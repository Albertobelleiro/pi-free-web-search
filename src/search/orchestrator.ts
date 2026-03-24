import { loadConfig } from "../config";
import { detectBrowser } from "../detection/browser";
import { detectSearchEngine } from "../detection/engine";
import type { EffectiveSearchContext, SearchRequest, SearchResponse } from "../types";
import { buildSearchUrl } from "./engines";
import { searchViaBrowser } from "./browser";
import { searchViaHttp } from "./http";
import { rerankResults } from "./rank";

export async function resolveSearchContext(cwd: string): Promise<EffectiveSearchContext> {
  const config = loadConfig(cwd);
  const browser = await detectBrowser(config);
  const engine = await detectSearchEngine(browser, config);
  return {
    browser,
    engine,
    mode: config.mode || "auto",
  };
}

export async function runSearch(cwd: string, request: SearchRequest): Promise<SearchResponse> {
  const config = loadConfig(cwd);
  const browser = await detectBrowser(config);
  const detectedEngine = await detectSearchEngine(browser, config);
  const engine = request.engine ? { ...detectedEngine, id: request.engine } : detectedEngine;
  const searchUrl = buildSearchUrl(engine, request.query);

  let usedBrowserFallback = false;
  let results = config.httpFirst === false ? [] : await searchViaHttp(searchUrl, engine.id, config.userAgent);
  const rankedHttp = rerankResults(results, request.query, request.domainFilter);

  if (config.mode !== "disabled") {
    const threshold = config.browserFallbackThreshold ?? 0.55;
    const qualityScore = Math.min(1, rankedHttp.length / Math.max(1, request.numResults));
    const shouldEscalate = rankedHttp.length < request.numResults || qualityScore < threshold;
    if (shouldEscalate) {
      const mode = request.mode || config.mode || "auto";
      results = await searchViaBrowser(browser, mode === "auto" ? "headless" : mode, searchUrl);
      usedBrowserFallback = true;
    }
  }

  const reranked = rerankResults(results.length > 0 ? results : rankedHttp, request.query, request.domainFilter).slice(0, request.numResults);
  return {
    context: { browser, engine, mode: request.mode || config.mode || "auto" },
    query: request.query,
    results: reranked,
    usedBrowserFallback,
  };
}
