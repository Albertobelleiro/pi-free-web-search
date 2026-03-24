import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchContent } from "../src/content/fetch";
import { parseSearchHtml } from "../src/search/http";
import { runSearch, resolveSearchContext } from "../src/search/orchestrator";
import type { BrowserMode, SearchEngineId } from "../src/types";

const cwd = process.cwd();
const query = process.argv.slice(2).join(" ") || "Bun runtime documentation";
const smokeMode = (process.env.FREE_WEB_SMOKE_MODE as BrowserMode | undefined) || "headless";
const allowOfflineFallback = process.env.FREE_WEB_SMOKE_ALLOW_OFFLINE === "1" || process.env.CI === "true";
const forceOffline = process.env.FREE_WEB_SMOKE_FORCE_OFFLINE === "1";
const requestedEngine = process.env.FREE_WEB_SMOKE_ENGINE as SearchEngineId | undefined;

function uniqueEngines(values: Array<SearchEngineId | undefined>): SearchEngineId[] {
  const output: SearchEngineId[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    output.push(value);
    seen.add(value);
  }
  return output;
}

async function runOfflineSmoke(): Promise<void> {
  console.log("[smoke] running deterministic offline fallback...");

  const fixturePath = join(import.meta.dir, "..", "tests", "fixtures", "duckduckgo.html");
  const fixtureHtml = readFileSync(fixturePath, "utf8");
  const fixtureResults = parseSearchHtml(fixtureHtml, "https://duckduckgo.com/html/?q=bun", "duckduckgo");
  if (fixtureResults.length === 0) throw new Error("Offline fallback parser did not return results");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Offline Smoke</title></head><body><article><h1>Offline Smoke Article</h1><p>This verifies readability extraction during CI fallback mode when live web search returns zero results.</p><p>It should produce enough markdown content for the smoke pass.</p></article></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    const top = fixtureResults[0];
    console.log(`[smoke] offline top result: ${top.title} -> ${top.url}`);

    const content = await fetchContent(cwd, top.url, "disabled");
    if (content.markdown.length < 50) {
      throw new Error("Offline fallback extracted content too short");
    }

    console.log(`[smoke] offline content title: ${content.title}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main(): Promise<void> {
  if (forceOffline) {
    await runOfflineSmoke();
    console.log("[smoke] PASS (forced offline)");
    return;
  }

  console.log("[smoke] resolving context...");
  const context = await resolveSearchContext(cwd);
  console.log(`[smoke] browser=${context.browser.browserLabel} engine=${context.engine.label} mode=${context.mode}`);
  console.log(`[smoke] execution mode=${smokeMode}`);

  const engineCandidates = uniqueEngines([requestedEngine, context.engine.id, "duckduckgo", "bing", "brave"]);

  let searchResult: Awaited<ReturnType<typeof runSearch>> | undefined;
  let selectedEngine: SearchEngineId | undefined;

  for (const engine of engineCandidates) {
    console.log(`[smoke] searching (${engine}): ${query}`);
    const attempt = await runSearch(cwd, {
      query,
      numResults: 3,
      includeContent: false,
      mode: smokeMode,
      engine,
    });

    if (attempt.results.length > 0) {
      searchResult = attempt;
      selectedEngine = engine;
      break;
    }

    console.log(`[smoke] no results via ${engine}`);
  }

  if (!searchResult) {
    if (smokeMode === "disabled" && allowOfflineFallback) {
      console.log("[smoke] live search returned no results in disabled mode; falling back to deterministic offline smoke");
      await runOfflineSmoke();
      console.log("[smoke] PASS (offline fallback)");
      return;
    }

    throw new Error(`No search results returned across engines: ${engineCandidates.join(", ")}`);
  }

  const topResult = searchResult.results[0];
  console.log(`[smoke] top result (${selectedEngine || "auto"}): ${topResult.title} -> ${topResult.url}`);

  console.log("[smoke] fetching content...");
  const content = await fetchContent(cwd, topResult.url, smokeMode);
  if (content.markdown.length < 50) throw new Error("Extracted content too short");
  console.log(`[smoke] content title: ${content.title}`);
  console.log("[smoke] PASS");
}

await main();
