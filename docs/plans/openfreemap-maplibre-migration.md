# OpenFreeMap + MapLibre Migration Plan

**Status:** Approved plan, branch `map-upgrade`
**Date:** 2026-10-14
**Cost:** 100% free — OpenFreeMap requires no API key, no registration, has no rate limits and no paid tier (self-hostable as escape hatch). MapLibre GL JS is BSD-2 open source. `react-map-gl` is MIT.

## 1. Current state (what gets replaced)

| Component | Leaflet usage |
|---|---|
| `src/components/dashboards/situation/InteractiveMap.tsx` | MapContainer, TileLayer, Marker/Popup, useMapEvents, `fitBounds` x2, custom touch gestures |
| `src/components/dashboards/situation/components/EntityMarker.tsx` | Marker + Popup, DivIcon SVG markers, `react-leaflet-markercluster`, icon cache |
| `src/components/coordinator/AssessmentRelationshipMap.tsx` | 2 maps (main + detail), CircleMarker + LayerGroup, tooltip popups |
| `src/components/forms/LocationSelector.tsx` | Click-to-pick coords, draggable marker, `setView` |
| `src/components/dashboards/shared/action-queue/ActionQueueMapPanel.tsx` | Marker/Popup + CircleMarker fallback, `flyTo` on selection |
| `src/app/(auth)/admin/settings/map/MapPreview.tsx` | Simple preview map with flyTo updater |
| Dormant: `situation/components/OfflineTileLayer.tsx`, `src/lib/map/offlineTiles.ts` | Raster tile Dexie cache (incompatible with vector — delete) |
| Admin config | `systemSetting` section `map-config` (activePreset/centerLat/centerLng/zoom/customPresets) -> `/api/v1/map-config` -> `src/hooks/useMapConfig.ts` |

Severity colors to preserve: CRITICAL `#dc2626`, HIGH `#ea580c`, MEDIUM `#ca8a04`, LOW `#16a34a` (`SEVERITY_HEX_COLORS` in EntityMarker.tsx).

## 2. Dependencies

- **Add:** `maplibre-gl`, `react-map-gl` (use `react-map-gl/maplibre` entry)
- **Remove:** `leaflet`, `react-leaflet`, `react-leaflet-cluster`, `react-leaflet-markercluster`, `@types/leaflet`, `types/react-leaflet-markercluster.d.ts`, Dexie tile-cache code (keep Dexie itself if used elsewhere)

## 3. Phase 1 — Shared foundation

1. Rewrite `src/lib/map/basemap.ts` into a style registry:
   ```ts
   export const BASEMAP_STYLES = {
     liberty:  { label: 'Liberty (detailed)',  url: 'https://tiles.openfreemap.org/styles/liberty' },
     bright:   { label: 'Bright',              url: 'https://tiles.openfreemap.org/styles/bright' },
     positron: { label: 'Positron (minimal)',  url: 'https://tiles.openfreemap.org/styles/positron' },
   }
   export const OPENFREEMAP_ATTRIBUTION = '© OpenStreetMap contributors · © OpenFreeMap';
   ```
2. New `src/components/maps/MapLibreView.tsx` — thin wrapper over `react-map-gl` `<Map>`: consumes `useMapConfig()` (style + center + zoom), renders attribution, handles resize -> `map.resize()` (replaces Leaflet `invalidateSize` fixes), exported via `next/dynamic ssr:false` helper so pages keep their existing dynamic-import pattern.
3. New primitives replacing per-file boilerplate:
   - `EntityGeoJsonLayer` — GeoJSON source with `cluster: true` (native, replaces markercluster), circle layer with data-driven paint (`match ['get','severity']` -> severity hex colors), symbol layer for entity-type icons, cluster count layers
   - `MapPopup` — `maplibregl.Popup` + React portal (renders existing `EntityPopup` JSX unchanged)
   - `useFlyTo` — wraps `map.flyTo({center, zoom, duration})`

## 4. Phase 2 — Component migration mapping

| Leaflet | MapLibre equivalent |
|---|---|
| `<TileLayer url=...>` | `mapStyle: BASEMAP_STYLES[x].url` (vector style URL) |
| Marker + DivIcon SVG | symbol layer in style (or `maplibregl.Marker` custom element for donor-count badge) |
| MarkerClusterGroup | GeoJSON source `cluster: true` + cluster circle/count layers — built in, removes 2 deps |
| useMapEvents click | `onClick` on `<Map>` / `map.on('click')` |
| flyTo / setView / fitBounds | `map.flyTo` / `map.jumpTo` / `map.fitBounds(bounds, {padding})` |
| CircleMarker | circle layer, data-driven radius/color |
| Popup | `maplibregl.Popup` + portal for React content |

Per component:
- **InteractiveMap.tsx** — biggest. Replace MapContainer with `MapLibreView`; entity markers -> `EntityGeoJsonLayer`; keep `DonorOverlayControl` (DOM-only); delete `useTouchGestures` wiring (MapLibre has native pinch/pan/double-tap-zoom); zoom controls -> `map.zoomIn/Out` + `jumpTo` for Home.
- **EntityMarker.tsx** — delete DivIcon SVG factory + iconCache (replaced by style-based symbols); keep `EntityPopup` JSX, render via portal.
- **AssessmentRelationshipMap.tsx** — both maps use the same `MapLibreView` + circle layers; keep the `mapRef` measurement logic (DOM-only).
- **LocationSelector.tsx** — `onClick={e => onLocationSelect(e.lngLat)}`, draggable marker via `maplibregl.Marker({draggable:true})`; delete cdnjs default-icon fix (lines 11-25).
- **ActionQueueMapPanel.tsx** — `useFlyTo([lng,lat], 13)`; entity markers -> circle/symbol layers.
- **MapPreview.tsx** — simplest; migrate first as proof-of-concept.

## 5. Phase 3 — Admin map settings (no schema migration needed)

Service stores flat key/value rows in `systemSetting`, so adding a basemap choice requires zero Prisma migration:

1. `src/lib/services/map-config.service.ts`: add `basemapStyle` to `MapConfig` interface + DEFAULT_CONFIG (`'liberty'`); read `map.get('basemapStyle')` in `getMapConfig`; upsert in `saveMapConfig`.
2. `/api/v1/map-config` PUT: validate `basemapStyle` is a `BASEMAP_STYLES` key (reject others).
3. Admin page `src/app/(auth)/admin/settings/map/page.tsx`: new "Base Map Style" picker card next to Presets (Liberty/Bright/Positron with descriptions), include in save payload; MAP_COVERAGE text unchanged (same 9 pages).
4. `src/hooks/useMapConfig.ts`: return `basemapStyle` (default `'liberty'`); `MapLibreView` consumes it -> style changes propagate system-wide after save, exactly like center/zoom today.

## 6. Phase 4 — Cleanup

- Remove `@import 'leaflet/dist/leaflet.css'` (globals.css:73) -> `@import 'maplibre-gl/dist/maplibre-gl.css'`
- Delete `map-styles.css` leaflet z-index/popup hacks (re-style popups with own classes)
- Delete `OfflineTileLayer.tsx` + `src/lib/map/offlineTiles.ts` (raster cache does not apply to vector tiles; dormant already) and CARTO `buildBasemapTileUrl` remnants
- Delete `useTouchGestures` map usage (keep hook if used elsewhere), `useMapPerformance` (MapLibre handles viewport culling natively)

## 7. Testing

- `npx tsc --noEmit` after each phase
- Browser-verify all 9 MAP_COVERAGE pages (login `coordinator@test.com` + admin for settings): entity-incident-map, situation-dashboard, 4 role dashboards, LocationSelector forms, admin map preview
- Verify: tiles served from `tiles.openfreemap.org` only, clustering works, severity colors, donor overlay badge, popup content, click-to-pick coords, admin style switch propagates after save

## 8. Risks

- **Bundle size:** maplibre-gl ~ +200-230KB gzip vs Leaflet — mitigated by code-splitting already in place (`next/dynamic`)
- **WebGL required:** very old mobile browsers fail; MapLibre broadly supported (iOS Safari 11+)
- **No SLA on OpenFreeMap free tier:** style URLs stable; self-hosting tiles is the documented escape hatch; no vendor lock since MapLibre works with any tile source
- **Marker icon fidelity:** DivIcon -> symbol layers changes rendering slightly; donor-count badge needs `maplibregl.Marker` hybrid or text-field count

## 9. Effort

~2-3 working sessions: Phase 1 foundation + MapPreview (~0.5d), InteractiveMap + EntityMarker (~1d, hardest), remaining components + admin settings (~0.5d), cleanup + full 9-page verification (~0.5d).

## Session breakdown for implementation

- **Session A (spec 1):** Phase 1 (foundation) + MapPreview migration + Phase 3 (admin basemapStyle end-to-end) — coherent, small spec
- **Session B (spec 2):** Phase 2 remaining components: MapPreview already done; InteractiveMap + EntityMarker (hardest)
- **Session C (spec 3):** Phase 2 remainder (AssessmentRelationshipMap, LocationSelector, ActionQueueMapPanel) + Phase 4 cleanup + full 9-page verification
