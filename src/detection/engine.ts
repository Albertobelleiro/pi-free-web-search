import type { BrowserDetection, FreeWebSearchConfig, SearchEngineDetection, SearchEngineId } from "../types";

function appendParams(baseUrl: string, params: Record<string, string | undefined>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function templateForEngine(id: SearchEngineId, config: Pick<FreeWebSearchConfig, "searxngBaseUrl" | "locale" | "language"> = {}): string | undefined {
  const locale = config.locale;
  const language = config.language || locale?.split("-")[0];

  switch (id) {
    case "google":
      return appendParams("https://www.google.com/search?q={searchTerms}", { hl: language });
    case "bing":
      return appendParams("https://www.bing.com/search?q={searchTerms}", { mkt: locale });
    case "duckduckgo":
      return "https://duckduckgo.com/html/?q={searchTerms}";
    case "brave":
      return "https://search.brave.com/search?q={searchTerms}";
    case "yahoo":
      return appendParams("https://search.yahoo.com/search?p={searchTerms}", { hl: language });
    case "searxng":
      return config.searxngBaseUrl ? `${config.searxngBaseUrl.replace(/\/$/, "")}/search?q={searchTerms}` : undefined;
    default:
      return undefined;
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
      templateUrl: templateForEngine(config.preferredEngine, config),
      source: "config",
    };
  }

  return {
    id: "yahoo",
    label: "yahoo",
    templateUrl: templateForEngine("yahoo", config),
    source: "fallback",
  };
}
