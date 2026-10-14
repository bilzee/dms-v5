'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { useMapConfig } from '@/hooks/useMapConfig';
import { MapLibreView } from '@/components/maps/MapLibreView';
import { EntityGeoJsonLayer } from '@/components/maps/EntityGeoJsonLayer';
import type { EntityMapPoint } from '@/components/maps/EntityGeoJsonLayer';
import { MapPopup } from '@/components/maps/MapPopup';
import { useFlyTo } from '@/components/maps/useFlyTo';

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
};

interface MapEntity {
  id: string;
  name: string;
  type: string;
  location: string | null;
  coordinates: unknown;
}

interface EntityPriorityInfo {
  entityId: string;
  highestPriority: string;
  signalCount: number;
}

function getCoords(entity: MapEntity): { lat: number; lng: number } | null {
  const c = entity.coordinates as any;
  if (!c) return null;
  const lat = parseFloat(c.latitude ?? c.lat ?? 0);
  const lng = parseFloat(c.longitude ?? c.lng ?? 0);
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

interface ActionQueueMapPanelProps {
  activeEntityIds: string[];
  entityPriorities?: Record<string, EntityPriorityInfo>;
  selectedEntityId?: string | null;
  onEntitySelect?: (entityId: string) => void;
}

function MapContent({
  entities,
  entityPriorities,
  selectedEntityId,
  onEntitySelect,
}: {
  entities: MapEntity[];
  entityPriorities?: Record<string, EntityPriorityInfo>;
  selectedEntityId: string | null;
  onEntitySelect?: (entityId: string) => void;
}) {
  const [popupEntityId, setPopupEntityId] = useState<string | null>(null);

  const points = useMemo<EntityMapPoint[]>(() => {
    return entities.map(entity => {
      const coords = getCoords(entity)!;
      return {
        id: entity.id,
        lng: coords.lng,
        lat: coords.lat,
        severity: entityPriorities?.[entity.id]?.highestPriority || 'MEDIUM',
      };
    });
  }, [entities, entityPriorities]);

  const selectedCoords = useMemo(() => {
    if (!selectedEntityId) return null;
    const selected = entities.find(e => e.id === selectedEntityId);
    if (!selected) return null;
    const coords = getCoords(selected);
    if (!coords) return null;
    return { lng: coords.lng, lat: coords.lat, zoom: 13 };
  }, [selectedEntityId, entities]);

  useFlyTo(selectedCoords);

  const popupEntity = popupEntityId ? entities.find(e => e.id === popupEntityId) : null;
  const popupPoint = popupEntityId ? points.find(p => p.id === popupEntityId) : null;
  const popupPriority = popupEntity ? entityPriorities?.[popupEntity.id] : undefined;
  const popupColor =
    PRIORITY_COLORS[popupPriority?.highestPriority || 'MEDIUM'] || '#6b7280';

  return (
    <>
      <EntityGeoJsonLayer
        id="action-queue-entities"
        points={points}
        severityColors={PRIORITY_COLORS}
        selectedId={selectedEntityId}
        clusterMaxZoom={12}
        onSelect={point => {
          onEntitySelect?.(point.id);
          setPopupEntityId(point.id);
        }}
      />
      {popupEntity && popupPoint && (
        <MapPopup
          longitude={popupPoint.lng}
          latitude={popupPoint.lat}
          onClose={() => setPopupEntityId(null)}
        >
          <div className="text-sm">
            <strong>{popupEntity.name}</strong>
            <br />
            <span style={{ color: popupColor }}>
              {popupPriority?.highestPriority || 'MEDIUM'}
            </span>{' '}
            · {popupEntity.type}
            {popupPriority && (
              <>
                <br />
                {popupPriority.signalCount} signal
                {popupPriority.signalCount !== 1 ? 's' : ''}
              </>
            )}
          </div>
        </MapPopup>
      )}
    </>
  );
}

export function ActionQueueMapPanel({
  activeEntityIds,
  entityPriorities,
  selectedEntityId,
  onEntitySelect,
}: ActionQueueMapPanelProps) {
  const { center: configCenter, zoom: configZoom } = useMapConfig();

  const { data: entitiesData } = useQuery({
    queryKey: ['map-entities'],
    queryFn: async () => {
      const result = await apiGet('/api/v1/entities?limit=100');
      if (!result.success) return [];
      const data = (result as any).data;
      if (Array.isArray(data)) return data as MapEntity[];
      if (data?.items) return data.items as MapEntity[];
      return [];
    },
    staleTime: 60000,
    refetchInterval: 120000,
  });

  const activeEntities = useMemo(() => {
    const allEntities = entitiesData ?? [];
    const activeSet = new Set(activeEntityIds);
    return allEntities.filter(e => activeSet.has(e.id));
  }, [entitiesData, activeEntityIds]);

  const entitiesWithCoords = useMemo(() => {
    return activeEntities.filter(e => getCoords(e) !== null);
  }, [activeEntities]);

  if (entitiesWithCoords.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        <div className="text-center">
          <p>No entity coordinates available</p>
          <p className="text-xs mt-1">
            {activeEntityIds.length > 0
              ? `${activeEntityIds.length} active entities without coordinates`
              : 'No active entities'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full rounded-lg">
      <MapLibreView center={configCenter} zoom={configZoom} className="h-full w-full">
        <MapContent
          entities={entitiesWithCoords}
          entityPriorities={entityPriorities}
          selectedEntityId={selectedEntityId ?? null}
          onEntitySelect={onEntitySelect}
        />
      </MapLibreView>
    </div>
  );
}
