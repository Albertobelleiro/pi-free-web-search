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

test("rejects unsupported PDF content", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response("%PDF-1.5 binary", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    })) as unknown as typeof globalThis.fetch;

  try {
    await expect(fetchContent(process.cwd(), "https://example.com/file.pdf", "disabled")).rejects.toThrow("Unsupported content type");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects challenge/interstitial pages", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Just a moment...</title></head><body>Verification successful. Waiting for example.com to respond</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    await expect(fetchContent(process.cwd(), "https://example.com/protected", "disabled")).rejects.toThrow("Content fetch blocked");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects x.com interstitial pages", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>https://x.com/OpenAI</title></head><body>Something went wrong, but don’t fret — let’s give it another shot. Some privacy related extensions may cause issues on x.com.</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    await expect(fetchContent(process.cwd(), "https://x.com/OpenAI", "disabled")).rejects.toThrow("x.com interstitial");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extracts plain-text responses", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response("Line 1\nLine 2", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })) as unknown as typeof globalThis.fetch;

  try {
    const content = await fetchContent(process.cwd(), "https://example.com/readme.txt", "disabled");
    expect(content.markdown).toContain("Line 1");
    expect(content.usedBrowserFallback).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ask mode does not auto-use browser fallback", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Short</title></head><body><p>tiny</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    await expect(fetchContent(process.cwd(), "https://example.com/short", "ask")).rejects.toThrow("Browser fallback disabled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
