import { expect, test } from "bun:test";
import { fetchContent } from "../src/content/fetch";

test("extracts readable content from HTML without network access", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Example</title></head><body><article><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents.</p></article></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    const content = await fetchContent(process.cwd(), "https://example.com", "disabled");
    expect(content.title).toContain("Example");
    expect(content.markdown.length).toBeGreaterThan(20);
    expect(content.usedBrowserFallback).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
