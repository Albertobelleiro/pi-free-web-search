import type { SearchResult } from "../types";

const docsTerms = ["doc", "docs", "documentation", "api", "reference", "guide", "sdk", "handbook", "manual"];
const docsLikePathPattern = /docs?|documentation|api|reference|guide|handbook|manual|sdk/i;
const lowSignalDocsDomains = [
  "video.search.yahoo.com",
  "search.yahoo.com",
  "bing.com",
  "google.com",
  "duckduckgo.com",
  "search.brave.com",
  "youtube.com",
  "youtu.be",
];
const communityDomains = [
  "medium.com",
  "reddit.com",
  "quora.com",
  "kaskus.co.id",
  "forums.",
  "community.",
  "stackoverflow.com",
  "stackexchange.com",
];

function includesDomainFilter(url: string, filters: string[]): boolean {
  if (filters.length === 0) return true;

  const normalizedUrl = url.toLowerCase();
  const includes: string[] = [];
  const excludes: string[] = [];

  for (const filter of filters) {
    const trimmed = filter.trim().toLowerCase();
    if (!trimmed) continue;
    if (trimmed.startsWith("-")) excludes.push(trimmed.slice(1));
    else includes.push(trimmed);
  }

  const includeMatch = includes.length === 0 || includes.some((filter) => normalizedUrl.includes(filter));
  const excludeMatch = excludes.every((filter) => !normalizedUrl.includes(filter));

  return includeMatch && excludeMatch;
}

function looksLikeDocsQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return docsTerms.some((term) => normalized.includes(term));
}

function inferPreferredDomains(query: string): string[] {
  const normalized = query.toLowerCase();
  const matches: string[] = [];

  if (normalized.includes("openai")) matches.push("developers.openai.com", "platform.openai.com", "openai.com");
  if (normalized.includes("supabase")) matches.push("supabase.com");
  if (normalized.includes("next.js") || normalized.includes("nextjs")) matches.push("nextjs.org", "vercel.com");
  if (normalized.includes("bun")) matches.push("bun.com", "bun.sh");
  if (normalized.includes("playwright")) matches.push("playwright.dev", "github.com");
  if (normalized.includes("vercel") && normalized.includes("ai sdk")) matches.push("sdk.vercel.ai", "vercel.com");
  if (normalized.includes("gemini") || normalized.includes("google ai") || normalized.includes("google cloud")) {
    matches.push("ai.google.dev", "cloud.google.com", "docs.cloud.google.com");
  }
  if (normalized.includes("copilot") || normalized.includes("microsoft")) {
    matches.push("learn.microsoft.com", "microsoft.com");
  }

  return [...new Set(matches)];
}

function domainMatches(hostname: string, candidate: string): boolean {
  return hostname === candidate || hostname.endsWith(`.${candidate}`);
}

function isLowSignalDocsResult(domain: string): boolean {
  return lowSignalDocsDomains.some((candidate) => domainMatches(domain, candidate));
}

function isCommunityDomain(domain: string): boolean {
  return communityDomains.some((candidate) => domain.includes(candidate));
}

function docsScoreBoost(result: SearchResult, query: string): number {
  if (!looksLikeDocsQuery(query)) return 0;

  const preferredDomains = inferPreferredDomains(query);
  let boost = 0;
  const domain = result.domain.toLowerCase();
  const titleAndSnippet = `${result.title} ${result.snippet}`.toLowerCase();

  if (isLowSignalDocsResult(domain)) return -20;
  if (preferredDomains.some((candidate) => domainMatches(domain, candidate))) boost += 6;
  if (docsLikePathPattern.test(result.url)) boost += 2;
  if (docsLikePathPattern.test(titleAndSnippet)) boost += 1.5;
  if (isCommunityDomain(domain)) boost -= 2.5;
  if (preferredDomains.length > 0 && !preferredDomains.some((candidate) => domainMatches(domain, candidate))) boost -= 0.5;

  return boost;
}

export function rerankResults(results: SearchResult[], query: string, domainFilter: string[] = []): SearchResult[] {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const deduped = new Map<string, SearchResult>();

  for (const result of results) {
    if (!includesDomainFilter(result.url, domainFilter)) continue;
    let score = result.score || 0;
    const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
    for (const token of tokens) {
      if (haystack.includes(token)) score += 1;
    }
    if (/docs|developer|api|guide|reference/.test(result.url)) score += 0.5;
    score += docsScoreBoost(result, query);

    if (score <= -4) continue;

    const normalized: SearchResult = { ...result, score };
    if (!deduped.has(result.url) || deduped.get(result.url)!.score < score) deduped.set(result.url, normalized);
  }

  return [...deduped.values()]
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .map((result, index) => ({ ...result, rank: index + 1 }));
}
