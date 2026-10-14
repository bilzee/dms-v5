'use client'

import { useState, useEffect, useCallback } from 'react'
import { RoleBasedRoute } from '@/components/shared/RoleBasedRoute'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { apiGet, apiPut, apiDelete } from '@/lib/api'
import { toast } from 'sonner'
import { MapPin, Save, RotateCcw, Check, Globe, Eye, LayoutDashboard, ExternalLink, Layers } from '@/lib/icons'
import { BASEMAP_STYLES, DEFAULT_BASEMAP_STYLE, type BasemapStyleId } from '@/lib/map/basemap'
import dynamic from 'next/dynamic'
import Link from 'next/link'

const MapPreview = dynamic(
  () => import('./MapPreview'),
  {
    ssr: false,
    loading: () => (
      <div className="h-80 w-full flex items-center justify-center bg-muted rounded-lg text-muted-foreground">
        Loading map preview...
      </div>
    )
  }
)

interface MapPreset {
  id: string
  name: string
  center: [number, number]
  zoom: number
}

interface MapConfig {
  activePreset: string
  center: [number, number]
  zoom: number
  basemapStyle: string
  presets: MapPreset[]
}

const MAP_COVERAGE = [
  {
    group: 'Action Queue Maps',
    icon: LayoutDashboard,
    pages: [
      { path: '/assessor/dashboard', label: 'Assessor Dashboard' },
      { path: '/responder/dashboard', label: 'Responder Dashboard' },
      { path: '/donor/dashboard', label: 'Donor Dashboard' },
      { path: '/coordinator/dashboard', label: 'Coordinator Dashboard' },
    ]
  },
  {
    group: 'Assessment Relationship Maps',
    icon: Globe,
    pages: [
      { path: '/coordinator/entity-incident-map', label: 'Entity-Incident Map' },
      { path: '/coordinator/situation-dashboard', label: 'Situation Dashboard' },
    ]
  },
  {
    group: 'Location Selector (Forms)',
    icon: MapPin,
    pages: [
      { path: '/assessor/preliminary-assessment/new', label: 'New Preliminary Assessment' },
      { path: '/coordinator/entities', label: 'Entity Management' },
    ]
  },
]

export default function MapSettingsPage() {
  const [config, setConfig] = useState<MapConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [centerLat, setCenterLat] = useState('')
  const [centerLng, setCenterLng] = useState('')
  const [zoom, setZoom] = useState('')
  const [basemapStyle, setBasemapStyle] = useState<string>(DEFAULT_BASEMAP_STYLE)

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true)
      const result = await apiGet('/api/v1/map-config')
      if (result.success && result.data) {
        const data = result.data as MapConfig
        setConfig(data)
        setSelectedPreset(data.activePreset)
        setCenterLat(String(data.center[0]))
        setCenterLng(String(data.center[1]))
        setZoom(String(data.zoom))
        setBasemapStyle(data.basemapStyle || DEFAULT_BASEMAP_STYLE)
        setDirty(false)
      }
    } catch {
      toast.error('Failed to load map configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchConfig() }, [fetchConfig])

  const handlePresetSelect = (preset: MapPreset) => {
    setSelectedPreset(preset.id)
    setCenterLat(String(preset.center[0]))
    setCenterLng(String(preset.center[1]))
    setZoom(String(preset.zoom))
    setDirty(true)
  }

  const handleStyleSelect = (id: BasemapStyleId) => {
    setBasemapStyle(id)
    setDirty(true)
  }

  const handleFieldChange = (field: 'lat' | 'lng' | 'zoom', value: string) => {
    if (field === 'lat') setCenterLat(value)
    else if (field === 'lng') setCenterLng(value)
    else setZoom(value)
    setSelectedPreset('custom')
    setDirty(true)
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const lat = parseFloat(centerLat)
      const lng = parseFloat(centerLng)
      const z = parseInt(zoom, 10)

      if (isNaN(lat) || lat < -90 || lat > 90) {
        toast.error('Latitude must be between -90 and 90')
        return
      }
      if (isNaN(lng) || lng < -180 || lng > 180) {
        toast.error('Longitude must be between -180 and 180')
        return
      }
      if (isNaN(z) || z < 1 || z > 18) {
        toast.error('Zoom must be between 1 and 18')
        return
      }

      const result = await apiPut('/api/v1/map-config', {
        activePreset: selectedPreset,
        center: [lat, lng],
        zoom: z,
        basemapStyle,
      })

      if (result.success) {
        toast.success('Map configuration saved')
        setDirty(false)
        fetchConfig()
      } else {
        toast.error(result.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save map configuration')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    try {
      setSaving(true)
      const result = await apiDelete('/api/v1/map-config')
      if (result.success) {
        toast.success('Reset to defaults')
        fetchConfig()
      }
    } catch {
      toast.error('Failed to reset')
    } finally {
      setSaving(false)
    }
  }

  const previewCenter: [number, number] = [
    parseFloat(centerLat) || 11.8311,
    parseFloat(centerLng) || 13.1511
  ]
  const previewZoom = parseInt(zoom, 10) || 9

  if (loading) {
    return (
      <RoleBasedRoute requiredRole="ADMIN">
        <div className="py-8 text-center text-muted-foreground">Loading map configuration...</div>
      </RoleBasedRoute>
    )
  }

  return (
    <RoleBasedRoute requiredRole="ADMIN">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <MapPin className="h-8 w-8 text-blue-600" />
              Map Configuration
            </h1>
            <p className="text-muted-foreground mt-2 hidden sm:block">
              Configure the default map center and zoom level used across all maps in the system
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <Badge variant="outline" className="text-orange-600 border-orange-300">
                Unsaved changes
              </Badge>
            )}
            <Button variant="outline" onClick={handleReset} disabled={saving}>
              <RotateCcw className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Defaults</span>
            </Button>
            <Button onClick={handleSave} disabled={saving || !dirty}>
              <Save className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">{saving ? 'Saving...' : 'Save'}</span>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Presets
              </CardTitle>
              <CardDescription>
                Select a predefined location to use as the default map view
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {config?.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                    selectedPreset === preset.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {preset.name}
                        {selectedPreset === preset.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {preset.center[0].toFixed(4)}, {preset.center[1].toFixed(4)} · Zoom {preset.zoom}
                      </div>
                    </div>
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custom Configuration</CardTitle>
              <CardDescription>
                Fine-tune the map center coordinates and zoom level
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="centerLat">Latitude</Label>
                  <Input
                    id="centerLat"
                    type="number"
                    step="0.0001"
                    min="-90"
                    max="90"
                    value={centerLat}
                    onChange={(e) => handleFieldChange('lat', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="centerLng">Longitude</Label>
                  <Input
                    id="centerLng"
                    type="number"
                    step="0.0001"
                    min="-180"
                    max="180"
                    value={centerLng}
                    onChange={(e) => handleFieldChange('lng', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="zoom">Default Zoom Level ({zoom})</Label>
                <Input
                  id="zoom"
                  type="range"
                  min="1"
                  max="18"
                  value={zoom}
                  onChange={(e) => handleFieldChange('zoom', e.target.value)}
                  className="cursor-pointer"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>World (1)</span>
                  <span>Country (5-6)</span>
                  <span>City (10-12)</span>
                  <span>Street (15-18)</span>
                </div>
              </div>

              <Separator />

              <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                <h4 className="font-medium text-sm">Current Configuration</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Center:</span>{' '}
                    {centerLat}, {centerLng}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Zoom:</span> {zoom}
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Preset:</span>{' '}
                    {config?.presets.find(p => p.id === selectedPreset)?.name || 'Custom'}
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Style:</span>{' '}
                    {BASEMAP_STYLES[basemapStyle as BasemapStyleId]?.label || basemapStyle}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-blue-50 dark:bg-blue-500/10 rounded-lg text-sm text-blue-700 dark:text-blue-400">
                Changes will apply to all maps across the system after saving. The map will center on the configured location when loaded.
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5" />
              Base Map Style
            </CardTitle>
            <CardDescription>
              Choose the visual style used by all maps in the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.values(BASEMAP_STYLES).map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => handleStyleSelect(style.id)}
                  className={`text-left p-4 rounded-lg border-2 transition-colors ${
                    basemapStyle === style.id
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`
                }
                >
                  <div className="font-medium flex items-center gap-2">
                    {style.label}
                    {basemapStyle === style.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">{style.description}</div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Map Preview
            </CardTitle>
            <CardDescription>
              Preview of the current map center and zoom level configuration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MapPreview center={previewCenter} zoom={previewZoom} basemapStyleId={basemapStyle} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pages Using This Configuration</CardTitle>
            <CardDescription>
              All pages in the system that use the map configuration for their default center and zoom
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {MAP_COVERAGE.map(({ group, icon: Icon, pages }) => (
                <div key={group} className="space-y-3">
                  <h4 className="font-medium flex items-center gap-2 text-sm">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    {group}
                  </h4>
                  <div className="space-y-2">
                    {pages.map(({ path, label }) => (
                      <Link
                        key={path}
                        href={path}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
                      >
                        <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span>{label}</span>
                        <span className="text-xs font-mono opacity-50">{path}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Separator className="my-4" />
            <p className="text-xs text-muted-foreground">
              Total: 9 pages across 3 map components. All maps automatically pick up changes after saving.
            </p>
          </CardContent>
        </Card>
      </div>
    </RoleBasedRoute>
  )
}
