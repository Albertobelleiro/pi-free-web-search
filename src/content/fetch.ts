import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";
import { loadConfig } from "../config";
import { detectBrowser } from "../detection/browser";
import type { BrowserMode, ExtractedContent } from "../types";
import { throwIfAborted, withTimeout } from "../util/abort";
import { fetchPageHtmlViaBrowser } from "../search/browser";

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

  const html = await withTimeout(
    "HTTP content fetch",
    config.httpTimeoutMs ?? 10000,
    async (timeoutSignal) => {
      const response = await fetch(url, {
        headers: {
          "user-agent": config.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
          "accept-language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: timeoutSignal,
      });
      return await response.text();
    },
    options.signal,
  );

  throwIfAborted(options.signal);
  emit("http-parse", "Extracting readable content");
  const content = buildContent(url, html, false);
  const minimumMarkdownLength = config.contentMinMarkdownLength ?? 200;

  if (content.markdown.length >= minimumMarkdownLength) {
    emit("done", "Content extracted via HTTP");
    return content;
  }

  if ((mode || config.mode) === "disabled") {
    emit("done", "Browser fallback disabled, returning HTTP extraction");
    return content;
  }

  emit("browser-fallback", "Page is JS-heavy, retrying via browser rendering");
  const browser = await detectBrowser(config);
  const browserMode = mode || config.mode || "auto";
  const htmlViaBrowser = await fetchPageHtmlViaBrowser(
    browser,
    browserMode === "auto" ? "headless" : browserMode,
    url,
    {
      signal: options.signal,
      navigationTimeoutMs: config.browserNavigationTimeoutMs ?? 12000,
      settleTimeoutMs: config.browserResultWaitMs ?? 700,
    },
  );

  throwIfAborted(options.signal);
  const extracted = buildContent(url, htmlViaBrowser, true);
  emit("done", "Content extracted via browser fallback");
  return extracted;
}
