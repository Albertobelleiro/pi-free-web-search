import { beforeEach, expect, test } from "bun:test";
import { getSessionEngineHealthSnapshot, resetSessionEngineHealth, runSearch, type SearchRuntimeDeps } from "../src/search/orchestrator";
import type { BrowserDetection, FreeWebSearchConfig, SearchEngineDetection, SearchResult } from "../src/types";

const browser: BrowserDetection = {
  platform: "darwin",
  browserFamily: "chrome",
  browserId: "chrome",
  browserLabel: "Google Chrome",
  source: "fallback",
};

beforeEach(() => {
  resetSessionEngineHealth();
});

const engine: SearchEngineDetection = {
  id: "google",
  label: "google",
  templateUrl: "https://www.google.com/search?q={searchTerms}",
  source: "fallback",
};

function makeResult(url: string, title: string, rank: number, score = 1, sourceEngine: SearchResult["sourceEngine"] = "google"): SearchResult {
  return {
    title,
    url,
    snippet: `${title} snippet`,
    sourceEngine,
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

test("keeps a single search engine attempt when no override is provided", async () => {
  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 5, mode: "disabled" },
    {
      deps: {
        loadConfig: () => ({ mode: "auto", httpFirst: true }),
        detectBrowser: async () => browser,
        detectSearchEngine: async () => ({
          ...engine,
          id: "duckduckgo",
          label: "duckduckgo",
          templateUrl: "https://duckduckgo.com/html/?q={searchTerms}",
        }),
        searchViaHttp: async () => [makeResult("https://bun.sh/docs", "Bun Docs", 1, 1, "duckduckgo")],
        searchViaBrowser: async () => [],
      },
    },
  );

  expect(result.context.engine.id).toBe("duckduckgo");
  expect(result.results.length).toBe(1);
  expect(result.attempts.length).toBe(1);
  expect(result.attempts[0].engine).toBe("duckduckgo");
});

test("falls back to a secondary engine when primary returns no results", async () => {
  const observedEngines: string[] = [];

  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 5, mode: "disabled" },
    {
      deps: {
        loadConfig: () => ({ mode: "auto", httpFirst: true }),
        detectBrowser: async () => browser,
        detectSearchEngine: async () => ({
          ...engine,
          id: "duckduckgo",
          label: "duckduckgo",
          templateUrl: "https://duckduckgo.com/html/?q={searchTerms}",
        }),
        searchViaHttp: async (_url, engineId) => {
          observedEngines.push(engineId);
          if (engineId === "duckduckgo") return [];
          return [makeResult("https://bun.sh/docs", "Bun Docs", 1, 1, engineId)];
        },
        searchViaBrowser: async () => [],
      },
    },
  );

  expect(observedEngines[0]).toBe("duckduckgo");
  expect(observedEngines.length).toBeGreaterThan(1);
  expect(result.attempts.length).toBeGreaterThan(1);
  expect(result.results.length).toBe(1);
  expect(result.context.engine.id).not.toBe("duckduckgo");
});

test("unknown engine override resolves to detected engine", async () => {
  let observedEngine = "";

  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 3, mode: "disabled", engine: "unknown" },
    {
      deps: {
        loadConfig: () => ({ mode: "auto", httpFirst: true }),
        detectBrowser: async () => browser,
        detectSearchEngine: async () => ({
          ...engine,
          id: "duckduckgo",
          label: "duckduckgo",
          templateUrl: "https://duckduckgo.com/html/?q={searchTerms}",
        }),
        searchViaHttp: async (_url, engineId) => {
          observedEngine = engineId;
          return [makeResult("https://bun.sh/docs", "Bun Docs", 1, 1, engineId)];
        },
        searchViaBrowser: async () => [],
      },
    },
  );

  expect(observedEngine).toBe("duckduckgo");
  expect(result.context.engine.id).toBe("duckduckgo");
});

test("ask mode does not auto-launch browser fallback", async () => {
  let browserCalls = 0;

  const result = await runSearch(
    process.cwd(),
    { query: "bun docs", numResults: 5, mode: "ask" },
    {
      deps: {
        loadConfig: () => ({ mode: "auto", httpFirst: true, browserFallbackThreshold: 0.9 }),
        detectBrowser: async () => browser,
        detectSearchEngine: async () => engine,
        searchViaHttp: async () => [makeResult("https://bun.sh/docs", "Bun Docs", 1)],
        searchViaBrowser: async () => {
          browserCalls += 1;
          return [makeResult("https://github.com/oven-sh/bun", "Bun GitHub", 2)];
        },
      },
    },
  );

  expect(browserCalls).toBe(0);
  expect(result.usedBrowserFallback).toBe(false);
  expect(result.results.length).toBe(1);
});

test("rejects empty query", async () => {
  await expect(
    runSearch(
      process.cwd(),
      { query: "   ", numResults: 5, mode: "disabled" },
      {
        deps: {
          loadConfig: () => ({ mode: "auto", httpFirst: true }),
          detectBrowser: async () => browser,
          detectSearchEngine: async () => engine,
          searchViaHttp: async () => [],
          searchViaBrowser: async () => [],
        },
      },
    ),
  ).rejects.toThrow("Search query must not be empty");
});

test("remembers repeated engine failures and skips cooled-down engines", async () => {
  const observedEngines: string[] = [];
  const runtimeDeps: SearchRuntimeDeps = {
    loadConfig: () => ({ mode: "auto", httpFirst: true, engineFailureThreshold: 2, engineHealthCooldownMs: 60_000 }),
    detectBrowser: async () => browser,
    detectSearchEngine: async () => ({
      ...engine,
      id: "duckduckgo",
      label: "duckduckgo",
      templateUrl: "https://duckduckgo.com/html/?q={searchTerms}",
    }),
    searchViaHttp: async (_url, engineId) => {
      observedEngines.push(engineId);
      if (engineId === "duckduckgo") return [];
      return [makeResult("https://bun.sh/docs", "Bun Docs", 1, 1, engineId)];
    },
    searchViaBrowser: async () => [],
  };

  await runSearch(process.cwd(), { query: "bun docs", numResults: 5, mode: "disabled" }, { deps: runtimeDeps });
  await runSearch(process.cwd(), { query: "bun docs", numResults: 5, mode: "disabled" }, { deps: runtimeDeps });
  await runSearch(process.cwd(), { query: "bun docs", numResults: 5, mode: "disabled" }, { deps: runtimeDeps });

  expect(observedEngines.slice(0, 2)).toEqual(["duckduckgo", "yahoo"]);
  expect(observedEngines.slice(2, 4)).toEqual(["duckduckgo", "yahoo"]);
  expect(observedEngines[4]).toBe("yahoo");
  expect(getSessionEngineHealthSnapshot().find((entry) => entry.engine === "duckduckgo")?.coolingDown).toBe(true);
});
