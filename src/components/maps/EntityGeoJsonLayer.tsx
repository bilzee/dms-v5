'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { Layer, Source, useMap } from 'react-map-gl/maplibre';
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';

export interface EntityMapPoint {
  id: string;
  lng: number;
  lat: number;
  severity?: string;
}

export interface EntityGeoJsonLayerProps {
  id: string;
  points: EntityMapPoint[];
  severityColors: Record<string, string>;
  defaultColor?: string;
  selectedId?: string | null;
  onSelect?: (point: EntityMapPoint) => void;
  clusterRadius?: number;
  clusterMaxZoom?: number;
}

function buildFeatureCollection(points: EntityMapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map(p => ({
      type: 'Feature' as const,
      id: p.id,
      geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      properties: { id: p.id, severity: p.severity ?? 'MEDIUM' },
    })),
  };
}

export function EntityGeoJsonLayer({
  id,
  points,
  severityColors,
  defaultColor = '#6b7280',
  selectedId = null,
  onSelect,
  clusterRadius = 50,
  clusterMaxZoom = 14,
}: EntityGeoJsonLayerProps) {
  const { current: mapRef } = useMap();
  const data = useMemo(() => buildFeatureCollection(points), [points]);

  const pointsRef = useRef(points);
  pointsRef.current = points;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const severityColorExpr = useMemo(() => {
    const expr: any[] = ['match', ['get', 'severity']];
    for (const [severity, color] of Object.entries(severityColors)) {
      expr.push(severity, color);
    }
    expr.push(defaultColor);
    return expr;
  }, [severityColors, defaultColor]);

  const clusterLayerId = `${id}-clusters`;
  const clusterCountLayerId = `${id}-cluster-count`;
  const pointsLayerId = `${id}-points`;
  const selectedLayerId = `${id}-selected`;

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const handlePointClick = (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const entityId = feature.properties?.id as string | undefined;
      if (!entityId) return;
      const point = pointsRef.current.find(p => p.id === entityId);
      if (point) onSelectRef.current?.(point);
    };

    const handleClusterClick = (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const clusterId = feature.properties?.cluster_id;
      if (clusterId === undefined) return;
      const source = map.getSource(id) as GeoJSONSource | undefined;
      if (!source) return;
      source
        .getClusterExpansionZoom(Number(clusterId))
        .then(zoom => {
          const coordinates = (feature.geometry as GeoJSON.Point).coordinates;
          map.easeTo({ center: [coordinates[0], coordinates[1]], zoom });
        })
        .catch(() => undefined);
    };

    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = '';
    };

    map.on('click', pointsLayerId, handlePointClick);
    map.on('click', clusterLayerId, handleClusterClick);
    map.on('mouseenter', pointsLayerId, handleMouseEnter);
    map.on('mouseenter', clusterLayerId, handleMouseEnter);
    map.on('mouseleave', pointsLayerId, handleMouseLeave);
    map.on('mouseleave', clusterLayerId, handleMouseLeave);

    return () => {
      map.off('click', pointsLayerId, handlePointClick);
      map.off('click', clusterLayerId, handleClusterClick);
      map.off('mouseenter', pointsLayerId, handleMouseEnter);
      map.off('mouseenter', clusterLayerId, handleMouseEnter);
      map.off('mouseleave', pointsLayerId, handleMouseLeave);
      map.off('mouseleave', clusterLayerId, handleMouseLeave);
      map.getCanvas().style.cursor = '';
    };
  }, [mapRef, id, pointsLayerId, clusterLayerId]);

  return (
    <Source
      id={id}
      type="geojson"
      data={data}
      cluster
      clusterRadius={clusterRadius}
      clusterMaxZoom={clusterMaxZoom}
    >
      <Layer
        id={clusterLayerId}
        type="circle"
        filter={['has', 'point_count']}
        paint={{
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#22c55e',
            11,
            '#3b82f6',
            21,
            '#eab308',
            51,
            '#ef4444',
          ],
          'circle-radius': 18,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        }}
      />
      <Layer
        id={clusterCountLayerId}
        type="symbol"
        filter={['has', 'point_count']}
        layout={{
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 13,
        }}
        paint={{ 'text-color': '#ffffff' }}
      />
      <Layer
        id={selectedLayerId}
        type="circle"
        filter={['==', ['get', 'id'], selectedId ?? '']}
        paint={{
          'circle-color': '#3b82f6',
          'circle-opacity': 0.15,
          'circle-radius': 16,
          'circle-stroke-color': '#3b82f6',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 1,
        }}
      />
      <Layer
        id={pointsLayerId}
        type="circle"
        filter={['!', ['has', 'point_count']]}
        paint={{
          'circle-color': severityColorExpr as any,
          'circle-radius': 8,
          'circle-opacity': 0.7,
          'circle-stroke-color': severityColorExpr as any,
          'circle-stroke-width': 2,
        }}
      />
    </Source>
  );
}
