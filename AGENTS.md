# Weather Decision Tool — Agent Guide

## Project structure

3 static files, no build step, no dependencies:

- `index.html` — page structure
- `style.css` — cream/amber palette, JetBrains Mono + Inter Tight
- `script.js` — all logic (~800 lines vanilla JS)

Deploy as-is to any static host.

## Every code change MUST bump the build number

Edit `index.html`: look for `bXXX` on the `.build-number` span and increment it. This lets the user verify they're seeing an updated page, not a cached one.

## Data sources

- `postcodes.io` — geocode UK postcodes to lat/lon (no key)
- Open-Meteo `/v1/forecast` — 8 deterministic weather models (no key)
- Open-Meteo `/v1/ensemble` — 4 ensemble models with percentiles (no key)

## Models (8 total)

UKMO, ECMWF, GFS, ICON, GEM, MF, KNMI, DMI

Add new models to `MODELS` array. Verify each model ID works by hitting the API — Open-Meteo returns 400 for unknown IDs.

## Key patterns

- `requestToken` prevents stale async responses from overwriting newer ones — always check `token !== requestToken` after await.
- Agreement uses `a.total` (models present for that hour), not `MODELS.length`.
- Ensemble probability in period blocks averages `precipitation_probability` from forecast API models, not from the ensemble endpoint (which doesn't support that variable).
- Ensemble "Range" column looks up P10/P90 from ensemble API for continuous variables only.

## Gotchas

- `getNextSaturday()` returns today if today is Saturday (intentional).
- no `precipitation_probability` in ensemble API — use forecast API models instead.
- not all model IDs follow a predictable naming pattern — test each one.
- no tests, no linter, no typechecker.
