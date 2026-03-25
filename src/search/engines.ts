import { templateForEngine } from "../detection/engine";
import type { SearchEngineDetection, SearchEngineId } from "../types";

export function buildSearchUrl(engine: SearchEngineDetection, query: string): string {
  const template = engine.templateUrl || defaultTemplate(engine.id);
  const encoded = encodeURIComponent(query);
  return template
    .replace(/\{searchTerms\}/g, encoded)
    .replace(/%7BsearchTerms%7D/gi, encoded)
    .replace(/\{inputEncoding\}/g, "UTF-8")
    .replace(/%7BinputEncoding%7D/gi, "UTF-8");
}

export function defaultTemplate(engine: SearchEngineId): string {
  return templateForEngine(engine) || "https://search.yahoo.com/search?p={searchTerms}";
}
