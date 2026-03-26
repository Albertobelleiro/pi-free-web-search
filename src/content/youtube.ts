import type { ExtractedContent } from "../types";
import { throwIfAborted, withTimeout } from "../util/abort";
import type { FetchContentProgress } from "./fetch";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36";

const YOUTUBE_URL_RE =
  /(?:youtube\.com\/(?:watch\?.*v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const BARE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

export function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)\//.test(url);
}

export function extractVideoId(url: string): string | undefined {
  const m = url.match(YOUTUBE_URL_RE);
  if (m) return m[1];
  if (BARE_ID_RE.test(url)) return url;
  return undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind: string;
  name: { simpleText?: string };
}

function pickBestTrack(tracks: CaptionTrack[], preferLang = "en"): CaptionTrack {
  // 1. Manual in preferred language
  const manualPref = tracks.find((t) => t.kind !== "asr" && t.languageCode === preferLang);
  if (manualPref) return manualPref;
  // 2. Manual in any language
  const manual = tracks.find((t) => t.kind !== "asr");
  if (manual) return manual;
  // 3. ASR in preferred language
  const asrPref = tracks.find((t) => t.languageCode === preferLang);
  if (asrPref) return asrPref;
  // 4. First available
  return tracks[0];
}

function parseTranscriptXml(xml: string): string {
  const segments: string[] = [];
  const re = /<text[^>]*>([^<]*)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    segments.push(decodeEntities(m[1]));
  }
  return segments
    .join(" ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchYouTubeTranscript(
  url: string,
  options?: { signal?: AbortSignal; onProgress?: (progress: FetchContentProgress) => void },
): Promise<ExtractedContent> {
  const signal = options?.signal;
  const emit = (phase: FetchContentProgress["phase"], message: string) =>
    options?.onProgress?.({ phase, message });

  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`Not a valid YouTube URL: ${url}`);

  // Step 1: GET watch page
  emit("http-fetch", "Fetching YouTube watch page");
  const watchHtml = await withTimeout(
    "YouTube watch page",
    10000,
    async (ts) => {
      const r = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: { "user-agent": USER_AGENT },
        signal: ts,
      });
      return await r.text();
    },
    signal,
  );

  if (watchHtml.includes('class="g-recaptcha"')) {
    throw new Error("YouTube rate limited — too many requests");
  }

  const apiKeyMatch = watchHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  if (!apiKeyMatch) throw new Error("Could not extract YouTube API key");
  const apiKey = apiKeyMatch[1];

  const titleMatch =
    watchHtml.match(/"title":"([^"]+)"/) || watchHtml.match(/<title>([^<]+)<\/title>/);
  const rawTitle = titleMatch?.[1] || "YouTube Video";
  const videoTitle = rawTitle.replace(/ - YouTube$/, "");

  // Step 2: POST Innertube player
  throwIfAborted(signal);
  emit("http-fetch", "Fetching YouTube player data");
  const playerData = await withTimeout(
    "YouTube player API",
    10000,
    async (ts) => {
      const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": USER_AGENT },
        body: JSON.stringify({
          context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
          videoId,
        }),
        signal: ts,
      });
      return await r.json();
    },
    signal,
  );

  // Prefer title from player response (more reliable than watch page scraping)
  const playerTitle = playerData?.videoDetails?.title;
  const finalTitle = playerTitle || videoTitle;

  const captionTracks: CaptionTrack[] | undefined =
    playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  // Fallback to description if no captions
  if (!captionTracks || captionTracks.length === 0) {
    const description = playerData?.videoDetails?.shortDescription || "";
    const markdown = `# ${finalTitle}\n\n${description}`.trim();
    const textExcerpt = markdown.replace(/\s+/g, " ").slice(0, 400);
    return { url, title: finalTitle, markdown, textExcerpt, usedBrowserFallback: false };
  }

  // Step 3: GET transcript XML
  throwIfAborted(signal);
  emit("http-fetch", "Fetching YouTube transcript");
  const track = pickBestTrack(captionTracks);
  const transcriptUrl = track.baseUrl.replace(/&fmt=[^&]*/, "");

  const transcriptXml = await withTimeout(
    "YouTube transcript",
    10000,
    async (ts) => {
      const r = await fetch(transcriptUrl, {
        headers: { "user-agent": USER_AGENT },
        signal: ts,
      });
      return await r.text();
    },
    signal,
  );

  if (!transcriptXml.trim()) throw new Error("Failed to fetch transcript data");

  const transcriptText = parseTranscriptXml(transcriptXml);
  const markdown = `# ${finalTitle}\n\n${transcriptText}`;
  const textExcerpt = markdown.replace(/\s+/g, " ").slice(0, 400);

  emit("done", "YouTube transcript extracted");
  return { url, title: finalTitle, markdown, textExcerpt, usedBrowserFallback: false };
}
