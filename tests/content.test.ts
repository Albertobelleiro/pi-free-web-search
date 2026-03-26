import { expect, test } from "bun:test";
import { fetchContent } from "../src/content/fetch";
import type { BrowserDetection } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockBrowser: BrowserDetection = {
  platform: "darwin",
  browserFamily: "chrome",
  browserId: "chrome",
  browserLabel: "Google Chrome",
  source: "fallback",
};

function mockBrowserDeps(html: string, onBrowserCall?: () => void) {
  return {
    detectBrowser: async () => mockBrowser,
    fetchPageHtmlViaBrowser: async () => {
      onBrowserCall?.();
      return html;
    },
  };
}

// ---------------------------------------------------------------------------
// Existing tests (unchanged behavior)
// ---------------------------------------------------------------------------

test("extracts readable content from HTML without network access", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Example</title></head><body><article><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents.</p></article></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    const content = await fetchContent(process.cwd(), "https://example.com", "disabled");
    expect(content.title).toContain("Example");
    expect(content.markdown.length).toBeGreaterThan(20);
    expect(content.usedBrowserFallback).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unsupported PDF content", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response("%PDF-1.5 binary", {
      status: 200,
      headers: { "content-type": "application/pdf" },
    })) as unknown as typeof globalThis.fetch;

  try {
    await expect(fetchContent(process.cwd(), "https://example.com/file.pdf", "disabled")).rejects.toThrow("Unsupported content type");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects challenge/interstitial pages when browser disabled", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Just a moment...</title></head><body>Verification successful. Waiting for example.com to respond</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    await expect(fetchContent(process.cwd(), "https://example.com/protected", "disabled")).rejects.toThrow("Content fetch blocked");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects x.com interstitial pages when browser disabled", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>https://x.com/OpenAI</title></head><body>Something went wrong, but don't fret — let's give it another shot. Some privacy related extensions may cause issues on x.com.</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    await expect(fetchContent(process.cwd(), "https://x.com/OpenAI", "disabled")).rejects.toThrow("x.com interstitial");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extracts plain-text responses", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response("Line 1\nLine 2", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })) as unknown as typeof globalThis.fetch;

  try {
    const content = await fetchContent(process.cwd(), "https://example.com/readme.txt", "disabled");
    expect(content.markdown).toContain("Line 1");
    expect(content.usedBrowserFallback).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ask mode does not auto-use browser fallback", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Short</title></head><body><p>tiny</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    await expect(fetchContent(process.cwd(), "https://example.com/short", "ask")).rejects.toThrow("Browser fallback disabled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Blocked page → browser escalation tests
// ---------------------------------------------------------------------------

test("blocked 403 escalates to browser fallback when mode is auto", async () => {
  const originalFetch = globalThis.fetch;
  let browserCalled = false;

  globalThis.fetch = (async () =>
    new Response("<html><body>Forbidden</body></html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof globalThis.fetch;

  try {
    const browserHtml = `<html><head><title>Protected Page</title></head><body><article><h1>Protected Content</h1><p>This is the actual content behind the protection, rendered via browser automation.</p></article></body></html>`;
    const content = await fetchContent(process.cwd(), "https://example.com/protected", "auto", {
      deps: mockBrowserDeps(browserHtml, () => { browserCalled = true; }),
    });

    expect(browserCalled).toBe(true);
    expect(content.usedBrowserFallback).toBe(true);
    expect(content.title).toContain("Protected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("blocked 403 throws when mode is disabled", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response("<html><body>Forbidden</body></html>", {
      status: 403,
      headers: { "content-type": "text/html" },
    })) as unknown as typeof globalThis.fetch;

  try {
    await expect(
      fetchContent(process.cwd(), "https://example.com/protected", "disabled"),
    ).rejects.toThrow("Content fetch blocked: HTTP 403");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("captcha page escalates to browser fallback when mode is auto", async () => {
  const originalFetch = globalThis.fetch;
  let browserCalled = false;

  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Security Check</title></head><body>Please complete the captcha to continue</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    const browserHtml = `<html><head><title>Real Article</title></head><body><article><h1>Real Article</h1><p>This is the full article content after bypassing the security challenge via browser rendering.</p></article></body></html>`;
    const content = await fetchContent(process.cwd(), "https://example.com/article", "auto", {
      deps: mockBrowserDeps(browserHtml, () => { browserCalled = true; }),
    });

    expect(browserCalled).toBe(true);
    expect(content.usedBrowserFallback).toBe(true);
    expect(content.title).toContain("Real Article");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("redirect to login page escalates to browser fallback", async () => {
  const originalFetch = globalThis.fetch;
  let browserCalled = false;

  globalThis.fetch = (async () => {
    const response = new Response(
      `<html><head><title>Sign In</title></head><body><form>Please sign in to continue</form></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );
    // Simulate redirect: response.url reflects the final URL after following redirects
    Object.defineProperty(response, "url", {
      value: "https://login.example.com/signin?redirect=https%3A%2F%2Fexample.com%2Farticle",
      configurable: true,
    });
    return response;
  }) as unknown as typeof globalThis.fetch;

  try {
    const browserHtml = `<html><head><title>Article Title</title></head><body><article><h1>Article Title</h1><p>This is the article content after the browser handled the login redirect automatically.</p></article></body></html>`;
    const content = await fetchContent(process.cwd(), "https://example.com/article", "auto", {
      deps: mockBrowserDeps(browserHtml, () => { browserCalled = true; }),
    });

    expect(browserCalled).toBe(true);
    expect(content.usedBrowserFallback).toBe(true);
    expect(content.title).toContain("Article");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("redirect to known auth domain escalates to browser fallback", async () => {
  const originalFetch = globalThis.fetch;
  let browserCalled = false;

  globalThis.fetch = (async () => {
    const response = new Response(
      `<html><head><title>Google Accounts</title></head><body>Choose an account to continue</body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );
    Object.defineProperty(response, "url", {
      value: "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fdocs.example.com",
      configurable: true,
    });
    return response;
  }) as unknown as typeof globalThis.fetch;

  try {
    const browserHtml = `<html><head><title>Team Docs</title></head><body><article><h1>Team Documentation</h1><p>Internal documentation after Google auth was handled by the browser session.</p></article></body></html>`;
    const content = await fetchContent(process.cwd(), "https://docs.example.com/internal", "auto", {
      deps: mockBrowserDeps(browserHtml, () => { browserCalled = true; }),
    });

    expect(browserCalled).toBe(true);
    expect(content.usedBrowserFallback).toBe(true);
    expect(content.title).toContain("Team");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("same-hostname response with login patterns is NOT flagged as login redirect", async () => {
  const originalFetch = globalThis.fetch;

  // A page that mentions "sign in" but is on the same hostname and has real content
  globalThis.fetch = (async () =>
    new Response(
      `<html><head><title>Welcome</title></head><body><article><h1>Welcome to Our Site</h1><p>You can sign in to access premium features. This article covers the basics of our platform and how to get started with the free tier.</p><p>More substantial content follows here with enough text to pass the minimum length threshold for extraction.</p></article></body></html>`,
      { status: 200, headers: { "content-type": "text/html" } },
    )) as unknown as typeof globalThis.fetch;

  try {
    // Should NOT escalate to browser — same hostname, "sign in" is incidental
    const content = await fetchContent(process.cwd(), "https://example.com/welcome", "disabled");
    expect(content.usedBrowserFallback).toBe(false);
    expect(content.title).toContain("Welcome");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// YouTube transcript extraction tests
// ---------------------------------------------------------------------------

const MOCK_WATCH_HTML = `<html><head><title>Test Video - YouTube</title></head><body><script>var ytInitialPlayerResponse = {};</script><script>{"INNERTUBE_API_KEY":"AIzaSyA_test_key_123"}</script></body></html>`;

const MOCK_PLAYER_JSON = {
  playabilityStatus: { status: "OK" },
  videoDetails: {
    videoId: "e_T-_dAcfGo",
    title: "Test Video Title",
    shortDescription: "This is the video description fallback text.",
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=e_T-_dAcfGo&lang=en",
          languageCode: "en",
          kind: "",
          name: { simpleText: "English" },
        },
      ],
    },
  },
};

const MOCK_TRANSCRIPT_XML = `<?xml version="1.0" encoding="utf-8"?><transcript><text start="0.0" dur="2.5">Hello everyone</text><text start="2.5" dur="3.0">welcome to the video</text><text start="5.5" dur="2.0">let&apos;s get started</text></transcript>`;

function mockYouTubeFetch(overrides?: { playerJson?: any; watchHtml?: string }) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("youtube.com/watch")) {
      return new Response(overrides?.watchHtml ?? MOCK_WATCH_HTML, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.includes("youtubei/v1/player")) {
      return new Response(JSON.stringify(overrides?.playerJson ?? MOCK_PLAYER_JSON), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("timedtext") || url.includes("api/timedtext")) {
      return new Response(MOCK_TRANSCRIPT_XML, {
        status: 200,
        headers: { "content-type": "text/xml" },
      });
    }
    return new Response("Not found", { status: 404 });
  };
}

test("extracts YouTube transcript from video URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockYouTubeFetch() as any;
  try {
    const content = await fetchContent(process.cwd(), "https://www.youtube.com/watch?v=e_T-_dAcfGo", "disabled");
    expect(content.title).toBe("Test Video Title");
    expect(content.markdown).toContain("Hello everyone");
    expect(content.markdown).toContain("welcome to the video");
    expect(content.markdown).toContain("let's get started");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extracts YouTube transcript from youtu.be short URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockYouTubeFetch() as any;
  try {
    const content = await fetchContent(process.cwd(), "https://youtu.be/e_T-_dAcfGo", "disabled");
    expect(content.title).toBe("Test Video Title");
    expect(content.markdown).toContain("Hello everyone");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to video description when no captions available", async () => {
  const originalFetch = globalThis.fetch;
  const noCaptionsPlayer = {
    ...MOCK_PLAYER_JSON,
    captions: undefined,
  };
  globalThis.fetch = mockYouTubeFetch({ playerJson: noCaptionsPlayer }) as any;
  try {
    const content = await fetchContent(process.cwd(), "https://www.youtube.com/watch?v=e_T-_dAcfGo", "disabled");
    expect(content.markdown).toContain("This is the video description fallback text.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throws on rate-limited YouTube response", async () => {
  const originalFetch = globalThis.fetch;
  const recaptchaHtml = `<html><body><div class="g-recaptcha"></div></body></html>`;
  globalThis.fetch = mockYouTubeFetch({ watchHtml: recaptchaHtml }) as any;
  try {
    await expect(
      fetchContent(process.cwd(), "https://www.youtube.com/watch?v=e_T-_dAcfGo", "disabled"),
    ).rejects.toThrow("YouTube rate limited");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns ExtractedContent with usedBrowserFallback=false", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockYouTubeFetch() as any;
  try {
    const content = await fetchContent(process.cwd(), "https://www.youtube.com/watch?v=e_T-_dAcfGo", "disabled");
    expect(content.usedBrowserFallback).toBe(false);
    expect(content.url).toBe("https://www.youtube.com/watch?v=e_T-_dAcfGo");
    expect(content.textExcerpt).toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
