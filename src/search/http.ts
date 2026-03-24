import { JSDOM, VirtualConsole } from "jsdom";
import type { SearchEngineId, SearchResult } from "../types";

const virtualConsole = new VirtualConsole();
virtualConsole.on("error", () => {});
virtualConsole.on("warn", () => {});

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveUrl(href: string | null | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function parseDuckDuckGo(html: string, base: string): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  return [...doc.querySelectorAll(".result")].map((node, index) => {
    const link = node.querySelector("a.result__a");
    const url = resolveUrl(link?.getAttribute("href"), base);
    if (!url) return undefined;
    return {
      title: cleanText(link?.textContent || url),
      url,
      snippet: cleanText(node.querySelector(".result__snippet")?.textContent || ""),
      sourceEngine: "duckduckgo" as const,
      rank: index + 1,
      score: 1,
      domain: domainOf(url),
    };
  }).filter(Boolean) as SearchResult[];
}

function parseBing(html: string, base: string): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  return [...doc.querySelectorAll("li.b_algo")].map((node, index) => {
    const link = node.querySelector("h2 a");
    const url = resolveUrl(link?.getAttribute("href"), base);
    if (!url) return undefined;
    return {
      title: cleanText(link?.textContent || url),
      url,
      snippet: cleanText(node.querySelector(".b_caption p")?.textContent || ""),
      sourceEngine: "bing" as const,
      rank: index + 1,
      score: 1,
      domain: domainOf(url),
    };
  }).filter(Boolean) as SearchResult[];
}

function parseGoogle(html: string, base: string): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  const anchors = [...doc.querySelectorAll("a")].filter((anchor) => anchor.querySelector("h3"));
  return anchors.map((anchor, index) => {
    const url = resolveUrl(anchor.getAttribute("href"), base);
    if (!url) return undefined;
    const h3 = anchor.querySelector("h3");
    const snippet = cleanText(anchor.parentElement?.parentElement?.textContent || "");
    return {
      title: cleanText(h3?.textContent || url),
      url,
      snippet,
      sourceEngine: "google" as const,
      rank: index + 1,
      score: 1,
      domain: domainOf(url),
    };
  }).filter(Boolean) as SearchResult[];
}

function parseYahoo(html: string, base: string): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  return [...doc.querySelectorAll("div#web li")].map((node, index) => {
    const link = node.querySelector("a");
    const url = resolveUrl(link?.getAttribute("href"), base);
    if (!url) return undefined;
    return {
      title: cleanText(link?.textContent || url),
      url,
      snippet: cleanText(node.textContent || ""),
      sourceEngine: "yahoo" as const,
      rank: index + 1,
      score: 1,
      domain: domainOf(url),
    };
  }).filter(Boolean) as SearchResult[];
}

function parseGeneric(html: string, base: string, engine: SearchEngineId): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  const candidates = [...doc.querySelectorAll("a[href]")]
    .map((anchor, index) => {
      const url = resolveUrl(anchor.getAttribute("href"), base);
      const title = cleanText(anchor.textContent || "");
      if (!url || !/^https?:/.test(url) || title.length < 8) return undefined;
      return {
        title,
        url,
        snippet: cleanText(anchor.parentElement?.textContent || ""),
        sourceEngine: engine,
        rank: index + 1,
        score: 0.5,
        domain: domainOf(url),
      } satisfies SearchResult;
    })
    .filter(Boolean) as SearchResult[];
  return candidates.slice(0, 20);
}

export function parseSearchHtml(html: string, baseUrl: string, engine: SearchEngineId): SearchResult[] {
  switch (engine) {
    case "duckduckgo": return parseDuckDuckGo(html, baseUrl);
    case "bing": return parseBing(html, baseUrl);
    case "google": return parseGoogle(html, baseUrl);
    case "yahoo": return parseYahoo(html, baseUrl);
    default: return parseGeneric(html, baseUrl, engine);
  }
}

export async function searchViaHttp(url: string, engine: SearchEngineId, userAgent?: string): Promise<SearchResult[]> {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  const html = await response.text();
  return parseSearchHtml(html, url, engine);
}
