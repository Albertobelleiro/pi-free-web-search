import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { BrowserDetection, FreeWebSearchConfig, SearchEngineDetection, SearchEngineId } from "../types";

function engineFromLabel(label?: string): SearchEngineId {
  const value = (label || "").toLowerCase();
  if (value.includes("google")) return "google";
  if (value.includes("duck")) return "duckduckgo";
  if (value.includes("bing")) return "bing";
  if (value.includes("brave")) return "brave";
  if (value.includes("yahoo")) return "yahoo";
  if (value.includes("searx")) return "searxng";
  return "unknown";
}

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

function parseChromiumPrefs(path: string): SearchEngineDetection | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const json = JSON.parse(readFileSync(path, "utf8")) as any;
    const data = json.default_search_provider_data?.template_url_data || json.default_search_provider;
    const label = data?.short_name || data?.keyword || "";
    const templateUrl = data?.url as string | undefined;
    const id = engineFromLabel(label || templateUrl);
    if (id === "unknown" && !templateUrl) return undefined;
    return { id, label: label || id, templateUrl: templateUrl || templateForEngine(id), source: "browser-profile" };
  } catch {
    return undefined;
  }
}

function parseFirefoxPrefs(path: string): SearchEngineDetection | undefined {
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  const match = text.match(/browser\.search\.defaultenginename",\s*"([^"]+)"/);
  const label = match?.[1];
  if (!label) return undefined;
  const id = engineFromLabel(label);
  return { id, label, templateUrl: templateForEngine(id), source: "browser-profile" };
}

function parseSafariPrefs(): SearchEngineDetection | undefined {
  if (platform() !== "darwin") return undefined;
  const path = join(homedir(), "Library/Containers/com.apple.Safari/Data/Library/Preferences/com.apple.Safari.plist");
  if (!existsSync(path)) return undefined;
  try {
    const data = Bun.spawnSync(["plutil", "-convert", "json", "-o", "-", path], { stdout: "pipe" });
    const json = JSON.parse(Buffer.from(data.stdout).toString("utf8"));
    const label = json.SearchProviderIdentifier || json.SearchProviderShortName || "google";
    const id = engineFromLabel(label);
    return { id, label, templateUrl: templateForEngine(id), source: "browser-profile" };
  } catch {
    return undefined;
  }
}

function candidateProfilePaths(browser: BrowserDetection, config: FreeWebSearchConfig): string[] {
  const home = homedir();
  const isMac = platform() === "darwin";
  switch (browser.browserFamily) {
    case "chrome":
      return [
        config.chromiumProfilePath || "",
        isMac ? join(home, "Library/Application Support/Google/Chrome/Default/Preferences") : join(home, ".config/google-chrome/Default/Preferences"),
      ].filter(Boolean);
    case "brave":
      return [
        config.chromiumProfilePath || "",
        isMac ? join(home, "Library/Application Support/BraveSoftware/Brave-Browser/Default/Preferences") : join(home, ".config/BraveSoftware/Brave-Browser/Default/Preferences"),
      ].filter(Boolean);
    case "edge":
      return [
        config.chromiumProfilePath || "",
        isMac ? join(home, "Library/Application Support/Microsoft Edge/Default/Preferences") : join(home, ".config/microsoft-edge/Default/Preferences"),
      ].filter(Boolean);
    case "chromium":
    case "dia":
      return [
        config.chromiumProfilePath || "",
        isMac ? join(home, "Library/Application Support/Chromium/Default/Preferences") : join(home, ".config/chromium/Default/Preferences"),
      ].filter(Boolean);
    case "firefox": {
      if (config.firefoxProfilePath) return [join(config.firefoxProfilePath, "prefs.js")];
      const base = isMac ? join(home, "Library/Application Support/Firefox/Profiles") : join(home, ".mozilla/firefox");
      try {
        return readdirSync(base).map((entry) => join(base, entry, "prefs.js"));
      } catch {
        return [];
      }
    }
    default:
      return [];
  }
}

export async function detectSearchEngine(browser: BrowserDetection, config: FreeWebSearchConfig): Promise<SearchEngineDetection> {
  if (config.searchTemplateUrl) {
    const id = config.preferredEngine || "unknown";
    return { id, label: id, templateUrl: config.searchTemplateUrl, source: "config" };
  }
  if (config.preferredEngine) {
    return { id: config.preferredEngine, label: config.preferredEngine, templateUrl: templateForEngine(config.preferredEngine, config.searxngBaseUrl), source: "config" };
  }

  if (browser.browserFamily === "safari") {
    const safari = parseSafariPrefs();
    if (safari) return safari;
  }

  for (const candidate of candidateProfilePaths(browser, config)) {
    const detected = browser.browserFamily === "firefox" ? parseFirefoxPrefs(candidate) : parseChromiumPrefs(candidate);
    if (detected) return detected;
  }

  const fallbackId = browser.browserFamily === "edge" ? "bing" : browser.browserFamily === "brave" ? "brave" : "google";
  return { id: fallbackId, label: fallbackId, templateUrl: templateForEngine(fallbackId, config.searxngBaseUrl), source: "fallback" };
}
