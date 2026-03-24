import { expect, test } from "bun:test";
import { fetchContent } from "../src/content/fetch";

test("fetches readable content from a public page", async () => {
  const content = await fetchContent(process.cwd(), "https://example.com", "disabled");
  expect(content.title.length).toBeGreaterThan(0);
  expect(content.markdown.length).toBeGreaterThan(0);
});
