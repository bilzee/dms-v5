'use client';

import { useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';

export interface FlyToTarget {
  lng: number;
  lat: number;
  zoom?: number;
}

export function useFlyTo(target: FlyToTarget | null, duration = 800) {
  const { current: mapRef } = useMap();
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!target || !mapRef) {
      if (!target) lastKeyRef.current = null;
      return;
    }
    const key = `${target.lng.toFixed(6)},${target.lat.toFixed(6)},${target.zoom ?? ''}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    mapRef.flyTo({
      center: [target.lng, target.lat],
      zoom: target.zoom ?? mapRef.getZoom(),
      duration,
    });
  }, [target, mapRef, duration]);
}
