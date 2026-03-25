import { expect, test } from "bun:test";
import { rerankResults } from "../src/search/rank";
import type { SearchResult } from "../src/types";

const sample: SearchResult[] = [
  { title: "Random page", url: "https://example.com", snippet: "misc", sourceEngine: "google", rank: 1, score: 0, domain: "example.com" },
  { title: "Bun Documentation", url: "https://bun.sh/docs", snippet: "Official Bun docs", sourceEngine: "google", rank: 2, score: 0, domain: "bun.sh" },
  { title: "Bun Documentation", url: "https://bun.sh/docs", snippet: "duplicate", sourceEngine: "google", rank: 3, score: 0, domain: "bun.sh" },
];

test("reranks and deduplicates results", () => {
  const ranked = rerankResults(sample, "bun docs");
  expect(ranked.length).toBe(2);
  expect(ranked[0].url).toBe("https://bun.sh/docs");
});

test("applies positive domain filters", () => {
  const ranked = rerankResults(sample, "bun docs", ["bun.sh"]);
  expect(ranked.length).toBe(1);
  expect(ranked[0].domain).toBe("bun.sh");
});

test("supports mixed include and exclude domain filters", () => {
  const mixed: SearchResult[] = [
    ...sample,
    { title: "Bun in StackOverflow", url: "https://stackoverflow.com/questions/1", snippet: "Q&A", sourceEngine: "google", rank: 4, score: 0, domain: "stackoverflow.com" },
  ];

  const ranked = rerankResults(mixed, "bun docs", ["bun", "-stackoverflow.com"]);
  expect(ranked.length).toBe(1);
  expect(ranked[0].url).toBe("https://bun.sh/docs");
});

test("boosts official documentation for docs-style queries", () => {
  const docsResults: SearchResult[] = [
    { title: "OpenAI Responses API", url: "https://developers.openai.com/api/reference/responses", snippet: "Official OpenAI API reference", sourceEngine: "google", rank: 3, score: 0, domain: "developers.openai.com" },
    { title: "Random blog post", url: "https://medium.com/example/openai-responses", snippet: "Community overview", sourceEngine: "google", rank: 1, score: 0, domain: "medium.com" },
  ];

  const ranked = rerankResults(docsResults, "OpenAI Responses API documentation");
  expect(ranked[0].domain).toBe("developers.openai.com");
});

test("filters low-value search landing pages for docs-style queries", () => {
  const docsResults: SearchResult[] = [
    { title: "Videos", url: "https://video.search.yahoo.com/search/video?p=bun+runtime+documentation", snippet: "YouTube", sourceEngine: "yahoo", rank: 1, score: 0, domain: "video.search.yahoo.com" },
    { title: "Bun Runtime - Bun", url: "https://bun.com/docs/runtime", snippet: "Official Bun runtime docs", sourceEngine: "yahoo", rank: 2, score: 0, domain: "bun.com" },
  ];

  const ranked = rerankResults(docsResults, "Bun runtime documentation");
  expect(ranked.length).toBe(1);
  expect(ranked[0].domain).toBe("bun.com");
});
