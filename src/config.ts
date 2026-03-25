import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { FreeWebSearchConfig } from "./types";

function safeReadJson(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function climbProjectConfig(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    const candidate = join(current, ".pi", "free-web-search.json");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(current, "..");
    if (parent === current) return undefined;
    current = parent;
  }
}

function detectSystemLocale(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
    return locale.replace("_", "-");
  } catch {
    return "en-US";
  }
}

export function loadConfig(cwd: string): FreeWebSearchConfig {
  const globalPath = join(homedir(), ".pi", "free-web-search.json");
  const projectPath = climbProjectConfig(cwd);
  const systemLocale = detectSystemLocale();
  return {
    mode: "auto",
    httpFirst: true,
    locale: systemLocale,
    language: systemLocale.split("-")[0] || "en",
    browserFallbackThreshold: 0.55,
    httpTimeoutMs: 10000,
    browserNavigationTimeoutMs: 12000,
    browserResultWaitMs: 700,
    contentMinMarkdownLength: 200,
    includeContentMinScore: 2,
    maxContentFetchConcurrency: 2,
    engineHealthCooldownMs: 10 * 60 * 1000,
    engineFailureThreshold: 2,
    ...safeReadJson(globalPath),
    ...(projectPath ? safeReadJson(projectPath) : {}),
  } as FreeWebSearchConfig;
}
