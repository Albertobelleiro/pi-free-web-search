# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `/pi-search` prompt template for steering the current Pi session/model to use `free_web_search` and `free_fetch_content` for documentation research.
- `debug: true` support on `free_web_search` plus `/free-search-debug <query>` for inspecting real search attempts, block reasons, URLs, titles, and progress logs.

### Changed
- Browser detection is now used only for automation; search defaults to DuckDuckGo unless the user explicitly overrides the engine.
- Documentation-style queries now prefer official docs/reference domains and aggressively demote low-value search/video/community pages.

### Fixed
- Searches no longer inherit Brave/Bing/other browser search-engine defaults just because that browser is installed or active on the computer.
- Bing redirect URLs are now unwrapped correctly instead of leaking raw `bing.com/ck/a` tracking links into results.
- Yahoo internal video/search pages are filtered so docs queries surface real documentation first.

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

[Unreleased]: https://github.com/Albertobelleiro/pi-free-web-search/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Albertobelleiro/pi-free-web-search/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Albertobelleiro/pi-free-web-search/releases/tag/v0.1.0
