---
description: Ultra-low-token web research using lean search and minimal reading
---
Research this topic as cheaply as possible in tokens using `free_web_search` and `free_fetch_content`:

$@

Budget profile: **cheap / ultra-lean**

Requirements:
- Start with `free_web_search({ query, detail: "lean" })`.
- Avoid `debug: true` unless the user explicitly asked for diagnostics.
- Avoid `detail: "full"` unless the user explicitly asks for full-fidelity output.
- Use `includeContent: true` only if the answer clearly needs a tiny multi-source synthesis.
- If deeper reading is required, fetch at most 1-2 URLs and keep `free_fetch_content` in default summary mode.
- Prefer official documentation and primary sources.
- Return a concise answer with exact links and only the most relevant evidence.
