'use client'

import { Marker } from 'react-map-gl/maplibre'
import { MapLibreView } from '@/components/maps/MapLibreView'
import { resolveBasemapStyleUrl, DEFAULT_BASEMAP_STYLE } from '@/lib/map/basemap'

interface MapPreviewProps {
  center: [number, number]
  zoom: number
  basemapStyleId?: string
}

export default function MapPreview({ center, zoom, basemapStyleId }: MapPreviewProps) {
  return (
    <div className="space-y-2">
      <div className="h-80 w-full rounded-lg overflow-hidden border border-border">
        <MapLibreView
          center={center}
          zoom={zoom}
          mapStyleUrl={resolveBasemapStyleUrl(basemapStyleId || DEFAULT_BASEMAP_STYLE)}
        >
          <Marker longitude={center[1]} latitude={center[0]} />
        </MapLibreView>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Center: {center[0].toFixed(4)}, {center[1].toFixed(4)}</span>
        <span>Zoom: {zoom}</span>
      </div>
    </div>
  )
}
