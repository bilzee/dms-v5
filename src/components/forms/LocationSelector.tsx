'use client';

import { useState } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { Button } from '@/components/ui/button';
import { Crosshair, Maximize2 } from '@/lib/icons';
import { useMapConfig } from '@/hooks/useMapConfig';
import { MapLibreView } from '@/components/maps/MapLibreView';

interface LocationSelectorProps {
  onLocationSelect: (latitude: number, longitude: number) => void;
  initialCoordinates?: {
    latitude: number;
    longitude: number;
  };
}

export function LocationSelector({ onLocationSelect, initialCoordinates }: LocationSelectorProps) {
  const { center: configCenter } = useMapConfig();
  const coords = initialCoordinates ?? { latitude: configCenter[0], longitude: configCenter[1] };
  const [position, setPosition] = useState<[number, number]>([coords.latitude, coords.longitude]);
  // Only geolocation re-centers the map (Leaflet setView parity) — map clicks must not pan
  const [flyCenter, setFlyCenter] = useState<[number, number] | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleCurrentLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        geoPosition => {
          const { latitude, longitude } = geoPosition.coords;
          setPosition([latitude, longitude]);
          onLocationSelect(latitude, longitude);

          // Center map on current location
          setFlyCenter([latitude, longitude]);
        },
        error => {
          console.error('Error getting current location:', error);
        }
      );
    } else {
      console.error('Geolocation is not supported by this browser');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Selected: {position[0].toFixed(6)}, {position[1].toFixed(6)}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCurrentLocation}
            className="flex items-center gap-2"
          >
            <Crosshair className="h-4 w-4" />
            My Location
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="flex items-center gap-2"
          >
            <Maximize2 className="h-4 w-4" />
            {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          </Button>
        </div>
      </div>

      <div className={isFullscreen ? 'fixed inset-0 z-50' : 'h-96 w-full rounded-lg overflow-hidden'}>
        <MapLibreView
          center={flyCenter ?? [coords.latitude, coords.longitude]}
          zoom={13}
          className="h-full w-full"
          onMapClick={(lat, lng) => {
            setPosition([lat, lng]);
            onLocationSelect(lat, lng);
          }}
        >
          <Marker
            latitude={position[0]}
            longitude={position[1]}
            onClick={e => {
              e.originalEvent.stopPropagation();
              onLocationSelect(position[0], position[1]);
            }}
          />
        </MapLibreView>
      </div>

      <div className="text-xs text-muted-foreground text-center">
        Click on the map to select coordinates or use &quot;My Location&quot; button
      </div>
    </div>
  );
}
