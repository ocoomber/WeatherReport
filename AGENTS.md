# Weather Decision Tool — Agent Guide

## Project structure

7 JS files, plain `<script>` tags in dependency order (no module system yet — deferred as separate infrastructure work):

- `index.html` — page structure
- `style.css` — cream/amber palette, JetBrains Mono + Inter Tight
- `config.js` — constants, config values, DOM element references
- `state.js` — app state variables (`lastRawData`, `lastSunrise`, etc.)
- `logic.js` — all 22 pure functions (parsing, classification, date handling, agreement calculations). No DOM/fetch/localStorage/geolocation.
- `api.js` — fetch calls (postcodes.io, Open-Meteo), geolocation, localStorage reads/writes
- `render.js` — all DOM-writing functions. No fetch or localStorage writes.
- `handlers.js` — event handlers, orchestrates across logic/render/api
- `app.js` — bootstrap: wires modules together, runs on load
- `manifest.json` — PWA manifest
- `sw.js` — service worker with cache-first static, network-only API
- `icon.svg` — PWA icon (512×512 amber concentric circles)

### Load order

config → state → logic → api → render → handlers → app

### Accepted exceptions to the 150-line ceiling

`logic.js` (383 lines) — all 22 pure functions across parsing/classification/date/agreement concerns. No DOM or I/O; splitting further would separate by category, not by responsibility, and was judged not worth the fragmentation.
`render.js` (184 lines) — 11 DOM-writing functions, no further natural boundary.

Deploy as-is to any static host. Currently on GitHub Pages.

## Every code change MUST bump the build number

The pre-commit hook (`.githooks/pre-commit`) runs `.\bump.ps1` automatically on every commit. It increments the build number (`bXXX` 3-digit zero-padded) in `index.html` and the SW cache version in `sw.js` using the same number. This lets the user verify they're seeing an updated page, not a cached one.

## Data sources

- `postcodes.io` — geocode UK postcodes to lat/lon (no key)
- Open-Meteo `/v1/forecast` — 8 deterministic weather models (no key)
- Open-Meteo `/v1/ensemble` — 4 ensemble models with percentiles (no key)

## Models (8 total)

UKMO, ECMWF, GFS, ICON, GEM, MF, KNMI, DMI

Add new models to `MODELS` array in `config.js`. Verify each model ID works by hitting the API — Open-Meteo returns 400 for unknown IDs.

## Recent conventions

- Bump regex tightened to `b(\d{3})` — won't match hex colors in SVGs
- Brand mark uses `icon.svg` (compass logo) instead of inline SVG
- Agreement cells show fraction only (e.g. `6/6`), no "agree dry" text — color tells the story
- `initDatePicker()` handles all three saved-date cases (no saved, out of range, valid) — no separate restore block needed
- Mobile table: `0.65rem` font, `0.15rem 0.18rem` padding, `1px` agreement border, "Agree" header text

## Key patterns

- `requestToken` prevents stale async responses from overwriting newer ones — always check `token !== requestToken` after await, and call `hideLoading()` before returning.
- Agreement uses `a.total` (models present for that hour), not `MODELS.length`.
- Ensemble probability in period blocks averages `precipitation_probability` from forecast API models, not from the ensemble endpoint (which doesn't support that variable).
- Every metric cell is color-coded via `classifyCell()` — green/amber/red thresholds per metric.
- Persistence via localStorage keys: `weather_postcode`, `weather_date`, `weather_hour_start`, `weather_hour_end`. Restored on page load by `app.js`.
- Pure logic and DOM side effects are separated: `get*` functions return data, `render*` functions write to screen, handlers call both.

## Gotchas

- `getNextSaturday()` returns today if today is Saturday (intentional).
- no `precipitation_probability` in ensemble API — use forecast API models instead.
- not all model IDs follow a predictable naming pattern — test each one.
- When `models` param is used, Open-Meteo returns per-model sunrise/sunset keys (e.g. `sunrise_ukmo_seamless`), not a bare `sunrise` key. `getSunTimes()` finds the first matching key dynamically.
- `geocode()` in `api.js` uses `normalizePostcode()` from `logic.js` — loaded before `api.js` via plain script tags, so it works without imports.
- no tests, no linter, no typechecker.
