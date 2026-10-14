export type BasemapStyleId = 'liberty' | 'bright' | 'positron';

export interface BasemapStyle {
  id: BasemapStyleId;
  label: string;
  description: string;
  url: string;
}

export const BASEMAP_STYLES: Record<BasemapStyleId, BasemapStyle> = {
  liberty: {
    id: 'liberty',
    label: 'Liberty',
    description: 'Detailed streets and landmarks',
    url: 'https://tiles.openfreemap.org/styles/liberty',
  },
  bright: {
    id: 'bright',
    label: 'Bright',
    description: 'Colorful, high contrast',
    url: 'https://tiles.openfreemap.org/styles/bright',
  },
  positron: {
    id: 'positron',
    label: 'Positron',
    description: 'Light and minimal',
    url: 'https://tiles.openfreemap.org/styles/positron',
  },
};

export const DEFAULT_BASEMAP_STYLE: BasemapStyleId = 'liberty';

export const OPENFREEMAP_ATTRIBUTION = '© OpenStreetMap contributors · © OpenFreeMap';

export function isBasemapStyleId(value: unknown): value is BasemapStyleId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BASEMAP_STYLES, value);
}

export function resolveBasemapStyleUrl(id?: string): string {
  return isBasemapStyleId(id) ? BASEMAP_STYLES[id].url : BASEMAP_STYLES[DEFAULT_BASEMAP_STYLE].url;
}

export const BASEMAP_URL = 'https://{s}.basemaps.cartocdn.com/voyager/{z}/{x}/{y}{r}.png';

export const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

export const BASEMAP_SUBDOMAINS = ['a', 'b', 'c', 'd'];

export const BASEMAP_MAX_ZOOM = 20;

export function buildBasemapTileUrl(z: number, x: number, y: number, retina = false): string {
  return `https://a.basemaps.cartocdn.com/voyager/${z}/${x}/${y}${retina ? '@2x' : ''}.png`;
}
