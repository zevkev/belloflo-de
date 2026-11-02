// Fetches the public YouTube RSS feed for the main channel (@Belloflo) and
// writes assets/data/main-videos.json. No API key needed, the feed is public.
// Run by .github/workflows/data-refresh.yml on a schedule.
//
// TRADEOFF vs. the YouTube Data API v3: the public RSS feed
// (feeds/videos.xml) is hard-capped by YouTube itself at roughly the
// channel's 15 most recent uploads, with no pagination -- there is no page 2
// to request. That's a real YouTube-side limitation, not something a
// different fetch strategy can work around. Chosen deliberately anyway
// (explicit ask: no Google Cloud API key for this channel) -- 15 most recent
// uploads, kept fresh by the 5-minute cron, is the tradeoff that buys "zero
// setup, no key to manage."
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHANNEL_ID = "UCZuzCW_1h6FUlpTI1G-T-aQ"; // @Belloflo (verified via canonical link and externalId)
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "data");
const OUT_FILE = path.join(OUT_DIR, "main-videos.json");

function textBetween(xml, tag, fromIndex) {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open, fromIndex);
  if (start === -1) return "";
  const end = xml.indexOf(close, start);
  if (end === -1) return "";
  return xml.slice(start + open.length, end).trim();
}

function attrValue(xml, tag, attr, fromIndex) {
  const re = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"[^>]*/?>`);
  const slice = xml.slice(fromIndex, fromIndex + 2000);
  const m = slice.match(re);
  return m ? m[1] : "";
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// The public RSS feed doesn't say whether a video is a Short. YouTube itself
// exposes this indirectly: /shorts/<id> serves the short normally (200) but
// redirects to /watch?v=<id> for anything that isn't one. From EU IPs every
// request first redirects to consent.youtube.com, so the request carries the
// "consent answered" cookie (this is the bot's own request, no visitor is
// involved). If YouTube still answers with something else, the oEmbed
// endpoint decides: Shorts come back in portrait (113x200).
async function checkIsShort(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (belloflo.de feed bot)", Cookie: "SOCS=CAI; CONSENT=YES+" },
    });
    if (res.status >= 200 && res.status < 300) return true;
    const location = res.headers.get("location") || "";
    if (res.status >= 300 && res.status < 400 && location.includes("/watch")) return false;
  } catch {
    // fall through to oEmbed
  }
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/shorts/${videoId}`)}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (belloflo.de feed bot)" } });
    if (!res.ok) return false;
    const { width, height } = await res.json();
    return Number(height) > Number(width);
  } catch {
    return false;
  }
}

async function main() {
  const res = await fetch(FEED_URL, { headers: { "User-Agent": "Mozilla/5.0 (belloflo.de main feed bot)" } });
  if (!res.ok) throw new Error(`YouTube feed fetch failed: ${res.status}`);
  const xml = await res.text();

  const entries = xml.split("<entry>").slice(1);
  if (entries.length === 0) {
    // Never overwrite a known-good file with an empty one -- more likely a
    // bad channel id or a transient feed hiccup than a channel with zero
    // uploads.
    throw new Error("YouTube RSS feed returned zero entries -- refusing to overwrite existing data.");
  }

  const parsed = entries.map((chunk) => {
    const videoId = textBetween(chunk, "yt:videoId", 0);
    const title = decodeEntities(textBetween(chunk, "title", 0));
    const published = textBetween(chunk, "published", 0);
    const thumb = attrValue(chunk, "media:thumbnail", "url", 0);
    const description = decodeEntities(textBetween(chunk, "media:description", 0));
    const viewsMatch = chunk.match(/<media:statistics views="(\d+)"/);
    return {
      id: videoId,
      title,
      publishedAt: published,
      thumbnail: thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      description,
      views: viewsMatch ? Number(viewsMatch[1]) : null,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    };
  });

  const shortsFlags = await Promise.all(parsed.map((v) => checkIsShort(v.id)));
  const videos = parsed.map((v, i) => ({ ...v, isShort: shortsFlags[i] }));

  await mkdir(OUT_DIR, { recursive: true });
  // Keep the old timestamp when nothing changed, so the refresh workflow
  // only commits (and deploys) real changes.
  const old = await readFile(OUT_FILE, "utf8").then(JSON.parse).catch(() => null);
  const same = old && JSON.stringify(old.videos) === JSON.stringify(videos);
  const updatedAt = same && old.updatedAt ? old.updatedAt : new Date().toISOString();
  await writeFile(OUT_FILE, JSON.stringify({ updatedAt, videos }, null, 2));
  console.log(`Wrote ${videos.length} videos (${shortsFlags.filter(Boolean).length} shorts) to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
