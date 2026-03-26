---
description: Deep research using full-fidelity output and richer source reading
---
Research this topic thoroughly using `free_web_search` and `free_fetch_content`:

$@

Budget profile: **deep / high-fidelity**

Requirements:
- Use `free_web_search` first.
- Prefer `detail: "full"` when context, fallback behavior, or richer excerpts matter.
- Use `includeContent: true` when top-result summaries will help triage sources.
- Fetch the strongest 2-4 URLs directly.
- Use `free_fetch_content({ url, detail: "full" })` when exact wording, document structure, or detailed technical analysis matters.
- Prefer official documentation, source repositories, standards, and primary sources.
- Compare sources when they disagree.
- Return a thorough, evidence-backed answer with exact links, caveats, and uncertainty.
