import { loadConfig } from "../config";
import { detectBrowser } from "../detection/browser";
import { detectSearchEngine } from "../detection/engine";
import type {
  EffectiveSearchContext,
  SearchAttempt,
  SearchEngineDetection,
  SearchEngineId,
  SearchRequest,
  SearchResponse,
} from "../types";
import { isAbortError, throwIfAborted } from "../util/abort";
import { searchViaBrowser } from "./browser";
import { buildSearchUrl } from "./engines";
import { isSearchEngineBlockedError, searchViaHttp } from "./http";
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

const fallbackEngineOrder: SearchEngineId[] = ["duckduckgo", "bing", "google", "yahoo", "brave", "searxng"];

interface EngineRunResult {
  engine: SearchEngineDetection;
  results: SearchResponse["results"];
  usedBrowserFallback: boolean;
  attemptedBrowserFallback: boolean;
  blockedReason?: string;
  error?: string;
  httpResults: number;
  browserResults: number;
}

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

function resolveEngineTemplateForOverride(
  detected: SearchEngineDetection,
  overrideId: SearchRequest["engine"],
  searxngBaseUrl?: string,
): string | undefined {
  if (!overrideId) return detected.templateUrl;
  if (overrideId === detected.id) return detected.templateUrl;
  if (overrideId === "searxng" && searxngBaseUrl) {
    return `${searxngBaseUrl.replace(/\/$/, "")}/search?q={searchTerms}`;
  }
  return undefined;
}

function uniqueEngines(values: Array<SearchEngineId | undefined>): SearchEngineId[] {
  const output: SearchEngineId[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || value === "unknown" || seen.has(value)) continue;
    output.push(value);
    seen.add(value);
  }
  return output;
}

function resolveEngineCandidate(
  detectedEngine: SearchEngineDetection,
  engineId: SearchEngineId,
  searxngBaseUrl?: string,
): SearchEngineDetection {
  return {
    ...detectedEngine,
    id: engineId,
    label: engineId,
    templateUrl: resolveEngineTemplateForOverride(detectedEngine, engineId, searxngBaseUrl),
  };
}

function buildEngineCandidates(
  requestedEngine: SearchRequest["engine"],
  detectedEngine: SearchEngineDetection,
  searxngBaseUrl?: string,
): SearchEngineDetection[] {
  const engineIds = uniqueEngines([requestedEngine, detectedEngine.id, ...fallbackEngineOrder]).filter(
    (engineId) => engineId !== "searxng" || detectedEngine.id === "searxng" || Boolean(searxngBaseUrl),
  );

  return engineIds.map((engineId) => resolveEngineCandidate(detectedEngine, engineId, searxngBaseUrl));
}

function toSearchAttempt(result: EngineRunResult): SearchAttempt {
  return {
    engine: result.engine.id,
    httpResults: result.httpResults,
    browserResults: result.browserResults,
    finalResults: result.results.length,
    attemptedBrowserFallback: result.attemptedBrowserFallback,
    usedBrowserFallback: result.usedBrowserFallback,
    blockedReason: result.blockedReason,
    error: result.error,
  };
}

async function runEngine(
  runtime: SearchRuntimeDeps,
  browser: EffectiveSearchContext["browser"],
  config: ReturnType<typeof loadConfig>,
  request: SearchRequest,
  engine: SearchEngineDetection,
  mode: EffectiveSearchContext["mode"],
  options: RunSearchOptions,
): Promise<EngineRunResult> {
  const searchUrl = buildSearchUrl(engine, request.query);
  let httpResults: SearchResponse["results"] = [];
  let rankedHttp: SearchResponse["results"] = [];
  let browserResults: SearchResponse["results"] = [];
  let httpError: unknown;
  let browserError: unknown;
  let blockedReason: string | undefined;
  let attemptedBrowserFallback = false;
  let usedBrowserFallback = false;

  if (config.httpFirst !== false) {
    emitProgress(options, {
      phase: "http-search",
      message: `Searching via HTTP first (${engine.label})`,
      metrics: { engine: engine.id },
    });
    try {
      httpResults = await runtime.searchViaHttp(searchUrl, engine.id, config.userAgent, {
        signal: options.signal,
        timeoutMs: config.httpTimeoutMs ?? 10000,
      });
      rankedHttp = rerankResults(httpResults, request.query, request.domainFilter);
      emitProgress(options, {
        phase: "http-search",
        message: `HTTP search found ${rankedHttp.length} result(s) via ${engine.label}`,
        metrics: { engine: engine.id, httpResults: rankedHttp.length },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (isSearchEngineBlockedError(error)) {
        blockedReason = error.reason;
        emitProgress(options, {
          phase: "http-search",
          message: `${engine.label} HTTP search was blocked (${error.reason})`,
          metrics: { engine: engine.id, blocked: true },
        });
      } else {
        httpError = error;
        emitProgress(options, {
          phase: "http-search",
          message: `HTTP search failed for ${engine.label} (${summarizeError(error)})`,
          metrics: { engine: engine.id },
        });
      }
      rankedHttp = [];
    }
  }

  throwIfAborted(options.signal);

  const threshold = config.browserFallbackThreshold ?? 0.55;
  const qualityScore = rankedHttp.length / Math.max(1, request.numResults);
  const browserAllowed = mode !== "disabled";
  const shouldEscalate = !blockedReason && browserAllowed && (rankedHttp.length === 0 || qualityScore < threshold);

  if (shouldEscalate) {
    attemptedBrowserFallback = true;
    emitProgress(options, {
      phase: "browser-search",
      message: `Escalating to browser automation (${engine.label})`,
      metrics: { engine: engine.id, qualityScore, threshold },
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
        message: `Browser search found ${browserResults.length} result(s) via ${engine.label}`,
        metrics: { engine: engine.id, browserResults: browserResults.length },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (isSearchEngineBlockedError(error)) {
        blockedReason = error.reason;
        emitProgress(options, {
          phase: "browser-search",
          message: `${engine.label} browser search was blocked (${error.reason})`,
          metrics: { engine: engine.id, blocked: true },
        });
      } else {
        browserError = error;
        emitProgress(options, {
          phase: "browser-search",
          message: `Browser fallback failed for ${engine.label} (${summarizeError(error)})`,
          metrics: { engine: engine.id },
        });
      }
    }
  }

  throwIfAborted(options.signal);
  emitProgress(options, {
    phase: "rerank",
    message: `Ranking and deduplicating results (${engine.label})`,
    metrics: { engine: engine.id },
  });

  const mergedCandidates = browserResults.length > 0 ? [...rankedHttp, ...browserResults] : rankedHttp;
  const reranked = rerankResults(mergedCandidates, request.query, request.domainFilter).slice(0, request.numResults);
  const error = reranked.length === 0 && httpError && browserError
    ? `Search failed via HTTP and browser fallback: ${summarizeError(httpError)} | ${summarizeError(browserError)}`
    : httpError
      ? summarizeError(httpError)
      : browserError
        ? summarizeError(browserError)
        : undefined;

  return {
    engine,
    results: reranked,
    usedBrowserFallback,
    attemptedBrowserFallback,
    blockedReason,
    error,
    httpResults: rankedHttp.length,
    browserResults: browserResults.length,
  };
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
  const mode = request.mode || config.mode || "auto";
  const engineCandidates = buildEngineCandidates(request.engine, detectedEngine, config.searxngBaseUrl);
  const attempts: SearchAttempt[] = [];
  let finalAttempt: EngineRunResult | undefined;

  for (let index = 0; index < engineCandidates.length; index += 1) {
    const engine = engineCandidates[index];
    const attempt = await runEngine(runtime, browser, config, request, engine, mode, options);
    attempts.push(toSearchAttempt(attempt));

    if (attempt.results.length > 0) {
      finalAttempt = attempt;
      break;
    }

    const nextEngine = engineCandidates[index + 1];
    if (nextEngine) {
      const reason = attempt.blockedReason
        ? `${engine.label} was blocked (${attempt.blockedReason})`
        : attempt.error
          ? `${engine.label} failed (${attempt.error})`
          : `${engine.label} returned no results`;
      emitProgress(options, {
        phase: "detecting",
        message: `${reason}; retrying with ${nextEngine.label}`,
        metrics: { fromEngine: engine.id, toEngine: nextEngine.id },
      });
    }
  }

  const activeEngine = finalAttempt?.engine || engineCandidates[0] || detectedEngine;
  const results = finalAttempt?.results || [];
  const usedBrowserFallback = finalAttempt?.usedBrowserFallback || false;

  emitProgress(options, {
    phase: "done",
    message: `Search complete with ${results.length} result(s) via ${activeEngine.label}`,
    metrics: {
      finalResults: results.length,
      usedBrowserFallback,
      attempts: attempts.length,
      engine: activeEngine.id,
    },
  });

  return {
    context: { browser, engine: activeEngine, mode },
    query: request.query,
    results,
    usedBrowserFallback,
    attempts,
  };
}
