import type { SearchEngineDetection, SearchEngineId } from "../types";

export function buildSearchUrl(engine: SearchEngineDetection, query: string): string {
  const template = engine.templateUrl || defaultTemplate(engine.id);
  const encoded = encodeURIComponent(query);
  return template.replace(/\{searchTerms\}/g, encoded).replace(/\{inputEncoding\}/g, "UTF-8");
}

export function defaultTemplate(engine: SearchEngineId): string {
  switch (engine) {
    case "google": return "https://www.google.com/search?q={searchTerms}";
    case "bing": return "https://www.bing.com/search?q={searchTerms}";
    case "duckduckgo": return "https://duckduckgo.com/html/?q={searchTerms}";
    case "brave": return "https://search.brave.com/search?q={searchTerms}";
    case "yahoo": return "https://search.yahoo.com/search?p={searchTerms}";
    case "searxng": return "https://searx.be/search?q={searchTerms}";
    default: return "https://duckduckgo.com/html/?q={searchTerms}";
  }
}
