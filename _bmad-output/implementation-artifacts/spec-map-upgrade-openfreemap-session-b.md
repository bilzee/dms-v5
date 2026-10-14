---
title: 'Map Upgrade Session B: ActionQueueMapPanel → MapLibre + dead map code removal'
type: 'refactor'
created: '2026-10-14'
status: 'done'
route: 'oneshot'
review_loop_iteration: 1
context: ['{project-root}/docs/plans/openfreemap-maplibre-migration.md', '{project-root}/_bmad-output/implementation-artifacts/spec-map-upgrade-openfreemap-session-a.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Remaining live map surfaces still render Leaflet + OSM raster after Session A laid the MapLibre/OpenFreeMap foundation. The user requires every map in the system to run on the free OpenFreeMap/MapLibre stack, with no CARTO or keyed providers anywhere.

**Approach:** Session B of 3 (per plan in `context`). **Plan deviation, evidence-based:** the planned Session B targets (`InteractiveMap.tsx` + `situation/components/EntityMarker.tsx`) are orphaned — zero page imports (situation dashboard renders `AssessmentRelationshipMap` via `CoordinatorPanelLayout`/`ExecutivePanelLayout`; `EntityCluster` is consumed only by `InteractiveMap`). Porting dead code serves no user-visible map. Rescoped Session B therefore: (1) build the shared MapLibre layer primitives planned in Phase 1 (`EntityGeoJsonLayer` with native GeoJSON clustering + data-driven severity colors, `MapPopup`, `useFlyTo`); (2) migrate the **live** `ActionQueueMapPanel.tsx` (mounted on all 4 role dashboards) onto `MapLibreView` + those primitives, preserving behavior: active-entity filtering, priority colors (CRITICAL `#ef4444`, HIGH `#f97316`, MEDIUM `#eab308`, LOW `#22c55e`), popup content, selection ring, fly-to-on-selection (zoom 13), "no coordinates" empty state; (3) delete the dead map code now instead of porting it: `InteractiveMap.tsx`, `situation/components/EntityMarker.tsx`, `OfflineTileLayer.tsx`, `lib/map/offlineTiles.ts`, `hooks/useTouchGestures.ts` (only consumer was InteractiveMap), `hooks/useMapPerformance.ts` (unused), `types/react-leaflet-markercluster.d.ts`, and `pnpm remove react-leaflet-markercluster react-leaflet-cluster` (only consumer was EntityMarker; `leaflet`/`react-leaflet` stay until Session C). `AssessmentRelationshipMap`, `LocationSelector`, Leaflet CSS cleanup, and the full 9-page verification remain Session C.

</frozen-after-approval>

## Implementation Notes

- **New primitives** (`src/components/maps/`):
  - `EntityGeoJsonLayer.tsx` — GeoJSON `Source` with native clustering (`clusterRadius=50`, `clusterMaxZoom` default 14) + 4 layers: clusters (step colors on `point_count`: #22c55e → 11 #3b82f6 → 21 #eab308 → 51 #ef4444), cluster count (symbol, `Noto Sans Regular`), selected halo (filter `['==',['get','id'],selectedId]`, #3b82f6), points (data-driven `['match',['get','severity'],…]` colors, radius 8, opacity 0.7). Click/cursor wired via `map.on('click'|'mouseenter'|'mouseleave', layerId, …)` from `useMap().current.getMap()` with full `map.off` cleanup; refs (`pointsRef`/`onSelectRef`) avoid stale closures. Cluster click → `GeoJSONSource.getClusterExpansionZoom()` (Promise form, maplibre-gl v6) → `map.easeTo`.
  - `MapPopup.tsx` — react-map-gl `Popup` wrapper (closeOnClick, offset 12, maxWidth 280px, `dms-map-popup` class), Tailwind card content.
  - `useFlyTo.ts` — flyTo on target change, deduped by `lng,lat,zoom` key; key resets to null when target becomes null so re-selecting the same entity re-flies (review fix 1).
- **ActionQueueMapPanel migration** (191→192 lines): Leaflet imports dropped; `MapContent` child inside `MapLibreView` holds popup state; severity = `highestPriority || 'MEDIUM'`; `useFlyTo` to `{lng, lat, zoom: 13}`; `clusterMaxZoom={12}` at call site so a selected point is guaranteed unclustered at zoom 13 (review fix 2). Query (`['map-entities']`, `/api/v1/entities?limit=100`, staleTime 60s, refetch 120s), active-entity filtering, and empty-state copy preserved verbatim.
- **Deletions:** InteractiveMap.tsx (439 ln), EntityMarker.tsx (387 ln), OfflineTileLayer.tsx (98 ln), offlineTiles.ts (389 ln), useTouchGestures.ts (208 ln), useMapPerformance.ts (240 ln), react-leaflet-markercluster.d.ts — 1,952 deletions total incl. rewrite. `pnpm remove react-leaflet-markercluster react-leaflet-cluster` (leaflet/react-leaflet retained for Session C).
- **Verification:** `npx tsc --noEmit` EXIT 0 (pre- and post-review-fix). Browser (coordinator@test.com, /coordinator/dashboard): Liberty basemap renders, OpenFreeMap style/tiles/sprite/glyph requests all 200, console clean (only pre-existing favicon 404 + button-in-button hydration warning), empty state renders when no coords. Synthetic full pointer sequence (PointerEvent pointerdown/up + MouseEvent down/up/click — MapLibre v6 requires PointerEvents) on marker → popup "IDP Camp Dalori / HIGH · CAMP / 2 signals" anchored bottom + queue row `aria-selected=true` (two-way map↔queue selection) + blue halo + flyTo to neighborhood zoom. Note: MapLibre map instance is not attached to the DOM container, so zoom must be verified visually.

## Review Triage Log

Review loop 1 (blind reviewer, general-purpose agent, 2026-10-14):

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| 1 | MINOR | `useFlyTo` dedup key not reset on null target → re-selecting same entity doesn't re-fly | **Fixed** — reset `lastKeyRef` when target is null |
| 2 | MINOR | `clusterMaxZoom=14` > flyTo zoom 13 → selected point can stay clustered/unhaloed at destination | **Fixed** — `clusterMaxZoom={12}` at ActionQueueMapPanel call site |
| 3 | INFO | `dms-map-popup` class defined in no CSS file | **Kept** — deliberate styling hook; harmless |
| 4 | INFO | Clustering is new behavior vs Leaflet version | **Intended** — per migration plan (Phase 1 primitives) |
| 5 | INFO | Stale comment in `situation/components/index.ts` referencing deleted modules | **Deferred to Session C** (file sits in Session C territory) |
| 6 | INFO | `maps/map-styles.css` now imported by nothing | **Deferred to Session C** (planned Leaflet CSS cleanup) |
| 7 | INFO | Attribution control now shown (was suppressed) | **Positive** — OpenFreeMap/OSM compliance |
| 8 | INFO | Halo dashed→solid stroke | **Accepted** — functionally equivalent |

Scope confirmation for Session C (user-directed): remaining map surfaces are `AssessmentRelationshipMap.tsx` (situation dashboard, via Coordinator/ExecutivePanelLayout) and `LocationSelector.tsx` (form pages — non-dashboard maps), plus Leaflet CSS + `leaflet`/`react-leaflet` dep removal and page-by-page verification.
