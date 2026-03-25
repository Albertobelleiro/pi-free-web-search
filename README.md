# pi-free-web-search

[![CI](https://github.com/Albertobelleiro/pi-free-web-search/actions/workflows/ci.yml/badge.svg)](https://github.com/Albertobelleiro/pi-free-web-search/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Free, browser-aware web search and readable content extraction for [Pi coding agent](https://pi.dev), without paid APIs.

---

## Why this package exists

`pi-web-access` is excellent, but its search path depends on Perplexity/Gemini. `pi-free-web-search` is for teams that want:

- zero paid APIs
- browser-aware behavior for automation, while defaulting searches to DuckDuckGo
- HTTP-first performance with browser fallback only when quality requires it
- a package that feels native in Pi (tools, commands, status line, TUI rendering)

---

## What it provides

| Capability | Name | Description |
|---|---|---|
| Tool | `free_web_search` | Natural-language web search with HTTP-first and browser fallback pipeline |
| Tool | `free_fetch_content` | Readable content extraction from a URL with browser fallback for JS-heavy pages |
| Command | `/free-search-info` | Shows detected browser, engine, mode, and executable |
| Command | `/free-search-test <query>` | End-to-end smoke test from inside Pi |
| Prompt | `/pi-search <topic>` | Short research template that steers the current session/model to use `free_web_search` and `free_fetch_content` |
| Skill | `free-web-researcher` | Guidance for robust research flow with these tools |

---

## Quick start

### 1) Install dependencies

```bash
bun install
```

### 2) Run checks

```bash
bun run check
bun run smoke
```

### 3) Install into Pi

```bash
pi install /absolute/path/to/pi-free-web-search
```

### 4) Use the prompt shortcut

```text
/pi-search exact Bun documentation for test reporters
/pi-search study the Playwright locator docs and explain best practices
```

---

## How the search pipeline works

1. Detect browser context for automation.
2. Choose the configured search engine, or DuckDuckGo by default.
3. Build search URL for the active engine.
4. Run HTTP search first.
5. Re-rank and quality-check results.
6. Escalate to browser automation only if needed and allowed.
7. Merge/dedupe/rerank final results.
8. Optionally fetch top-result content with readable extraction.

---

## Supported targets

### Operating systems
- macOS
- Linux

### Browsers / families
- Safari
- Chrome
- Brave
- Edge
- Chromium
- Firefox
- Dia Browser (best-effort via Chromium-family fallback)

### Search engines
- Google
- Bing
- DuckDuckGo
- Brave Search
- Yahoo
- SearXNG (if configured)

---

## Configuration

Create `~/.pi/free-web-search.json`:

```json
{
  "mode": "auto",
  "httpFirst": true,
  "browserFallbackThreshold": 0.55,
  "preferredEngine": "duckduckgo"
}
```

Project-local override is also supported:

```text
.pi/free-web-search.json
```

### Configuration reference

| Field | Type | Default | Notes |
|---|---|---|---|
| `mode` | `auto \| visible \| headless \| ask \| disabled` | `auto` | Global browser execution policy |
| `preferredBrowser` | browser family | detected | Force browser family |
| `preferredEngine` | search engine id | `duckduckgo` | Force search engine |
| `searchTemplateUrl` | string | per engine | Custom search URL template |
| `browserExecutablePath` | string | auto-resolved | Explicit browser executable |
| `chromiumProfilePath` | string | auto | Chromium-family profile path |
| `firefoxProfilePath` | string | auto | Firefox profile path |
| `searxngBaseUrl` | string | unset | Base URL for SearXNG |
| `httpFirst` | boolean | `true` | Skip HTTP path when false |
| `browserFallbackThreshold` | number | `0.55` | Quality threshold for fallback |
| `httpTimeoutMs` | number | `10000` | Timeout for HTTP search/fetch |
| `browserNavigationTimeoutMs` | number | `12000` | Browser navigation timeout |
| `browserResultWaitMs` | number | `700` | Additional wait for dynamic result content |
| `contentMinMarkdownLength` | number | `200` | Minimum extraction size before browser fallback |
| `maxContentFetchConcurrency` | number | `2` | Max parallel content fetches when `includeContent=true` |
| `userAgent` | string | bundled UA | Override request UA |

---

## Usage examples in Pi

```ts
free_web_search({ query: "Bun runtime documentation", numResults: 5 })
free_web_search({ query: "React server components caching", includeContent: true })
free_web_search({ query: "Supabase RLS docs", domainFilter: ["supabase.com"] })
free_fetch_content({ url: "https://bun.sh/docs" })
```

---

## Development

```bash
bun install
bun run typecheck
bun test
bun run check
bun run smoke

# CI-safe smoke mode (no browser automation)
FREE_WEB_SMOKE_MODE=disabled FREE_WEB_SMOKE_ALLOW_OFFLINE=1 bun run smoke
```

---

## Open source project health

This repository includes the standard community health files and templates:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- [`SECURITY.md`](./SECURITY.md)
- [`SUPPORT.md`](./SUPPORT.md)
- [Issue templates](./.github/ISSUE_TEMPLATE)
- [PR template](./.github/PULL_REQUEST_TEMPLATE.md)
- [Release configuration](./.github/release.yml)
- [Changelog](./CHANGELOG.md)

---

## Notes

- v0.x focuses on normal web pages, not YouTube/PDF/GitHub-specialized extraction flows.
- Browser and engine detection are best-effort and can be overridden in config.
- Safari automation uses Playwright WebKit instead of directly controlling Safari binaries.
- The package is authored and tested with Bun.

---

## License

MIT — see [LICENSE](./LICENSE).
