# pi-free-web-search

[![npm version](https://img.shields.io/npm/v/pi-free-web-search.svg)](https://www.npmjs.com/package/pi-free-web-search)
[![CI](https://github.com/Albertobelleiro/pi-free-web-search/actions/workflows/ci.yml/badge.svg)](https://github.com/Albertobelleiro/pi-free-web-search/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Free, browser-aware web search and readable content extraction for [Pi coding agent](https://pi.dev), without paid APIs.

---

## Why this package exists

`pi-web-access` is excellent, but its search path depends on Perplexity/Gemini. `pi-free-web-search` is for teams that want:

- zero paid APIs
- browser-aware behavior for automation, while defaulting searches to Yahoo and failing over across engines when needed
- HTTP-first performance with browser fallback only when quality requires it
- a package that feels native in Pi (tools, commands, status line, TUI rendering)

---

## What it provides

| Capability | Name | Description |
|---|---|---|
| Tool | `free_web_search` | Natural-language web search with HTTP-first and browser fallback pipeline, now lean-by-default for lower token usage |
| Tool | `free_fetch_content` | Readable content extraction from a URL with browser fallback for JS-heavy pages, now summary-by-default |
| Command | `/free-search-info` | Shows detected browser, engine, mode, and executable |
| Command | `/free-search-test <query>` | End-to-end smoke test from inside Pi |
| Command | `/free-search-debug <query>` | Runs a real search and shows detailed debug logs/attempt metadata |
| Command | `/free-search-status` | Shows recent per-engine health, latency, failures, and cooldown state for the current session |
| Prompt | `/pi-search <topic>` | Balanced default research template |
| Prompt | `/pi-search-cheap <topic>` | Lowest-token research template |
| Prompt | `/pi-search-balanced <topic>` | Moderate-cost research template |
| Prompt | `/pi-search-deep <topic>` | High-fidelity research template |
| Prompt | `/pi-search-debug <topic>` | Diagnostic/debug research template |
| Skill | `free-web-researcher` | General routing guidance across budget profiles |
| Skill | `free-web-researcher-cheap` | Lowest-token research workflow |
| Skill | `free-web-researcher-balanced` | Best default quality/cost trade-off |
| Skill | `free-web-researcher-deep` | Higher-cost deep-research workflow |

---

## Quick start

### Install into Pi

```bash
pi install pi-free-web-search
```

That's it. The extension, tools, commands, skill, and prompt are all registered automatically.

### Update

```bash
pi update pi-free-web-search
```

### Use the prompt shortcuts

```text
# Balanced default
/pi-search exact Bun documentation for test reporters

# Cheapest route
/pi-search-cheap study the Playwright locator docs and explain best practices

# Deeper research
/pi-search-deep compare Bun test reporters and exact CLI flags across docs pages

# Retrieval diagnostics
/pi-search-debug why is this query falling back to browser mode
```

### Alternative install methods

```bash
# From GitHub directly
pi install github:Albertobelleiro/pi-free-web-search

# From a local clone (for development)
git clone https://github.com/Albertobelleiro/pi-free-web-search.git
cd pi-free-web-search
bun install
pi install .
```

---

## How the search pipeline works

1. Detect browser context for automation.
2. Choose the configured search engine, or Yahoo by default.
3. Build search URL for the active engine.
4. Run HTTP search first.
5. Re-rank and quality-check results.
6. Escalate to browser automation only if needed and allowed.
7. Merge/dedupe/rerank final results.
8. Optionally fetch top-result content with readable extraction.
9. Shape the returned tool output for token efficiency (`lean`/`summary`) or deeper reading (`full`).

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
  "preferredEngine": "yahoo",
  "locale": "en-US",
  "language": "en"
}
```

Project-local override is also supported:

```text
.pi/free-web-search.json
```

### Configuration reference

| Field | Type | Default | Notes |
|---|---|---|---|
| `mode` | `auto \| visible \| headless \| ask \| disabled` | `auto` | Global browser execution policy (`ask` prompts before browser automation in Pi UI) |
| `preferredBrowser` | browser family | detected | Force browser family |
| `preferredEngine` | search engine id | `yahoo` | Force search engine |
| `locale` | string | system locale | Locale/market hint for engines that support it (for example Bing `mkt`) |
| `language` | string | system language | Language hint for engines that support it (for example Yahoo/Google `hl`) |
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
| `includeContentMinScore` | number | `2` | Skip low-relevance search results when `includeContent=true` |
| `maxContentFetchConcurrency` | number | `2` | Max parallel content fetches when `includeContent=true` |
| `engineHealthCooldownMs` | number | `600000` | How long session engine failures remain cooled down before retry |
| `engineFailureThreshold` | number | `2` | Consecutive failures before a session temporarily skips an engine |
| `userAgent` | string | bundled UA | Override request UA |

---

## Personalized research profiles

The package now supports multiple research profiles matched to how much model/token expense you want to spend:

- **Cheap**: lowest-token path, quick discovery, minimal source reading
- **Balanced**: default path, strong evidence with moderate cost
- **Deep**: richer excerpts and fuller page reads for higher confidence
- **Diagnostic**: debug-oriented investigation of search/fallback behavior

You can activate these profiles through the dedicated prompt templates and skills, while still using the same underlying tools.

## Token-efficient output modes

Retrieval quality is unchanged. The search, ranking, fallback, and extraction pipeline still works the same internally. What changed is the default tool **presentation**:

- `free_web_search` now defaults to `detail: "lean"`
  - compact result list
  - short snippets
  - no verbose context/fallback narration unless needed
  - when `includeContent: true`, returns tightly capped source summaries by default
- `free_fetch_content` now defaults to `detail: "summary"`
  - short readable summary/excerpt
  - full extracted markdown only when explicitly requested

Use `detail: "full"` when you want the old high-fidelity style output for deep research, auditing, or debugging.

## Usage examples in Pi

```ts
// Cheapest/default path
free_web_search({ query: "Bun runtime documentation", numResults: 5 })
free_fetch_content({ url: "https://bun.sh/docs" })

// Lean search + small source summaries
free_web_search({ query: "React server components caching", includeContent: true })

// Full-fidelity search output
free_web_search({ query: "Supabase RLS docs", domainFilter: ["supabase.com"], detail: "full" })

// Full article body
free_fetch_content({ url: "https://bun.sh/docs", detail: "full" })

// Deep debugging stays opt-in
free_web_search({ query: "OpenAI Responses API reference", engine: "yahoo", mode: "headless", detail: "full", debug: true })
```

### Recommended usage patterns

- **Cheap exploration:** `free_web_search({ query })`
- **Search, then read selectively:** run lean search first, then call `free_fetch_content({ url })` only for the most promising hit
- **Broader but still cheap:** `free_web_search({ query, includeContent: true })`
- **Deep research / exact wording matters:** add `detail: "full"`
- **Operational debugging:** add `debug: true` (best paired with `detail: "full"`)

### Prompt + skill matrix

| Goal | Prompt template | Skill | Typical tool shape |
|---|---|---|---|
| Lowest possible cost | `/pi-search-cheap` | `free-web-researcher-cheap` | lean search, summary fetch, minimal reading |
| Best default trade-off | `/pi-search` or `/pi-search-balanced` | `free-web-researcher-balanced` | lean search, selective includeContent/fetch |
| Deep study | `/pi-search-deep` | `free-web-researcher-deep` | full search/fetch where justified |
| Debugging search behavior | `/pi-search-debug` | `free-web-researcher` | full + debug, diagnostic reading |

For manual diagnostics inside Pi:

```text
/free-search-debug OpenAI Responses API documentation
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

- YouTube URLs automatically extract video transcripts via Innertube API (no API keys, no yt-dlp). Falls back to video description when no captions are available.
- Browser and engine detection are best-effort and can be overridden in config.
- Safari automation uses Playwright WebKit instead of directly controlling Safari binaries.
- The package is authored and tested with Bun.

---

## License

MIT — see [LICENSE](./LICENSE).
