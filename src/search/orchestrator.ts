import { loadConfig } from "../config";
import { detectBrowser } from "../detection/browser";
import { detectSearchEngine, templateForEngine } from "../detection/engine";
import type {
  EffectiveSearchContext,
  FreeWebSearchConfig,
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

export interface EngineHealthSnapshot {
  engine: SearchEngineId;
  successes: number;
  failures: number;
  blocked: number;
  consecutiveFailures: number;
  coolingDown: boolean;
  coolDownUntil?: number;
  lastFailureReason?: string;
  lastLatencyMs?: number;
  avgLatencyMs?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

const defaultDeps: SearchRuntimeDeps = {
  loadConfig,
  detectBrowser,
  detectSearchEngine,
  searchViaHttp,
  searchViaBrowser,
};

const ENGINE_FALLBACK_ORDER: SearchEngineId[] = ["yahoo", "bing", "duckduckgo", "brave", "google", "searxng"];

interface EngineHealthRecord {
  engine: SearchEngineId;
  successes: number;
  failures: number;
  blocked: number;
  consecutiveFailures: number;
  coolDownUntil?: number;
  lastFailureReason?: string;
  lastLatencyMs?: number;
  totalLatencyMs: number;
  samples: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

interface EngineRunResult {
  engine: SearchEngineDetection;
  searchUrl: string;
  results: SearchResponse["results"];
  usedBrowserFallback: boolean;
  attemptedBrowserFallback: boolean;
  blockedReason?: string;
  blockedSource?: "http" | "browser";
  pageTitle?: string;
  httpStatus?: number;
  error?: string;
  httpResults: number;
  browserResults: number;
  durationMs: number;
}

const sessionEngineHealth = new Map<SearchEngineId, EngineHealthRecord>();

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

function getOrCreateEngineHealth(engine: SearchEngineId): EngineHealthRecord {
  const existing = sessionEngineHealth.get(engine);
  if (existing) return existing;

  const created: EngineHealthRecord = {
    engine,
    successes: 0,
    failures: 0,
    blocked: 0,
    consecutiveFailures: 0,
    totalLatencyMs: 0,
    samples: 0,
  };
  sessionEngineHealth.set(engine, created);
  return created;
}

function engineHealthCooldownMs(config: FreeWebSearchConfig): number {
  return config.engineHealthCooldownMs ?? 10 * 60 * 1000;
}

function engineFailureThreshold(config: FreeWebSearchConfig): number {
  return Math.max(1, config.engineFailureThreshold ?? 2);
}

function isCoolingDown(engine: SearchEngineId, config: FreeWebSearchConfig, now = Date.now()): boolean {
  const record = sessionEngineHealth.get(engine);
  if (!record?.coolDownUntil) return false;
  if (record.coolDownUntil <= now) {
    record.coolDownUntil = undefined;
    return false;
  }
  return record.consecutiveFailures >= engineFailureThreshold(config);
}

function recordEngineHealth(result: EngineRunResult, config: FreeWebSearchConfig, now = Date.now()): void {
  const record = getOrCreateEngineHealth(result.engine.id);
  record.lastLatencyMs = result.durationMs;
  record.totalLatencyMs += result.durationMs;
  record.samples += 1;

  if (result.results.length > 0) {
    record.successes += 1;
    record.consecutiveFailures = 0;
    record.coolDownUntil = undefined;
    record.lastSuccessAt = now;
    return;
  }

  record.failures += 1;
  record.consecutiveFailures += 1;
  record.lastFailureAt = now;
  record.lastFailureReason = result.blockedReason || result.error;
  if (result.blockedReason) record.blocked += 1;

  if (record.consecutiveFailures >= engineFailureThreshold(config)) {
    record.coolDownUntil = now + engineHealthCooldownMs(config);
  }
}

export function getSessionEngineHealthSnapshot(now = Date.now()): EngineHealthSnapshot[] {
  return [...sessionEngineHealth.values()]
    .map((record) => ({
      engine: record.engine,
      successes: record.successes,
      failures: record.failures,
      blocked: record.blocked,
      consecutiveFailures: record.consecutiveFailures,
      coolingDown: Boolean(record.coolDownUntil && record.coolDownUntil > now),
      coolDownUntil: record.coolDownUntil,
      lastFailureReason: record.lastFailureReason,
      lastLatencyMs: record.lastLatencyMs,
      avgLatencyMs: record.samples > 0 ? Math.round(record.totalLatencyMs / record.samples) : undefined,
      lastSuccessAt: record.lastSuccessAt,
      lastFailureAt: record.lastFailureAt,
    }))
    .sort((a, b) => ENGINE_FALLBACK_ORDER.indexOf(a.engine) - ENGINE_FALLBACK_ORDER.indexOf(b.engine));
}

export function resetSessionEngineHealth(): void {
  sessionEngineHealth.clear();
}

function normalizeEngineId(engine: SearchEngineId | undefined, detectedEngine: SearchEngineDetection): SearchEngineId {
  if (!engine || engine === "unknown") {
    return detectedEngine.id === "unknown" ? "yahoo" : detectedEngine.id;
  }
  return engine;
}

function buildEngineCandidate(
  requestedEngine: SearchEngineId,
  detectedEngine: SearchEngineDetection,
  config: Pick<FreeWebSearchConfig, "searxngBaseUrl" | "locale" | "language">,
): SearchEngineDetection {
  return {
    ...detectedEngine,
    id: requestedEngine,
    label: requestedEngine,
    templateUrl: templateForEngine(requestedEngine, config),
  };
}

function buildEngineCandidates(
  requestedEngine: SearchRequest["engine"],
  detectedEngine: SearchEngineDetection,
  config: FreeWebSearchConfig,
): SearchEngineDetection[] {
  const explicitEngine = requestedEngine && requestedEngine !== "unknown" ? requestedEngine : undefined;
  if (explicitEngine) {
    return [buildEngineCandidate(explicitEngine, detectedEngine, config)];
  }

  const primaryEngine = normalizeEngineId(requestedEngine, detectedEngine);
  const candidateIds = [primaryEngine, ...ENGINE_FALLBACK_ORDER]
    .filter((engineId, index, list) => list.indexOf(engineId) === index)
    .filter((engineId) => engineId !== "searxng" || Boolean(config.searxngBaseUrl));

  const cooledDownFiltered = candidateIds.filter((engineId) => !isCoolingDown(engineId, config));
  const finalIds = cooledDownFiltered.length > 0 ? cooledDownFiltered : candidateIds;

  return finalIds.map((engineId) => buildEngineCandidate(engineId, detectedEngine, config));
}

function toSearchAttempt(result: EngineRunResult): SearchAttempt {
  return {
    engine: result.engine.id,
    searchUrl: result.searchUrl,
    httpResults: result.httpResults,
    browserResults: result.browserResults,
    finalResults: result.results.length,
    attemptedBrowserFallback: result.attemptedBrowserFallback,
    usedBrowserFallback: result.usedBrowserFallback,
    blockedReason: result.blockedReason,
    blockedSource: result.blockedSource,
    pageTitle: result.pageTitle,
    httpStatus: result.httpStatus,
    error: result.error,
    durationMs: result.durationMs,
  };
}

function httpTimeoutForEngine(engine: SearchEngineId, config: FreeWebSearchConfig): number {
  const defaultTimeout = config.httpTimeoutMs ?? 10000;
  if (engine === "duckduckgo") return Math.min(defaultTimeout, 5000);
  return defaultTimeout;
}

function browserNavigationTimeoutForEngine(engine: SearchEngineId, config: FreeWebSearchConfig): number {
  const defaultTimeout = config.browserNavigationTimeoutMs ?? 12000;
  if (engine === "duckduckgo") return Math.min(defaultTimeout, 6000);
  return defaultTimeout;
}

async function runEngine(
  runtime: SearchRuntimeDeps,
  browser: EffectiveSearchContext["browser"],
  config: ReturnType<typeof loadConfig>,
  request: SearchRequest,
  engine: SearchEngineDetection,
  mode: EffectiveSearchContext["mode"],
  rankingQuery: string,
  options: RunSearchOptions,
): Promise<EngineRunResult> {
  const startedAt = Date.now();
  const searchUrl = buildSearchUrl(engine, request.query);
  let httpResults: SearchResponse["results"] = [];
  let rankedHttp: SearchResponse["results"] = [];
  let browserResults: SearchResponse["results"] = [];
  let httpError: unknown;
  let browserError: unknown;
  let blockedReason: string | undefined;
  let blockedSource: "http" | "browser" | undefined;
  let pageTitle: string | undefined;
  let httpStatus: number | undefined;
  let attemptedBrowserFallback = false;
  let usedBrowserFallback = false;

  if (config.httpFirst !== false) {
    emitProgress(options, {
      phase: "http-search",
      message: `Searching via HTTP first (${engine.label})`,
      metrics: { engine: engine.id, searchUrl },
    });
    try {
      httpResults = await runtime.searchViaHttp(searchUrl, engine.id, config.userAgent, {
        signal: options.signal,
        timeoutMs: httpTimeoutForEngine(engine.id, config),
      });
      rankedHttp = rerankResults(httpResults, rankingQuery, request.domainFilter);
      emitProgress(options, {
        phase: "http-search",
        message: `HTTP search found ${rankedHttp.length} result(s) via ${engine.label}`,
        metrics: { engine: engine.id, httpResults: rankedHttp.length, searchUrl },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (isSearchEngineBlockedError(error)) {
        blockedReason = error.reason;
        blockedSource = error.source;
        pageTitle = typeof error.metadata.title === "string" ? error.metadata.title : undefined;
        httpStatus = typeof error.metadata.status === "number" ? error.metadata.status : undefined;
        emitProgress(options, {
          phase: "http-search",
          message: `${engine.label} HTTP search was blocked (${error.reason})`,
          metrics: {
            engine: engine.id,
            blocked: true,
            searchUrl,
            blockedReason: error.reason,
            blockedSource: error.source,
            httpStatus: httpStatus ?? "n/a",
            pageTitle: pageTitle ?? "n/a",
          },
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
  const browserAllowed = mode !== "disabled" && mode !== "ask";
  const blockedByBrowser = blockedSource === "browser";
  const shouldEscalate = browserAllowed && !blockedByBrowser && (blockedSource === "http" || rankedHttp.length === 0 || qualityScore < threshold);

  if (shouldEscalate) {
    attemptedBrowserFallback = true;
    emitProgress(options, {
      phase: "browser-search",
      message: `Escalating to browser automation (${engine.label})`,
      metrics: { engine: engine.id, qualityScore, threshold, searchUrl },
    });
    try {
      browserResults = await runtime.searchViaBrowser(browser, modeForBrowser(mode), searchUrl, {
        signal: options.signal,
        navigationTimeoutMs: browserNavigationTimeoutForEngine(engine.id, config),
        settleTimeoutMs: config.browserResultWaitMs ?? 700,
      });
      usedBrowserFallback = browserResults.length > 0;
      emitProgress(options, {
        phase: "browser-search",
        message: `Browser search found ${browserResults.length} result(s) via ${engine.label}`,
        metrics: { engine: engine.id, browserResults: browserResults.length, searchUrl },
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (isSearchEngineBlockedError(error)) {
        blockedReason = error.reason;
        blockedSource = error.source;
        pageTitle = typeof error.metadata.title === "string" ? error.metadata.title : pageTitle;
        emitProgress(options, {
          phase: "browser-search",
          message: `${engine.label} browser search was blocked (${error.reason})`,
          metrics: {
            engine: engine.id,
            blocked: true,
            searchUrl,
            blockedReason: error.reason,
            blockedSource: error.source,
            pageTitle: pageTitle ?? "n/a",
          },
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
    metrics: { engine: engine.id, searchUrl },
  });

  const mergedCandidates = browserResults.length > 0 ? [...rankedHttp, ...browserResults] : rankedHttp;
  const reranked = rerankResults(mergedCandidates, rankingQuery, request.domainFilter).slice(0, request.numResults);
  const error = reranked.length === 0 && httpError && browserError
    ? `Search failed via HTTP and browser fallback: ${summarizeError(httpError)} | ${summarizeError(browserError)}`
    : httpError
      ? summarizeError(httpError)
      : browserError
        ? summarizeError(browserError)
        : undefined;

  return {
    engine,
    searchUrl,
    results: reranked,
    usedBrowserFallback,
    attemptedBrowserFallback,
    blockedReason,
    blockedSource,
    pageTitle,
    httpStatus,
    error,
    httpResults: rankedHttp.length,
    browserResults: browserResults.length,
    durationMs: Date.now() - startedAt,
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

  const query = request.query.trim();
  if (!query) throw new Error("Search query must not be empty");

  const normalizedRequest: SearchRequest = { ...request, query };
  const rankingQuery = normalizedRequest.context ? `${normalizedRequest.query} ${normalizedRequest.context}`.trim() : normalizedRequest.query;

  const config = runtime.loadConfig(cwd);
  const browser = await runtime.detectBrowser(config);
  const detectedEngine = await runtime.detectSearchEngine(browser, config);
  const mode = normalizedRequest.mode || config.mode || "auto";
  const engineCandidates = buildEngineCandidates(normalizedRequest.engine, detectedEngine, config);

  const attempts: SearchAttempt[] = [];
  const collectedResults: SearchResponse["results"] = [];
  let usedBrowserFallback = false;
  let finalEngine = engineCandidates[0] || buildEngineCandidate("yahoo", detectedEngine, config);

  for (let index = 0; index < engineCandidates.length; index += 1) {
    const candidate = engineCandidates[index];
    if (index > 0) {
      emitProgress(options, {
        phase: "detecting",
        message: `Trying fallback engine (${candidate.label})`,
        metrics: { attempt: index + 1, engine: candidate.id, totalCandidates: engineCandidates.length },
      });
    }

    const attempt = await runEngine(runtime, browser, config, normalizedRequest, candidate, mode, rankingQuery, options);
    recordEngineHealth(attempt, config);
    attempts.push(toSearchAttempt(attempt));
    if (attempt.usedBrowserFallback) usedBrowserFallback = true;

    if (attempt.results.length === 0) continue;

    collectedResults.push(...attempt.results);
    finalEngine = candidate;

    const explicitEngineSelected = Boolean(normalizedRequest.engine && normalizedRequest.engine !== "unknown");
    const shouldContinueForCoverage = !explicitEngineSelected && attempt.results.length < normalizedRequest.numResults && Boolean(attempt.blockedReason);
    if (!shouldContinueForCoverage) break;
  }

  const results = rerankResults(collectedResults, rankingQuery, normalizedRequest.domainFilter).slice(0, normalizedRequest.numResults);
  if (results.length > 0) {
    const topEngine = engineCandidates.find((engine) => engine.id === results[0].sourceEngine);
    if (topEngine) finalEngine = topEngine;
  }

  emitProgress(options, {
    phase: "done",
    message: `Search complete with ${results.length} result(s) via ${finalEngine.label}`,
    metrics: {
      finalResults: results.length,
      usedBrowserFallback,
      attempts: attempts.length,
      engine: finalEngine.id,
    },
  });

  return {
    context: { browser, engine: finalEngine, mode },
    query: normalizedRequest.query,
    results,
    usedBrowserFallback,
    attempts,
  };
}
