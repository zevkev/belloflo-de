// Homepage: the newest upload, the live Discord numbers and the "Kopieren"
// button of the invite.
//
// Everything comes from this site's own JSON files (refreshed by GitHub
// Actions), so a visit never contacts YouTube or Discord, apart from the
// video thumbnails, which load from YouTube's image servers (ytimg.com).
// If a file can't be loaded, its part quietly disappears: no video means
// the whole "Neuestes Video" section hides, no Discord numbers means the
// numbers line stays hidden.
import { cleanText } from "/js/text.js";
import { initReveal } from "/js/reveal.js";

const numberDE = new Intl.NumberFormat("de-DE");
const decimalDE = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const dateShort = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });
const dateLong = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

const ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ---------- Neuestes Video ---------- */

// Same wording as the Videos page: 584 Aufrufe, 25,1 Tsd. Aufrufe, 1,2 Mio. Aufrufe
function viewsText(n) {
  if (n === 1) return "1 Aufruf";
  if (n < 10_000) return `${numberDE.format(n)} Aufrufe`;
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${n < 100_000 ? decimalDE.format(Math.floor(k * 10) / 10) : numberDE.format(Math.floor(k))} Tsd. Aufrufe`;
  }
  return `${decimalDE.format(Math.floor(n / 100_000) / 10)} Mio. Aufrufe`;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Heute, Gestern, vor 3 Tagen, vor 2 Wochen, then 4. Okt. 2026
function dateText(ms) {
  const d = new Date(ms);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
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

function metaHTML(v) {
  const parts = [];
  if (v.views != null) parts.push(`<span>${viewsText(v.views)}</span>`);
  if (v.published != null) {
    const d = new Date(v.published);
    parts.push(`<time datetime="${d.toISOString()}" title="${dateLong.format(d)}">${dateText(v.published)}</time>`);
  }
  return parts.join("");
}

// The newest upload as one featured card. Same tab on purpose: videos open
// on YouTube instead of an embedded player. The picture repeats the title
// link, so it is skipped by keyboard and screen readers.
function featureHTML(v) {
  const meta = metaHTML(v);
  const url = watchUrl(v);
  return `
    <article class="panel panel-glow feature reveal" aria-labelledby="feature-title">
      <div class="feature-grid">
        <a class="hud-corners feature-thumb" href="${url}" tabindex="-1" aria-hidden="true">
          <div class="video-thumb">
            <img src="${esc(v.thumb)}" data-fallback="${fallbackThumb(v.id)}" alt="" width="480" height="360" decoding="async">
          </div>
        </a>
        <div class="feature-body">
          ${v.isShort ? '<span class="chip chip-cyan feature-chip">Short</span>' : ""}
          <h3 id="feature-title" class="feature-title"><a href="${url}" title="${esc(v.title)}">${esc(v.title)}</a></h3>
          ${meta ? `<p class="feature-meta">${meta}</p>` : ""}
          <div class="feature-actions">
            <a class="btn btn-yt" href="${url}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>Jetzt ansehen</a>
            <a class="btn" href="/youtube/">Alle Videos<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
          </div>
        </div>
      </div>
    </article>`;
}

// A missing thumbnail comes back as an error or as YouTube's 120px grey
// placeholder. Swap to the standard thumbnail once, then leave the dark frame.
function useFallback(img) {
  const fallback = img.dataset.fallback;
  delete img.dataset.fallback;
  if (fallback && img.getAttribute("src") !== fallback) img.src = fallback;
  else img.style.visibility = "hidden";
}

function watchThumbs(root) {
  root.addEventListener(
    "load",
    (ev) => {
      const img = ev.target;
      if (img instanceof HTMLImageElement && img.naturalWidth > 0 && img.naturalWidth < 121) useFallback(img);
    },
    true
  );
  root.addEventListener(
    "error",
    (ev) => {
      if (ev.target instanceof HTMLImageElement) useFallback(ev.target);
    },
    true
  );
}

async function loadLatestVideo() {
  const section = document.getElementById("video");
  const slot = document.getElementById("latest-video");
  if (!section || !slot) return;
  try {
    const res = await fetch("/assets/data/main-videos.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw = Array.isArray(data) ? data : data?.videos;
    const newest = (Array.isArray(raw) ? raw : [])
      .map(normalize)
      .filter(Boolean)
      .sort((a, b) => (b.published ?? 0) - (a.published ?? 0))[0];
    if (!newest) throw new Error("kein Video");
    watchThumbs(slot);
    slot.innerHTML = featureHTML(newest);
    slot.removeAttribute("aria-busy");
    initReveal(slot);
  } catch {
    section.hidden = true;
  }
}

/* ---------- Discord ---------- */

async function loadDiscordStats() {
  const stats = document.getElementById("dc-stats");
  if (!stats) return;
  try {
    const res = await fetch("/assets/data/discord.json", { cache: "no-cache" });
    if (!res.ok) return;
    const data = await res.json();
    const members = toCount(data?.members);
    if (!members) return;
    document.getElementById("dc-members").textContent = numberDE.format(members);
    const online = toCount(data.online);
    const onlineEl = document.getElementById("dc-online");
    if (online != null) onlineEl.textContent = numberDE.format(online);
    else onlineEl.parentElement.hidden = true;
    stats.hidden = false;
  } catch {}
}

// Clipboard API first, then the old execCommand way (older browsers, pages
// without permission). Returns whether the text really landed somewhere.
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

// If copying fails, the link itself is shown (one tap selects all of it),
// so it can be copied by hand.
function initInviteCopy() {
  const btn = document.getElementById("discord-copy");
  const out = document.getElementById("discord-copy-ok");
  if (!btn || !out) return;
  const label = btn.querySelector(".dc-copy-label");
  let resetTimer;

  btn.addEventListener("click", async () => {
    const invite = btn.dataset.invite;
    clearTimeout(resetTimer);
    const ok = await copyText(invite);
    btn.focus({ preventScroll: true });
    if (ok) {
      out.classList.remove("is-link");
      out.textContent = "Einladung kopiert. Schick sie weiter!";
      btn.classList.add("is-copied");
      if (label) label.textContent = "Kopiert";
      resetTimer = setTimeout(() => {
        btn.classList.remove("is-copied");
        if (label) label.textContent = "Kopieren";
        out.textContent = "";
      }, 3000);
    } else {
      btn.classList.remove("is-copied");
      if (label) label.textContent = "Kopieren";
      out.classList.add("is-link");
      out.textContent = "Kopieren ging nicht. Hier ist der Link: ";
      const link = document.createElement("span");
      link.className = "dc-manual";
      link.textContent = invite;
      out.appendChild(link);
    }
  });
}

loadLatestVideo();
loadDiscordStats();
initInviteCopy();
