# Weather Decision Tool — Agent Guide

## Project structure

6 static files, no build step, no dependencies:

- `index.html` — page structure
- `style.css` — cream/amber palette, JetBrains Mono + Inter Tight
- `script.js` — all logic (~860 lines vanilla JS)
- `manifest.json` — PWA manifest
- `sw.js` — service worker with cache-first static, network-only API
- `icon.svg` — PWA icon (512×512 amber concentric circles)

Deploy as-is to any static host. Currently on GitHub Pages.

## Every code change MUST bump the build number

Run `.\bump.ps1` to increment the build number in `index.html` and the cache version in `sw.js`. This lets the user verify they're seeing an updated page, not a cached one.

## Data sources

- `postcodes.io` — geocode UK postcodes to lat/lon (no key)
- Open-Meteo `/v1/forecast` — 8 deterministic weather models (no key)
- Open-Meteo `/v1/ensemble` — 4 ensemble models with percentiles (no key)

## Models (8 total)

UKMO, ECMWF, GFS, ICON, GEM, MF, KNMI, DMI

Add new models to `MODELS` array. Verify each model ID works by hitting the API — Open-Meteo returns 400 for unknown IDs.

## Key patterns

- `requestToken` prevents stale async responses from overwriting newer ones — always check `token !== requestToken` after await, and call `hideLoading()` before returning.
- Agreement uses `a.total` (models present for that hour), not `MODELS.length`.
- Ensemble probability in period blocks averages `precipitation_probability` from forecast API models, not from the ensemble endpoint (which doesn't support that variable).
- Ensemble "Range" column looks up P10/P90 from ensemble API for continuous variables only.
- Agreement labels use fraction format (e.g. `18/48 dry`) in period distribution and per-model breakdown to avoid confusion with temperature readings.
- Every metric cell is color-coded via `classifyCell()` — green/amber/red thresholds per metric.
- Persistence via localStorage keys: `weather_postcode`, `weather_date`, `weather_hour_start`, `weather_hour_end`. Restored on page load.

## Gotchas

- `getNextSaturday()` returns today if today is Saturday (intentional).
- no `precipitation_probability` in ensemble API — use forecast API models instead.
- not all model IDs follow a predictable naming pattern — test each one.
- When `models` param is used, Open-Meteo returns per-model sunrise/sunset keys (e.g. `sunrise_ukmo_seamless`), not a bare `sunrise` key. `getSunTimes()` finds the first matching key dynamically.
- no tests, no linter, no typechecker.
