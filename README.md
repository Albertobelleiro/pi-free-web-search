# pi-free-web-search

Free, browser-aware web search and readable content extraction for [Pi coding agent](https://pi.dev).

## Why

`pi-web-access` is excellent, but its search path depends on Perplexity or Gemini. `pi-free-web-search` is designed for teams that want:

- **zero paid APIs**
- **human-like search behavior**
- **default browser awareness**
- **search-engine awareness**
- **hybrid quality pipeline**: HTTP first, browser automation fallback when needed

## What it does

This package adds:

- `free_web_search` — natural-language web search without paid APIs
- `free_fetch_content` — readable page extraction with browser fallback
- `/free-search-info` — inspect detected browser + engine
- `/free-search-test <query>` — end-to-end smoke test from inside Pi
- `free-web-researcher` skill — teaches the agent how to use the tools well

## Quality model

The package is **hybrid**:

1. detect the user's browser context
2. detect the likely default search engine
3. search via HTTP first when possible
4. escalate to browser automation when quality is weak
5. extract readable content from the resulting pages

This keeps the system free while still behaving much more like a human researcher than a plain scraper.

## Supported targets

### OS
- macOS
- Linux

### Browsers / families
- Safari
- Chrome
- Brave
- Edge
- Chromium
- Firefox
- Dia Browser (best-effort, Chromium-family fallback)

### Search engines
- Google
- Bing
- DuckDuckGo
- Brave Search
- Yahoo
- SearXNG (if configured)

## Install

```bash
bun install
```

Test the package:

```bash
bun run check
bun run smoke
```

Install into Pi locally:

```bash
pi install /absolute/path/to/pi-free-web-search
```

## Configuration

Create `~/.pi/free-web-search.json`:

```json
{
  "mode": "auto",
  "httpFirst": true,
  "browserFallbackThreshold": 0.55,
  "preferredEngine": "google"
}
```

Optional fields:

- `mode`: `auto`, `visible`, `headless`, `ask`, `disabled`
- `preferredBrowser`
- `preferredEngine`
- `searchTemplateUrl`
- `browserExecutablePath`
- `chromiumProfilePath`
- `firefoxProfilePath`
- `searxngBaseUrl`
- `httpFirst`
- `browserFallbackThreshold`
- `httpTimeoutMs` (default `10000`)
- `browserNavigationTimeoutMs` (default `12000`)
- `browserResultWaitMs` (default `700`)
- `contentMinMarkdownLength` (default `200`)
- `maxContentFetchConcurrency` (default `2`)
- `userAgent`

Project-local override:

```text
.pi/free-web-search.json
```

## Example usage in Pi

```ts
free_web_search({ query: "Bun runtime documentation", numResults: 5 })
free_web_search({ query: "React server components caching", includeContent: true })
free_web_search({ query: "Supabase RLS docs", domainFilter: ["supabase.com"] })
free_fetch_content({ url: "https://bun.sh/docs" })
```

## Development

```bash
bun install
bun run typecheck
bun test
bun run smoke
# CI-safe smoke mode (no browser automation):
FREE_WEB_SMOKE_MODE=disabled bun run smoke
```

## Notes

- v0.1 focuses on normal web pages, not YouTube/PDF/GitHub-specialized flows.
- Browser detection and search-engine detection are best-effort and can be overridden in config.
- Search now includes explicit timeout/cancellation handling and progress streaming to avoid stuck-looking runs.
- Safari search automation falls back to Playwright WebKit rather than controlling the Safari binary directly.
- The package is authored and tested with Bun (`bun install`, `bun test`, `bun run check`).

## License

MIT
