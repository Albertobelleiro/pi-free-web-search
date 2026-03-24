import { expect, test } from "bun:test";
import { detectBrowser } from "../src/detection/browser";
import { detectSearchEngine } from "../src/detection/engine";

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
