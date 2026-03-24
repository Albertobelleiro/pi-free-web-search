import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import TurndownService from "turndown";
import { loadConfig } from "../config";
import { detectBrowser } from "../detection/browser";
import type { BrowserMode, ExtractedContent } from "../types";
import { withBrowser } from "../search/browser";

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

export async function fetchContent(cwd: string, url: string, mode?: BrowserMode): Promise<ExtractedContent> {
  const config = loadConfig(cwd);
  const response = await fetch(url, {
    headers: {
      "user-agent": config.userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  const html = await response.text();
  const content = buildContent(url, html, false);
  if (content.markdown.length > 200) return content;
  if (config.mode === "disabled") return content;

  const browser = await detectBrowser(config);
  const browserMode = mode || config.mode || "auto";
  return withBrowser(browser, browserMode === "auto" ? "headless" : browserMode, async (instance) => {
    const page = await instance.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);
    return buildContent(url, await page.content(), true);
  });
}
