import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectBlockedSearchResponse, parseSearchHtml } from "../src/search/http";

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

test("parses DuckDuckGo redirect links", () => {
  const html = `<html><body><div class=\"result\"><a class=\"result__a\" href=\"https://duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh%2Fdocs&rut=abc\">Bun Documentation</a><a class=\"result__snippet\">Official Bun runtime docs.</a></div></body></html>`;
  const results = parseSearchHtml(html, "https://duckduckgo.com/html/?q=bun", "duckduckgo");
  expect(results.length).toBe(1);
  expect(results[0].url).toBe("https://bun.sh/docs");
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

test("detects blocked Brave captcha responses", () => {
  const reason = detectBlockedSearchResponse(
    "brave",
    429,
    "<html><head><title>Captcha - Brave Search</title></head><body>Too many requests</body></html>",
  );
  expect(reason).toBe("HTTP 429");
});

test("detects DuckDuckGo bot challenge pages", () => {
  const reason = detectBlockedSearchResponse(
    "duckduckgo",
    202,
    "<html><body>Unfortunately, bots use DuckDuckGo too.</body></html>",
  );
  expect(reason).toBe("bot challenge");
});
