---
name: free-web-researcher-deep
description: Use when the user wants deep research, richer excerpts, direct source study, or higher-cost high-confidence answers.
---

# Free Web Researcher — Deep Mode

Use this when the user explicitly wants **depth over cost**.

## Tool strategy
1. `free_web_search`
2. Prefer `detail: "full"` when richer context is useful
3. Use `includeContent: true` when top-result summaries help compare sources
4. Use `free_fetch_content({ url, detail: "full" })` for the strongest 2-4 URLs when exact wording or structure matters

## Rules
- Preserve retrieval quality; do not simplify the search process.
- Prefer official docs, repos, standards, and primary sources.
- Compare sources when they disagree.
- Use `debug: true` when diagnosing retrieval behavior, not for normal research.

## Good patterns
- Search broadly, then branch into exact sub-questions.
- Read directly from the best pages rather than relying on snippets alone.
- Return a thorough, evidence-backed answer with exact links and uncertainty when relevant.
