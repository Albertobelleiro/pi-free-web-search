# pi-free-web-search — Remediation Report (2026-03-25)

## Scope
This document tracks remediation of issues identified in `docs/reports/2026-03-25-live-extension-audit.md`.

---

## Fixed items

### 1) Engine failover added for default search path (P0)
**Problem:** default engine block produced hard zero-result failures.

**Implemented:**
- Added multi-engine fallback orchestration in `src/search/orchestrator.ts`:
  - primary engine + fallback chain (`duckduckgo -> brave -> yahoo -> bing -> google -> searxng`)
  - collects attempts and merges/reranks final results
- Keeps explicit engine override behavior deterministic (single selected engine), while default/no-engine path now self-recovers.

**Evidence:**
- `docs/reports/2026-03-25-default-engine-fallback-after-fixes.json`
  - all tested default-mode queries returned results (`5/5`) in both `auto` and `disabled` via fallback to `yahoo` when DDG/Brave were blocked.

---

### 2) Challenge/interstitial pages now rejected in content fetch (P0)
**Problem:** anti-bot/challenge pages were returned as successful content.

**Implemented:**
- Added blocked/interstitial detection in `src/content/fetch.ts` (`detectBlockedContentResponse`).
- Throws explicit errors for verification/captcha/access-denied/interstitial cases.
- Added x.com-specific interstitial detection.

**Evidence:**
- `docs/reports/2026-03-25-fetch-matrix-after-fixes.json`
  - `platform.openai.com/settings/profile` now fails with explicit blocked error.
  - `x.com/OpenAI` now fails with `Content fetch blocked: x.com interstitial`.

---

### 3) PDF/binary content handling fixed (P0)
**Problem:** PDF payloads were parsed as HTML and emitted as binary garbage markdown.

**Implemented:**
- Added content-type gating in `src/content/fetch.ts`.
- Rejects unsupported binary content types (`application/pdf`, octet-stream, images, audio/video, archives).
- Added binary signature guard (`%PDF-`, zip magic).

**Evidence:**
- `docs/reports/2026-03-25-fetch-matrix-after-fixes.json`
  - RFC PDF URL now fails fast with `Unsupported content type for readable extraction: application/pdf`.

---

### 4) `ask` mode behavior corrected (P1)
**Problem:** `ask` acted like headless.

**Implemented:**
- In extension layer (`extensions/free-web-search/index.ts`), added `resolveAskMode(...)`:
  - prompts user with `ctx.ui.confirm(...)` before browser automation
  - approval => `headless`; reject/no-UI => `disabled`
- In core search/content logic, `ask` no longer auto-launches browser fallback.

**Evidence:**
- `tests/orchestrator.test.ts` includes: `ask mode does not auto-launch browser fallback`.
- `tests/content.test.ts` includes: `ask mode does not auto-use browser fallback`.

---

### 5) `unknown` removed from tool-exposed engine enum (P1)
**Problem:** user could pass a broken engine option.

**Implemented:**
- Removed `unknown` from public `free_web_search` tool parameter schema in `extensions/free-web-search/index.ts`.
- Kept internal handling resilient in orchestrator (`unknown` resolves to detected/default fallback behavior).

**Evidence:**
- Schema change in extension file.
- Internal regression coverage in `tests/orchestrator.test.ts` (`unknown engine override resolves to detected engine`).

---

### 6) Empty/whitespace query rejection (P1)
**Problem:** empty query yielded junk/ads.

**Implemented:**
- Added query trim/validation in extension execution path and `runSearch(...)`.
- Empty query now returns/throws explicit validation error.

**Evidence:**
- `docs/reports/2026-03-25-edge-cases-after-fixes.json`
  - empty and whitespace query cases now fail with `Search query must not be empty`.

---

### 7) Misleading blocked headline logic fixed (P1)
**Problem:** UI could show “blocked” even when results were present.

**Implemented:**
- Updated `blockedSummary(...)` in extension to emit blocked headline only when there are no final results across attempts.

---

### 8) Content fallback heuristic improved (P2)
**Problem:** browser fallback was over-triggered for short but valid pages.

**Implemented:**
- Replaced length-only trigger with `needsBrowserRetry(...)` heuristic in `src/content/fetch.ts`.
- Avoids fallback for valid short pages unless suspicious/interstitial-like signals are present.

**Evidence:**
- `docs/reports/2026-03-25-fetch-matrix-after-fixes.json`
  - `https://example.com` with `mode:auto` now stays HTTP (`usedBrowserFallback: false`).

---

### 9) `context` parameter is now used (P2)
**Problem:** context field existed but had no effect.

**Implemented:**
- `runSearch(...)` now derives `rankingQuery = query + context` for reranking relevance.

---

### 10) Smoke test quality gate strengthened (P2)
**Problem:** smoke could pass with irrelevant/challenge content.

**Implemented:**
- Updated `scripts/smoke-test.ts`:
  - relevance scoring via token overlap
  - interstitial/challenge rejection
  - added `yahoo` fallback candidate for real-world resilience

**Evidence:**
- smoke runs now pass only with relevant content:
  - `bun run smoke`
  - `FREE_WEB_SMOKE_MODE=disabled bun run smoke`
  - `FREE_WEB_SMOKE_FORCE_OFFLINE=1 bun run smoke`

---

## Verification run summary

### Automated checks
- `bun run check` ✅
- Test suite: **34 pass / 0 fail**

### Smoke tests
- `bun run smoke` ✅
- `FREE_WEB_SMOKE_MODE=disabled bun run smoke` ✅
- `FREE_WEB_SMOKE_FORCE_OFFLINE=1 bun run smoke` ✅

### Post-fix evidence files
- `docs/reports/2026-03-25-default-engine-fallback-after-fixes.json`
- `docs/reports/2026-03-25-search-matrix-disabled-after-fixes.json`
- `docs/reports/2026-03-25-search-matrix-auto-after-fixes.json`
- `docs/reports/2026-03-25-fetch-matrix-after-fixes.json`
- `docs/reports/2026-03-25-edge-cases-after-fixes.json`

---

## Remaining external constraints (not code bugs)
- Upstream anti-bot/captcha policies can still block **explicitly selected** engines (e.g., forcing Google/Brave).
- This is expected network/provider behavior; default/no-engine path now mitigates it with failover.
