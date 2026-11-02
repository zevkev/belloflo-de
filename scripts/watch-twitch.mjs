// Watches Belloflo's Twitch channel through the official Helix API and keeps
// assets/data/live-status.json and assets/data/twitch-vods.json current.
//
//   node scripts/watch-twitch.mjs            one check, writes the files
//   node scripts/watch-twitch.mjs --publish  keeps checking for WATCH_MINUTES
//                                            and commits, pushes and deploys
//                                            every change (GitHub Actions)
//
// Why a long running watcher instead of one check per cron run: GitHub fires
// short cron schedules on small repos only every few hours in practice, far
// too slow for "is he live right now". One run of
// .github/workflows/twitch-watch.yml polls every POLL_MS for almost the whole
// 6 hour job limit, and the next scheduled run takes over.
//
// Needs an app access token (Client Credentials grant), which needs the
// Client Secret, so this only ever runs server-side with the repo secrets
// TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET, never in the browser.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHANNEL_LOGIN = "belloflo_ttv";
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const PUBLISH = process.argv.includes("--publish");
const WATCH_MINUTES = Number(process.env.WATCH_MINUTES || 340);
const POLL_MS = 2 * 60 * 1000;
const VOD_EVERY_MS = 30 * 60 * 1000;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "assets", "data");
const FILES = {
  status: path.join(OUT_DIR, "live-status.json"),
  vods: path.join(OUT_DIR, "twitch-vods.json"),
};

let token = null;

async function getAppToken() {
  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Twitch token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function helix(apiPath, retry = true) {
  token ??= await getAppToken();
  const res = await fetch(`https://api.twitch.tv/helix${apiPath}`, {
    headers: { "Client-Id": CLIENT_ID, Authorization: `Bearer ${token}` },
  });
  // App tokens expire after a while; get a fresh one once.
  if (res.status === 401 && retry) {
    token = null;
    return helix(apiPath, false);
  }
  if (!res.ok) throw new Error(`Twitch API ${res.status} on ${apiPath}: ${await res.text()}`);
  return res.json();
}

async function fetchStatus() {
  const { data } = await helix(`/streams?user_login=${CHANNEL_LOGIN}`);
  const stream = data?.[0] || null;
  return {
    live: !!stream,
    title: stream?.title || null,
    game: stream?.game_name || null,
    startedAt: stream?.started_at || null,
  };
}

async function fetchVods(userId) {
  const { data } = await helix(`/videos?user_id=${userId}&type=archive&first=24`);
  return (data || []).map((v) => ({
    id: v.id,
    title: v.title,
    publishedAt: v.published_at || v.created_at,
    // Empty or a "404_processing" placeholder while Twitch is still
    // processing the VOD; the page shows its own fallback then.
    thumbnail: v.thumbnail_url && !v.thumbnail_url.includes("processing") ? v.thumbnail_url : null,
    duration: v.duration,
    viewCount: v.view_count,
    url: v.url,
  }));
}

async function readJSON(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

// What counts as a change worth a commit and a deploy. View counts move all
// the time, so they ride along with real changes but never trigger one.
const statusKey = (s) => JSON.stringify(s ? [s.live, s.title, s.game, s.startedAt] : null);
const vodsKey = (v) => JSON.stringify((v?.videos || []).map((x) => [x.id, x.title, x.thumbnail, x.duration]));

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

let deployPending = false;

function publish(message) {
  git("add", "assets/data/live-status.json", "assets/data/twitch-vods.json");
  let staged = true;
  try {
    git("diff", "--cached", "--quiet");
    staged = false;
  } catch {
    // exit code 1: there are staged changes
  }
  if (staged) git("commit", "-m", message);
  // Other workflows (YouTube feed, Discord stats) push to main as well.
  git("pull", "--rebase", "origin", "main");
  if (git("rev-list", "--count", "origin/main..HEAD") !== "0") {
    git("push", "origin", "HEAD:main");
    deployPending = true;
  }
  if (!deployPending) return;
  // Pushes made with the workflow token do not start other workflows, so the
  // site is deployed explicitly. workflow_dispatch is the allowed exception.
  execFileSync("gh", ["workflow", "run", "deploy.yml", "--ref", "main"], { cwd: ROOT, stdio: "inherit" });
  deployPending = false;
  console.log(`Published: ${message}`);
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    // A warning, not a failure: a red run every 30 minutes would flood the
    // owner's inbox until the secrets are added.
    console.log("::warning::TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set, Twitch status is not updated.");
    return;
  }
  await mkdir(OUT_DIR, { recursive: true });

  const { data: users } = await helix(`/users?login=${CHANNEL_LOGIN}`);
  const userId = users?.[0]?.id;
  if (!userId) throw new Error(`Could not resolve Twitch user id for ${CHANNEL_LOGIN}`);

  let status = await readJSON(FILES.status);
  let vods = await readJSON(FILES.vods);
  let lastVodCheck = 0;
  // Changes written but not yet pushed (a failed push is retried next poll).
  const pending = [];
  const deadline = Date.now() + WATCH_MINUTES * 60 * 1000;

  for (;;) {
    try {
      const next = await fetchStatus();
      const wentOffline = status?.live && !next.live;

      if (statusKey(next) !== statusKey(status)) {
        status = { checkedAt: new Date().toISOString(), ...next };
        await writeFile(FILES.status, JSON.stringify(status, null, 2) + "\n");
        pending.push(next.live ? "live" : "offline");
        console.log(`Live status: ${next.live ? `LIVE (${next.title})` : "offline"}`);
      }

      // VODs every half hour, and right after a stream ends (its VOD appears).
      if (wentOffline || Date.now() - lastVodCheck >= VOD_EVERY_MS) {
        lastVodCheck = Date.now();
        const videos = await fetchVods(userId);
        if (vodsKey({ videos }) !== vodsKey(vods)) {
          vods = { updatedAt: new Date().toISOString(), videos };
          await writeFile(FILES.vods, JSON.stringify(vods, null, 2) + "\n");
          pending.push(`${videos.length} VODs`);
          console.log(`Wrote ${videos.length} Twitch VODs`);
        }
      }

      if (PUBLISH && pending.length) {
        publish(`chore: Twitch ${[...new Set(pending)].join(", ")}`);
        pending.length = 0;
      }
    } catch (err) {
      // One failed poll (network, Twitch hiccup) must not end the watch.
      console.error(err);
    }

    if (!PUBLISH || Date.now() + POLL_MS > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
