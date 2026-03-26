import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { keyHint } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { fetchContent } from "../../src/content/fetch";
import { loadConfig } from "../../src/config";
import { getSessionEngineHealthSnapshot, runSearch, resolveSearchContext } from "../../src/search/orchestrator";
import type { BrowserMode } from "../../src/types";
import { isAbortError } from "../../src/util/abort";
import {
  blockedSummary,
  buildDebugSection,
  fallbackLabel,
  formatDuration,
  formatEngineLabel,
  formatFetchToolText,
  formatSearchToolText,
  maybeTruncate,
  summarizeAttempts,
  summarizeSnippet,
  type FetchDetailMode,
  type SearchDetailMode,
} from "./formatting";

const SearchParams = Type.Object({
  query: Type.String({ minLength: 1, description: "Natural language search query" }),
  numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Maximum results (default 5)" })),
  engine: Type.Optional(StringEnum(["google", "bing", "duckduckgo", "brave", "yahoo", "searxng"] as const, { description: "Optional search engine override" })),
  mode: Type.Optional(StringEnum(["auto", "visible", "headless", "ask", "disabled"] as const, { description: "Browser mode override" })),
  detail: Type.Optional(StringEnum(["lean", "full"] as const, { description: "Output detail level (default lean for token efficiency)" })),
  includeContent: Type.Optional(Type.Boolean({ description: "Fetch readable content for top results" })),
  debug: Type.Optional(Type.Boolean({ description: "Include detailed search/debug logs in the output" })),
  domainFilter: Type.Optional(Type.Array(Type.String({ description: "Domain filter; prefix with - to exclude" }))),
  context: Type.Optional(Type.String({ description: "User task context to help query shaping" })),
});

const FetchParams = Type.Object({
  url: Type.String({ description: "URL to extract readable content from" }),
  mode: Type.Optional(StringEnum(["auto", "visible", "headless", "ask", "disabled"] as const, { description: "Browser mode override" })),
  detail: Type.Optional(StringEnum(["summary", "full"] as const, { description: "Output detail level (default summary for token efficiency)" })),
});

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

        const detail: SearchDetailMode = params.detail ?? "lean";
        let contentResults: Array<any> = [];
        let contentSkippedMessage: string | undefined;

        if (params.includeContent && search.results.length > 0) {
          const config = loadConfig(ctx.cwd);
          const minScore = config.includeContentMinScore ?? 2;
          const eligibleResults = search.results.filter((result) => result.score >= minScore);
          const topResults = eligibleResults.slice(0, 3);
          const concurrency = Math.max(1, Math.min(3, config.maxContentFetchConcurrency ?? 2));
          let completed = 0;
          const total = topResults.length;

          if (topResults.length === 0) {
            contentSkippedMessage = `Skipped content fetch: no results met relevance threshold (score >= ${minScore}).`;
          }

          contentResults = await mapWithConcurrency(topResults, concurrency, async (result, index) => {
            emitProgress(`Reading source ${index + 1}/${Math.max(total, 1)}`, {
              phase: "content",
              completed,
              total,
              url: result.url,
            });
            try {
              const content = await fetchContent(ctx.cwd, result.url, mode, {
                signal,
                onProgress: (progress) => emitProgress(`${index + 1}/${Math.max(total, 1)}: ${progress.message}`, {
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
        }

        const text = formatSearchToolText({
          search,
          detail,
          requestedMode: params.mode,
          effectiveMode: mode || search.context.mode,
          debug: params.debug,
          progressLog,
          contentResults,
          contentSkippedMessage,
        });

        return {
          content: [{ type: "text", text }],
          details: {
            ...search,
            requestedMode: params.mode,
            effectiveMode: mode || search.context.mode,
            requestedDetail: params.detail,
            effectiveDetail: detail,
            debug: params.debug,
            progressLog,
            contentResults,
            contentSkippedMessage,
          },
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
      if (args.detail && args.detail !== "lean") text += theme.fg("dim", ` · ${args.detail}`);
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
        const detail: FetchDetailMode = params.detail ?? "summary";
        return {
          content: [{ type: "text", text: formatFetchToolText({ content, detail }) }],
          details: { ...content, requestedMode: params.mode, effectiveMode: mode || "auto", requestedDetail: params.detail, effectiveDetail: detail },
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
      if (args.detail && args.detail !== "summary") text += theme.fg("dim", ` · ${args.detail}`);
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
