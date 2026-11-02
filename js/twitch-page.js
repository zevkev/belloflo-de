// Twitch page (/twitch/). Data comes from this site only:
// assets/data/live-status.json and assets/data/twitch-vods.json, both kept
// current by .github/workflows/twitch-watch.yml (scripts/watch-twitch.mjs).
//
// Stage, first match wins: live player (click to load, nothing from Twitch
// is embedded before that click), the newest past stream, or "Kein Signal".
// Below it the archive of past streams. Every card is a plain link to
// Twitch in the same tab. Thumbnails load from Twitch's image CDN, which the
// Datenschutz page covers.
import { isLive } from "/js/live.js";
import { brandIcon } from "/js/layout.js";
import { cleanText } from "/js/text.js";

const CHANNEL = "belloflo_ttv";
const CHANNEL_URL = `https://www.twitch.tv/${CHANNEL}`;
const CHAT_URL = `https://www.twitch.tv/popout/${CHANNEL}/chat?popout=`;
const DATA = { status: "/assets/data/live-status.json", vods: "/assets/data/twitch-vods.json" };
const PAGE_SIZE = 9;
// The watcher publishes changes within a few minutes, so a visitor waiting
// on the page sees the stream start without reloading.
const POLL_MS = 60 * 1000;

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor"/></svg>',
};

const $ = (id) => document.getElementById(id);
const els = {
  console: document.querySelector(".tw-console"),
  wave: $("tw-wave"),
  log: $("tw-log"),
  stage: $("tw-stage"),
  archive: $("tw-archive"),
  archiveSub: $("tw-archive-sub"),
  grid: $("tw-grid"),
  more: $("tw-more"),
};

const state = { status: null, vods: [], live: false, shown: 0, playerLoaded: false };

/* ---------- Formatting ---------- */

const numberDE = new Intl.NumberFormat("de-DE");
const relative = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
const dateDE = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function agoText(iso) {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const seconds = (time - Date.now()) / 1000;
  const steps = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "gerade eben";
}

// "3h2m10s" (Helix) to "3:02:10".
function clockText(duration) {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(duration || "");
  if (!m || !duration) return "";
  const [h, min, s] = [m[1], m[2], m[3]].map((x) => Number(x || 0));
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

function sinceText(iso) {
  const start = Date.parse(iso);
  if (!Number.isFinite(start)) return "";
  const minutes = Math.max(1, Math.floor((Date.now() - start) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} Min.`;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

function viewsText(n) {
  if (!Number.isFinite(n)) return "";
  return `${numberDE.format(n)} ${n === 1 ? "Aufruf" : "Aufrufe"}`;
}

function thumbURL(template, w = 640, h = 360) {
  return template ? template.replace("%{width}", w).replace("%{height}", h).replace("{width}", w).replace("{height}", h) : null;
}

/* ---------- Console ---------- */

// Oscilloscope line: two identical 400 wide periods in the 800 wide view
// box, so the CSS loop (slide by half) is seamless. Live: spikes, else flat.
function wavePath(live) {
  let d = "M0 30";
  for (let x = 0; x <= 800; x += 8) {
    const local = x % 400;
    let y = 30;
    if (live) {
      const beat = local % 100;
      if (beat > 40 && beat < 64) y = 30 + Math.sin(((beat - 40) / 24) * Math.PI * 3) * (beat < 52 ? 22 : 12);
      else y = 30 + Math.sin(local / 9) * 2.5;
    } else {
      y = 30 + Math.sin(local / 23) * 1.2;
    }
    d += ` L${x} ${y.toFixed(1)}`;
  }
  return d;
}

function logLine(i, label, value, cls = "") {
  return `<li class="tw-line" style="--i:${i}"><span class="tw-prompt">&gt;</span> ${label}: <b class="${cls}">${value}</b></li>`;
}

function renderConsole() {
  const { status, vods, live } = state;
  els.console.dataset.state = live ? "live" : "offline";
  els.wave.setAttribute("d", wavePath(live));

  const lines = [];
  if (live) {
    lines.push(logLine(0, "Status", "LIVE", "tw-v-live"));
    if (status.game) lines.push(logLine(1, "Spiel", escapeHTML(cleanText(status.game))));
    const since = sinceText(status.startedAt);
    if (since) lines.push(logLine(lines.length, "Live seit", `<span data-live-since>${since}</span>`));
  } else {
    lines.push(logLine(0, "Status", "offline", "tw-v-off"));
    if (vods.length) {
      lines.push(logLine(1, "Letzter Stream", escapeHTML(agoText(vods[0].publishedAt))));
      lines.push(logLine(2, "Zum Nachschauen", `${vods.length} ${vods.length === 1 ? "Stream" : "Streams"}`));
    } else {
      lines.push(logLine(1, "Kanal", CHANNEL));
    }
  }
  els.log.innerHTML = lines.join("").replace(/<\/li>$/, '<span class="cursor"></span></li>');
}

/* ---------- Stage ---------- */

function liveStageHTML(status) {
  const title = cleanText(status.title) || "Live auf Twitch";
  const game = cleanText(status.game);
  // Twitch updates this preview every few minutes; a coarse cache key keeps
  // the browser from showing a stale one.
  const preview = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${CHANNEL}-1280x720.jpg?t=${Math.floor(Date.now() / 300000)}`;
  const since = sinceText(status.startedAt);
  return `
  <div class="tw-live">
    <div class="tw-live-glow" aria-hidden="true"></div>
    <div class="tw-live-frame">
      <div id="tw-player" class="tw-player">
        <img class="tw-player-bg" src="${preview}" alt="" decoding="async" data-tw-img>
        <div class="tw-gate">
          <span class="tw-gate-icon">${brandIcon("twitch")}</span>
          <h2 class="tw-gate-title">Livestream hier ansehen</h2>
          <p class="tw-gate-text">Erst beim Klick wird der Player von Twitch geladen. Dabei gehen Daten wie deine IP Adresse an Twitch und Twitch kann Cookies setzen. Mehr dazu im <a href="/datenschutz/#twitch">Datenschutz</a>.</p>
          <button type="button" class="btn btn-twitch btn-lg" data-load-player>${ICON.play}Player laden</button>
        </div>
      </div>
      <div class="tw-live-info">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2.5">
            <span class="chip chip-live">Live</span>
            ${game ? `<span class="chip chip-dim">${escapeHTML(game)}</span>` : ""}
            ${since ? `<span class="tw-since">seit <span data-live-since>${since}</span></span>` : ""}
          </div>
          <h2 class="tw-stage-title mt-5">${escapeHTML(title)}</h2>
        </div>
        <div class="flex flex-wrap gap-4 lg:shrink-0 lg:flex-nowrap">
          <a class="btn btn-twitch flex-auto sm:flex-none" href="${CHANNEL_URL}">${brandIcon("twitch")}Auf Twitch öffnen</a>
          <a class="btn flex-auto sm:flex-none" href="${CHAT_URL}" target="_blank" rel="noopener">${ICON.chat}Chat öffnen</a>
        </div>
      </div>
    </div>
  </div>`;
}

function thumbHTML(vod, { eager = false } = {}) {
  const src = thumbURL(vod.thumbnail, eager ? 1280 : 640, eager ? 720 : 360);
  const img = src
    ? `<img src="${escapeHTML(src)}" alt="" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" data-tw-img>`
    : "";
  return `${img}<span class="tw-thumb-fallback"${src ? " hidden" : ""}>${brandIcon("twitch")}</span>`;
}

function vodStageHTML(vod) {
  const duration = clockText(vod.duration);
  const date = Date.parse(vod.publishedAt);
  return `
  <article class="panel fx-scan">
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <div class="p-3 sm:p-4">
        <a class="video-thumb tw-feature-thumb" href="${escapeHTML(vod.url)}" tabindex="-1" aria-hidden="true">
          ${thumbHTML(vod, { eager: true })}
          ${duration ? `<span class="video-duration">${duration}</span>` : ""}
          <span class="tw-play">${ICON.play}</span>
        </a>
      </div>
      <div class="flex flex-col px-6 pb-8 pt-4 sm:px-10 sm:pb-10 lg:pt-10">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="chip chip-dim tw-chip-off">Offline</span>
          <span class="chip">Letzter Stream</span>
        </div>
        <h2 class="tw-stage-title mt-6"><a class="tw-title-link" href="${escapeHTML(vod.url)}">${escapeHTML(cleanText(vod.title) || "Stream")}</a></h2>
        <p class="tw-stage-meta mt-5">${[
          Number.isFinite(date) ? dateDE.format(date) : "",
          duration ? `Dauer ${duration}` : "",
          viewsText(vod.viewCount),
        ].filter(Boolean).join(" · ")}</p>
        <div class="mt-auto pt-9">
          <a class="btn btn-twitch btn-lg w-full sm:w-auto" href="${escapeHTML(vod.url)}">${ICON.play}Auf Twitch ansehen</a>
        </div>
      </div>
    </div>
  </article>`;
}

function noSignalHTML() {
  return `
  <div class="panel tw-nosignal">
    <div class="tw-static" aria-hidden="true"></div>
    <div class="relative flex flex-col items-center px-6 py-14 text-center sm:px-12 sm:py-20">
      <span class="tw-nosignal-icon">${brandIcon("twitch")}</span>
      <h2 class="tw-nosignal-title glitch mt-7" data-text="Gerade offline" data-scramble>Gerade offline</h2>
      <p class="mt-6 max-w-lg text-lg leading-relaxed text-ink-muted">Im Moment läuft kein Stream. Folg Belloflo auf Twitch, dann verpasst du den nächsten nicht.</p>
      <div class="mt-10 flex w-full flex-wrap justify-center gap-4">
        <a class="btn btn-twitch btn-lg flex-auto sm:flex-none" href="${CHANNEL_URL}">${brandIcon("twitch")}Auf Twitch folgen</a>
        <a class="btn btn-lg flex-auto sm:flex-none" href="/youtube/">${ICON.screen}Videos ansehen</a>
      </div>
    </div>
  </div>`;
}

function renderStage() {
  const { status, vods, live } = state;
  els.stage.removeAttribute("aria-busy");
  if (live) els.stage.innerHTML = liveStageHTML(status);
  else if (vods.length) els.stage.innerHTML = vodStageHTML(vods[0]);
  else els.stage.innerHTML = noSignalHTML();
  wireImages(els.stage);
}

/* ---------- Archive ---------- */

function vodCardHTML(vod) {
  const duration = clockText(vod.duration);
  const meta = [agoText(vod.publishedAt), viewsText(vod.viewCount)].filter(Boolean).join(" · ");
  return `
  <a class="video-card tw-vod" href="${escapeHTML(vod.url)}">
    <div class="video-thumb">
      ${thumbHTML(vod)}
      ${duration ? `<span class="video-duration">${duration}</span>` : ""}
    </div>
    <div class="tw-vod-body">
      <h3 class="video-title">${escapeHTML(cleanText(vod.title) || "Stream")}</h3>
      <p class="video-meta">${escapeHTML(meta)}</p>
    </div>
  </a>`;
}

function renderArchive() {
  // While offline the newest stream is the stage, so the archive starts at
  // the second one. While live, all of them are past streams.
  const list = state.live ? state.vods : state.vods.slice(1);
  els.archive.hidden = list.length === 0;
  if (!list.length) return;
  const next = list.slice(state.shown, state.shown + PAGE_SIZE);
  els.grid.insertAdjacentHTML("beforeend", next.map(vodCardHTML).join(""));
  state.shown += next.length;
  els.more.hidden = state.shown >= list.length;
  wireImages(els.grid);
}

function resetArchive() {
  state.shown = 0;
  els.grid.innerHTML = "";
  renderArchive();
}

/* ---------- Wiring ---------- */

// Missing or still processing thumbnails fall back to the Twitch glyph.
function wireImages(root) {
  for (const img of root.querySelectorAll("img[data-tw-img]")) {
    img.removeAttribute("data-tw-img");
    const fail = () => {
      img.hidden = true;
      img.nextElementSibling?.removeAttribute("hidden");
    };
    if (img.complete && img.naturalWidth === 0) fail();
    else img.addEventListener("error", fail, { once: true });
  }
}

function loadPlayer() {
  const player = $("tw-player");
  if (!player) return;
  const src = `https://player.twitch.tv/?channel=${CHANNEL}&parent=${encodeURIComponent(location.hostname)}&autoplay=true&muted=false`;
  player.innerHTML = `<iframe src="${src}" title="Twitch Livestream von Belloflo" allow="autoplay; fullscreen"></iframe>`;
  player.classList.add("is-loaded");
  state.playerLoaded = true;
}

els.stage.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-load-player]")) loadPlayer();
});
els.more.addEventListener("click", renderArchive);

// "seit 1 Std. 20 Min." keeps counting.
setInterval(() => {
  if (!state.live) return;
  const since = sinceText(state.status.startedAt);
  for (const el of document.querySelectorAll("[data-live-since]")) el.textContent = since;
}, 30 * 1000);

async function fetchJSON(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function load() {
  const [status, vods] = await Promise.all([fetchJSON(DATA.status), fetchJSON(DATA.vods)]);
  state.status = status || { live: false };
  state.vods = (vods?.videos || []).filter((v) => v && v.url);
  state.live = isLive(state.status);
  renderConsole();
  renderStage();
  resetArchive();
}

async function poll() {
  // A loaded player stays as it is; Twitch shows its own offline screen.
  if (state.playerLoaded || document.hidden) return;
  const status = await fetchJSON(DATA.status);
  if (!status) return;
  const live = isLive(status);
  if (live === state.live && status.title === state.status.title) return;
  const vods = await fetchJSON(DATA.vods);
  state.status = status;
  state.live = live;
  if (vods?.videos) state.vods = vods.videos.filter((v) => v && v.url);
  renderConsole();
  renderStage();
  resetArchive();
}

els.stage.setAttribute("aria-busy", "true");
load();
setInterval(poll, POLL_MS);
