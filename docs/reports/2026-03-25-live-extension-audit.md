# pi-free-web-search — Live Extension Audit (2026-03-25)

> Remediation status: see `docs/reports/2026-03-25-remediation-report.md` for implemented fixes and post-fix verification.

## Objective
Run **real extension-level testing** (not unit tests) to expose practical failures in `free_web_search` and `free_fetch_content`, then deliver a fix-ready issue list.

## What was tested

### 1) Direct extension tools (live web)
- `free_web_search` across engines: `duckduckgo`, `bing`, `google`, `brave`, `yahoo`, `searxng`, `unknown`
- Modes: `auto`, `disabled`, `visible`, `ask`
- Parameters: `includeContent`, `debug`, `domainFilter`, edge-case queries
- `free_fetch_content` on:
  - normal docs pages
  - JS/login/challenge pages
  - PDF/binary content
  - edge/error-like targets

### 2) Scripted live matrix runs (using extension runtime code, no test fixtures)
Saved raw outputs:
- `docs/reports/2026-03-25-search-matrix-disabled.json` (30 runs)
- `docs/reports/2026-03-25-search-matrix-auto.json` (15 runs)
- `docs/reports/2026-03-25-fetch-matrix.json` (14 runs)
- `docs/reports/2026-03-25-edge-cases.json` (4 runs)

### 3) Existing smoke command
- `bun run smoke`
- `FREE_WEB_SMOKE_MODE=disabled bun run smoke`
- `FREE_WEB_SMOKE_FORCE_OFFLINE=1 bun run smoke`

---

## Executive summary

The extension works in favorable conditions, but reliability degrades quickly under real anti-bot pressure and edge content types.

Most important findings:
1. **Default engine path can hard-fail with no recovery** (DuckDuckGo blocked → no fallback engine).
2. **`ask` mode is not actually implemented** (behaves like headless).
3. **`unknown` engine is accepted but functionally broken**.
4. **Content extraction marks challenge pages / empty pages as success**.
5. **PDFs are treated as HTML and returned as binary garbage markdown**.
6. **UI can report “blocked” even when valid results exist**.

---

## High-priority issues (ready to fix)

## P0 — No engine failover when default/selected engine is blocked
**Impact:** Total zero-result failures in real usage.

**Evidence:**
- `docs/reports/2026-03-25-search-matrix-auto.json`
  - DuckDuckGo: 0/3 successful, blocked all 3 (`bot challenge`)
  - Google: 0/3 successful (blocked in browser fallback)
- Manual calls showed same pattern repeatedly with debug output.

**Root cause area:**
- `src/search/orchestrator.ts`
  - `runSearch(...)` executes only one engine attempt.
  - `const finalAttempt = await runEngine(...)` then returns immediately.
- `src/search/orchestrator.ts`
  - `shouldEscalate = !blockedReason && ...` prevents browser retry when HTTP is blocked.

**Fix direction:**
- Add multi-engine candidate loop (primary + fallback engines, deduped).
- Attempt next engine when:
  - blocked,
  - zero results,
  - or low quality after fallback attempt.
- Keep attempts array truly multi-attempt.

---

## P0 — `free_fetch_content` returns anti-bot/challenge pages as if valid content
**Impact:** Agent receives unusable output while tool reports success.

**Evidence:**
- `free_fetch_content({ url: "https://platform.openai.com/settings/profile", mode: "auto" })`
  - returned title `Just a moment...`
  - content: `Verification successful...`
- `free_fetch_content({ url: "https://x.com/OpenAI" })`
  - returned error page text (`Something went wrong...`) as content.
- `docs/reports/2026-03-25-fetch-matrix.json` contains these cases as `ok: true`.

**Root cause area:**
- `src/content/fetch.ts`
  - No blocked/challenge detection in content path.
  - Success is assumed unless fetch throws.

**Fix direction:**
- Add `detectBlockedContentResponse(...)` similar to search blocked detection.
- Return a structured blocked/error state (or throw) when challenge signatures are found.
- Optionally include `blockedReason`, `blockedSource` in `ExtractedContent` details.

---

## P0 — PDF/binary content parsed as HTML text (garbage output)
**Impact:** Massive, useless markdown; truncation; noisy context for models.

**Evidence:**
- `free_fetch_content({ url: "https://www.rfc-editor.org/rfc/rfc9110.pdf" })`
  - returns `%PDF-1.5 ...` binary-like content.
- `docs/reports/2026-03-25-fetch-matrix.json`
  - `markdownLength: 1937144` for the PDF URL.

**Root cause area:**
- `src/content/fetch.ts`
  - Always `response.text()` regardless of `content-type`.
  - Always runs HTML readability pipeline.

**Fix direction:**
- Gate behavior by `content-type`:
  - `text/html`, `application/xhtml+xml` → readability path.
  - non-HTML (pdf/octet-stream/etc.) → explicit unsupported response or dedicated extractor.

---

## P1 — `ask` mode behaves like headless (no ask UX)
**Impact:** Contract mismatch with tool schema and docs.

**Evidence:**
- `docs/reports/2026-03-25-edge-cases.json` (`ask-mode`)
  - browser fallback executed automatically.
- `free_fetch_content({ url: "https://example.com", mode: "ask" })`
  - browser fallback happened automatically (no prompt).

**Root cause area:**
- `src/search/orchestrator.ts` `modeForBrowser(...)`
- `src/search/browser.ts` `toLaunchMode(...)`
- Both map every non-`visible` mode to `headless`.

**Fix direction:**
- In extension layer, implement true ask gate via Pi UI confirm before browser launch.
- Pass resolved mode to orchestrator only after user decision.

---

## P1 — `unknown` engine is user-selectable but broken
**Impact:** User can select a mode that predictably returns zero results.

**Evidence:**
- `docs/reports/2026-03-25-edge-cases.json` (`unknown-engine`) → 0 results.
- Search URL fell back to DuckDuckGo template while parser used generic engine path.

**Root cause area:**
- `extensions/free-web-search/index.ts`
  - Tool schema allows `engine: "unknown"`.
- `src/search/engines.ts`
  - default template for unknown points to DuckDuckGo.
- `src/search/http.ts`
  - unknown uses generic parser, not DuckDuckGo parser.

**Fix direction:**
- Remove `unknown` from tool-exposed enum.
- Keep `unknown` internal only for detection fallback.

---

## P1 — “Blocked” status message can be misleading
**Impact:** UI says blocked even when valid results were returned.

**Evidence:**
- Example: domain-filtered runs returned results but header showed `Status: DuckDuckGo blocked this query` (browser fallback blocked after HTTP succeeded).

**Root cause area:**
- `extensions/free-web-search/index.ts` `blockedSummary(...)`
  - any `blockedReason` in single attempt triggers blocked headline.

**Fix direction:**
- Show blocked status only if `finalResults === 0` OR all attempts failed.
- Otherwise show warning note: `browser fallback blocked, HTTP results used`.

---

## P1 — Empty query allowed (and returns junk/ads)
**Impact:** Low-quality, confusing outputs.

**Evidence:**
- `docs/reports/2026-03-25-edge-cases.json` (`empty-query`) returned Brave ads result as top hit.

**Root cause area:**
- `extensions/free-web-search/index.ts`
  - `query: Type.String(...)` has no min length/trim validation.

**Fix direction:**
- Validate trimmed query length >= 2 (or >=1) in schema/execute path.
- Return actionable validation error.

---

## P2 — Content fallback heuristic can trigger unnecessary browser launches
**Impact:** Extra latency + anti-bot exposure on short but valid pages.

**Evidence:**
- `docs/reports/2026-03-25-fetch-matrix.json`
  - `https://example.com` in `auto` had `usedBrowserFallback: true` even though HTTP extraction was already valid and unchanged.

**Root cause area:**
- `src/content/fetch.ts`
  - fallback solely on `markdown.length < contentMinMarkdownLength`.

**Fix direction:**
- Refine heuristic using multiple signals (title presence, paragraph count, readability confidence, meaningful text density).

---

## P2 — `context` request parameter is currently dead
**Impact:** Public API surface implies behavior that does not exist.

**Evidence:**
- `SearchRequest.context` exists in `src/types.ts`.
- No usage in `src/search/orchestrator.ts` ranking/query pipeline.

**Fix direction:**
- Either implement context-aware reranking/query expansion, or remove the parameter from public schema for now.

---

## P2 — Smoke test can pass with irrelevant or poor content
**Impact:** False confidence in CI/local checks.

**Evidence:**
- `bun run smoke` passed with unrelated Zhihu result for Bun docs query.
- Current pass condition is mainly `content.markdown.length >= 50`.

**Root cause area:**
- `scripts/smoke-test.ts` success criteria too weak.

**Fix direction:**
- Add relevance assertions:
  - domain/topic whitelist checks,
  - expected keyword checks,
  - challenge-page rejection.

---

## Fix order recommendation
1. **P0 failover architecture** in `runSearch` (multi-engine attempts + blocked handling).
2. **P0 content validity guards** (challenge detection + content-type handling for non-HTML).
3. **P1 API contract fixes** (`ask`, `unknown`, empty query validation).
4. **P1 UX correctness** (blocked summary messaging).
5. **P2 heuristic quality improvements** (content fallback + context use + smoke quality gate).

---

## Minimal regression checklist after fixes
- Engine failover from blocked DDG to alternative returns usable results.
- `mode: "ask"` visibly requests permission before browser launch.
- `engine: "unknown"` rejected at validation layer.
- Empty/whitespace query rejected.
- PDF URL returns explicit unsupported/handled response (no binary markdown dump).
- Challenge pages return blocked/error state, not normal extracted content.
- Blocked summary does not override successful-result status.
- Smoke test fails on irrelevant/challenge-only outputs.
