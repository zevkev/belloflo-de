// Netrunner motion primitives, loaded on every page by js/layout.js.
// Markup opts in, and content that page scripts insert later is picked up
// too (MutationObserver), so pages never call anything here directly.
//
//   data-scramble          text decodes from hex glyphs when it scrolls in
//   data-count             a number ("1.234") counts up from 0 when visible
//   canvas[data-rain]      falling streaks of light inside its parent
//
// The CSS only effects (.fx-scan, .fx-ticker, .fx-flicker) live in
// src/app.css. Everything here is skipped with prefers-reduced-motion.
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const GLYPHS = "0123456789ABCDEF#$%&*+<>/\\=";
const numberDE = new Intl.NumberFormat("de-DE");

const seen = new WeakSet();
let io;

function onVisible(el, run, threshold = 0.35) {
  io ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        entry.target.__fxRun?.();
      }
    },
    { threshold }
  );
  el.__fxRun = run;
  io.observe(el);
}

// ---------- Scramble ----------
function textNodes(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push(walker.currentNode);
  return nodes;
}

function scramble(el) {
  const nodes = textNodes(el).map((node) => ({ node, text: node.nodeValue }));
  if (!nodes.length) return;
  const total = nodes.reduce((n, x) => n + x.text.length, 0);
  const duration = Math.min(900, 380 + total * 18);
  // Lock the height so a different glyph width never rewraps the block.
  const lock = el.style.minHeight;
  el.style.minHeight = `${el.offsetHeight}px`;
  el.classList.add("is-scrambling");
  const start = performance.now();

  const frame = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    let offset = 0;
    for (const { node, text } of nodes) {
      let out = "";
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const resolved = (offset + i) / total < progress;
        out += resolved || ch === " " || ch === "\n" ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      node.nodeValue = out;
      offset += text.length;
    }
    if (progress < 1) {
      requestAnimationFrame(frame);
    } else {
      for (const { node, text } of nodes) node.nodeValue = text;
      el.style.minHeight = lock;
      el.classList.remove("is-scrambling");
    }
  };
  requestAnimationFrame(frame);
}

// ---------- Count up ----------
function countUp(el) {
  const target = Number(el.textContent.replace(/\D/g, ""));
  if (!Number.isFinite(target) || target <= 0) return;
  const suffix = el.textContent.replace(/^[\d.\s]+/, "");
  const duration = 1100;
  const start = performance.now();
  const frame = (now) => {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = numberDE.format(Math.round(target * eased)) + suffix;
    if (p < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------- Data rain ----------
// Falling streaks of light (no characters: visible text on this site is
// always real information).
function rain(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const GAP = 18;
  let width = 0;
  let height = 0;
  let drops = [];
  let running = false;
  let visible = false;
  let last = 0;
  let colors = ["#ff2a55", "#2de2e6"];

  const readColors = () => {
    const css = getComputedStyle(document.documentElement);
    colors = [css.getPropertyValue("--red").trim() || colors[0], css.getPropertyValue("--cyan").trim() || colors[1]];
  };

  const drop = (spread) => ({
    y: Math.random() * spread,
    speed: 2.5 + Math.random() * 5,
    len: 6 + Math.random() * 18,
    w: Math.random() > 0.8 ? 2 : 1,
  });

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drops = Array.from({ length: Math.ceil(width / GAP) }, () => drop(-height));
  };

  const step = (now) => {
    if (!running) return;
    requestAnimationFrame(step);
    if (now - last < 33) return; // about 30 fps
    last = now;
    // Fade what is there instead of clearing, which leaves the trails.
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgb(0 0 0 / 0.16)";
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      ctx.fillStyle = colors[i % 4 === 0 ? 1 : 0];
      ctx.fillRect(i * GAP + GAP / 2, d.y, d.w, d.len);
      d.y += d.speed;
      if (d.y > height) drops[i] = drop(-height * 0.6);
    }
  };

  const sync = () => {
    const should = visible && !document.hidden;
    if (should === running) return;
    running = should;
    if (running) requestAnimationFrame(step);
  };

  readColors();
  resize();
  new ResizeObserver(resize).observe(canvas);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }).observe(canvas);
  document.addEventListener("visibilitychange", sync);
}

// ---------- Wiring ----------
function scan(root) {
  if (root.nodeType !== 1) return;
  const pick = (sel) => [...(root.matches?.(sel) ? [root] : []), ...root.querySelectorAll(sel)];
  for (const el of pick("[data-scramble]")) {
    if (seen.has(el)) continue;
    seen.add(el);
    onVisible(el, () => scramble(el), 0.6);
  }
  for (const el of pick("[data-count]")) {
    if (seen.has(el)) continue;
    seen.add(el);
    onVisible(el, () => countUp(el), 0.6);
  }
  for (const el of pick("canvas[data-rain]")) {
    if (seen.has(el)) continue;
    seen.add(el);
    rain(el);
  }
}

export function initFx() {
  if (reduced) return;
  scan(document.body);
  new MutationObserver((records) => {
    for (const r of records) for (const node of r.addedNodes) scan(node);
  }).observe(document.body, { childList: true, subtree: true });
}
