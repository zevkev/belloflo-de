// Twitch live status, written by .github/workflows/twitch-watch.yml
// (scripts/watch-twitch.mjs) and served from this site, so checking it never
// contacts Twitch. Shared by the header (live dot) and the Twitch page.
const STATUS_URL = "/assets/data/live-status.json";
// The watcher publishes every change within minutes. If it ever stops, a
// "live" status could stay behind, so a stream that started this long ago
// counts as over.
const MAX_STREAM_MS = 16 * 60 * 60 * 1000;

let pending;

export function getLiveStatus() {
  pending ??= fetch(STATUS_URL, { cache: "no-cache" })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return pending;
}

export function isLive(status) {
  if (!status || status.live !== true) return false;
  const started = Date.parse(status.startedAt);
  return !Number.isFinite(started) || Date.now() - started < MAX_STREAM_MS;
}
