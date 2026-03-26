import { expect, test } from "bun:test";
import { formatFetchToolText, formatSearchToolText } from "../extensions/free-web-search/formatting";
import type { ExtractedContent, SearchResponse } from "../src/types";

function makeSearchResponse(): SearchResponse {
  return {
    query: "bun docs",
    usedBrowserFallback: false,
    context: {
      mode: "auto",
      browser: {
        platform: "darwin",
        browserFamily: "chrome",
        browserId: "chrome",
        browserLabel: "Google Chrome",
        source: "fallback",
      },
      engine: {
        id: "yahoo",
        label: "Yahoo",
        source: "fallback",
      },
    },
    attempts: [
      {
        engine: "yahoo",
        searchUrl: "https://search.yahoo.com/search?p=bun+docs",
        httpResults: 3,
        browserResults: 0,
        finalResults: 3,
        attemptedBrowserFallback: false,
        usedBrowserFallback: false,
        durationMs: 220,
      },
    ],
    results: [
      {
        rank: 1,
        title: "Bun Runtime Docs",
        url: "https://bun.sh/docs",
        snippet: "Bun is a fast JavaScript runtime with built-in tooling, package management, testing, and bundling.",
        sourceEngine: "yahoo",
        score: 4,
        domain: "bun.sh",
      },
      {
        rank: 2,
        title: "Bun Test Runner",
        url: "https://bun.sh/docs/cli/test",
        snippet: "Learn how to run tests, filter suites, watch files, and use snapshots in Bun.",
        sourceEngine: "yahoo",
        score: 3,
        domain: "bun.sh",
      },
    ],
  };
}

function makeContent(markdown: string): ExtractedContent {
  return {
    url: "https://example.com/article",
    title: "Example Article",
    markdown,
    textExcerpt: markdown.replace(/\s+/g, " ").trim().slice(0, 400),
    usedBrowserFallback: false,
  };
}

test("lean search output is compact by default", () => {
  const text = formatSearchToolText({
    search: makeSearchResponse(),
    detail: "lean",
    requestedMode: undefined,
    effectiveMode: "auto",
    debug: false,
    progressLog: [],
  });

  expect(text).toContain("1. Bun Runtime Docs");
  expect(text).toContain("https://bun.sh/docs");
  expect(text).not.toContain("# Search:");
  expect(text).not.toContain("Context:");
  expect(text).not.toContain("## Debug log");
});

test("full search output preserves richer context", () => {
  const text = formatSearchToolText({
    search: makeSearchResponse(),
    detail: "full",
    requestedMode: undefined,
    effectiveMode: "auto",
    debug: false,
    progressLog: [],
  });

  expect(text).toContain("# Search: bun docs");
  expect(text).toContain("Context: browser=Google Chrome, engine=Yahoo, mode=auto, browserFallback=no");
});

test("lean includeContent stays tightly capped", () => {
  const longBody = "This is a detailed source summary. ".repeat(30);
  const text = formatSearchToolText({
    search: makeSearchResponse(),
    detail: "lean",
    requestedMode: undefined,
    effectiveMode: "auto",
    debug: false,
    progressLog: [],
    contentResults: [
      { ok: true, result: makeSearchResponse().results[0], content: makeContent(longBody) },
    ],
  });

  expect(text).toContain("Source: Example Article");
  expect(text).not.toContain(longBody);
  expect(text.length).toBeLessThan(900);
});

test("debug output remains opt-in and rich", () => {
  const text = formatSearchToolText({
    search: makeSearchResponse(),
    detail: "lean",
    requestedMode: undefined,
    effectiveMode: "auto",
    debug: true,
    progressLog: [{ phase: "search", message: "Searching Yahoo", metrics: { engine: "yahoo" } }],
  });

  expect(text).toContain("## Debug log");
  expect(text).toContain("Searching Yahoo");
  expect(text).toContain("## Attempt details");
});

test("summary fetch output is compact and excludes full markdown", () => {
  const markdown = [
    "# Heading",
    "",
    "This is a long readable article body with implementation details and examples.",
    "",
    "## Section",
    "",
    "More paragraphs follow here with extra depth that should not be returned by default.",
  ].join("\n");

  const text = formatFetchToolText({ content: makeContent(markdown), detail: "summary" });

  expect(text).toContain("Example Article");
  expect(text).toContain("https://example.com/article");
  expect(text).not.toContain("## Section");
  expect(text).not.toContain(markdown);
});

test("full fetch output includes extracted markdown", () => {
  const markdown = "# Heading\n\nFull body paragraph.";
  const text = formatFetchToolText({ content: makeContent(markdown), detail: "full" });

  expect(text).toContain("# Example Article");
  expect(text).toContain("Full body paragraph.");
});
