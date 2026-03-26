---
description: Balanced web research with good evidence at moderate token cost
---
Research this topic using `free_web_search` and `free_fetch_content` with a balanced token budget:

$@

Budget profile: **balanced**

Requirements:
- Start with `free_web_search({ query, detail: "lean" })`.
- Use `includeContent: true` when a small multi-source summary would improve answer quality.
- Fetch 1-3 of the strongest URLs if the question needs direct reading.
- Keep `free_fetch_content` in summary mode unless the exact wording or full structure matters.
- Prefer official docs, specs, repos, and primary sources.
- Refine the query instead of guessing.
- Return a concise but evidence-backed answer with exact links, caveats, and uncertainty.
