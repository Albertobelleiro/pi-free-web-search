---
name: free-web-researcher-cheap
description: Use when the user wants cheap, low-token web research, fast source discovery, or rough documentation lookup without paying a large context cost.
---

# Free Web Researcher — Cheap Mode

Use this when the user wants the answer at the **lowest token cost that still preserves retrieval quality**.

## Tool strategy
1. `free_web_search` with `detail: "lean"`
2. `free_fetch_content` only for the strongest 1-2 URLs, using the default summary mode

## Rules
- Prefer `free_web_search` over asking the user for URLs.
- Keep outputs lean by default.
- Avoid `detail: "full"` unless the user explicitly asks for deep reading.
- Avoid `debug: true` unless the task is diagnostic.
- Use `includeContent: true` only when a tiny multi-source synthesis is clearly useful.
- Prefer primary sources and official docs.

## Good patterns
- Search broad first, then refine.
- Read fewer pages, but choose better pages.
- Return concise answers with exact links.
