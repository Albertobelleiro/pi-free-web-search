import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSearchHtml } from "../src/search/http";

const fixtures = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

test("parses DuckDuckGo HTML fixtures", () => {
  const results = parseSearchHtml(fixtures("duckduckgo.html"), "https://duckduckgo.com/html/?q=bun", "duckduckgo");
  expect(results.length).toBe(2);
  expect(results[0].title).toContain("Bun");
  expect(results[0].url).toBe("https://bun.sh/docs");
});

test("parses Bing HTML fixtures", () => {
  const results = parseSearchHtml(fixtures("bing.html"), "https://www.bing.com/search?q=bun", "bing");
  expect(results.length).toBe(1);
  expect(results[0].snippet).toContain("Official docs");
});

test("parses Google fixtures, unwraps redirect links, and ignores Google internal links", () => {
  const results = parseSearchHtml(fixtures("google.html"), "https://www.google.com/search?q=bun", "google");
  expect(results.length).toBe(2);
  expect(results[0].url).toBe("https://bun.sh/docs");
  expect(results.some((result) => result.url.includes("google.com/search"))).toBe(false);
});

test("parses Yahoo fixtures and unwraps redirect links", () => {
  const results = parseSearchHtml(fixtures("yahoo.html"), "https://search.yahoo.com/search?p=bun", "yahoo");
  expect(results.length).toBe(2);
  expect(results[0].url).toBe("https://bun.sh/docs");
  expect(results[1].url).toBe("https://github.com/oven-sh/bun");
});

test("parses Brave fixtures", () => {
  const results = parseSearchHtml(fixtures("brave.html"), "https://search.brave.com/search?q=bun", "brave");
  expect(results.length).toBe(2);
  expect(results[0].url).toBe("https://bun.sh/docs");
  expect(results[1].url).toBe("https://github.com/oven-sh/bun");
});
