import type { BrowserDetection, FreeWebSearchConfig, SearchEngineDetection, SearchEngineId } from "../types";

function templateForEngine(id: SearchEngineId, searxngBaseUrl?: string): string | undefined {
  switch (id) {
    case "google": return "https://www.google.com/search?q={searchTerms}";
    case "bing": return "https://www.bing.com/search?q={searchTerms}";
    case "duckduckgo": return "https://duckduckgo.com/html/?q={searchTerms}";
    case "brave": return "https://search.brave.com/search?q={searchTerms}";
    case "yahoo": return "https://search.yahoo.com/search?p={searchTerms}";
    case "searxng": return searxngBaseUrl ? `${searxngBaseUrl.replace(/\/$/, "")}/search?q={searchTerms}` : undefined;
    default: return undefined;
  }
}

export async function detectSearchEngine(_browser: BrowserDetection, config: FreeWebSearchConfig): Promise<SearchEngineDetection> {
  if (config.searchTemplateUrl) {
    const id = config.preferredEngine || "unknown";
    return { id, label: id, templateUrl: config.searchTemplateUrl, source: "config" };
  }

  if (config.preferredEngine) {
    return {
      id: config.preferredEngine,
      label: config.preferredEngine,
      templateUrl: templateForEngine(config.preferredEngine, config.searxngBaseUrl),
      source: "config",
    };
  }

  return {
    id: "duckduckgo",
    label: "duckduckgo",
    templateUrl: templateForEngine("duckduckgo", config.searxngBaseUrl),
    source: "fallback",
  };
}
