import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";
import { loadConfig } from "../config";
import { detectBrowser } from "../detection/browser";
import { fetchPageHtmlViaBrowser } from "../search/browser";
import type { BrowserMode, ExtractedContent } from "../types";
import { throwIfAborted, withTimeout } from "../util/abort";

const turndown = new TurndownService();
const virtualConsole = new VirtualConsole();
virtualConsole.on("error", () => {});
virtualConsole.on("warn", () => {});

function buildContent(url: string, html: string, usedBrowserFallback: boolean): ExtractedContent {
  const dom = new JSDOM(html, { url, virtualConsole });
  const article = new Readability(dom.window.document).parse();
  const title = article?.title || dom.window.document.title || url;
  const contentHtml = article?.content || dom.window.document.body?.innerHTML || "";
  const markdown = turndown.turndown(contentHtml || "").trim();
  const textExcerpt = markdown.replace(/\s+/g, " ").slice(0, 400);
  return {
    url,
    title,
    markdown: markdown || textExcerpt || "",
    textExcerpt,
    usedBrowserFallback,
  };
}

function buildTextContent(url: string, text: string, usedBrowserFallback: boolean): ExtractedContent {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const titleLine = normalized.split("\n").map((line) => line.trim()).find(Boolean);
  const excerpt = normalized.replace(/\s+/g, " ").slice(0, 400);
  return {
    url,
    title: titleLine || url,
    markdown: normalized,
    textExcerpt: excerpt,
    usedBrowserFallback,
  };
}

function isHtmlContentType(contentType: string): boolean {
  if (!contentType) return true;
  return contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
}

function isTextLikeContentType(contentType: string): boolean {
  if (!contentType) return true;
  if (contentType.startsWith("text/")) return true;
  if (contentType.includes("json")) return true;
  if (contentType.includes("xml")) return true;
  if (contentType.includes("javascript")) return true;
  return false;
}

function isDefinitelyUnsupportedContentType(contentType: string): boolean {
  if (!contentType) return false;
  return contentType.includes("application/pdf")
    || contentType.includes("application/octet-stream")
    || contentType.startsWith("image/")
    || contentType.startsWith("audio/")
    || contentType.startsWith("video/")
    || contentType.includes("application/zip")
    || contentType.includes("application/gzip");
}

function detectBlockedContentResponse(status: number, html: string, url: string): string | undefined {
  if ([401, 403, 429, 503].includes(status)) return `HTTP ${status}`;

  const sample = html.slice(0, 60000).toLowerCase();
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1]?.toLowerCase() || "";
  const combined = `${title} ${sample}`;

  if (combined.includes("just a moment") && combined.includes("verification")) return "verification challenge";
  if (combined.includes("performing security verification")) return "security verification";
  if (combined.includes("verify you are human")) return "human verification";
  if (combined.includes("captcha")) return "captcha";
  if (combined.includes("access denied")) return "access denied";

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "x.com" || hostname.endsWith(".x.com")) {
      if (combined.includes("something went wrong, but don") || combined.includes("privacy related extensions may cause issues on x.com")) {
        return "x.com interstitial";
      }
    }
  } catch {
    // Ignore URL parsing failures here and let outer logic surface URL errors.
  }

  return undefined;
}

function looksLikeBinaryPayload(body: string): boolean {
  return body.startsWith("%PDF-") || body.startsWith("PK\u0003\u0004");
}

function needsBrowserRetry(content: ExtractedContent, minimumMarkdownLength: number): boolean {
  if (!content.markdown.trim()) return true;
  if (content.markdown.length >= minimumMarkdownLength) return false;

  const normalized = content.markdown.toLowerCase();
  const suspicious = [
    "loading",
    "please ensure javascript",
    "enable javascript",
    "verify you are human",
    "just a moment",
    "captcha",
    "access denied",
    "sign in",
    "log in",
  ];
  if (suspicious.some((phrase) => normalized.includes(phrase))) return true;

  return content.markdown.length < 60;
}

function ensureExtractedContent(content: ExtractedContent, url: string): ExtractedContent {
  if (content.markdown.trim().length > 0) return content;
  throw new Error(`No readable content extracted from ${url}`);
}

export interface FetchContentProgress {
  phase: "http-fetch" | "http-parse" | "browser-fallback" | "done";
  message: string;
}

export interface FetchContentOptions {
  signal?: AbortSignal;
  onProgress?: (progress: FetchContentProgress) => void;
}

export async function fetchContent(
  cwd: string,
  url: string,
  mode?: BrowserMode,
  options: FetchContentOptions = {},
): Promise<ExtractedContent> {
  const config = loadConfig(cwd);
  const emit = (phase: FetchContentProgress["phase"], message: string) => options.onProgress?.({ phase, message });

  throwIfAborted(options.signal);
  emit("http-fetch", `Fetching ${url}`);

  const response = await withTimeout(
    "HTTP content fetch",
    config.httpTimeoutMs ?? 10000,
    async (timeoutSignal) => {
      return await fetch(url, {
        headers: {
          "user-agent": config.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
          "accept-language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: timeoutSignal,
      });
    },
    options.signal,
  );

  const status = response.status;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (isDefinitelyUnsupportedContentType(contentType)) {
    throw new Error(`Unsupported content type for readable extraction: ${contentType}`);
  }

  const body = await response.text();
  throwIfAborted(options.signal);

  if (looksLikeBinaryPayload(body)) {
    throw new Error("Unsupported binary content for readable extraction");
  }

  const blockedReason = detectBlockedContentResponse(status, body, url);
  if (blockedReason) {
    throw new Error(`Content fetch blocked: ${blockedReason}`);
  }

  if (!isTextLikeContentType(contentType)) {
    throw new Error(`Unsupported content type for readable extraction: ${contentType || "unknown"}`);
  }

  if (!isHtmlContentType(contentType)) {
    emit("done", "Content extracted as plain text");
    return ensureExtractedContent(buildTextContent(url, body, false), url);
  }

  throwIfAborted(options.signal);
  emit("http-parse", "Extracting readable content");

  const content = buildContent(url, body, false);
  const minimumMarkdownLength = config.contentMinMarkdownLength ?? 200;
  const resolvedMode = mode || config.mode || "auto";

  if (!needsBrowserRetry(content, minimumMarkdownLength)) {
    emit("done", "Content extracted via HTTP");
    return ensureExtractedContent(content, url);
  }

  if (resolvedMode === "disabled" || resolvedMode === "ask") {
    throw new Error("Browser fallback disabled and HTTP extraction was insufficient");
  }

  emit("browser-fallback", "Page is JS-heavy, retrying via browser rendering");
  const browser = await detectBrowser(config);
  const browserMode = resolvedMode === "auto" ? "headless" : resolvedMode;
  const htmlViaBrowser = await fetchPageHtmlViaBrowser(
    browser,
    browserMode,
    url,
    {
      signal: options.signal,
      navigationTimeoutMs: config.browserNavigationTimeoutMs ?? 12000,
      settleTimeoutMs: config.browserResultWaitMs ?? 700,
    },
  );

  throwIfAborted(options.signal);
  const browserBlockedReason = detectBlockedContentResponse(200, htmlViaBrowser, url);
  if (browserBlockedReason) {
    throw new Error(`Content fetch blocked after browser fallback: ${browserBlockedReason}`);
  }

  const extracted = ensureExtractedContent(buildContent(url, htmlViaBrowser, true), url);
  emit("done", "Content extracted via browser fallback");
  return extracted;
}
