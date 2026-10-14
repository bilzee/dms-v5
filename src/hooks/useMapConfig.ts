import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { DEFAULT_BASEMAP_STYLE } from '@/lib/map/basemap'

interface MapConfig {
  activePreset: string
  center: [number, number]
  zoom: number
  basemapStyle: string
}

const DEFAULT_CENTER: [number, number] = [11.8311, 13.1511]
const DEFAULT_ZOOM = 9

export function useMapConfig() {
  const { data } = useQuery({
    queryKey: ['map-config'],
    queryFn: async () => {
      try {
        const result = await apiGet('/api/v1/map-config')
        if (result.success && result.data) {
          return result.data as MapConfig
        }
        return null
      } catch {
        return null
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  return {
    center: data?.center ?? DEFAULT_CENTER,
    zoom: data?.zoom ?? DEFAULT_ZOOM,
    basemapStyle: data?.basemapStyle ?? DEFAULT_BASEMAP_STYLE,
  }
}
