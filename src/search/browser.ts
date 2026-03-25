import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from "playwright";
import type { BrowserDetection, BrowserMode, SearchEngineId, SearchResult } from "../types";
import { OperationAbortedError, throwIfAborted } from "../util/abort";
import { detectBlockedSearchResponse, parseSearchHtml, SearchEngineBlockedError } from "./http";

function browserTypeForFamily(browserFamily: BrowserDetection["browserFamily"]): BrowserType {
  if (browserFamily === "firefox") return firefox;
  if (browserFamily === "safari") return webkit;
  return chromium;
}

function toLaunchMode(mode: BrowserMode): "visible" | "headless" {
  return mode === "visible" ? "visible" : "headless";
}

export async function withBrowser<T>(browser: BrowserDetection, mode: BrowserMode, fn: (instance: Browser) => Promise<T>): Promise<T> {
  const type = browserTypeForFamily(browser.browserFamily);
  const launchMode = toLaunchMode(mode);
  const instance = await type.launch({
    headless: launchMode !== "visible",
    executablePath: browser.browserFamily === "safari" ? undefined : browser.executablePath,
  });
  try {
    return await fn(instance);
  } finally {
    await instance.close();
  }
}

export function inferEngineFromUrl(url: string): SearchEngineId {
  const value = url.toLowerCase();
  if (value.includes("google")) return "google";
  if (value.includes("bing")) return "bing";
  if (value.includes("duckduckgo")) return "duckduckgo";
  if (value.includes("brave")) return "brave";
  if (value.includes("yahoo")) return "yahoo";
  if (value.includes("searx")) return "searxng";
  return "unknown";
}

const resultSelectors: Record<SearchEngineId, string[]> = {
  google: ["#search a h3", "a h3"],
  bing: ["li.b_algo"],
  duckduckgo: [".result"],
  brave: ["main a[href]", "a.result-header"],
  yahoo: ["#web li", "ol.searchCenterMiddle li"],
  searxng: ["article.result", "main a[href]"],
  unknown: ["main a[href]", "a[href]"]
};

async function waitForLikelyResults(page: Page, engine: SearchEngineId, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) return;
  const selectors = resultSelectors[engine] || resultSelectors.unknown;
  await Promise.any(
    selectors.map((selector) => page.waitForSelector(selector, { timeout: timeoutMs }).then(() => true)),
  ).catch(() => {});
}

export interface BrowserFetchOptions {
  signal?: AbortSignal;
  navigationTimeoutMs?: number;
  settleTimeoutMs?: number;
}

export async function fetchPageHtmlViaBrowser(
  browser: BrowserDetection,
  mode: BrowserMode,
  url: string,
  options: BrowserFetchOptions = {},
): Promise<string> {
  throwIfAborted(options.signal);

  const navigationTimeoutMs = options.navigationTimeoutMs ?? 12000;
  const settleTimeoutMs = options.settleTimeoutMs ?? 700;

  return withBrowser(browser, mode, async (instance) => {
    const page = await instance.newPage();

    const work = (async () => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
      await waitForLikelyResults(page, inferEngineFromUrl(url), settleTimeoutMs);
      throwIfAborted(options.signal);
      return await page.content();
    })();

    if (!options.signal) return await work;

    if (options.signal.aborted) {
      await page.close().catch(() => {});
      throw new OperationAbortedError();
    }

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        void page.close().catch(() => {});
        reject(new OperationAbortedError());
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });

    work.catch(() => {});
    try {
      return await Promise.race([work, aborted]);
    } finally {
      if (onAbort) options.signal.removeEventListener("abort", onAbort);
    }
  });
}

export async function searchViaBrowser(
  browser: BrowserDetection,
  mode: BrowserMode,
  searchUrl: string,
  options: BrowserFetchOptions = {},
): Promise<SearchResult[]> {
  const html = await fetchPageHtmlViaBrowser(browser, mode, searchUrl, options);
  const engine = inferEngineFromUrl(searchUrl);
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1]?.trim();
  const blockedReason = detectBlockedSearchResponse(engine, undefined, html);
  if (blockedReason) {
    throw new SearchEngineBlockedError(engine, "browser", blockedReason, { title });
  }
  return parseSearchHtml(html, searchUrl, engine);
}
