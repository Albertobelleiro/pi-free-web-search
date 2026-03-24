import { expect, test } from "bun:test";
import { runSearch, type SearchRuntimeDeps } from "../src/search/orchestrator";
import { SearchEngineBlockedError } from "../src/search/http";
import type { BrowserDetection, FreeWebSearchConfig, SearchEngineDetection, SearchResult } from "../src/types";

const browser: BrowserDetection = {
  platform: "darwin",
  browserFamily: "chrome",
  browserId: "chrome",
  browserLabel: "Google Chrome",
  source: "fallback",
};

const engine: SearchEngineDetection = {
  id: "google",
  label: "google",
  templateUrl: "https://www.google.com/search?q={searchTerms}",
  source: "fallback",
};

function makeResult(url: string, title: string, rank: number, score = 1): SearchResult {
  return {
    title,
    url,
    snippet: `${title} snippet`,
    sourceEngine: "google",
    rank,
    score,
    domain: new URL(url).hostname,
  };
}

function deps(config: FreeWebSearchConfig, httpResults: SearchResult[], browserResults: SearchResult[], onBrowserCall?: () => void): SearchRuntimeDeps {
  return {
    loadConfig: () => config,
    detectBrowser: async () => browser,
    detectSearchEngine: async () => engine,
    searchViaHttp: async () => httpResults,
    searchViaBrowser: async () => {
      onBrowserCall?.();
      return browserResults;
    },
  };
}

test("does not escalate to browser fallback when HTTP quality is above threshold", async () => {
  let browserCalls = 0;
  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 5 },
    {
      deps: deps(
        { mode: "auto", httpFirst: true, browserFallbackThreshold: 0.55 },
        [
          makeResult("https://bun.sh/docs", "Bun Docs", 1),
          makeResult("https://github.com/oven-sh/bun", "Bun GitHub", 2),
          makeResult("https://bun.com/blog", "Bun Blog", 3),
          makeResult("https://bunhelp.dev", "Bun Help", 4),
        ],
        [],
        () => browserCalls++,
      ),
    },
  );

  expect(browserCalls).toBe(0);
  expect(result.usedBrowserFallback).toBe(false);
  expect(result.results.length).toBe(4);
});

test("escalates to browser fallback when HTTP quality is low and merges results", async () => {
  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 5 },
    {
      deps: deps(
        { mode: "auto", httpFirst: true, browserFallbackThreshold: 0.9 },
        [makeResult("https://bun.sh/docs", "Bun Docs", 1)],
        [
          makeResult("https://bun.sh/docs", "Bun Docs", 1, 0.4),
          makeResult("https://github.com/oven-sh/bun", "Bun GitHub", 2),
        ],
      ),
    },
  );

  expect(result.usedBrowserFallback).toBe(true);
  expect(result.results.some((entry) => entry.url === "https://bun.sh/docs")).toBe(true);
  expect(result.results.some((entry) => entry.url === "https://github.com/oven-sh/bun")).toBe(true);
});

test("keeps HTTP results when browser fallback fails", async () => {
  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 5 },
    {
      deps: {
        loadConfig: () => ({ mode: "auto", httpFirst: true, browserFallbackThreshold: 0.9 }),
        detectBrowser: async () => browser,
        detectSearchEngine: async () => engine,
        searchViaHttp: async () => [makeResult("https://bun.sh/docs", "Bun Docs", 1)],
        searchViaBrowser: async () => {
          throw new Error("browser failed");
        },
      },
    },
  );

  expect(result.usedBrowserFallback).toBe(false);
  expect(result.results.length).toBe(1);
  expect(result.results[0].url).toBe("https://bun.sh/docs");
});

test("request mode disabled prevents browser fallback", async () => {
  let browserCalls = 0;

  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 5, mode: "disabled" },
    {
      deps: deps(
        { mode: "auto", httpFirst: true, browserFallbackThreshold: 0.9 },
        [makeResult("https://bun.sh/docs", "Bun Docs", 1)],
        [makeResult("https://github.com/oven-sh/bun", "Bun GitHub", 2)],
        () => browserCalls++,
      ),
    },
  );

  expect(browserCalls).toBe(0);
  expect(result.usedBrowserFallback).toBe(false);
  expect(result.results.length).toBe(1);
});

test("engine override switches outbound search endpoint", async () => {
  let observedUrl = "";
  let observedEngine = "";

  await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 3, mode: "disabled", engine: "bing" },
    {
      deps: {
        loadConfig: () => ({ mode: "auto", httpFirst: true }),
        detectBrowser: async () => browser,
        detectSearchEngine: async () => engine,
        searchViaHttp: async (url, engineId) => {
          observedUrl = url;
          observedEngine = engineId;
          return [makeResult("https://bun.sh/docs", "Bun Docs", 1)];
        },
        searchViaBrowser: async () => [],
      },
    },
  );

  expect(observedEngine).toBe("bing");
  expect(observedUrl.startsWith("https://www.bing.com/search?")).toBe(true);
});

test("retries with a fallback engine when the detected engine is blocked", async () => {
  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 5, mode: "disabled" },
    {
      deps: {
        loadConfig: () => ({ mode: "auto", httpFirst: true }),
        detectBrowser: async () => browser,
        detectSearchEngine: async () => ({
          ...engine,
          id: "brave",
          label: "brave",
          templateUrl: "https://search.brave.com/search?q={searchTerms}",
        }),
        searchViaHttp: async (_url, engineId) => {
          if (engineId === "brave") throw new SearchEngineBlockedError("brave", "http", "HTTP 429");
          return [makeResult("https://bun.sh/docs", "Bun Docs", 1)];
        },
        searchViaBrowser: async () => [],
      },
    },
  );

  expect(result.context.engine.id).toBe("duckduckgo");
  expect(result.results.length).toBe(1);
  expect(result.attempts[0].engine).toBe("brave");
  expect(result.attempts[0].blockedReason).toBe("HTTP 429");
  expect(result.attempts[1].engine).toBe("duckduckgo");
});

test("retries with a fallback engine when the primary engine returns no results", async () => {
  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 5, mode: "disabled" },
    {
      deps: {
        loadConfig: () => ({ mode: "auto", httpFirst: true }),
        detectBrowser: async () => browser,
        detectSearchEngine: async () => ({
          ...engine,
          id: "brave",
          label: "brave",
          templateUrl: "https://search.brave.com/search?q={searchTerms}",
        }),
        searchViaHttp: async (_url, engineId) => {
          if (engineId === "brave") return [];
          return [makeResult("https://github.com/oven-sh/bun", "Bun GitHub", 1)];
        },
        searchViaBrowser: async () => [],
      },
    },
  );

  expect(result.context.engine.id).toBe("duckduckgo");
  expect(result.results[0].url).toBe("https://github.com/oven-sh/bun");
  expect(result.attempts[0].finalResults).toBe(0);
  expect(result.attempts[1].finalResults).toBe(1);
});
