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
