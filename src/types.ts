export type SupportedPlatform = "darwin" | "linux" | "unknown";

export type BrowserFamily =
  | "safari"
  | "chrome"
  | "brave"
  | "edge"
  | "chromium"
  | "firefox"
  | "dia"
  | "unknown";

export type SearchEngineId =
  | "google"
  | "bing"
  | "duckduckgo"
  | "brave"
  | "yahoo"
  | "searxng"
  | "unknown";

export type BrowserMode = "auto" | "visible" | "headless" | "ask" | "disabled";

export interface BrowserDetection {
  platform: SupportedPlatform;
  browserFamily: BrowserFamily;
  browserId: string;
  browserLabel: string;
  executablePath?: string;
  source: "system" | "config" | "fallback";
}

export interface SearchEngineDetection {
  id: SearchEngineId;
  label: string;
  templateUrl?: string;
  source: "browser-profile" | "browser-default" | "config" | "fallback";
}

export interface EffectiveSearchContext {
  browser: BrowserDetection;
  engine: SearchEngineDetection;
  mode: BrowserMode;
}

export interface FreeWebSearchConfig {
  mode?: BrowserMode;
  preferredBrowser?: BrowserFamily;
  preferredEngine?: SearchEngineId;
  searchTemplateUrl?: string;
  browserExecutablePath?: string;
  chromiumProfilePath?: string;
  firefoxProfilePath?: string;
  searxngBaseUrl?: string;
  locale?: string;
  language?: string;
  httpFirst?: boolean;
  browserFallbackThreshold?: number;
  httpTimeoutMs?: number;
  browserNavigationTimeoutMs?: number;
  browserResultWaitMs?: number;
  contentMinMarkdownLength?: number;
  includeContentMinScore?: number;
  maxContentFetchConcurrency?: number;
  engineHealthCooldownMs?: number;
  engineFailureThreshold?: number;
  userAgent?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceEngine: SearchEngineId;
  rank: number;
  score: number;
  domain: string;
}

export interface SearchRequest {
  query: string;
  numResults: number;
  engine?: SearchEngineId;
  mode?: BrowserMode;
  domainFilter?: string[];
  includeContent?: boolean;
  context?: string;
}

export interface SearchAttempt {
  engine: SearchEngineId;
  searchUrl: string;
  httpResults: number;
  browserResults: number;
  finalResults: number;
  attemptedBrowserFallback: boolean;
  usedBrowserFallback: boolean;
  blockedReason?: string;
  blockedSource?: "http" | "browser";
  pageTitle?: string;
  httpStatus?: number;
  error?: string;
  durationMs?: number;
}

export interface SearchResponse {
  context: EffectiveSearchContext;
  query: string;
  results: SearchResult[];
  usedBrowserFallback: boolean;
  attempts: SearchAttempt[];
}

export interface ExtractedContent {
  url: string;
  title: string;
  markdown: string;
  textExcerpt: string;
  usedBrowserFallback: boolean;
}
