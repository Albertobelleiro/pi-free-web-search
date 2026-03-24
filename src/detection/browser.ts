import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { BrowserDetection, BrowserFamily, FreeWebSearchConfig, SupportedPlatform } from "../types";
import { execFileText } from "../util/exec";

function labelForBrowser(browserFamily: BrowserFamily): string {
  switch (browserFamily) {
    case "safari": return "Safari";
    case "chrome": return "Google Chrome";
    case "brave": return "Brave Browser";
    case "edge": return "Microsoft Edge";
    case "chromium": return "Chromium";
    case "firefox": return "Firefox";
    case "dia": return "Dia Browser";
    default: return "Unknown Browser";
  }
}

function inferFamily(browserId: string): BrowserFamily {
  const value = browserId.toLowerCase();
  if (value.includes("safari")) return "safari";
  if (value.includes("brave")) return "brave";
  if (value.includes("edge")) return "edge";
  if (value.includes("chrome")) return "chrome";
  if (value.includes("chromium")) return "chromium";
  if (value.includes("firefox")) return "firefox";
  if (value.includes("dia")) return "dia";
  return "unknown";
}

function resolveExecutable(family: BrowserFamily): string | undefined {
  const mac = {
    safari: "/Applications/Safari.app/Contents/MacOS/Safari",
    chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    brave: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    edge: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    chromium: "/Applications/Chromium.app/Contents/MacOS/Chromium",
    firefox: "/Applications/Firefox.app/Contents/MacOS/firefox",
  } as const;
  const linux = {
    chrome: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
    brave: ["/usr/bin/brave-browser", "/snap/bin/brave"],
    edge: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
    chromium: ["/usr/bin/chromium", "/usr/bin/chromium-browser"],
    firefox: ["/usr/bin/firefox"],
  } as const;
  if (platform() === "darwin") {
    const path = mac[family as keyof typeof mac];
    return path && existsSync(path) ? path : undefined;
  }
  if (platform() === "linux") {
    const candidates = linux[family as keyof typeof linux] ?? [];
    return candidates.find((candidate) => existsSync(candidate));
  }
  return undefined;
}

async function detectDefaultBrowserDarwin(): Promise<string | undefined> {
  const plist = join(homedir(), "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist");
  const script = `import plistlib, sys\nfrom pathlib import Path\npath = Path(${JSON.stringify(plist)})\nif not path.exists():\n  sys.exit(0)\nwith path.open('rb') as f:\n  data = plistlib.load(f)\nfor item in data.get('LSHandlers', []):\n  if item.get('LSHandlerURLScheme') in ('http','https'):\n    bundle = item.get('LSHandlerRoleAll') or item.get('LSHandlerRoleViewer')\n    if bundle:\n      print(bundle)\n      break\n`;
  try {
    return await execFileText("python3", ["-c", script]);
  } catch {
    return undefined;
  }
}

async function detectDefaultBrowserLinux(): Promise<string | undefined> {
  try {
    return await execFileText("xdg-settings", ["get", "default-web-browser"]);
  } catch {
    return undefined;
  }
}

export async function detectBrowser(config: FreeWebSearchConfig): Promise<BrowserDetection> {
  if (config.preferredBrowser) {
    return {
      platform: platform() as SupportedPlatform,
      browserFamily: config.preferredBrowser,
      browserId: config.preferredBrowser,
      browserLabel: labelForBrowser(config.preferredBrowser),
      executablePath: config.browserExecutablePath || resolveExecutable(config.preferredBrowser),
      source: "config",
    };
  }

  let browserId = "unknown";
  if (platform() === "darwin") browserId = (await detectDefaultBrowserDarwin()) || browserId;
  if (platform() === "linux") browserId = (await detectDefaultBrowserLinux()) || browserId;

  const browserFamily = inferFamily(browserId);
  return {
    platform: (platform() === "darwin" || platform() === "linux" ? platform() : "unknown") as SupportedPlatform,
    browserFamily,
    browserId,
    browserLabel: labelForBrowser(browserFamily),
    executablePath: config.browserExecutablePath || resolveExecutable(browserFamily),
    source: browserId === "unknown" ? "fallback" : "system",
  };
}
