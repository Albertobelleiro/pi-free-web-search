---
name: free-web-researcher
description: Use when the user asks for internet research, source discovery, documentation lookup, or human-like web searching without paid APIs.
---

# Free Web Researcher

Use the package tools in this order:

1. `free_web_search` for natural-language search
2. `free_fetch_content` for the best result URLs you want to read deeply

## Rules
- Prefer `free_web_search` over asking the user for URLs.
- Use `includeContent: true` when the user needs a quick synthesis from the top results.
- Use `domainFilter` when the user clearly wants docs, GitHub, official sites, or exclusions.
- When one search is not enough, search again with a refined query instead of guessing.
- Prefer primary sources and official docs over blogspam.

## Good patterns
- Search broad first, then narrow.
- Fetch content for the strongest 1-3 sources.
- Cite exact URLs in your answer.
- If search engine/browser fallback was used, trust the results but still verify by reading source pages.
