import { prisma } from '@/lib/db/client';
import { DEFAULT_BASEMAP_STYLE, isBasemapStyleId, type BasemapStyleId } from '@/lib/map/basemap';

export interface MapPreset {
  id: string;
  name: string;
  center: [number, number];
  zoom: number;
}

export interface MapConfig {
  activePreset: string;
  center: [number, number];
  zoom: number;
  basemapStyle: BasemapStyleId;
  presets: MapPreset[];
}

export const DEFAULT_PRESETS: MapPreset[] = [
  {
    id: 'nigeria',
    name: 'Nigeria',
    center: [9.082, 8.6753],
    zoom: 6,
  },
  {
    id: 'borno',
    name: 'Borno State',
    center: [11.8311, 13.1511],
    zoom: 9,
  },
  {
    id: 'maiduguri',
    name: 'Maiduguri',
    center: [11.8311, 13.1511],
    zoom: 13,
  },
];

const DEFAULT_CONFIG: MapConfig = {
  activePreset: 'borno',
  center: [11.8311, 13.1511],
  zoom: 9,
  basemapStyle: DEFAULT_BASEMAP_STYLE,
  presets: DEFAULT_PRESETS,
};

const CACHE_TTL_MS = 2 * 60 * 1000;

let cachedConfig: MapConfig | null = null;
let cacheExpiry = 0;

export function getDefaultMapConfig(): MapConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

export async function getMapConfig(): Promise<MapConfig> {
  if (cachedConfig && Date.now() < cacheExpiry) {
    return JSON.parse(JSON.stringify(cachedConfig));
  }

  const rows = await prisma.systemSetting.findMany({
    where: { section: 'map-config' },
  });

  const map = new Map(rows.map((r) => [r.key, r.value as string]));

  const activePreset = map.get('activePreset') || DEFAULT_CONFIG.activePreset;
  const centerLat = parseFloat(map.get('centerLat') || String(DEFAULT_CONFIG.center[0]));
  const centerLng = parseFloat(map.get('centerLng') || String(DEFAULT_CONFIG.center[1]));
  const zoom = parseInt(map.get('zoom') || String(DEFAULT_CONFIG.zoom), 10);
  const basemapStyleRaw = map.get('basemapStyle');
  const basemapStyle: BasemapStyleId = isBasemapStyleId(basemapStyleRaw)
    ? basemapStyleRaw
    : DEFAULT_CONFIG.basemapStyle;

  let presets = DEFAULT_CONFIG.presets;
  const customPresetsRaw = map.get('customPresets');
  if (customPresetsRaw) {
    try {
      const custom = JSON.parse(customPresetsRaw) as MapPreset[];
      presets = [...DEFAULT_PRESETS, ...custom];
    } catch {}
  }

  const config: MapConfig = { activePreset, center: [centerLat, centerLng], zoom, basemapStyle, presets };

  cachedConfig = config;
  cacheExpiry = Date.now() + CACHE_TTL_MS;

  return JSON.parse(JSON.stringify(config));
}

export async function saveMapConfig(config: Partial<MapConfig>): Promise<MapConfig> {
  const current = await getMapConfig();

  const upserts: Array<{ section: string; key: string; value: string }> = [];

  if (config.activePreset !== undefined) {
    upserts.push({ section: 'map-config', key: 'activePreset', value: config.activePreset });
  }
  if (config.center !== undefined) {
    upserts.push({ section: 'map-config', key: 'centerLat', value: String(config.center[0]) });
    upserts.push({ section: 'map-config', key: 'centerLng', value: String(config.center[1]) });
  }
  if (config.zoom !== undefined) {
    upserts.push({ section: 'map-config', key: 'zoom', value: String(config.zoom) });
  }
  if (config.basemapStyle !== undefined) {
    upserts.push({ section: 'map-config', key: 'basemapStyle', value: config.basemapStyle });
  }

  const customPresets = (config.presets || current.presets).filter(
    (p) => !DEFAULT_PRESETS.find((d) => d.id === p.id)
  );
  upserts.push({ section: 'map-config', key: 'customPresets', value: JSON.stringify(customPresets) });

  for (const { section, key, value } of upserts) {
    await prisma.systemSetting.upsert({
      where: { section_key: { section, key } },
      create: { section, key, value },
      update: { value },
    });
  }

  cachedConfig = null;
  cacheExpiry = 0;

  return getMapConfig();
}
