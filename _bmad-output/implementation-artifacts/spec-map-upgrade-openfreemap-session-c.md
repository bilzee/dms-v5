---
title: 'Map Upgrade Session C: remaining map surfaces → MapLibre + Leaflet removal'
type: 'refactor'
created: '2026-10-14'
status: 'done'
route: 'oneshot'
review_loop_iteration: 1
context: ['{project-root}/docs/plans/openfreemap-maplibre-migration.md', '{bmad-output}/spec-map-upgrade-openfreemap-session-b.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After Sessions A+B, two live map surfaces still render Leaflet + cdnjs-patched markers + OSM raster tiles, and Leaflet CSS/deps remain in the bundle. The user requires every map on the free OpenFreeMap/MapLibre stack — including the situation dashboard map and maps on non-dashboard pages — with Leaflet fully removed.

**Approach:** Session C of 3 (final). Migrate the two remaining Leaflet components onto the Session B primitives (`MapLibreView`, `EntityGeoJsonLayer`, `MapPopup`, `useFlyTo`):

1. **`src/components/coordinator/AssessmentRelationshipMap.tsx`** (761 ln) — mounted on `/coordinator/situation-dashboard` (via `CoordinatorPanelLayout` + `ExecutivePanelLayout`), `/coordinator/incidents/[id]`, and `/coordinator/entity-incident-map`. Replace both `MapContainer` instances (inline + maximized overlay) with `MapLibreView` + `EntityGeoJsonLayer`; CircleMarkers → severity-colored points (ENTITY_SEVERITY_COLORS CRITICAL `#dc2626`, HIGH `#ea580c`, MEDIUM `#ca8a04`, LOW `#16a34a`, default gray `#9ca3af` — visual upgrade over the current always-gray transparent rings, which exist only because of dead code paths); preserve hover→details-panel (add `onHover` to EntityGeoJsonLayer), click→`setSelectedEntityId` + store `setSelectedEntity` + `onEntitySelect`/`onIncidentSelect` callbacks, priority filtering, stats overlay, maximize/Escape overlay mechanics, loading/error states. Drop: Leaflet CDN icon patch, OSM TileLayer, window-resize hack (react-map-gl auto-resizes), noop `whenReady`, noisy console.logs. No clustering here (unfiltered entity set must stay individually visible per current behavior).
2. **`src/components/forms/LocationSelector.tsx`** — mounted in `EntityForm` (`/coordinator/entity-management` create/edit dialogs) and `PreliminaryAssessmentForm` (MapLocationSelector). Replace with `MapLibreView` + react-map-gl `Marker` + map click handler (child using `useMap().current.on('click')`); preserve: click-to-select coordinates, "My Location" geolocation (center via `flyTo`, zoom 13 — Leaflet `setView` parity), fullscreen toggle, "Selected: lat, lng" readout, zoom 13 initial. Map click must NOT re-center (Leaflet parity) — only geolocation flies.

**Cleanup (Leaflet zero-out):** remove `@import 'leaflet/dist/leaflet.css'` from `src/app/globals.css`; delete `src/components/dashboards/situation/map-styles.css` (zero importers after Session B deletions); update stale comment in `situation/components/index.ts`; `pnpm remove leaflet react-leaflet @types/leaflet`. `src/components/shared/LocationSelector.tsx` is NOT a map (text-based) — untouched.

**Verification (pages beyond dashboards, per user directive):** `/coordinator/situation-dashboard`, `/coordinator/entity-incident-map`, `/coordinator/incidents/[id]` (incident with entity coords), `/coordinator/entity-management` (create dialog map click), assessor preliminary assessment form (MapLocationSelector), `/admin/settings/map` + role dashboards (regression). `npx tsc --noEmit` + zero `leaflet` references in `src/` + package.json clean.

</frozen-after-approval>

## Implementation Notes

- **`AssessmentRelationshipMap.tsx`** (761→~630 ln): both `MapContainer` instances (inline map + maximized overlay) replaced with `MapLibreView` + `EntityGeoJsonLayer id="relationship-entities"` (`cluster={false}` — unfiltered entities stay individually visible); severity-colored points via `ENTITY_SEVERITY_COLORS` (CRITICAL `#dc2626`, HIGH `#ea580c`, MEDIUM `#ca8a04`, LOW `#16a34a`, default `#9ca3af`); hover→details panel via new `onHover` prop on `EntityGeoJsonLayer` (layer-scoped `mousemove`/`mouseout` with refs); click→selection + store + callbacks preserved; stats overlay, maximize/Escape mechanics, loading/error states preserved. Dropped: Leaflet CDN icon patch, OSM TileLayer, `window.dispatchEvent(resize)` hack (maplibre has internal ResizeObserver), noop `whenReady`, console.logs.
- **`LocationSelector.tsx`** (~190→~110 ln): `MapLibreView` + react-map-gl `Marker` (maplibre v6 default pin replaces Leaflet CDN patch); click-to-select via child component using `useMap().current.on('click')`; map click does NOT re-center (Leaflet parity) — only "My Location" flies (zoom 13); fullscreen toggle + "Selected: lat, lng" readout preserved.
- **Bug fix 1 (found in verification — update-depth loop):** `/coordinator/incidents/[id]` omitted `priorityFilter`, so the unstable default `priorityFilter = []` produced a new array identity each render, re-firing the prop-sync `useEffect` forever (906 console errors). Fix: module-level `EMPTY_PRIORITY_FILTER` constant as default + functional-update content-equality bailout in the sync effect. Consumers passing stable state arrays (entity-incident-map) were unaffected.
- **Bug fix 2 (Session B regression — cluster layers broken):** react-map-libre `<Source>` injects the `source` prop into children via `cloneElement`, which does **not** traverse Fragments — the cluster `<Layer>`s in `EntityGeoJsonLayer` were wrapped in `<>…</>`, so `addLayer` threw `missing required property "source"` on every `cluster={true}` consumer (`ActionQueueMapPanel`, all 4 role dashboards). Fix: cluster Layers are direct children of `<Source>` (`{cluster && <Layer/>}`), with an explanatory comment. `cluster={false}` consumers never hit it, which is why Session B's own single-page verification passed.
- **Leaflet zero-out:** `@import 'leaflet/dist/leaflet.css'` removed from `globals.css`; `situation/map-styles.css` deleted (302 ln, zero importers); stale comment fixed in `situation/components/index.ts`; `pnpm remove leaflet react-leaflet @types/leaflet`; `@types/geojson` added (replaces the `GeoJSON` namespace types `@types/leaflet` supplied). Zero `leaflet` references remain in `src/` or the lockfile.
- **Verification:** `npx tsc --noEmit` EXIT 0 (after each fix). Browser MCP died mid-session (crash during loop debugging) → pivoted to repo Playwright with the `authenticate` fixture + dev-DB credentials via `E2E_<ROLE>_CREDENTIALS`; temp spec (deleted before commit) asserted `canvas.maplibregl-canvas` visible + zero "Maximum update depth" / "missing required property" / other console errors on all 5 surfaces: `/coordinator/incidents/[id]`, `/coordinator/entity-management` (nested Create-Entity → map dialog), `/assessor/preliminary-assessment/new` (nested map dialog), `/coordinator/dashboard` (Session B regression), `/admin/settings/map` (Session A regression) — 5/5 pass. `/coordinator/situation-dashboard` + `/coordinator/entity-incident-map` verified earlier via screenshots (severity-colored marker, blue selection halo, populated details sidebar, OpenFreeMap attribution). Benign noise allowlisted: highway-shield style warns, pre-existing `action-signals` HTTP 400 (layout-wide), pre-existing ActionQueueItem nested-button hydration warning (a3bc347).

## Review Triage Log

Review loop 1 (blind reviewer, general-purpose agent, 2026-10-14):

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| 1 | MINOR | Severity fallback divergence: `toMapPoint` uses `'UNASSESSED'` (gray default) but sibling client filter falls back to `'LOW'` | **Deferred** — only reachable via dead `/api/v1/relationships` branch (query gated on `incidentId` truthy, branch requires falsy); live dashboard path always sets severity. Align when branch is revived |
| 2 | NIT | Stale "Leaflet" comments in AssessmentRelationshipMap (docblock + panel comment), situation-dashboard page doc | **Fixed** — comments updated to MapLibre |
| 3 | NIT | Unused `React` default import in LocationSelector | **Fixed** |
| 4 | INFO | Pre-existing dead filter UI (Slider/Calendar/Popover imports, `selectedAssessmentTypes`, unused props) | **Left** — exists identically before Session C (verified vs 4a1c68d); out of migration scope |

Reviewer cleared (with library-source evidence): marker default-pin rendering, layer-scoped mouseout hover clearing, full `map.off` cleanup incl. cluster listeners, resize handling sans hack, `{cluster && false}` children vs Source cloneElement, consumer prop compatibility, [lat,lng]→[lng,lat] conversions, `useMap()` destructure, lockfile integrity. **No CRITICAL/MAJOR findings.**