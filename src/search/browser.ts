import { chromium, firefox, webkit, type Browser, type BrowserType } from "playwright";
import type { BrowserDetection, BrowserMode, SearchEngineId, SearchResult } from "../types";
import { parseSearchHtml } from "./http";

function browserTypeForFamily(browserFamily: BrowserDetection["browserFamily"]): BrowserType {
  if (browserFamily === "firefox") return firefox;
  if (browserFamily === "safari") return webkit;
  return chromium;
}

export async function withBrowser<T>(browser: BrowserDetection, mode: BrowserMode, fn: (instance: Browser) => Promise<T>): Promise<T> {
  const type = browserTypeForFamily(browser.browserFamily);
  const instance = await type.launch({
    headless: mode !== "visible",
    executablePath: browser.browserFamily === "safari" ? undefined : browser.executablePath,
  });
  try {
    return await fn(instance);
  } finally {
    await instance.close();
  }
}

function inferEngineFromUrl(url: string): SearchEngineId {
  const value = url.toLowerCase();
  if (value.includes("google")) return "google";
  if (value.includes("bing")) return "bing";
  if (value.includes("duckduckgo")) return "duckduckgo";
  if (value.includes("brave")) return "brave";
  if (value.includes("yahoo")) return "yahoo";
  return "unknown";
}

export async function searchViaBrowser(browser: BrowserDetection, mode: BrowserMode, searchUrl: string): Promise<SearchResult[]> {
  return withBrowser(browser, mode, async (instance) => {
    const page = await instance.newPage();
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);
    const html = await page.content();
    return parseSearchHtml(html, searchUrl, inferEngineFromUrl(searchUrl));
  });
}
