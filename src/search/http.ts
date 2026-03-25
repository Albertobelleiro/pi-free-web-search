import { JSDOM, VirtualConsole } from "jsdom";
import type { SearchEngineId, SearchResult } from "../types";
import { throwIfAborted, withTimeout } from "../util/abort";

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

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isGoogleHost(hostname: string): boolean {
  return /(^|\.)google\.[a-z.]+$/i.test(hostname);
}

function decodeBingRedirectTarget(value: string): string | undefined {
  try {
    const normalized = value.startsWith("a1") ? value.slice(2) : value;
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    return /^https?:/i.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function normalizeResultUrl(url: string, engine: SearchEngineId): string | undefined {
  try {
    const parsed = new URL(url);

    if (engine === "google" && isGoogleHost(parsed.hostname.toLowerCase())) {
      if (parsed.pathname === "/url") {
        const target = parsed.searchParams.get("q") || parsed.searchParams.get("url");
        if (!target) return undefined;
        const decoded = decodeURIComponent(target);
        return /^https?:/i.test(decoded) ? decoded : undefined;
      }
      if (parsed.pathname.startsWith("/search") || parsed.pathname.startsWith("/preferences")) {
        return undefined;
      }
    }

    if (engine === "bing" && hostMatches(parsed.hostname.toLowerCase(), "bing.com") && parsed.pathname.startsWith("/ck/a")) {
      const target = parsed.searchParams.get("u") || parsed.searchParams.get("url") || parsed.searchParams.get("redirectUrl");
      if (!target) return undefined;
      const decoded = decodeBingRedirectTarget(target) || decodeURIComponent(target);
      return /^https?:/i.test(decoded) ? decoded : undefined;
    }

    if (engine === "duckduckgo" && hostMatches(parsed.hostname.toLowerCase(), "duckduckgo.com") && parsed.pathname === "/l/") {
      const target = parsed.searchParams.get("uddg");
      if (!target) return undefined;
      const decoded = decodeURIComponent(target);
      return /^https?:/i.test(decoded) ? decoded : undefined;
    }

    if (engine === "yahoo" && hostMatches(parsed.hostname.toLowerCase(), "search.yahoo.com")) {
      const ru = parsed.searchParams.get("RU") || parsed.searchParams.get("ru");
      if (ru) {
        const decoded = decodeURIComponent(ru);
        return /^https?:/i.test(decoded) ? decoded : undefined;
      }
    }

    if (engine === "yahoo" && hostMatches(parsed.hostname.toLowerCase(), "r.search.yahoo.com")) {
      const match = parsed.pathname.match(/\/RU=([^/]+)\//);
      if (match?.[1]) {
        const decoded = decodeURIComponent(match[1]);
        return /^https?:/i.test(decoded) ? decoded : undefined;
      }
    }

    if (!/^https?:/i.test(parsed.protocol)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function resolveResultUrl(href: string | null | undefined, base: string, engine: SearchEngineId): string | undefined {
  const resolved = resolveUrl(href, base);
  if (!resolved) return undefined;
  return normalizeResultUrl(resolved, engine);
}

function parseDuckDuckGo(html: string, base: string): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  return [...doc.querySelectorAll(".result")]
    .map((node, index) => {
      const link = node.querySelector("a.result__a");
      const url = resolveResultUrl(link?.getAttribute("href"), base, "duckduckgo");
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
    })
    .filter(Boolean) as SearchResult[];
}

function parseBing(html: string, base: string): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  return [...doc.querySelectorAll("li.b_algo")]
    .map((node, index) => {
      const link = node.querySelector("h2 a");
      const url = resolveResultUrl(link?.getAttribute("href"), base, "bing");
      if (!url || isInternalSearchUrl(url, "bing")) return undefined;
      return {
        title: cleanText(link?.textContent || url),
        url,
        snippet: cleanText(node.querySelector(".b_caption p")?.textContent || ""),
        sourceEngine: "bing" as const,
        rank: index + 1,
        score: 1,
        domain: domainOf(url),
      };
    })
    .filter(Boolean) as SearchResult[];
}

function parseGoogle(html: string, base: string): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  const headingNodes = [...doc.querySelectorAll("#search a h3, a h3")];

  const results = headingNodes
    .map((heading, index) => {
      const anchor = heading.closest("a");
      if (!anchor) return undefined;
      const url = resolveResultUrl(anchor.getAttribute("href"), base, "google");
      if (!url) return undefined;

      const container = anchor.closest("div.g, div.MjjYud, div[data-hveid]") || anchor.parentElement;
      const snippetNode = container?.querySelector(".VwiC3b, .IsZvec, span.aCOpRe, .yXK7lf");

      return {
        title: cleanText(heading.textContent || url),
        url,
        snippet: cleanText(snippetNode?.textContent || container?.textContent || ""),
        sourceEngine: "google" as const,
        rank: index + 1,
        score: 1,
        domain: domainOf(url),
      };
    })
    .filter(Boolean) as SearchResult[];

  return dedupeByUrl(results);
}

function parseYahoo(html: string, base: string): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  const items = [...doc.querySelectorAll("#web li, ol.searchCenterMiddle li")];
  return items
    .map((node, index) => {
      const link = node.querySelector("a");
      const url = resolveResultUrl(link?.getAttribute("href"), base, "yahoo");
      if (!url || isInternalSearchUrl(url, "yahoo")) return undefined;
      const snippetNode = node.querySelector(".compText, p");
      return {
        title: cleanText(link?.textContent || url),
        url,
        snippet: cleanText(snippetNode?.textContent || node.textContent || ""),
        sourceEngine: "yahoo" as const,
        rank: index + 1,
        score: 1,
        domain: domainOf(url),
      };
    })
    .filter(Boolean) as SearchResult[];
}

function parseBrave(html: string, base: string): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  const blocks = [...doc.querySelectorAll("article, div.snippet[data-type='web'], div[data-testid='result']")];
  const parsed = blocks
    .map((block, index) => {
      const link = block.querySelector("a[href]");
      const url = resolveResultUrl(link?.getAttribute("href"), base, "brave");
      if (!url) return undefined;
      const title = cleanText(link?.textContent || url);
      if (!title) return undefined;
      const snippet = cleanText(
        block.querySelector(".snippet-description, .snippet, p")?.textContent || block.textContent || "",
      );
      return {
        title,
        url,
        snippet,
        sourceEngine: "brave" as const,
        rank: index + 1,
        score: 1,
        domain: domainOf(url),
      };
    })
    .filter(Boolean) as SearchResult[];

  if (parsed.length > 0) return dedupeByUrl(parsed);
  return parseGeneric(html, base, "brave");
}

function isInternalSearchUrl(url: string, engine: SearchEngineId): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (engine === "google") return isGoogleHost(hostname);
    if (engine === "bing") return hostMatches(hostname, "bing.com");
    if (engine === "duckduckgo") return hostMatches(hostname, "duckduckgo.com");
    if (engine === "brave") return hostMatches(hostname, "search.brave.com");
    if (engine === "yahoo") {
      return hostMatches(hostname, "search.yahoo.com") || hostMatches(hostname, "video.search.yahoo.com") || hostMatches(hostname, "yahoo.com");
    }
    return false;
  } catch {
    return true;
  }
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    deduped.push(result);
  }
  return deduped.map((result, index) => ({ ...result, rank: index + 1 }));
}

function parseGeneric(html: string, base: string, engine: SearchEngineId): SearchResult[] {
  const doc = new JSDOM(html, { virtualConsole }).window.document;
  const candidates = [...doc.querySelectorAll("a[href]")]
    .map((anchor, index) => {
      const url = resolveResultUrl(anchor.getAttribute("href"), base, engine);
      const title = cleanText(anchor.textContent || "");
      if (!url || !/^https?:/.test(url) || title.length < 8) return undefined;
      if (isInternalSearchUrl(url, engine)) return undefined;
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
  return dedupeByUrl(candidates).slice(0, 20);
}

export function parseSearchHtml(html: string, baseUrl: string, engine: SearchEngineId): SearchResult[] {
  switch (engine) {
    case "duckduckgo":
      return parseDuckDuckGo(html, baseUrl);
    case "bing":
      return parseBing(html, baseUrl);
    case "google":
      return parseGoogle(html, baseUrl);
    case "yahoo":
      return parseYahoo(html, baseUrl);
    case "brave":
      return parseBrave(html, baseUrl);
    default:
      return parseGeneric(html, baseUrl, engine);
  }
}

export class SearchEngineBlockedError extends Error {
  constructor(
    public readonly engine: SearchEngineId,
    public readonly source: "http" | "browser",
    public readonly reason: string,
    public readonly metadata: Record<string, string | number | boolean | undefined> = {},
  ) {
    super(`${engine} ${source} search blocked: ${reason}`);
    this.name = "SearchEngineBlockedError";
  }
}

export function isSearchEngineBlockedError(error: unknown): error is SearchEngineBlockedError {
  return error instanceof SearchEngineBlockedError;
}

export function detectBlockedSearchResponse(
  engine: SearchEngineId,
  status: number | undefined,
  html: string,
): string | undefined {
  if (status === 403 || status === 429) return `HTTP ${status}`;

  const sample = html.slice(0, 12000).toLowerCase();
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1]?.toLowerCase() || "";
  const combined = `${title} ${sample}`;

  if (engine === "brave" && combined.includes("captcha - brave search")) return "captcha";
  if (engine === "google" && combined.includes("unusual traffic")) return "unusual traffic challenge";
  if (engine === "duckduckgo" && combined.includes("unfortunately, bots use duckduckgo too")) return "bot challenge";
  if (engine === "duckduckgo" && title.trim() === "duckduckgo" && combined.includes("duckduckgo")) return "unexpected homepage";

  if (combined.includes("captcha")) return "captcha";
  if (combined.includes("too many requests")) return "too many requests";
  if (combined.includes("rate limit")) return "rate limit";
  if (combined.includes("verify you are human")) return "human verification";
  if (combined.includes("access denied")) return "access denied";

  return undefined;
}

export interface HttpSearchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function searchViaHttp(
  url: string,
  engine: SearchEngineId,
  userAgent?: string,
  options: HttpSearchOptions = {},
): Promise<SearchResult[]> {
  throwIfAborted(options.signal);
  const timeoutMs = options.timeoutMs ?? 10000;

  const response = await withTimeout(
    "HTTP search",
    timeoutMs,
    async (timeoutSignal) => {
      const result = await fetch(url, {
        headers: {
          "user-agent": userAgent || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
          "accept-language": "en-US,en;q=0.9",
        },
        redirect: "follow",
        signal: timeoutSignal,
      });
      return {
        status: result.status,
        html: await result.text(),
      };
    },
    options.signal,
  );

  throwIfAborted(options.signal);
  const title = response.html.match(/<title>(.*?)<\/title>/i)?.[1]?.trim();
  const blockedReason = detectBlockedSearchResponse(engine, response.status, response.html);
  if (blockedReason) {
    throw new SearchEngineBlockedError(engine, "http", blockedReason, {
      status: response.status,
      title,
    });
  }

  return parseSearchHtml(response.html, url, engine);
}
