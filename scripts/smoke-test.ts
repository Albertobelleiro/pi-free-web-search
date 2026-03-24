import { fetchContent } from "../src/content/fetch";
import { runSearch, resolveSearchContext } from "../src/search/orchestrator";
import type { BrowserMode } from "../src/types";

const cwd = process.cwd();
const query = process.argv.slice(2).join(" ") || "Bun runtime documentation";
const smokeMode = (process.env.FREE_WEB_SMOKE_MODE as BrowserMode | undefined) || "headless";

console.log("[smoke] resolving context...");
const context = await resolveSearchContext(cwd);
console.log(`[smoke] browser=${context.browser.browserLabel} engine=${context.engine.label} mode=${context.mode}`);
console.log(`[smoke] execution mode=${smokeMode}`);

console.log(`[smoke] searching: ${query}`);
const search = await runSearch(cwd, { query, numResults: 3, includeContent: false, mode: smokeMode });
if (search.results.length === 0) throw new Error("No search results returned");
console.log(`[smoke] top result: ${search.results[0].title} -> ${search.results[0].url}`);

console.log("[smoke] fetching content...");
const content = await fetchContent(cwd, search.results[0].url, smokeMode);
if (content.markdown.length < 50) throw new Error("Extracted content too short");
console.log(`[smoke] content title: ${content.title}`);
console.log("[smoke] PASS");
