---
title: 'Map Upgrade Session A: MapLibre foundation, MapPreview, admin basemap style'
type: 'refactor'
created: '2026-10-14'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: ['{project-root}/docs/plans/openfreemap-maplibre-migration.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The map stack uses Leaflet raster tiles via CARTO, which the user rejects as paid/keyed; the user requires a fully free map (no API key, no subscription). OpenFreeMap vector tiles + MapLibre GL (via `react-map-gl`) meets this at zero cost.

**Approach:** Session A of 3 (per plan doc in `context`): add `maplibre-gl` + `react-map-gl`; rewrite `src/lib/map/basemap.ts` into an OpenFreeMap style registry (liberty/bright/positron, default liberty); add `src/components/maps/MapLibreView.tsx` wrapper (dynamic `ssr:false`, consumes `useMapConfig`, imports maplibre CSS); add `basemapStyle` end-to-end through admin config (`map-config.service` key/value upsert → `/api/v1/map-config` PUT validation → admin settings "Base Map Style" picker card → `useMapConfig` return value); migrate `MapPreview.tsx` from react-leaflet to MapLibre as the first live consumer. Leaflet stays untouched for the remaining maps until Sessions B and C.

</frozen-after-approval>

## Implementation Notes

- **maplibre-gl v6 worker fix (critical):** v6 ships a separate worker file. Under Next.js webpack, `import.meta.url` is not `http(s):`, so maplibre's built-in resolver returns `''` → `new Worker('')` throws "Worker failed to load" → blank canvas (style/tiles still fetch 200 from the main thread, which masks it). Fixed by calling `setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${getVersion()}`)` at module scope of `MapLibreView.tsx` (must run before any Map creation), with the worker copied to `public/vendor/` by `scripts/copy-maplibre-worker.mjs`. The copy script is prefixed onto `dev`, `dev:pwa`, `build`, `build:test`, `build:validated`, `build:production`, `build:production:ignore-ts`; `Dockerfile.production` copies `public/` so prod is covered.
- **lat/lng convention:** app config `center` stays `[lat, lng]`; `MapLibreView` flips to `[lng, lat]` internally (MapLibre order). All future migrated components must keep passing `[lat, lng]`.
- `MapLibreView` wraps `MapGL` in a div so `className` sizes the container (MapGL fills 100%); `ViewportSync` child calls `flyTo` when center/zoom props change.
- `basemap.ts` keeps legacy CARTO tile-URL exports untouched for the still-on-Leaflet components; they are deleted in Session C cleanup.
- CSP: production `connect-src` gained `https://tiles.openfreemap.org` (vector tiles/styles/fonts are fetched, not `<img>`-loaded; Leaflet raster worked under the old CSP but MapLibre would not have).
- Review finding: six Leaflet files had been rewired to CARTO raster in an earlier experiment; reverted to HEAD (OSM raster) so Sessions B/C replace them wholesale with MapLibre — no interim CARTO dependency.
- Verification (dev, admin `admin@dms.gov.ng`): tiles + sprites + Noto Sans glyph ranges 200, worker `200` from `/vendor/maplibre-gl-worker.mjs?v=6.14.0`, zero console errors; style switch Liberty→Bright→Save→reload persisted (PUT 200, `basemapStyle: "bright"` after reload), then restored Liberty. `tsc --noEmit` clean.
- Gotcha for future sessions: verify maps in a fresh isolated browser context — the shared Chrome profile's HTTP cache was poisoned by an earlier CARTO experiment.

## Review Triage Log

Blind-hunter review (general-purpose subagent, full working-tree diff vs HEAD). Verdict: FIX-FIRST → all findings triaged, fixes applied, `tsc` clean.

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| 1 | CRITICAL | Production CSP `connect-src 'self'` would block MapLibre's fetch() of OpenFreeMap styles/tiles/fonts in prod builds (dev unaffected — invisible to dev-only verification) | **Fixed** — added `https://tiles.openfreemap.org` to `connect-src` in `production-security.config.js:37` |
| 2 | MAJOR | Six not-yet-migrated Leaflet files had been rewired to CARTO raster (the vendor this migration exists to eliminate) | **Fixed** — reverted `LocationSelector`, `InteractiveMap`, `ActionQueueMapPanel`, `AssessmentRelationshipMap`, `OfflineTileLayer`, `offlineTiles.ts` to HEAD (OSM raster); Sessions B/C replace them with MapLibre wholesale |
| 3 | MINOR | `build:validated` was the only build path skipping `copy:maplibre-worker` | **Fixed** — prefixed with `pnpm copy:maplibre-worker`; worker artifact committed under `public/vendor/` as belt-and-suspenders |
| 4 | NIT | Base Map Style card copy ("applies to all maps") overpromises until Sessions B/C migrate the remaining consumers | **Won't Fix** — Sessions B and C land immediately after in this same chained effort; copy becomes accurate on chain completion |

