---
name: free-web-researcher-balanced
description: Use when the user wants a strong evidence-backed answer with moderate token cost, blending compact search output with selective source reading.
---

# Free Web Researcher — Balanced Mode

Use this when the user wants the best default trade-off between **quality and cost**.

## Tool strategy
1. `free_web_search` with `detail: "lean"`
2. `free_web_search({ includeContent: true })` when quick multi-source synthesis helps
3. `free_fetch_content` for the best 1-3 URLs, usually in summary mode

## Rules
- Start compact, then deepen only where needed.
- Prefer official docs, primary sources, repos, and standards.
- Use `detail: "full"` only when exact wording or richer context matters.
- Use `debug: true` only for operational diagnosis.
- Refine searches instead of guessing.

## Good patterns
- Search → shortlist → read selectively.
- Keep the answer concise, but include exact links and caveats.
- Escalate to full mode only for the most valuable sources.
