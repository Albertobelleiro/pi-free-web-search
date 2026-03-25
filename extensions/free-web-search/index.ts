import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, keyHint, truncateHead } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { fetchContent } from "../../src/content/fetch";
import { loadConfig } from "../../src/config";
import { getSessionEngineHealthSnapshot, runSearch, resolveSearchContext } from "../../src/search/orchestrator";
import type { BrowserMode } from "../../src/types";
import { isAbortError } from "../../src/util/abort";

const SearchParams = Type.Object({
  query: Type.String({ minLength: 1, description: "Natural language search query" }),
  numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Maximum results (default 5)" })),
  engine: Type.Optional(StringEnum(["google", "bing", "duckduckgo", "brave", "yahoo", "searxng"] as const, { description: "Optional search engine override" })),
  mode: Type.Optional(StringEnum(["auto", "visible", "headless", "ask", "disabled"] as const, { description: "Browser mode override" })),
  includeContent: Type.Optional(Type.Boolean({ description: "Fetch readable content for top results" })),
  debug: Type.Optional(Type.Boolean({ description: "Include detailed search/debug logs in the output" })),
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

function formatEngineLabel(engine?: string): string {
  if (!engine) return "search engine";
  if (engine === "duckduckgo") return "DuckDuckGo";
  if (engine === "bing") return "Bing";
  if (engine === "google") return "Google";
  if (engine === "yahoo") return "Yahoo";
  if (engine === "brave") return "Brave";
  return engine;
}

function summarizeAttempts(attempts: Array<any> = []): string | undefined {
  if (attempts.length === 0) return undefined;
  return attempts
    .map((attempt) => {
      if (attempt?.blockedReason) return `${attempt.engine} blocked (${attempt.blockedReason})`;
      if (attempt?.error) return `${attempt.engine} failed (${attempt.error})`;
      return `${attempt.engine} ${attempt?.finalResults ?? 0} result(s)`;
    })
    .join(" -> ");
}

function blockedSummary(attempts: Array<any> = []): string | undefined {
  if (attempts.length === 0) return undefined;
  const hasAnyResults = attempts.some((attempt) => (attempt?.finalResults ?? 0) > 0);
  if (hasAnyResults) return undefined;

  const blockedAttempt = attempts.find((attempt) => attempt?.blockedReason);
  if (!blockedAttempt?.blockedReason) return undefined;
  return `${formatEngineLabel(blockedAttempt.engine)} blocked this query (${blockedAttempt.blockedReason})`;
}

async function resolveAskMode(mode: BrowserMode | undefined, ctx: ExtensionContext, signal?: AbortSignal): Promise<BrowserMode | undefined> {
  if (mode !== "ask") return mode;

  if (!ctx.hasUI) return "disabled";

  const approved = await ctx.ui.confirm(
    "Allow browser automation?",
    "free-web-search wants to use browser automation for this request. Approve browser fallback?",
    { signal, timeout: 30000 },
  );

  return approved ? "headless" : "disabled";
}

function fallbackLabel(details: any): string | undefined {
  const attempts = Array.isArray(details?.attempts) ? details.attempts : [];
  const initialEngine = attempts[0]?.engine;
  const finalEngine = details?.context?.engine?.id;
  if (!initialEngine || !finalEngine || initialEngine === finalEngine) return undefined;
  return `fallback from ${initialEngine}`;
}

function formatMetrics(metrics: Record<string, unknown> = {}): string {
  const entries = Object.entries(metrics)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`);
  return entries.length > 0 ? ` [${entries.join(", ")}]` : "";
}

function formatDuration(durationMs?: number): string | undefined {
  if (typeof durationMs !== "number") return undefined;
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function buildDebugSection(progressLog: Array<{ phase: string; message: string; metrics?: Record<string, unknown> }>, attempts: Array<any>): string[] {
  const lines: string[] = [];
  lines.push("## Debug log");
  for (const entry of progressLog) {
    lines.push(`- ${entry.phase}: ${entry.message}${formatMetrics(entry.metrics)}`);
  }
  if (attempts.length > 0) {
    lines.push("", "## Attempt details");
    for (const attempt of attempts) {
      lines.push(`- engine=${attempt.engine} searchUrl=${attempt.searchUrl}`);
      lines.push(`  httpResults=${attempt.httpResults} browserResults=${attempt.browserResults} finalResults=${attempt.finalResults} attemptedBrowserFallback=${attempt.attemptedBrowserFallback} usedBrowserFallback=${attempt.usedBrowserFallback}`);
      if (attempt.durationMs) lines.push(`  duration=${attempt.durationMs}ms`);
      if (attempt.blockedReason) lines.push(`  blocked=${attempt.blockedSource || "unknown"} (${attempt.blockedReason})`);
      if (attempt.httpStatus) lines.push(`  httpStatus=${attempt.httpStatus}`);
      if (attempt.pageTitle) lines.push(`  pageTitle=${attempt.pageTitle}`);
      if (attempt.error) lines.push(`  error=${attempt.error}`);
    }
  }
  return lines;
}

function getTextComponent(lastComponent: unknown): Text {
  return lastComponent instanceof Text ? lastComponent : new Text("", 0, 0);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      output[index] = await worker(items[index], index);
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
      const progressLog: Array<{ phase: string; message: string; metrics?: Record<string, unknown> }> = [];
      const emitProgress = (message: string, details: Record<string, unknown> = {}) => {
        progressLog.push({
          phase: String(details.phase || "unknown"),
          message,
          metrics: details,
        });
        onUpdate?.({
          content: [{ type: "text", text: message }],
          details: { message, ...details },
        });
      };

      try {
        const query = params.query.trim();
        if (!query) {
          return {
            content: [{ type: "text", text: "Search query must not be empty." }],
            details: { validationError: true, field: "query", message: "Search query must not be empty" },
          };
        }

        const mode = await resolveAskMode(params.mode, ctx, signal);
        if (params.mode === "ask" && mode === "disabled") {
          emitProgress("Browser fallback not approved; continuing in disabled mode", { phase: "detecting", askResolvedMode: mode });
        }

        const search = await runSearch(
          ctx.cwd,
          {
            query,
            numResults: params.numResults ?? 5,
            engine: params.engine,
            mode,
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
        const attemptsSummary = summarizeAttempts(search.attempts);
        const blockedMessage = blockedSummary(search.attempts);
        const fallback = fallbackLabel(search);
        lines.push(`# Search: ${search.query}`);
        lines.push(`Context: browser=${search.context.browser.browserLabel}, engine=${search.context.engine.label}${fallback ? ` (${fallback})` : ""}, mode=${search.context.mode}, browserFallback=${search.usedBrowserFallback ? "yes" : "no"}`);
        if (blockedMessage) {
          lines.push(`Status: ${blockedMessage}`);
        } else if (attemptsSummary && (search.attempts.length > 1 || search.attempts.some((attempt) => attempt.blockedReason || attempt.error))) {
          lines.push(`Attempts: ${attemptsSummary}`);
        }
        lines.push("");
        for (const result of search.results) {
          lines.push(`${result.rank}. ${result.title}`);
          lines.push(`   ${result.url}`);
          if (result.snippet) lines.push(`   ${summarizeSnippet(result.snippet, 240)}`);
        }

        if (params.includeContent && search.results.length > 0) {
          const config = loadConfig(ctx.cwd);
          const minScore = config.includeContentMinScore ?? 2;
          const eligibleResults = search.results.filter((result) => result.score >= minScore);
          const topResults = eligibleResults.slice(0, 3);
          const concurrency = Math.max(1, Math.min(3, config.maxContentFetchConcurrency ?? 2));
          let completed = 0;
          const total = topResults.length;

          lines.push("", "## Top result content");
          if (topResults.length === 0) {
            lines.push(`Skipped content fetch: no results met relevance threshold (score >= ${minScore}).`);
          }

          const contentResults = await mapWithConcurrency(topResults, concurrency, async (result, index) => {
            emitProgress(`Reading source ${index + 1}/${total}`, {
              phase: "content",
              completed,
              total,
              url: result.url,
            });
            try {
              const content = await fetchContent(ctx.cwd, result.url, mode, {
                signal,
                onProgress: (progress) => emitProgress(`${index + 1}/${total}: ${progress.message}`, {
                  phase: "content",
                  subphase: progress.phase,
                  completed,
                  total,
                  url: result.url,
                }),
              });
              completed += 1;
              emitProgress(`Read ${completed}/${total} sources`, { phase: "content", completed, total, url: result.url });
              return { ok: true as const, result, content };
            } catch (error) {
              completed += 1;
              emitProgress(`Read ${completed}/${total} sources`, { phase: "content", completed, total, url: result.url });
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

        if (params.debug) {
          lines.push("", ...buildDebugSection(progressLog, search.attempts));
        }

        return {
          content: [{ type: "text", text: maybeTruncate(lines.join("\n")) }],
          details: { ...search, requestedMode: params.mode, effectiveMode: mode || search.context.mode, debug: params.debug, progressLog },
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
    renderCall(args, theme, context) {
      const textComponent = getTextComponent(context.lastComponent);
      let text = theme.fg("toolTitle", theme.bold("free_web_search "));
      text += theme.fg("accent", `“${summarizeSnippet(args.query, 96)}”`);
      if (args.engine) text += theme.fg("dim", ` · ${args.engine}`);
      if (args.mode) text += theme.fg("dim", ` · ${args.mode}`);
      if (args.includeContent) text += theme.fg("warning", " · content");
      if (args.debug) text += theme.fg("warning", " · debug");
      textComponent.setText(text);
      return textComponent;
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = result.details as any;
      const textComponent = getTextComponent(context.lastComponent);

      if (isPartial) {
        const partialMessage = details?.message || "Searching...";
        let text = theme.fg("warning", partialMessage);
        if (details?.phase) text += theme.fg("dim", ` · ${details.phase}`);
        if (typeof details?.completed === "number" && typeof details?.total === "number") {
          text += theme.fg("dim", ` · ${details.completed}/${details.total}`);
        }
        textComponent.setText(text);
        return textComponent;
      }

      if (details?.cancelled) {
        textComponent.setText(theme.fg("warning", "Search cancelled"));
        return textComponent;
      }

      const count = details?.results?.length ?? 0;
      const browser = details?.context?.browser?.browserLabel ?? "browser";
      const engine = details?.context?.engine?.label ?? "engine";
      const path = details?.usedBrowserFallback ? "browser" : "http";
      const fallback = fallbackLabel(details);
      const attemptsSummary = summarizeAttempts(details?.attempts);
      const blockedMessage = blockedSummary(details?.attempts);
      let text = theme.fg("success", `${count} result${count === 1 ? "" : "s"}`);
      text += theme.fg("dim", ` · ${engine} · ${path} · ${browser}`);
      if (fallback) text += theme.fg("warning", ` · ${fallback}`);

      if (!expanded && (count > 0 || attemptsSummary || blockedMessage)) {
        text += theme.fg("muted", ` (${keyHint("app.tools.expand", "details")})`);
      }

      if (expanded && blockedMessage) {
        text += `\n${theme.fg("warning", blockedMessage)}`;
      }

      if (expanded && attemptsSummary) {
        text += `\n${theme.fg("muted", `Attempts: ${attemptsSummary}`)}`;
        for (const attempt of details?.attempts || []) {
          const extra = [
            attempt?.httpStatus ? `status=${attempt.httpStatus}` : "",
            attempt?.pageTitle ? `title=${attempt.pageTitle}` : "",
            typeof attempt?.durationMs === "number" ? `duration=${formatDuration(attempt.durationMs)}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          if (extra) text += `\n${theme.fg("dim", `   ${attempt.engine}: ${extra}`)}`;
        }
      }

      if (expanded && Array.isArray(details?.results)) {
        for (const item of details.results.slice(0, 5)) {
          text += `\n${theme.fg("accent", `${item.rank}. ${item.title}`)}`;
          text += `\n${theme.fg("dim", `   ${item.url}`)}`;
          if (item.snippet) text += `\n${theme.fg("muted", `   ${summarizeSnippet(item.snippet, 140)}`)}`;
        }
      }

      textComponent.setText(text);
      return textComponent;
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
        const mode = await resolveAskMode(params.mode, ctx, signal);
        if (params.mode === "ask" && mode === "disabled") {
          onUpdate?.({
            content: [{ type: "text", text: "Browser fallback not approved; continuing in disabled mode" }],
            details: { phase: "http-fetch", message: "Browser fallback not approved; continuing in disabled mode" },
          });
        }

        const content = await fetchContent(ctx.cwd, params.url, mode, {
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
          details: { ...content, requestedMode: params.mode, effectiveMode: mode || "auto" },
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
    renderCall(args, theme, context) {
      const textComponent = getTextComponent(context.lastComponent);
      let text = theme.fg("toolTitle", theme.bold("free_fetch_content "));
      text += theme.fg("accent", summarizeSnippet(args.url, 100));
      if (args.mode) text += theme.fg("dim", ` · ${args.mode}`);
      textComponent.setText(text);
      return textComponent;
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = result.details as any;
      const textComponent = getTextComponent(context.lastComponent);

      if (isPartial) {
        const partialMessage = details?.message || "Fetching content...";
        textComponent.setText(theme.fg("warning", partialMessage));
        return textComponent;
      }
      if (details?.cancelled) {
        textComponent.setText(theme.fg("warning", "Fetch cancelled"));
        return textComponent;
      }

      const title = details?.title ?? "page";
      const excerpt = details?.textExcerpt ?? "";
      let text = theme.fg("success", title);
      text += theme.fg("dim", ` · ${details?.usedBrowserFallback ? "browser" : "http"}`);

      if (!expanded && excerpt) {
        text += theme.fg("muted", ` (${keyHint("app.tools.expand", "preview")})`);
      }

      if (expanded && excerpt) {
        text += `\n${theme.fg("dim", summarizeSnippet(excerpt, 280))}`;
      }

      textComponent.setText(text);
      return textComponent;
    },
  });

  pi.registerCommand("free-search-info", {
    description: "Show detected browser and search engine for pi-free-web-search",
    handler: async (_args, ctx) => {
      const context = await resolveSearchContext(ctx.cwd);
      const config = loadConfig(ctx.cwd);
      ctx.ui.notify(
        `Browser: ${context.browser.browserLabel}\nEngine: ${context.engine.label}\nMode: ${context.mode}\nLocale: ${config.locale || "n/a"}\nLanguage: ${config.language || "n/a"}\nExecutable: ${context.browser.executablePath || "n/a"}`,
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

  pi.registerCommand("free-search-debug", {
    description: "Run a search and show detailed debug logs: /free-search-debug <query>",
    handler: async (args, ctx) => {
      const query = args.trim();
      if (!query) {
        ctx.ui.notify("Usage: /free-search-debug <query>", "warning");
        return;
      }

      const progressLog: Array<{ phase: string; message: string; metrics?: Record<string, unknown> }> = [];
      const search = await runSearch(
        ctx.cwd,
        { query, numResults: 5, includeContent: false },
        {
          onProgress: (event) => {
            progressLog.push({ phase: event.phase, message: event.message, metrics: event.metrics || {} });
          },
        },
      );

      const lines = [
        `Query: ${query}`,
        `Browser: ${search.context.browser.browserLabel}`,
        `Engine: ${search.context.engine.label}`,
        `Mode: ${search.context.mode}`,
        `Results: ${search.results.length}`,
        "",
        ...buildDebugSection(progressLog, search.attempts),
      ];

      ctx.ui.notify(maybeTruncate(lines.join("\n")), "info");
    },
  });

  pi.registerCommand("free-search-status", {
    description: "Show recent per-engine health and cooldown status for this session",
    handler: async (_args, ctx) => {
      const snapshot = getSessionEngineHealthSnapshot();
      if (snapshot.length === 0) {
        ctx.ui.notify("No engine health data collected yet in this session.", "info");
        return;
      }

      const now = Date.now();
      const lines = ["Engine health (session):"];
      for (const entry of snapshot) {
        const pieces = [
          `${formatEngineLabel(entry.engine)}:`,
          `ok=${entry.successes}`,
          `fail=${entry.failures}`,
          `blocked=${entry.blocked}`,
          `streak=${entry.consecutiveFailures}`,
        ];
        const avg = formatDuration(entry.avgLatencyMs);
        const last = formatDuration(entry.lastLatencyMs);
        if (avg) pieces.push(`avg=${avg}`);
        if (last) pieces.push(`last=${last}`);
        if (entry.coolingDown && entry.coolDownUntil) {
          pieces.push(`cooldown=${Math.max(0, Math.ceil((entry.coolDownUntil - now) / 1000))}s`);
        }
        if (entry.lastFailureReason) pieces.push(`reason=${entry.lastFailureReason}`);
        lines.push(`- ${pieces.join(" · ")}`);
      }

      ctx.ui.notify(maybeTruncate(lines.join("\n")), "info");
    },
  });
}
