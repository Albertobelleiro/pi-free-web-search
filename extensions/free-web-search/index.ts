import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { fetchContent } from "../../src/content/fetch";
import { loadConfig } from "../../src/config";
import { runSearch, resolveSearchContext } from "../../src/search/orchestrator";
import { isAbortError } from "../../src/util/abort";

const SearchParams = Type.Object({
  query: Type.String({ description: "Natural language search query" }),
  numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Maximum results (default 5)" })),
  engine: Type.Optional(StringEnum(["google", "bing", "duckduckgo", "brave", "yahoo", "searxng", "unknown"] as const, { description: "Optional search engine override" })),
  mode: Type.Optional(StringEnum(["auto", "visible", "headless", "ask", "disabled"] as const, { description: "Browser mode override" })),
  includeContent: Type.Optional(Type.Boolean({ description: "Fetch readable content for top results" })),
  domainFilter: Type.Optional(Type.Array(Type.String({ description: "Domain filter; prefix with - to exclude" }))),
  context: Type.Optional(Type.String({ description: "User task context to help query shaping" })),
});

const FetchParams = Type.Object({
  url: Type.String({ description: "URL to extract readable content from" }),
  mode: Type.Optional(StringEnum(["auto", "visible", "headless", "ask", "disabled"] as const, { description: "Browser mode override" })),
});

function maybeTruncate(text: string): string {
  const truncation = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncation.truncated) return truncation.content;
  return `${truncation.content}\n\n[Output truncated: ${truncation.outputLines}/${truncation.totalLines} lines, ${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function summarizeSnippet(text: string, max = 360): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const queue = items.map((item, index) => ({ item, index }));
  const output: R[] = new Array(items.length);
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      output[next.index] = await worker(next.item, next.index);
    }
  });
  await Promise.all(workers);
  return output;
}

export default function freeWebSearchExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      const context = await resolveSearchContext(ctx.cwd);
      const theme = ctx.ui.theme;
      ctx.ui.setStatus(
        "free-web",
        theme.fg("accent", "◉") + theme.fg("dim", ` ${context.browser.browserLabel} · ${context.engine.label} · ${context.mode}`),
      );
    } catch {
      ctx.ui.setStatus("free-web", ctx.ui.theme.fg("dim", "free-web ready"));
    }
  });

  pi.registerTool({
    name: "free_web_search",
    label: "Free Web Search",
    description: "Free browser-aware web search. Uses default browser/search-engine detection, HTTP search first, and browser automation fallback when result quality needs it.",
    promptSnippet: "Search the web with natural language, using a free browser-aware search pipeline with browser fallback when needed.",
    promptGuidelines: [
      "Use this tool for normal web research instead of asking for exact URLs.",
      "Pass includeContent=true when the user needs actual page contents, not just links.",
      "Use domainFilter when you need docs-only or GitHub-only results.",
    ],
    parameters: SearchParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const emitProgress = (message: string, details: Record<string, unknown> = {}) => {
        onUpdate?.({
          content: [{ type: "text", text: message }],
          details: { message, ...details },
        });
      };

      try {
        const search = await runSearch(
          ctx.cwd,
          {
            query: params.query,
            numResults: params.numResults ?? 5,
            engine: params.engine,
            mode: params.mode,
            includeContent: params.includeContent,
            domainFilter: params.domainFilter,
            context: params.context,
          },
          {
            signal,
            onProgress: (event) => emitProgress(event.message, { phase: event.phase, ...(event.metrics || {}) }),
          },
        );

        const lines: string[] = [];
        lines.push(`# Search: ${search.query}`);
        lines.push(`Context: browser=${search.context.browser.browserLabel}, engine=${search.context.engine.label}, mode=${search.context.mode}, browserFallback=${search.usedBrowserFallback ? "yes" : "no"}`);
        lines.push("");
        for (const result of search.results) {
          lines.push(`${result.rank}. ${result.title}`);
          lines.push(`   ${result.url}`);
          if (result.snippet) lines.push(`   ${summarizeSnippet(result.snippet, 240)}`);
        }

        if (params.includeContent && search.results.length > 0) {
          const topResults = search.results.slice(0, 3);
          const config = loadConfig(ctx.cwd);
          const concurrency = Math.max(1, Math.min(3, config.maxContentFetchConcurrency ?? 2));
          let completed = 0;

          lines.push("", "## Top result content");
          const contentResults = await mapWithConcurrency(topResults, concurrency, async (result, index) => {
            emitProgress(`Reading source ${completed + 1}/${topResults.length}`, {
              phase: "content",
              completed,
              total: topResults.length,
              url: result.url,
            });
            try {
              const content = await fetchContent(ctx.cwd, result.url, params.mode, {
                signal,
                onProgress: (progress) => emitProgress(`${index + 1}/${topResults.length}: ${progress.message}`, {
                  phase: "content",
                  subphase: progress.phase,
                  completed,
                  total: topResults.length,
                  url: result.url,
                }),
              });
              completed++;
              return { ok: true as const, result, content };
            } catch (error) {
              completed++;
              return { ok: false as const, result, error };
            }
          });

          for (const item of contentResults) {
            if (item.ok) {
              lines.push(`### ${item.content.title}`);
              lines.push(item.content.textExcerpt || item.content.markdown.slice(0, 500));
            } else {
              lines.push(`### ${item.result.title}`);
              lines.push(`Failed to extract content: ${errorMessage(item.error)}`);
            }
          }
        }

        return {
          content: [{ type: "text", text: maybeTruncate(lines.join("\n")) }],
          details: search,
        };
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          return {
            content: [{ type: "text", text: "Search cancelled." }],
            details: { cancelled: true, message: "Search cancelled" },
          };
        }
        throw error;
      }
    },
    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("free_web_search "));
      text += theme.fg("accent", `“${args.query}”`);
      if (args.engine) text += theme.fg("dim", ` · ${args.engine}`);
      if (args.mode) text += theme.fg("dim", ` · ${args.mode}`);
      if (args.includeContent) text += theme.fg("warning", " · content");
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, _context) {
      const details = result.details as any;

      if (isPartial) {
        const partialMessage = details?.message || "Searching...";
        let text = theme.fg("warning", partialMessage);
        if (details?.phase) text += theme.fg("dim", ` · ${details.phase}`);
        if (typeof details?.completed === "number" && typeof details?.total === "number") {
          text += theme.fg("dim", ` · ${details.completed}/${details.total}`);
        }
        return new Text(text, 0, 0);
      }

      if (details?.cancelled) {
        return new Text(theme.fg("warning", "Search cancelled"), 0, 0);
      }

      const count = details?.results?.length ?? 0;
      const browser = details?.context?.browser?.browserLabel ?? "browser";
      const engine = details?.context?.engine?.label ?? "engine";
      const fallback = details?.usedBrowserFallback ? "browser fallback" : "http";
      let text = theme.fg("success", `${count} results`);
      text += theme.fg("dim", ` · ${browser} · ${engine} · ${fallback}`);
      if (expanded && Array.isArray(details?.results)) {
        for (const item of details.results.slice(0, 5)) {
          text += `\n${theme.fg("accent", `${item.rank}. ${item.title}`)}`;
          text += `\n${theme.fg("dim", `   ${item.url}`)}`;
        }
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "free_fetch_content",
    label: "Free Fetch Content",
    description: "Fetch a web page and extract readable content using free HTTP + browser fallback extraction.",
    promptSnippet: "Fetch and extract readable content from a web page without requiring paid APIs.",
    promptGuidelines: ["Use this after free_web_search when you need the article content from a result URL."],
    parameters: FetchParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      try {
        const content = await fetchContent(ctx.cwd, params.url, params.mode, {
          signal,
          onProgress: (progress) => {
            onUpdate?.({
              content: [{ type: "text", text: progress.message }],
              details: { phase: progress.phase, message: progress.message },
            });
          },
        });
        const body = [`# ${content.title}`, `URL: ${content.url}`, `Browser fallback: ${content.usedBrowserFallback ? "yes" : "no"}`, "", content.markdown].join("\n");
        return {
          content: [{ type: "text", text: maybeTruncate(body) }],
          details: content,
        };
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          return {
            content: [{ type: "text", text: "Fetch cancelled." }],
            details: { cancelled: true, message: "Fetch cancelled" },
          };
        }
        throw error;
      }
    },
    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("free_fetch_content "));
      text += theme.fg("accent", args.url);
      if (args.mode) text += theme.fg("dim", ` · ${args.mode}`);
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, _context) {
      const details = result.details as any;
      if (isPartial) {
        const partialMessage = details?.message || "Fetching content...";
        return new Text(theme.fg("warning", partialMessage), 0, 0);
      }
      if (details?.cancelled) {
        return new Text(theme.fg("warning", "Fetch cancelled"), 0, 0);
      }
      const title = details?.title ?? "page";
      const excerpt = details?.textExcerpt ?? "";
      let text = theme.fg("success", title);
      text += theme.fg("dim", ` · ${details?.usedBrowserFallback ? "browser fallback" : "http"}`);
      if (expanded && excerpt) {
        text += `\n${theme.fg("dim", excerpt)}`;
      }
      return new Text(text, 0, 0);
    },
  });

  pi.registerCommand("free-search-info", {
    description: "Show detected browser and search engine for pi-free-web-search",
    handler: async (_args, ctx) => {
      const context = await resolveSearchContext(ctx.cwd);
      ctx.ui.notify(
        `Browser: ${context.browser.browserLabel}\nEngine: ${context.engine.label}\nMode: ${context.mode}\nExecutable: ${context.browser.executablePath || "n/a"}`,
        "info",
      );
    },
  });

  pi.registerCommand("free-search-test", {
    description: "Run an end-to-end smoke search: /free-search-test <query>",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /free-search-test <query>", "warning");
        return;
      }
      const result = await runSearch(ctx.cwd, { query, numResults: 3, includeContent: false });
      const top = result.results[0];
      ctx.ui.notify(`Top result: ${top?.title || "none"}\n${top?.url || ""}`, "info");
    },
  });
}
