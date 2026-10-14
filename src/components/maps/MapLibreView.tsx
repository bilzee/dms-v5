'use client';

import React, { forwardRef, useEffect, useRef } from 'react';
import MapGL, { MapRef, useMap } from 'react-map-gl/maplibre';
import { getVersion, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapConfig } from '@/hooks/useMapConfig';
import { resolveBasemapStyleUrl } from '@/lib/map/basemap';

setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${getVersion()}`);

export interface MapLibreViewProps {
  center?: [number, number];
  zoom?: number;
  mapStyleUrl?: string;
  onMapClick?: (lat: number, lng: number) => void;
  className?: string;
  children?: React.ReactNode;
}

function ViewportSync({ center, zoom }: { center: [number, number]; zoom: number }) {
  const { current: map } = useMap();
  const prevRef = useRef(`${center[0]},${center[1]},${zoom}`);

  useEffect(() => {
    const key = `${center[0]},${center[1]},${zoom}`;
    if (map && key !== prevRef.current) {
      map.flyTo({ center: [center[1], center[0]], zoom, duration: 600 });
      prevRef.current = key;
    }
  }, [map, center, zoom]);

  return null;
}

export const MapLibreView = forwardRef<MapRef, MapLibreViewProps>(function MapLibreView(
  { center, zoom, mapStyleUrl, onMapClick, className, children },
  ref
) {
  const config = useMapConfig();
  const resolvedCenter = center ?? config.center;
  const resolvedZoom = zoom ?? config.zoom;
  const styleUrl = mapStyleUrl ?? resolveBasemapStyleUrl(config.basemapStyle);

  return (
    <div className={className ?? 'h-full w-full'} style={{ position: 'relative' }}>
      <MapGL
        ref={ref}
        mapStyle={styleUrl}
        initialViewState={{
          longitude: resolvedCenter[1],
          latitude: resolvedCenter[0],
          zoom: resolvedZoom,
        }}
        style={{ width: '100%', height: '100%' }}
        onClick={(e) => onMapClick?.(e.lngLat.lat, e.lngLat.lng)}
      >
        <ViewportSync center={resolvedCenter} zoom={resolvedZoom} />
        {children}
      </MapGL>
    </div>
  );
});

export default MapLibreView;
