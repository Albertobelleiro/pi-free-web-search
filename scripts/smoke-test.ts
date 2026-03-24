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

  let hadAnyLiveResults = false;
  const searchErrors: string[] = [];
  const contentFailures: string[] = [];

  for (const engine of engineCandidates) {
    console.log(`[smoke] searching (${engine}): ${query}`);

    let attempt: Awaited<ReturnType<typeof runSearch>> | undefined;
    try {
      attempt = await runSearch(cwd, {
        query,
        numResults: 5,
        includeContent: false,
        mode: smokeMode,
        engine,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      searchErrors.push(`${engine}: ${message}`);
      console.log(`[smoke] search failed via ${engine}: ${message}`);
      continue;
    }

    if (attempt.results.length === 0) {
      console.log(`[smoke] no results via ${engine}`);
      continue;
    }

    hadAnyLiveResults = true;
    const topResult = attempt.results[0];
    console.log(`[smoke] top result (${engine}): ${topResult.title} -> ${topResult.url}`);

    for (const candidate of attempt.results) {
      console.log(`[smoke] fetching content (${engine}): ${candidate.url}`);
      try {
        const content = await fetchContent(cwd, candidate.url, smokeMode);
        if (content.markdown.length >= 50) {
          console.log(`[smoke] content title: ${content.title}`);
          console.log(`[smoke] content url: ${candidate.url}`);
          console.log("[smoke] PASS");
          return;
        }
        const failure = `${engine}: ${candidate.url} (too short: ${content.markdown.length})`;
        contentFailures.push(failure);
        console.log(`[smoke] content too short (${content.markdown.length}) for ${candidate.url}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failure = `${engine}: ${candidate.url} (error: ${message})`;
        contentFailures.push(failure);
        console.log(`[smoke] content extraction failed for ${candidate.url}: ${message}`);
      }
    }

    console.log(`[smoke] no extractable content via ${engine}, trying next engine`);
  }

  if (!hadAnyLiveResults) {
    if (smokeMode === "disabled" && allowOfflineFallback) {
      console.log("[smoke] live search returned no results in disabled mode; falling back to deterministic offline smoke");
      await runOfflineSmoke();
      console.log("[smoke] PASS (offline fallback)");
      return;
    }

    const details = searchErrors.length > 0 ? ` | errors: ${searchErrors.join(" ; ")}` : "";
    throw new Error(`No search results returned across engines: ${engineCandidates.join(", ")}${details}`);
  }

  const detailSuffix = contentFailures.length > 0 ? ` Details: ${contentFailures.join(" ; ")}` : "";
  throw new Error(`Search returned URLs but none produced extractable content.${detailSuffix}`);
}

await main();
