import { expect, test } from "bun:test";
import { runSearch, type SearchRuntimeDeps } from "../src/search/orchestrator";
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
