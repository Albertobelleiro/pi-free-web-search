---
description: Diagnostic web research with debug visibility and full-fidelity traces
---
Investigate this web-search or retrieval problem using `free_web_search` and `free_fetch_content`:

$@

Budget profile: **diagnostic / expensive**

Requirements:
- Prefer `free_web_search({ query, detail: "full", debug: true })`.
- Use `mode` explicitly when browser behavior matters.
- Inspect engine fallback behavior, blocked pages, and attempt metadata when relevant.
- Use `includeContent: true` only when source reading is part of the diagnosis.
- Use `free_fetch_content({ url, detail: "full" })` for pages whose extraction behavior you need to inspect closely.
- Return a concise diagnosis with exact links, observed failure modes, and recommended next actions.
