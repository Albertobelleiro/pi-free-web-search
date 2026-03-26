# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-03-26

### Added
- Explicit output detail controls for token shaping:
  - `free_web_search.detail = "lean" | "full"`
  - `free_fetch_content.detail = "summary" | "full"`
- Formatter-level tests covering lean/full search output, summary/full fetch output, debug visibility, and capped `includeContent=true` behavior.
- Personalized research profiles with dedicated prompt templates:
  - `/pi-search-cheap`
  - `/pi-search-balanced`
  - `/pi-search-deep`
  - `/pi-search-debug`
- Additional budget-aware skills:
  - `free-web-researcher-cheap`
  - `free-web-researcher-balanced`
  - `free-web-researcher-deep`

### Changed
- `free_web_search` now defaults to lean output: compact result blocks, shorter snippets, and no verbose context/debug narration unless explicitly requested.
- `includeContent=true` now stays token-efficient by default, returning tightly capped source summaries in lean mode while preserving richer excerpts in full mode.
- `free_fetch_content` now defaults to a short summary/excerpt instead of returning the full extracted markdown body.
- Output shaping logic was split into focused formatting helpers so retrieval logic, extraction, and presentation are less coupled.
- The original `/pi-search` prompt now acts as the balanced default profile.

## [0.3.1] - 2026-03-26

### Fixed
- **Critical:** Blocked pages (403, 429, captcha, interstitials) now escalate to browser fallback instead of throwing immediately. Previously, `detectBlockedContentResponse()` caused an immediate error before the browser fallback path was ever reached.
- Login-redirect detection: sites that return 200 but redirect to auth domains (`accounts.google.com`, `login.*`, `sso.*`, etc.) now trigger browser fallback instead of returning empty content.

### Changed
- HTTP fetch headers improved with standard browser signals (`Accept`, `Sec-Fetch-*`, `Cache-Control`, `Pragma`) to reduce bot detection on direct URL fetches.
- Browser fallback logic extracted into a dedicated `fetchViaBrowser()` helper for cleaner control flow and single responsibility.
- `FetchContentOptions` now supports `deps` injection for testing browser fallback in isolation (same pattern as the search orchestrator).

### Added
- **YouTube transcript extraction** via Innertube API — no API keys, no yt-dlp, no dependencies. When `fetchContent()` receives a YouTube URL, it extracts the video transcript using 3 HTTP requests (watch page → Innertube player API with ANDROID client → caption track XML). Falls back to video description when no captions are available.
- 11 new tests covering blocked-page escalation, login-redirect detection, YouTube transcript extraction, and false-positive prevention (47 total, up from 36).
- JSDoc comments differentiating `detectBlockedContentResponse` (content pages) from `detectBlockedSearchResponse` (search engine result pages).

## [0.3.0] - 2026-03-25

### Added
- `/pi-search` prompt template for steering the current Pi session/model to use `free_web_search` and `free_fetch_content` for documentation research.
- `debug: true` support on `free_web_search` plus `/free-search-debug <query>` for inspecting real search attempts, block reasons, URLs, titles, and progress logs.
- `/free-search-status` command for inspecting per-engine success/failure/cooldown state during the current session.
- Session engine-health memory so repeatedly failing engines can be cooled down and skipped temporarily.
- Locale/language-aware search templates (`locale`, `language`) for engines that support market/language hints.

### Changed
- Browser detection is now used only for automation; search defaults to Yahoo unless the user explicitly overrides the engine.
- Documentation-style queries now prefer official docs/reference domains and aggressively demote low-value search/video/community pages.
- `includeContent=true` now skips low-scoring results by relevance threshold instead of fetching them blindly.
- DuckDuckGo now fails faster with shorter engine-specific timeouts to reduce wasted latency when it is unhealthy.

### Fixed
- Searches no longer inherit Brave/Bing/other browser search-engine defaults just because that browser is installed or active on the computer.
- Bing redirect URLs are now unwrapped correctly instead of leaking raw `bing.com/ck/a` tracking links into results.
- Yahoo internal video/search pages are filtered so docs queries surface real documentation first.
- Search templates with locale/language query params now preserve `{searchTerms}` correctly instead of URL-encoding the placeholder.

## [0.2.0] - 2026-03-24

### Added
- Abort and timeout utilities for responsive, cancellation-aware operations (`src/util/abort.ts`).
- Progressive runtime updates for search and content extraction phases in Pi tool output.
- Engine-specific parser coverage and fixtures for Google, Yahoo, Brave, and DuckDuckGo redirect flows.
- Orchestrator unit tests for fallback quality thresholds, result merging, and engine override behavior.
- Deterministic CI-safe smoke fallback mode for environments where live search is blocked.
- Config defaults for runtime tuning (`httpTimeoutMs`, `browserNavigationTimeoutMs`, `browserResultWaitMs`, `contentMinMarkdownLength`, `maxContentFetchConcurrency`).

### Changed
- Search orchestration now merges HTTP and browser fallback results instead of replacing HTTP results.
- Tool rendering aligned with Pi TUI conventions (compact default rows, expansion hints, richer progress states).
- Smoke test hardened with multi-engine retries and improved diagnostics.
- Test script narrowed to `tests/*.test.ts` for deterministic local/CI behavior.
- Peer dependency ranges constrained to tested Pi/TypeBox version ranges.

### Fixed
- Domain filter include/exclude logic now correctly handles mixed positive/negative filters.
- Engine override now changes the actual outbound search template/endpoint.
- `mode: "disabled"` now correctly prevents browser fallback escalation.
- Smoke flow no longer hides content-extraction failures when live results exist.
- Safari engine preference parsing now uses Node-compatible process APIs.

## [0.1.0] - 2026-03-24

### Added
- Initial `pi-free-web-search` package structure, design docs, and CI.
- Browser detection layer (macOS/Linux) and search engine detection from browser profiles.
- HTTP-first search path with Playwright browser fallback.
- Readability + Turndown content extraction flow with optional browser-rendered fallback.
- Pi extension with:
  - `free_web_search` tool
  - `free_fetch_content` tool
  - `/free-search-info` command
  - `/free-search-test` command
  - startup status indicator
- Initial tests for parser, ranking, detection, and content extraction.

[Unreleased]: https://github.com/Albertobelleiro/pi-free-web-search/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/Albertobelleiro/pi-free-web-search/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/Albertobelleiro/pi-free-web-search/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Albertobelleiro/pi-free-web-search/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Albertobelleiro/pi-free-web-search/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Albertobelleiro/pi-free-web-search/releases/tag/v0.1.0
