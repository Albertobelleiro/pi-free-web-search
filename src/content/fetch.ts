import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";
import { loadConfig } from "../config";
import { detectBrowser } from "../detection/browser";
import { fetchPageHtmlViaBrowser } from "../search/browser";
import type { BrowserMode, ExtractedContent, FreeWebSearchConfig } from "../types";
import { throwIfAborted, withTimeout } from "../util/abort";

// ---------------------------------------------------------------------------
// Shared instances
// ---------------------------------------------------------------------------

const turndown = new TurndownService();
const virtualConsole = new VirtualConsole();
virtualConsole.on("error", () => {});
virtualConsole.on("warn", () => {});

// ---------------------------------------------------------------------------
// Content building
// ---------------------------------------------------------------------------

function buildContent(url: string, html: string, usedBrowserFallback: boolean): ExtractedContent {
  const dom = new JSDOM(html, { url, virtualConsole });
  const article = new Readability(dom.window.document).parse();
  const title = article?.title || dom.window.document.title || url;
  const contentHtml = article?.content || dom.window.document.body?.innerHTML || "";
  const markdown = turndown.turndown(contentHtml || "").trim();
  const textExcerpt = markdown.replace(/\s+/g, " ").slice(0, 400);
  return { url, title, markdown: markdown || textExcerpt || "", textExcerpt, usedBrowserFallback };
}

function buildTextContent(url: string, text: string, usedBrowserFallback: boolean): ExtractedContent {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const titleLine = normalized.split("\n").map((line) => line.trim()).find(Boolean);
  const excerpt = normalized.replace(/\s+/g, " ").slice(0, 400);
  return { url, title: titleLine || url, markdown: normalized, textExcerpt: excerpt, usedBrowserFallback };
}

// ---------------------------------------------------------------------------
// Content type classification
// ---------------------------------------------------------------------------

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

function looksLikeBinaryPayload(body: string): boolean {
  return body.startsWith("%PDF-") || body.startsWith("PK\u0003\u0004");
}

// ---------------------------------------------------------------------------
// Blocked / login-redirect detection
// ---------------------------------------------------------------------------

/**
 * Detects blocked responses from content pages (403, 429, captcha, interstitials).
 *
 * This is intentionally separate from `detectBlockedSearchResponse` in search/http.ts,
 * which checks for search-engine-specific patterns (unusual traffic, bot challenges,
 * DuckDuckGo homepage redirect). Content pages have their own blocking signals.
 */
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
    // URL parsing failures are non-fatal; outer logic surfaces URL errors.
  }

  return undefined;
}

/** Known authentication/login domains. */
const AUTH_DOMAINS = [
  "accounts.google.com",
  "login.microsoftonline.com",
  "login.live.com",
  "auth0.com",
  "okta.com",
];

/** Hostname prefixes that indicate an auth/login service. */
const AUTH_HOSTNAME_PREFIXES = ["login.", "signin.", "auth.", "sso.", "accounts.", "idp."];

/** Content patterns that indicate a login wall when combined with a hostname redirect. */
const LOGIN_CONTENT_PATTERNS = ["sign in", "log in", "authentication required", "create an account to continue"];

/**
 * Detects redirect-to-login pages: sites that return 200 but redirect to an
 * auth domain or serve a login form instead of the requested content.
 *
 * Only triggers when the response was redirected to a different hostname —
 * this avoids false positives on pages that legitimately mention "sign in".
 */
function detectLoginRedirect(requestedUrl: string, finalUrl: string, html: string): string | undefined {
  try {
    const requested = new URL(requestedUrl);
    const final = new URL(finalUrl);

    if (requested.hostname.toLowerCase() === final.hostname.toLowerCase()) return undefined;

    const finalHost = final.hostname.toLowerCase();

    if (AUTH_DOMAINS.some((d) => finalHost === d || finalHost.endsWith(`.${d}`))) {
      return `redirected to login (${final.hostname})`;
    }

    if (AUTH_HOSTNAME_PREFIXES.some((p) => finalHost.startsWith(p))) {
      return `redirected to login (${final.hostname})`;
    }

    const sample = html.slice(0, 20000).toLowerCase();
    if (LOGIN_CONTENT_PATTERNS.some((p) => sample.includes(p))) {
      return `redirected to login page (${final.hostname})`;
    }
  } catch {
    // URL parsing failures are not login redirects.
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Quality heuristics
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Browser fallback
// ---------------------------------------------------------------------------

function isBrowserAllowed(mode: BrowserMode): boolean {
  return mode !== "disabled" && mode !== "ask";
}

/** Fetch page content via browser automation and extract readable markdown. */
async function fetchViaBrowser(
  config: FreeWebSearchConfig,
  url: string,
  resolvedMode: BrowserMode,
  options: FetchContentOptions,
): Promise<ExtractedContent> {
  const resolveBrowser = options.deps?.detectBrowser ?? detectBrowser;
  const fetchHtml = options.deps?.fetchPageHtmlViaBrowser ?? fetchPageHtmlViaBrowser;
  const emit = (phase: FetchContentProgress["phase"], message: string) => options.onProgress?.({ phase, message });

  const browser = await resolveBrowser(config);
  const browserMode = resolvedMode === "auto" ? "headless" : resolvedMode;
  const htmlViaBrowser = await fetchHtml(browser, browserMode, url, {
    signal: options.signal,
    navigationTimeoutMs: config.browserNavigationTimeoutMs ?? 12000,
    settleTimeoutMs: config.browserResultWaitMs ?? 700,
  });

  throwIfAborted(options.signal);

  const browserBlockedReason = detectBlockedContentResponse(200, htmlViaBrowser, url);
  if (browserBlockedReason) {
    throw new Error(`Content fetch blocked after browser fallback: ${browserBlockedReason}`);
  }

  const extracted = ensureExtractedContent(buildContent(url, htmlViaBrowser, true), url);
  emit("done", "Content extracted via browser fallback");
  return extracted;
}

// ---------------------------------------------------------------------------
// HTTP request headers
// ---------------------------------------------------------------------------

/** Standard browser-like headers to reduce bot detection on direct URL fetches. */
function buildFetchHeaders(config: FreeWebSearchConfig): Record<string, string> {
  return {
    "user-agent": config.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    "accept-language": "en-US,en;q=0.9",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "cache-control": "no-cache",
    "pragma": "no-cache",
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FetchContentProgress {
  phase: "http-fetch" | "http-parse" | "browser-fallback" | "done";
  message: string;
}

export interface FetchContentOptions {
  signal?: AbortSignal;
  onProgress?: (progress: FetchContentProgress) => void;
  /** Dependency injection for testing browser fallback in isolation. */
  deps?: {
    fetchPageHtmlViaBrowser?: typeof fetchPageHtmlViaBrowser;
    detectBrowser?: typeof detectBrowser;
  };
}

/**
 * Fetch a URL and extract readable markdown content.
 *
 * Flow:
 *   HTTP fetch → blocked/login check → if blocked + browser allowed → browser fallback
 *                                     → if blocked + browser disabled → throw
 *              → Readability parse    → if thin/JS + browser allowed → browser fallback
 *                                     → if thin/JS + browser disabled → throw
 *              → return content
 */
export async function fetchContent(
  cwd: string,
  url: string,
  mode?: BrowserMode,
  options: FetchContentOptions = {},
): Promise<ExtractedContent> {
  const config = loadConfig(cwd);
  const emit = (phase: FetchContentProgress["phase"], message: string) => options.onProgress?.({ phase, message });
  const resolvedMode = mode || config.mode || "auto";
  const browserCanEscalate = isBrowserAllowed(resolvedMode);

  // --- HTTP fetch --------------------------------------------------------

  throwIfAborted(options.signal);
  emit("http-fetch", `Fetching ${url}`);

  const response = await withTimeout(
    "HTTP content fetch",
    config.httpTimeoutMs ?? 10000,
    async (timeoutSignal) => {
      return await fetch(url, {
        headers: buildFetchHeaders(config),
        redirect: "follow",
        signal: timeoutSignal,
      });
    },
    options.signal,
  );

  const status = response.status;
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const finalUrl = response.url || url;

  if (isDefinitelyUnsupportedContentType(contentType)) {
    throw new Error(`Unsupported content type for readable extraction: ${contentType}`);
  }

  const body = await response.text();
  throwIfAborted(options.signal);

  if (looksLikeBinaryPayload(body)) {
    throw new Error("Unsupported binary content for readable extraction");
  }

  // --- Blocked / login-redirect → escalate to browser or throw -----------

  const blockedReason = detectBlockedContentResponse(status, body, url)
    || detectLoginRedirect(url, finalUrl, body);

  if (blockedReason) {
    if (browserCanEscalate) {
      emit("browser-fallback", `Page blocked (${blockedReason}), escalating to browser`);
      return await fetchViaBrowser(config, url, resolvedMode, options);
    }
    throw new Error(`Content fetch blocked: ${blockedReason}`);
  }

  // --- Non-HTML text content ---------------------------------------------

  if (!isTextLikeContentType(contentType)) {
    throw new Error(`Unsupported content type for readable extraction: ${contentType || "unknown"}`);
  }

  if (!isHtmlContentType(contentType)) {
    emit("done", "Content extracted as plain text");
    return ensureExtractedContent(buildTextContent(url, body, false), url);
  }

  // --- HTML → Readability extraction -------------------------------------

  throwIfAborted(options.signal);
  emit("http-parse", "Extracting readable content");

  const content = buildContent(url, body, false);
  const minimumMarkdownLength = config.contentMinMarkdownLength ?? 200;

  if (!needsBrowserRetry(content, minimumMarkdownLength)) {
    emit("done", "Content extracted via HTTP");
    return ensureExtractedContent(content, url);
  }

  // --- Thin/JS-heavy content → escalate to browser or throw --------------

  if (!browserCanEscalate) {
    throw new Error("Browser fallback disabled and HTTP extraction was insufficient");
  }

  emit("browser-fallback", "Page is JS-heavy, retrying via browser rendering");
  return await fetchViaBrowser(config, url, resolvedMode, options);
}
