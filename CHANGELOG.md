# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `/pi-search` prompt template for steering the current Pi session/model to use `free_web_search` and `free_fetch_content` for documentation research.

### Fixed
- Search now retries alternative engines when the detected/default engine is blocked or returns zero results.
- Brave/Google/DuckDuckGo bot-challenge pages are detected explicitly so fallback can happen before users get silent `0 results` failures.
- Search result summaries now expose fallback attempts so users can see when an engine switched from the detected default.

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
