import { formatSize, truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import type { ExtractedContent, SearchResponse, SearchResult } from "../../src/types";

export type SearchDetailMode = "lean" | "full";
export type FetchDetailMode = "summary" | "full";

export type SearchContentResult =
  | { ok: true; result: SearchResult; content: ExtractedContent }
  | { ok: false; result: SearchResult; error: unknown };

export interface ProgressLogEntry {
  phase: string;
  message: string;
  metrics?: Record<string, unknown>;
}

export function maybeTruncate(text: string): string {
  const truncation = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncation.truncated) return truncation.content;
  return `${truncation.content}\n\n[Output truncated: ${truncation.outputLines}/${truncation.totalLines} lines, ${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}]`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function summarizeSnippet(text: string, max = 360): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export function summarizeReadableText(text: string, max = 360): string {
  const flattened = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/`+/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return summarizeSnippet(flattened, max);
}

export function formatEngineLabel(engine?: string): string {
  if (!engine) return "search engine";
  if (engine === "duckduckgo") return "DuckDuckGo";
  if (engine === "bing") return "Bing";
  if (engine === "google") return "Google";
  if (engine === "yahoo") return "Yahoo";
  if (engine === "brave") return "Brave";
  return engine;
}

export function summarizeAttempts(attempts: Array<any> = []): string | undefined {
  if (attempts.length === 0) return undefined;
  return attempts
    .map((attempt) => {
      if (attempt?.blockedReason) return `${attempt.engine} blocked (${attempt.blockedReason})`;
      if (attempt?.error) return `${attempt.engine} failed (${attempt.error})`;
      return `${attempt.engine} ${attempt?.finalResults ?? 0} result(s)`;
    })
    .join(" -> ");
}

export function blockedSummary(attempts: Array<any> = []): string | undefined {
  if (attempts.length === 0) return undefined;
  const hasAnyResults = attempts.some((attempt) => (attempt?.finalResults ?? 0) > 0);
  if (hasAnyResults) return undefined;

  const blockedAttempt = attempts.find((attempt) => attempt?.blockedReason);
  if (!blockedAttempt?.blockedReason) return undefined;
  return `${formatEngineLabel(blockedAttempt.engine)} blocked this query (${blockedAttempt.blockedReason})`;
}

export function fallbackLabel(details: any): string | undefined {
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

export function formatDuration(durationMs?: number): string | undefined {
  if (typeof durationMs !== "number") return undefined;
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function buildDebugSection(progressLog: ProgressLogEntry[], attempts: Array<any>): string[] {
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

function appendResultLines(lines: string[], search: SearchResponse, snippetLimit: number) {
  for (const result of search.results) {
    lines.push(`${result.rank}. ${result.title}`);
    lines.push(result.url);
    if (result.snippet) lines.push(summarizeSnippet(result.snippet, snippetLimit));
    lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
}

function appendLeanContent(lines: string[], contentResults: SearchContentResult[]) {
  if (contentResults.length === 0) return;
  lines.push("", "Sources:");
  for (const item of contentResults) {
    if (item.ok) {
      lines.push(`- Source: ${item.content.title}`);
      lines.push(`  ${summarizeReadableText(item.content.markdown || item.content.textExcerpt, 140)}`);
    } else {
      lines.push(`- Source: ${item.result.title}`);
      lines.push(`  Failed to extract content: ${errorMessage(item.error)}`);
    }
  }
}

function appendFullContent(lines: string[], contentResults: SearchContentResult[]) {
  lines.push("", "## Top result content");
  if (contentResults.length === 0) return;
  for (const item of contentResults) {
    if (item.ok) {
      lines.push(`### ${item.content.title}`);
      lines.push(summarizeReadableText(item.content.markdown || item.content.textExcerpt, 500));
    } else {
      lines.push(`### ${item.result.title}`);
      lines.push(`Failed to extract content: ${errorMessage(item.error)}`);
    }
  }
}

export function formatSearchToolText(options: {
  search: SearchResponse;
  detail?: SearchDetailMode;
  requestedMode?: string;
  effectiveMode?: string;
  debug?: boolean;
  progressLog?: ProgressLogEntry[];
  contentResults?: SearchContentResult[];
  contentSkippedMessage?: string;
}): string {
  const {
    search,
    detail = "lean",
    debug = false,
    progressLog = [],
    contentResults = [],
    contentSkippedMessage,
  } = options;

  const lines: string[] = [];
  const attemptsSummary = summarizeAttempts(search.attempts);
  const blockedMessage = blockedSummary(search.attempts);
  const fallback = fallbackLabel(search);

  if (detail === "full") {
    lines.push(`# Search: ${search.query}`);
    lines.push(`Context: browser=${search.context.browser.browserLabel}, engine=${search.context.engine.label}${fallback ? ` (${fallback})` : ""}, mode=${search.context.mode}, browserFallback=${search.usedBrowserFallback ? "yes" : "no"}`);
    if (blockedMessage) {
      lines.push(`Status: ${blockedMessage}`);
    } else if (attemptsSummary && (search.attempts.length > 1 || search.attempts.some((attempt) => attempt.blockedReason || attempt.error))) {
      lines.push(`Attempts: ${attemptsSummary}`);
    }
    lines.push("");
    appendResultLines(lines, search, 240);
    if (contentSkippedMessage) lines.push("", contentSkippedMessage);
    if (contentResults.length > 0) appendFullContent(lines, contentResults);
  } else {
    if (blockedMessage) lines.push(`Status: ${blockedMessage}`, "");
    appendResultLines(lines, search, 120);
    if (contentSkippedMessage) lines.push("", contentSkippedMessage);
    appendLeanContent(lines, contentResults);
  }

  if (debug) {
    lines.push("", ...buildDebugSection(progressLog, search.attempts));
  }

  return maybeTruncate(lines.join("\n").trim());
}

export function formatFetchToolText(options: {
  content: ExtractedContent;
  detail?: FetchDetailMode;
}): string {
  const { content, detail = "summary" } = options;

  if (detail === "full") {
    const body = [
      `# ${content.title}`,
      `URL: ${content.url}`,
      `Browser fallback: ${content.usedBrowserFallback ? "yes" : "no"}`,
      "",
      content.markdown,
    ].join("\n");
    return maybeTruncate(body);
  }

  const lines = [content.title, content.url];
  if (content.usedBrowserFallback) lines.push("Browser fallback: yes");
  lines.push("", summarizeReadableText(content.markdown || content.textExcerpt, 280));
  return maybeTruncate(lines.join("\n"));
}
