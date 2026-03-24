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
