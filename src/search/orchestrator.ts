import { loadConfig } from "../config";
import { detectBrowser } from "../detection/browser";
import { detectSearchEngine } from "../detection/engine";
import type { EffectiveSearchContext, SearchRequest, SearchResponse } from "../types";
import { isAbortError, throwIfAborted } from "../util/abort";
import { searchViaBrowser } from "./browser";
import { buildSearchUrl } from "./engines";
import { searchViaHttp } from "./http";
import { rerankResults } from "./rank";

export interface SearchProgressEvent {
  phase: "detecting" | "http-search" | "browser-search" | "rerank" | "done";
  message: string;
  metrics?: Record<string, number | string | boolean>;
}

export interface SearchRuntimeDeps {
  loadConfig: typeof loadConfig;
  detectBrowser: typeof detectBrowser;
  detectSearchEngine: typeof detectSearchEngine;
  searchViaHttp: typeof searchViaHttp;
  searchViaBrowser: typeof searchViaBrowser;
}

export interface RunSearchOptions {
  signal?: AbortSignal;
  onProgress?: (event: SearchProgressEvent) => void;
  deps?: Partial<SearchRuntimeDeps>;
}

const defaultDeps: SearchRuntimeDeps = {
  loadConfig,
  detectBrowser,
  detectSearchEngine,
  searchViaHttp,
  searchViaBrowser,
};

function modeForBrowser(mode: SearchRequest["mode"]): "headless" | "visible" {
  return mode === "visible" ? "visible" : "headless";
}

function summarizeError(error: unknown): string {
  if (!error) return "unknown error";
  if (error instanceof Error) return error.message;
  return String(error);
}

function emitProgress(options: RunSearchOptions, event: SearchProgressEvent): void {
  options.onProgress?.(event);
}

export async function resolveSearchContext(cwd: string, deps: Partial<SearchRuntimeDeps> = {}): Promise<EffectiveSearchContext> {
  const runtime = { ...defaultDeps, ...deps };
  const config = runtime.loadConfig(cwd);
  const browser = await runtime.detectBrowser(config);
  const engine = await runtime.detectSearchEngine(browser, config);
  return {
    browser,
    engine,
    mode: config.mode || "auto",
  };
}

export async function runSearch(cwd: string, request: SearchRequest, options: RunSearchOptions = {}): Promise<SearchResponse> {
  const runtime = { ...defaultDeps, ...(options.deps || {}) };

  throwIfAborted(options.signal);
  emitProgress(options, { phase: "detecting", message: "Detecting browser and search engine" });

  const config = runtime.loadConfig(cwd);
  const browser = await runtime.detectBrowser(config);
  const detectedEngine = await runtime.detectSearchEngine(browser, config);
  const engine = request.engine ? { ...detectedEngine, id: request.engine } : detectedEngine;
  const mode = request.mode || config.mode || "auto";
  const searchUrl = buildSearchUrl(engine, request.query);

  let httpResults: SearchResponse["results"] = [];
  let rankedHttp: SearchResponse["results"] = [];
  let httpError: unknown;

  if (config.httpFirst !== false) {
    emitProgress(options, { phase: "http-search", message: "Searching via HTTP first" });
    try {
      httpResults = await runtime.searchViaHttp(searchUrl, engine.id, config.userAgent, {
        signal: options.signal,
        timeoutMs: config.httpTimeoutMs ?? 10000,
      });
      rankedHttp = rerankResults(httpResults, request.query, request.domainFilter);
      emitProgress(options, {
        phase: "http-search",
        message: `HTTP search found ${rankedHttp.length} result(s)`,
        metrics: { httpResults: rankedHttp.length },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      httpError = error;
      rankedHttp = [];
      emitProgress(options, {
        phase: "http-search",
        message: `HTTP search failed (${summarizeError(error)}), browser fallback may run`,
      });
    }
  }

  throwIfAborted(options.signal);

  const threshold = config.browserFallbackThreshold ?? 0.55;
  const qualityScore = rankedHttp.length / Math.max(1, request.numResults);
  const shouldEscalate = config.mode !== "disabled" && (rankedHttp.length === 0 || qualityScore < threshold);

  let browserResults: SearchResponse["results"] = [];
  let usedBrowserFallback = false;
  let browserError: unknown;

  if (shouldEscalate) {
    emitProgress(options, {
      phase: "browser-search",
      message: "Escalating to browser automation",
      metrics: { qualityScore, threshold },
    });
    try {
      browserResults = await runtime.searchViaBrowser(browser, modeForBrowser(mode), searchUrl, {
        signal: options.signal,
        navigationTimeoutMs: config.browserNavigationTimeoutMs ?? 12000,
        settleTimeoutMs: config.browserResultWaitMs ?? 700,
      });
      usedBrowserFallback = browserResults.length > 0;
      emitProgress(options, {
        phase: "browser-search",
        message: `Browser search found ${browserResults.length} result(s)`,
        metrics: { browserResults: browserResults.length },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      browserError = error;
      emitProgress(options, {
        phase: "browser-search",
        message: `Browser fallback failed (${summarizeError(error)})`,
      });
    }
  }

  throwIfAborted(options.signal);

  emitProgress(options, { phase: "rerank", message: "Ranking and deduplicating results" });
  const mergedCandidates = browserResults.length > 0 ? [...rankedHttp, ...browserResults] : rankedHttp;
  const reranked = rerankResults(mergedCandidates, request.query, request.domainFilter).slice(0, request.numResults);

  if (reranked.length === 0 && httpError && browserError) {
    throw new Error(`Search failed via HTTP and browser fallback: ${summarizeError(httpError)} | ${summarizeError(browserError)}`);
  }

  emitProgress(options, {
    phase: "done",
    message: `Search complete with ${reranked.length} result(s)`,
    metrics: { finalResults: reranked.length, usedBrowserFallback },
  });

  return {
    context: { browser, engine, mode },
    query: request.query,
    results: reranked,
    usedBrowserFallback,
  };
}
