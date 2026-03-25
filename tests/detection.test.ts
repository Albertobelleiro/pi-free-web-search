import { expect, test } from "bun:test";
import { detectBrowser } from "../src/detection/browser";
import { detectSearchEngine } from "../src/detection/engine";
import { buildSearchUrl } from "../src/search/engines";

test("preferred browser config wins", async () => {
  const browser = await detectBrowser({ preferredBrowser: "brave" });
  expect(browser.browserFamily).toBe("brave");
  expect(browser.source).toBe("config");
});

test("preferred engine config wins", async () => {
  const browser = await detectBrowser({ preferredBrowser: "chrome" });
  const engine = await detectSearchEngine(browser, { preferredEngine: "duckduckgo" });
  expect(engine.id).toBe("duckduckgo");
  expect(engine.source).toBe("config");
});

test("default engine is yahoo regardless of detected browser", async () => {
  const browser = await detectBrowser({ preferredBrowser: "brave" });
  const engine = await detectSearchEngine(browser, {});
  expect(engine.id).toBe("yahoo");
  expect(engine.source).toBe("fallback");
});

test("locale-aware templates are applied to configured engines", async () => {
  const browser = await detectBrowser({ preferredBrowser: "chrome" });
  const bing = await detectSearchEngine(browser, { preferredEngine: "bing", locale: "en-US" });
  const yahoo = await detectSearchEngine(browser, { preferredEngine: "yahoo", language: "en" });

  expect(bing.templateUrl).toContain("mkt=en-US");
  expect(yahoo.templateUrl).toContain("hl=en");
  expect(buildSearchUrl(bing, "bun docs")).toContain("q=bun%20docs");
  expect(buildSearchUrl(yahoo, "bun docs")).toContain("p=bun%20docs");
});
