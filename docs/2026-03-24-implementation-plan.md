# pi-free-web-search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build and verify a free, browser-aware Pi web-search package for macOS and Linux.

**Architecture:** A layered TypeScript package with browser detection, search engine detection, HTTP + browser search orchestration, content extraction, and Pi tool/command bindings.

**Tech Stack:** Bun, TypeScript, Playwright, JSDOM, Mozilla Readability, Turndown.

---

### Task 1: Repository foundation
**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `LICENSE`, `README.md`
- Create: `docs/2026-03-24-design.md`, `docs/2026-03-24-implementation-plan.md`
- Create: `.github/workflows/ci.yml`

- [x] Write package manifest and Pi manifest
- [x] Add TypeScript config and scripts
- [x] Add OSS license and README
- [x] Add CI for typecheck + tests

### Task 2: Core types and config
**Files:**
- Create: `src/types.ts`, `src/config.ts`

- [x] Define browser, engine, config, search result, and extraction types
- [x] Implement project/user config loading and merge logic

### Task 3: Browser and engine detection
**Files:**
- Create: `src/detection/browser.ts`, `src/detection/engine.ts`, `src/util/exec.ts`
- Test: `tests/detection.test.ts`

- [x] Implement default browser detection for macOS and Linux
- [x] Implement browser executable resolution
- [x] Implement search engine detection from Safari/Chromium-family/Firefox preferences where possible
- [x] Add parser tests for detection helpers

### Task 4: Search engines and ranking
**Files:**
- Create: `src/search/engines.ts`, `src/search/http.ts`, `src/search/rank.ts`
- Test: `tests/parsers.test.ts`, `tests/rank.test.ts`

- [x] Implement search URL builders and engine normalization
- [x] Implement SERP HTML parsers for supported engines
- [x] Implement quality scoring, dedupe, and domain filtering
- [x] Add fixture-based parser tests

### Task 5: Browser fallback search
**Files:**
- Create: `src/search/browser.ts`, `src/search/orchestrator.ts`

- [x] Implement Playwright browser launch with visible/headless policy
- [x] Implement browser-based result extraction fallback
- [x] Implement search orchestration and fallback thresholds

### Task 6: Content extraction
**Files:**
- Create: `src/content/fetch.ts`
- Test: `tests/content.test.ts`

- [x] Implement HTTP fetch + readability extraction
- [x] Implement browser-rendered fallback extraction
- [x] Convert extracted content to markdown-like output

### Task 7: Pi extension integration
**Files:**
- Create: `extensions/free-web-search/index.ts`
- Create: `skills/free-web-researcher/SKILL.md`

- [x] Register `free_web_search` tool
- [x] Register `free_fetch_content` tool
- [x] Add `/free-search-info` command
- [x] Add `/free-search-test` command
- [x] Add startup status indicator and user-facing skill

### Task 8: Smoke test and release prep
**Files:**
- Create: `scripts/smoke-test.ts`

- [x] Install dependencies
- [x] Run typecheck and unit tests
- [x] Run smoke test against live web targets
- [x] Initialize git repo, create GitHub remote, and push
