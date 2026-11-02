// Shared scroll-reveal: adds .is-visible to .reveal elements as they enter
// the viewport (see .reveal in src/app.css: opacity snaps, only transform
// animates). js/layout.js runs it once on load.
//
// Exported (not just run once like the old inline version) specifically so
// a page can call it again after rendering NEW .reveal elements -- a filter
// switch, a sort change, "load more", a fresh product page -- since a
// one-time scan at module-load time only ever catches whatever already
// existed in the DOM at that exact moment. Safe to call repeatedly: already
// -revealed elements are excluded by the :not(.is-visible) selector, and
// re-observing an element that's still pending its first reveal is
// harmless (whichever observer instance sees it first adds the class and
// unobserves itself; a second one doing the same afterwards is a no-op).
export function initReveal(root = document) {
  const items = root.querySelectorAll(".reveal:not(.is-visible)");
  if (!items.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    items.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    },
    // threshold 0 plus a bottom margin, not a ratio: a ratio can never be
    // reached by elements much taller than the viewport.
    { threshold: 0, rootMargin: "0px 0px -10% 0px" }
  );
  items.forEach((el) => io.observe(el));
}
