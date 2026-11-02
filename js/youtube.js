// Videos page (/youtube/): the channel panel next to the newest regular
// video, a ticker with the newest titles, then the latest uploads split into
// Videos and Shorts. The data is the channel's public RSS feed
// (scripts/fetch-main-feed.mjs), so it holds only the ~15 most recent
// uploads, already marked `isShort` by that script. Every video is a plain
// link to YouTube in the same tab: no player, no watch page, no modal.
//
// State that is linkable: the active tab lives in the URL hash (#shorts).
// The Videos / Shorts switch is always shown; a tab whose list is empty is
// disabled with the count 0.
//
// Motion comes from js/fx.js (loaded by js/layout.js): it picks up the
// data-scramble, data-count and data-rain markup, also in content this file
// inserts later. Nothing here calls it directly.
import { initReveal } from "/js/reveal.js";
import { cleanText } from "/js/text.js";

const DATA_URL = "/assets/data/main-videos.json";
const CHANNEL_URL = "https://www.youtube.com/@Belloflo";
const ARCHIVE_URL = { videos: `${CHANNEL_URL}/videos`, shorts: `${CHANNEL_URL}/shorts` };
const MODES = ["videos", "shorts"];
// The feed holds about 15 uploads, so one page shows most of a tab.
// 12 fills rows of 1, 2, 3, 4 and 6 columns evenly.
const PAGE_SIZE = 12;
// Newest titles that run through the ticker.
const TICKER_ITEMS = 10;
// Literal class strings so the Tailwind scanner picks them up. Shorts: two
// columns on phones, then fixed width tracks centred, so a handful of
// Shorts doesn't sit in the left half of an empty row.
const GRID_CLASS = {
  videos: "yt-grid grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 lg:gap-y-10",
  shorts: "yt-grid yt-grid--shorts grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fit,minmax(0,11.5rem))] sm:justify-center sm:gap-x-7 sm:gap-y-9",
};
const NOUN = { videos: ["Video", "Videos"], shorts: ["Short", "Shorts"] };

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  youtube:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  alert:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  screen:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M10 9.2v5.6l4.6-2.8z" fill="currentColor"/></svg>',
};

const $ = (id) => document.getElementById(id);
const readoutEl = $("yt-readout");
const statsEl = $("yt-stats");
const captionEl = $("yt-stats-caption");
const featureEl = $("yt-feature");
const tickerEl = $("yt-ticker");
const tickerSkelEl = $("yt-ticker-skel");
const tickerRunEl = $("yt-ticker-run");
const tickerTrackEl = $("yt-ticker-track");
const libraryEl = $("yt-library");
const updatedEl = $("yt-updated");
const libSubEl = $("yt-lib-sub");
const tabbarEl = $("yt-tabbar");
const tabsEl = $("yt-tabs");
const sortEl = $("yt-sort");
const panelEl = $("yt-panel");
const gridEl = $("yt-grid");
const moreBtn = $("yt-more");
const progressEl = $("yt-progress");
const endEl = $("yt-end");
const statusEl = $("yt-status");
const tabs = [...tabsEl.querySelectorAll('[role="tab"]')];
const sortBtns = [...sortEl.querySelectorAll("[data-sort]")];

// Skeleton markup as shipped in the HTML, reused when "Nochmal versuchen"
// starts a fresh load after an error.
const initialFeatureHTML = featureEl.innerHTML;
const initialStatsHTML = statsEl.innerHTML;
const initialCaption = captionEl.textContent;

const state = {
  loaded: false,
  failed: false,
  lists: { videos: [], shorts: [] },
  sorted: new Map(),
  hasViews: false,
  totalViews: 0,
  mode: modeFromHash() || "videos",
  sort: "new",
  shown: 0,
};

/* ---------- Formatting ---------- */

const numberDE = new Intl.NumberFormat("de-DE");
const decimalDE = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const dateShort = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });
const dateLong = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });
const timeDE = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// 584 Aufrufe, 9.613 Aufrufe, 25,1 Tsd. Aufrufe, 410 Tsd. Aufrufe, 1,2 Mio. Aufrufe
function viewsText(n) {
  if (n === 1) return "1 Aufruf";
  if (n < 10_000) return `${numberDE.format(n)} Aufrufe`;
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${n < 100_000 ? decimalDE.format(Math.floor(k * 10) / 10) : numberDE.format(Math.floor(k))} Tsd. Aufrufe`;
  }
  return `${decimalDE.format(Math.floor(n / 100_000) / 10)} Mio. Aufrufe`;
}

// Stats in the readout have little room: 10.560, then 123 Tsd., 1,2 Mio.
function compactNumber(n) {
  if (n < 100_000) return numberDE.format(n);
  if (n < 1_000_000) return `${numberDE.format(Math.floor(n / 1000))} Tsd.`;
  return `${decimalDE.format(Math.floor(n / 100_000) / 10)} Mio.`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function daysAgo(d) {
  return Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
}

// Heute, Gestern, vor 3 Tagen, vor 2 Wochen, then 4. Okt. 2026
function dateText(ms) {
  const d = new Date(ms);
  const days = daysAgo(d);
  if (days < 0) return dateShort.format(d);
  if (days === 0) return "Heute";
  if (days === 1) return "Gestern";
  if (days < 7) return `vor ${days} Tagen`;
  if (days < 28) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? "vor einer Woche" : `vor ${weeks} Wochen`;
  }
  return dateShort.format(d);
}

// When the list was refreshed: Stand: heute, 16:36 / gestern, 08:10 /
// 30. Okt. 2026 (short, it has to fit one line on a 320px phone).
function updatedText(ms) {
  const d = new Date(ms);
  const days = daysAgo(d);
  if (days === 0) return `Stand: heute, ${timeDE.format(d)}`;
  if (days === 1) return `Stand: gestern, ${timeDE.format(d)}`;
  return `Stand: ${dateShort.format(d)}`;
}

// Direct children of .yt-meta get a middle dot between them (page CSS).
function metaHTML(v) {
  const parts = [];
  if (v.views != null) parts.push(`<span title="${numberDE.format(v.views)} ${v.views === 1 ? "Aufruf" : "Aufrufe"}">${viewsText(v.views)}</span>`);
  if (v.published != null) {
    const d = new Date(v.published);
    parts.push(`<time datetime="${d.toISOString()}" title="${dateLong.format(d)}">${dateText(v.published)}</time>`);
  }
  return parts.join("");
}

/* ---------- Data ---------- */

const ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

function toCount(value) {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function fallbackThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function normalize(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
  const published = Date.parse(raw.publishedAt);
  return {
    id: raw.id,
    title: cleanText(raw.title) || "Video",
    published: Number.isFinite(published) ? published : null,
    views: toCount(raw.views),
    isShort: raw.isShort === true,
    thumb: typeof raw.thumbnail === "string" && raw.thumbnail.startsWith("https://") ? raw.thumbnail : fallbackThumb(raw.id),
  };
}

function watchUrl(v) {
  return v.isShort ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`;
}

function hasItems(mode) {
  return state.lists[mode].length > 0;
}

function uploadsTotal() {
  return state.lists.videos.length + state.lists.shorts.length;
}

function sortedList() {
  const key = `${state.mode}:${state.sort}`;
  if (!state.sorted.has(key)) {
    const base = state.lists[state.mode];
    const list = state.sort === "views" ? [...base].sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.published ?? 0) - (a.published ?? 0)) : base;
    state.sorted.set(key, list);
  }
  return state.sorted.get(key);
}

/* ---------- Markup ---------- */

function channelButton() {
  return `<a class="btn btn-yt" href="${CHANNEL_URL}">${ICON.youtube}Zum Kanal</a>`;
}

// In the hero the notice fills the column next to the channel panel; in the
// grid it is a smaller centred panel.
function noticeHTML({ icon, heading = "h3", title, text, actions = "", hero = false }) {
  const box = hero ? "h-full justify-center" : "mx-auto max-w-xl";
  return `
    <div class="panel ${box} flex flex-col items-center px-6 py-12 text-center sm:px-12 sm:py-14">
      <span class="yt-notice-icon">${icon}</span>
      <${heading} class="mt-7 text-2xl uppercase sm:text-3xl">${title}</${heading}>
      <p class="mt-4 max-w-sm leading-[1.75] text-ink-muted">${text}</p>
      ${actions ? `<div class="mt-9 flex flex-wrap justify-center gap-4">${actions}</div>` : ""}
    </div>`;
}

// `step` staggers the entrance of a freshly rendered page of cards.
function cardHTML(v, index, step) {
  const meta = metaHTML(v);
  // Top three of "Meistgesehen" get a place chip.
  const rank =
    state.sort === "views" && index < 3 && v.views != null
      ? `<span class="chip${index === 0 ? "" : " chip-cyan"} yt-rank">Platz ${index + 1}</span>`
      : "";
  return `
    <li class="reveal" style="--i:${Math.min(step, 8)}">
      <a class="video-card" href="${watchUrl(v)}">
        <div class="video-thumb${v.isShort ? " video-thumb--short" : ""}">
          <img src="${esc(v.thumb)}" data-fallback="${fallbackThumb(v.id)}" data-min-width="121" alt="" width="480" height="360" loading="lazy" decoding="async">
          ${rank}
        </div>
        <div class="video-title" title="${esc(v.title)}">${esc(v.title)}</div>
        ${meta ? `<div class="video-meta yt-meta">${meta}</div>` : ""}
      </a>
    </li>`;
}

function skeletonHTML(mode) {
  const thumb = mode === "shorts" ? "aspect-[9/16]" : "aspect-video";
  return Array.from(
    { length: 6 },
    () =>
      `<li class="video-card" aria-hidden="true"><div class="skeleton ${thumb}"></div><div class="skeleton mx-2 h-4 w-11/12"></div><div class="skeleton mx-2 h-4 w-3/5"></div><div class="skeleton mx-2 h-3 w-2/5"></div></li>`
  ).join("");
}

function endHTML(mode, count) {
  const noun = NOUN[mode];
  const recent = uploadsTotal() === 1 ? "den letzten Upload" : `die letzten ${numberDE.format(uploadsTotal())} Uploads`;
  return `
    <div class="panel mx-auto mt-10 flex max-w-3xl flex-col items-center gap-8 px-6 py-10 text-center sm:flex-row sm:gap-10 sm:px-10 sm:py-11 sm:text-left">
      <span class="hazard" aria-hidden="true"></span>
      <div class="flex-1">
        <span class="term">${numberDE.format(count)} von ${numberDE.format(count)} ${noun[count === 1 ? 0 : 1]}</span>
        <h3 class="mt-3 text-2xl uppercase">Mehr gibt es auf dem Kanal</h3>
        <p class="mt-3 leading-[1.75] text-ink-muted">Hier siehst du immer ${recent}. Ältere ${noun[1]} warten direkt auf YouTube.</p>
      </div>
      <a class="btn btn-yt shrink-0" href="${ARCHIVE_URL[mode]}">${ICON.youtube}Alle ${noun[1]}</a>
    </div>`;
}

/* ---------- Rendering ---------- */

// Plain numbers count up (js/fx.js, data-count); the width is reserved so
// the tiles don't jump while the digits grow.
function statHTML(n, label) {
  const text = compactNumber(n);
  const count = n < 100_000 ? ` data-count style="min-width:${text.length}ch"` : "";
  return `<li class="yt-stat" title="${numberDE.format(n)} ${label}"><span class="yt-stat-num"${count}>${text}</span><span class="yt-stat-label">${label}</span></li>`;
}

function renderStats() {
  const items = MODES.map((mode) => {
    const n = state.lists[mode].length;
    return statHTML(n, NOUN[mode][n === 1 ? 0 : 1]);
  });
  if (state.hasViews) items.push(statHTML(state.totalViews, state.totalViews === 1 ? "Aufruf" : "Aufrufe"));
  statsEl.innerHTML = items.join("");
  const total = uploadsTotal();
  const recent = total === 1 ? "Der letzte Upload" : `Die letzten ${numberDE.format(total)} Uploads`;
  captionEl.textContent = recent;
  libSubEl.textContent = `${recent} vom Kanal. Ein Klick und du schaust direkt auf YouTube.`;
  readoutEl.hidden = false;
}

function renderUpdated(ms) {
  updatedEl.hidden = ms == null;
  if (ms != null) updatedEl.textContent = updatedText(ms);
}

function renderCounts() {
  for (const el of tabsEl.querySelectorAll("[data-tab-count]")) {
    el.textContent = numberDE.format(state.lists[el.dataset.tabCount].length);
  }
}

// The newest uploads as a data stream. The track holds the items twice, so
// the CSS loop (fx-ticker) can run endlessly.
function renderTicker(all) {
  const items = all
    .slice(0, TICKER_ITEMS)
    .map(
      (v) =>
        `<span class="yt-tick"><span class="yt-tick-type">${NOUN[v.isShort ? "shorts" : "videos"][0]}</span>${esc(v.title)}${
          v.views != null ? `<span class="yt-tick-meta">${viewsText(v.views)}</span>` : ""
        }</span>`
    )
    .join("");
  tickerTrackEl.innerHTML = `<div class="yt-tick-group">${items}</div><div class="yt-tick-group">${items}</div>`;
  tickerSkelEl.hidden = true;
  tickerRunEl.hidden = false;
  // About 55 pixels per second, however long the titles are.
  const width = tickerTrackEl.firstElementChild.offsetWidth;
  tickerTrackEl.style.setProperty("--ticker-speed", `${Math.max(20, Math.round(width / 55))}s`);
  tickerEl.hidden = false;
}

function renderFeature() {
  // Newest regular video; only if there is none, the newest Short.
  const v = state.lists.videos[0] || state.lists.shorts[0];
  const url = watchUrl(v);
  const meta = metaHTML(v);
  // maxresdefault is sharper but missing on some uploads; the image handlers
  // below fall back to the feed's own thumbnail (see data-min-width).
  const src = v.isShort ? v.thumb : `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg`;
  featureEl.innerHTML = `
    <article class="panel panel-glow fx-scan flex h-full flex-col">
      <div class="p-4 sm:p-5">
        <div class="hud-corners">
          <a class="video-thumb yt-feature-thumb" href="${url}" tabindex="-1" aria-hidden="true">
            <img src="${esc(src)}" data-fallback="${esc(v.thumb)}" data-min-width="121" alt="" width="1280" height="720" fetchpriority="high" decoding="async">
            <span class="yt-play">${ICON.play}</span>
          </a>
        </div>
      </div>
      <div class="flex flex-1 flex-col items-start px-6 pb-8 pt-5 sm:px-9 sm:pb-10">
        <span class="chip">${v.isShort ? "Neuestes Short" : "Neuestes Video"}</span>
        <h2 class="yt-feature-title mt-5"><a href="${url}" tabindex="-1">${esc(v.title)}</a></h2>
        <div class="mt-auto w-full pt-9">
          <hr class="divider-neon">
          <div class="mt-7 flex flex-col-reverse gap-5 sm:flex-row sm:items-center sm:justify-between">
            <a class="btn btn-red w-full max-[359px]:px-4 max-[359px]:text-[0.86rem] sm:w-auto" href="${url}">${ICON.play}Auf YouTube ansehen</a>
            ${meta ? `<span class="yt-meta font-mono text-[0.8rem] text-ink-muted">${meta}</span>` : ""}
          </div>
        </div>
      </div>
    </article>`;
  featureEl.removeAttribute("aria-busy");
}

function syncSort() {
  sortEl.hidden = !state.hasViews;
  if (!state.hasViews) state.sort = "new";
  for (const btn of sortBtns) btn.setAttribute("aria-pressed", String(btn.dataset.sort === state.sort));
}

// Before the data is there both tabs work (they only switch the skeleton);
// after that a tab without uploads is disabled.
function syncTabs() {
  for (const tab of tabs) tab.disabled = state.loaded && !hasItems(tab.dataset.mode);
}

// The red block of the active tab slides to the new tab (page CSS).
function placeInk() {
  const active = tabs.find((tab) => tab.dataset.mode === state.mode);
  if (!active || !active.offsetWidth) return;
  tabsEl.style.setProperty("--ink-x", `${active.offsetLeft}px`);
  tabsEl.style.setProperty("--ink-w", `${active.offsetWidth}px`);
  if (!tabsEl.classList.contains("has-ink")) {
    tabsEl.classList.add("has-ink");
    // Only animate moves after the first placement.
    requestAnimationFrame(() => requestAnimationFrame(() => tabsEl.classList.add("ink-ready")));
  }
}

function showGridSkeleton() {
  gridEl.className = GRID_CLASS[state.mode];
  gridEl.setAttribute("aria-busy", "true");
  gridEl.innerHTML = skeletonHTML(state.mode);
  moreBtn.hidden = true;
  progressEl.hidden = true;
  endEl.hidden = true;
}

function renderGrid() {
  const list = sortedList();
  gridEl.className = GRID_CLASS[state.mode];
  gridEl.removeAttribute("aria-busy");
  gridEl.innerHTML = "";
  state.shown = 0;
  if (!list.length) {
    const noun = NOUN[state.mode][1];
    gridEl.innerHTML = `<li class="col-span-full">${noticeHTML({
      icon: ICON.screen,
      title: `Noch keine ${noun}`,
      text: `Unter den neuesten Uploads sind gerade keine ${noun}. Schau bald wieder vorbei oder direkt auf dem Kanal.`,
      actions: channelButton(),
    })}</li>`;
    updateMore(list);
    return;
  }
  appendPage(list);
}

// Appends the next page of cards and returns the first new card link.
function appendPage(list) {
  const start = state.shown;
  const slice = list.slice(start, start + PAGE_SIZE);
  gridEl.insertAdjacentHTML("beforeend", slice.map((v, i) => cardHTML(v, start + i, i)).join(""));
  state.shown = start + slice.length;
  initReveal(gridEl);
  updateMore(list);
  return gridEl.children[start]?.querySelector("a") || null;
}

// "Mehr laden" while cards are left, then the end of list panel that points
// to the full archive on YouTube (the feed only has the newest uploads).
function updateMore(list) {
  const left = list.length - state.shown;
  moreBtn.hidden = left <= 0;
  progressEl.hidden = left <= 0;
  progressEl.textContent = `${numberDE.format(state.shown)} von ${numberDE.format(list.length)} ${NOUN[state.mode][1]}`;
  const showEnd = left <= 0 && list.length > 0;
  if (showEnd && endEl.dataset.mode !== state.mode) {
    endEl.innerHTML = endHTML(state.mode, list.length);
    endEl.dataset.mode = state.mode;
  }
  endEl.hidden = !showEnd;
}

function showNotice(notice) {
  featureEl.removeAttribute("aria-busy");
  featureEl.innerHTML = noticeHTML({ heading: "h2", hero: true, ...notice });
  readoutEl.hidden = true;
  tickerEl.hidden = true;
  libraryEl.hidden = true;
  syncStuck();
}

function showError() {
  showNotice({
    icon: ICON.alert,
    title: "Gerade hakt es",
    text: "Die Videoliste konnte nicht geladen werden. Versuch es gleich nochmal oder schau direkt auf YouTube vorbei.",
    actions: `<button type="button" class="btn btn-red" data-yt-retry>${ICON.refresh}Nochmal versuchen</button>${channelButton()}`,
  });
}

function showEmptyChannel() {
  showNotice({
    icon: ICON.screen,
    title: "Noch keine Videos",
    text: "Hier ist gerade noch nichts zu sehen. Auf dem Kanal findest du alles Neue zuerst.",
    actions: channelButton(),
  });
}

/* ---------- Sticky switch (phones) ---------- */

// On phones the switch sticks under the header (page CSS) and gets the
// header's glass background while it is stuck.
const phoneMQ = matchMedia("(max-width: 639.98px)");

function isStuck() {
  if (!phoneMQ.matches || libraryEl.hidden) return false;
  const top = parseFloat(getComputedStyle(tabbarEl).top);
  return Number.isFinite(top) && tabbarEl.getBoundingClientRect().top <= top + 0.5;
}

function syncStuck() {
  tabbarEl.classList.toggle("is-stuck", isStuck());
}

let stuckFrame = 0;
function queueStuck() {
  if (!stuckFrame) stuckFrame = requestAnimationFrame(() => {
    stuckFrame = 0;
    syncStuck();
  });
}
window.addEventListener("scroll", queueStuck, { passive: true });
window.addEventListener("resize", queueStuck, { passive: true });

// Switching tabs while the switch is stuck: start the new list right under
// it instead of somewhere in the middle (or the footer, if the new list is
// shorter).
function keepListInView() {
  if (!isStuck()) return;
  const top = panelEl.getBoundingClientRect().top + window.scrollY - tabbarEl.getBoundingClientRect().bottom - 16;
  window.scrollTo({ top, behavior: "instant" });
}

/* ---------- Tabs, sort, hash ---------- */

function modeFromHash() {
  const hash = location.hash.toLowerCase();
  return hash === "#shorts" ? "shorts" : hash === "#videos" ? "videos" : null;
}

// Shorts get #shorts, Videos the clean URL. Other hashes (like the skip
// link's #main) are only replaced when the user actually switches tabs.
function syncHash() {
  const current = modeFromHash();
  const base = `${location.pathname}${location.search}`;
  if (state.mode === "shorts" && current !== "shorts") history.replaceState(history.state, "", `${base}#shorts`);
  else if (state.mode === "videos" && current === "shorts") history.replaceState(history.state, "", base);
}

function setMode(mode, { syncUrl = true, focusTab = false, render = true } = {}) {
  state.mode = mode;
  syncTabs();
  for (const tab of tabs) {
    const active = tab.dataset.mode === mode;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focusTab) tab.focus();
  }
  panelEl.setAttribute("aria-labelledby", `yt-tab-${mode}`);
  placeInk();
  if (syncUrl) syncHash();
  if (!render) return;
  if (state.loaded) renderGrid();
  else if (!state.failed) showGridSkeleton();
}

function switchTo(mode, options) {
  setMode(mode, options);
  keepListInView();
}

function scrollToLibrary() {
  if (!libraryEl.hidden) libraryEl.scrollIntoView({ block: "start" });
}

tabsEl.addEventListener("click", (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (tab && !tab.disabled && tab.dataset.mode !== state.mode) switchTo(tab.dataset.mode);
});

// Arrow keys move between the enabled tabs (WAI-ARIA tabs pattern).
tabsEl.addEventListener("keydown", (event) => {
  const usable = tabs.filter((tab) => !tab.disabled);
  const index = usable.indexOf(document.activeElement);
  if (index === -1) return;
  let next = null;
  if (event.key === "ArrowRight") next = usable[(index + 1) % usable.length];
  else if (event.key === "ArrowLeft") next = usable[(index - 1 + usable.length) % usable.length];
  else if (event.key === "Home") next = usable[0];
  else if (event.key === "End") next = usable[usable.length - 1];
  if (!next) return;
  event.preventDefault();
  if (next.dataset.mode !== state.mode) switchTo(next.dataset.mode, { focusTab: true });
  else next.focus();
});

// Tab widths change when the counts arrive and when the fonts load.
new ResizeObserver(() => placeInk()).observe(tabsEl);
for (const tab of tabs) new ResizeObserver(() => placeInk()).observe(tab);

sortEl.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-sort]");
  if (!btn || btn.dataset.sort === state.sort) return;
  state.sort = btn.dataset.sort;
  syncSort();
  if (state.loaded) renderGrid();
});

moreBtn.addEventListener("click", () => {
  const list = sortedList();
  const before = state.shown;
  const firstNew = appendPage(list);
  const added = state.shown - before;
  const noun = NOUN[state.mode];
  statusEl.textContent = `${added === 1 ? `1 weiteres ${noun[0]}` : `${added} weitere ${noun[1]}`} geladen, ${state.shown} von ${list.length}.`;
  // Keyboard users continue at the first new card instead of losing focus
  // when the button disappears after the last page.
  firstNew?.focus({ preventScroll: true });
});

window.addEventListener("hashchange", () => {
  const mode = modeFromHash();
  if (!mode) return;
  // #shorts while there are no Shorts: stay on Videos and clean the URL.
  if (state.loaded && !hasItems(mode)) syncHash();
  else if (mode !== state.mode) setMode(mode, { syncUrl: false });
  scrollToLibrary();
});

featureEl.addEventListener("click", (event) => {
  if (!event.target.closest("[data-yt-retry]")) return;
  featureEl.innerHTML = initialFeatureHTML;
  featureEl.setAttribute("aria-busy", "true");
  featureEl.focus({ preventScroll: true }); // the clicked button is gone now
  statsEl.innerHTML = initialStatsHTML;
  captionEl.textContent = initialCaption;
  readoutEl.hidden = false;
  tickerEl.hidden = false;
  libraryEl.hidden = false;
  state.failed = false;
  setMode(state.mode, { syncUrl: false });
  load();
});

/* ---------- Thumbnails ---------- */

// Missing thumbnails: YouTube answers either with an error or with a tiny
// 120px grey placeholder. Swap to the fallback once, then show an empty frame.
function useFallback(img) {
  const fallback = img.dataset.fallback;
  delete img.dataset.fallback;
  if (fallback && img.getAttribute("src") !== fallback) {
    img.src = fallback; // still size checked on load, see onThumbLoad
  } else {
    delete img.dataset.minWidth;
    img.closest(".video-thumb")?.classList.add("yt-thumb-broken");
  }
}
function onThumbLoad(event) {
  const img = event.target;
  if (img instanceof HTMLImageElement && img.dataset.minWidth && img.naturalWidth < Number(img.dataset.minWidth)) useFallback(img);
}
function onThumbError(event) {
  const img = event.target;
  if (img instanceof HTMLImageElement) useFallback(img);
}
for (const root of [featureEl, gridEl]) {
  root.addEventListener("load", onThumbLoad, true);
  root.addEventListener("error", onThumbError, true);
}

/* ---------- Boot ---------- */

let scrolledForHash = false;

async function load() {
  let all;
  let updated = null;
  try {
    const res = await fetch(DATA_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw = Array.isArray(data?.videos) ? data.videos : Array.isArray(data) ? data : null;
    if (!raw) throw new Error("unexpected data format");
    const stamp = Date.parse(data?.updatedAt);
    if (Number.isFinite(stamp)) updated = stamp;
    const seen = new Set();
    all = raw
      .map(normalize)
      .filter((v) => v && !seen.has(v.id) && seen.add(v.id))
      .sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
  } catch (err) {
    console.warn("[youtube] Could not load the video list:", err);
    state.failed = true;
    showError();
    return;
  }

  state.lists = { videos: all.filter((v) => !v.isShort), shorts: all.filter((v) => v.isShort) };
  state.sorted.clear();
  const views = all.map((v) => v.views).filter((n) => n != null);
  state.hasViews = new Set(views).size > 1;
  state.totalViews = views.reduce((sum, n) => sum + n, 0);
  state.loaded = true;

  if (!all.length) {
    showEmptyChannel();
    return;
  }

  // Stay on the requested tab if it has uploads, otherwise the first one
  // that does (this also drops a #shorts hash when there are no Shorts).
  setMode(hasItems(state.mode) ? state.mode : MODES.find(hasItems), { render: false });
  renderStats();
  renderUpdated(updated);
  renderCounts();
  renderFeature();
  renderTicker(all);
  syncSort();
  renderGrid();

  // Arriving via /youtube/#shorts: jump to the library once it exists.
  if (!scrolledForHash && state.mode === "shorts" && modeFromHash() === "shorts" && window.scrollY < 40) scrollToLibrary();
  scrolledForHash = true;
}

setMode(state.mode, { syncUrl: false });
load();
