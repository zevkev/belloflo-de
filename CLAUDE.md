# Belloflo Website (belloflo.de)

Read this first, then only the files a task touches.

## What this is

Static site for Belloflo (YouTube `@Belloflo`, Twitch `belloflo_ttv`, member
of the Medienspeicher team with ZevKev and Jamon). Repo
`github.com/zevkev/belloflo-de`, built and run by Kevin Kliver (ZevKev),
hosted on **GitHub Pages** (custom domain belloflo.de, DNS at Namecheap:
four GitHub A records on `@`, `www` CNAME to `zevkev.github.io`, nothing
else). No server, no backend: plain HTML + ES modules, Tailwind CSS v4
compiled in CI, data JSON refreshed by GitHub Actions.

Built 2026-11-02 together with the sister sites zevkev.de
(`I:\Claude\Website-ZevKev`) and jamonhd.de (`I:\Claude\Website-JamonHD`);
read their CLAUDE.md for shared lessons. belloflo.de used to be a
Fourthwall shop; Belloflo has no merch, so there is no shop.

**No cookies, no analytics, no consent banner.** localStorage is only
written when a visitor uses the theme toggle (`belloflo-theme`). Third-party
requests on page load: YouTube thumbnails (home, Videos), Twitch thumbnails
(Twitch page), team avatars from `zevkev.github.io`. The Twitch player loads
only after a click. Discord stats, Twitch status and VOD list are fetched by
CI and served from this site. Keep `datenschutz/` in sync with any change.

Legal: Kevin is responsible for the site (Impressum with his address);
Belloflo is responsible for his own channels, contact
kontakt.belloflo@gmail.com.

## Owner rules

- German, casual UI copy. **No emojis** (`js/text.js` `cleanText()` strips
  them from titles). **No dashes as punctuation** in copy.
- **No filler text.** Every visible text is real information (names, real
  counts, real titles, actions). No fake terminal labels, hex IDs,
  "Dossier", "Breach Protocol", topic chips. The theme shows through visuals
  and motion only; data rain is glyph-free streaks for that reason.
- Text and headings always sit on a surface (panel), never on the page
  background.
- Own identity, NOT a copy of the sister sites: **cyberpunk netrunning,
  red**. Chamfered HUD panels with neon edge, scan beams, data rain, glitch
  headings, offset-shadow buttons, hazard tape (not on the home avatar,
  Kevin had that removed). Fonts Chakra Petch (display), Space Grotesk
  (body), JetBrains Mono (labels), self-hosted. Light and dark mode.
- Lively ("weniger statisch, mehr animiert"), generous spacing ("nicht alles
  so nah"), phone layouts designed on their own, not just stacked.
- Three pages: Home (newest video only, Discord, team), Videos, Twitch. No
  Twitch teaser on Home; nav and link buttons are enough.
- Videos and Twitch links open in the same tab; Discord and sister sites in
  a new one.
- Team roles (shared): ZevKev Leitung blue #1e88e5, Jamon Co Owner green
  #22a06b, Belloflo Mitglied red #e5484d.

## Architecture map

| Path | What it is |
|---|---|
| `src/app.css` | Design system: tokens (light `:root`, dark `[data-theme="dark"]`), Tailwind theme, components (`.panel*`, `.btn*`, `.chip`, `.term`, `.seg`, `.title-panel`, `.glitch`, `.video-card`, `.fx-*`, header/footer chrome). Imports `src/pages/*.css`. A new top-level folder needs an `@source` line. |
| `assets/css/app.css` | Generated (`npm run build`), gitignored, built in `deploy.yml`, which also appends `?v=<commit>` to the CSS link. |
| `js/boot.js`, `js/theme.js`, `js/layout.js`, `js/reveal.js`, `js/text.js` | Theme before paint; toggle; header/footer/mobile nav (mounts on import, live dot on the Twitch link); scroll reveal; emoji cleaning. |
| `js/fx.js` | Motion primitives, auto-applied (also to content added later): `data-scramble`, `data-count`, `canvas[data-rain]`. CSS-only: `.fx-scan`, `.fx-ticker`, `.fx-flicker`, card glitch, page-load scan line. All off with reduced motion. |
| `js/live.js` | Reads `assets/data/live-status.json`; `isLive()` ignores a "live" older than 16 h. |
| `index.html` + `js/home.js` | Home: hero, newest video, Discord invite (stats from `assets/data/discord.json`), team. |
| `youtube/` + `js/youtube.js` | Videos page: Videos/Shorts switch (`#shorts`), sort, grid. Data `assets/data/main-videos.json` (RSS, latest 15). |
| `twitch/` + `js/twitch-page.js` | Twitch page: status console, click-to-load live player, newest past stream, archive. Polls the status every minute. |
| `404.html` | Pages fallback; old Fourthwall paths like `/en-eur/...` go to Home. |
| `impressum/`, `datenschutz/` | Legal pages (Kevin's data, LDI NRW). |
| `scripts/fetch-main-feed.mjs` | YouTube RSS. Shorts check sends the consent cookie (EU IPs get redirected to consent.youtube.com otherwise) and falls back to oEmbed aspect ratio. Keeps `updatedAt` when nothing changed. |
| `scripts/fetch-discord.mjs` | Discord invite stats and server icon. |
| `scripts/watch-twitch.mjs` | Twitch watcher (Helix, app token). `--publish`: polls every 2 min for ~340 min, commits, pushes and dispatches `deploy.yml` on every change. Without secrets it only logs a warning. |
| `.github/workflows/` | `deploy.yml` (push/dispatch), `data-refresh.yml` (30 min: YouTube + Discord, dispatches deploy on change), `twitch-watch.yml` (30 min cron, one watcher at a time). |
| `assets/img/` | `og.png` (1200x630 share image, source `_dev/og.html`), favicons, `belloflo.jpg` (640px avatar). |
| `tools/serve.mjs` | Local preview like GitHub Pages (404 fallback, no cache): `node tools/serve.mjs 8300`. |
| `_dev/` | Gitignored scratch (component kit, OG card source). |

## GitHub Actions facts

- Pushes made with the workflow token do **not** start other workflows, so
  every job that commits data dispatches `deploy.yml` itself
  (`gh workflow run`, needs `actions: write`).
- GitHub fires short cron schedules on small repos only every few hours,
  hence the long-running Twitch watcher instead of one check per run.
- Twitch secrets `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` come from a
  Twitch app of Kevin's own account (Belloflo's account is not needed).
  Use a separate app from zevkev.de: a new secret invalidates the old one.

## Testing

`npm install`, `npm run dev` (Tailwind watch), `node tools/serve.mjs 8300`.
Headless checks with zevkev.de's `tools/cdp-shot.mjs` (console errors, HTTP
errors, `--mobile` phone emulation). Always check light + dark, desktop +
320/390px phones and that nothing scrolls sideways. Test Twitch states by
temporarily writing fixture data into `assets/data/` and restoring it.

## Do not

- Type passwords, API keys or secrets into forms for Kevin.
- Invent legal text.
- Add a backend, accounts, analytics or anything that sets cookies.
