import type { SearchResult } from "../types";

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
    const normalized: SearchResult = { ...result, score };
    if (!deduped.has(result.url) || deduped.get(result.url)!.score < score) deduped.set(result.url, normalized);
  }

  return [...deduped.values()]
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .map((result, index) => ({ ...result, rank: index + 1 }));
}
