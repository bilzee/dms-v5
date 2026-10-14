import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response';
import { getMapConfig, saveMapConfig, getDefaultMapConfig } from '@/lib/services/map-config.service';
import { isBasemapStyleId } from '@/lib/map/basemap';

export const GET = withAuth(async (request: NextRequest) => {
  try {
    const config = await getMapConfig();
    return successResponse(config);
  } catch (error) {
    return handleApiError(error);
  }
});

export const PUT = withAuth(async (request: NextRequest, context) => {
  const { roles } = context;
  if (!roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions.', 403);
  }

  try {
    const body = await request.json();
    const { activePreset, center, zoom, presets, basemapStyle } = body;

    const updates: Record<string, unknown> = {};
    if (activePreset !== undefined) updates.activePreset = activePreset;
    if (center !== undefined) {
      if (!Array.isArray(center) || center.length !== 2 || center.some(isNaN)) {
        return errorResponse('Invalid center coordinates.', 400);
      }
      updates.center = center;
    }
    if (zoom !== undefined) {
      if (typeof zoom !== 'number' || zoom < 1 || zoom > 18) {
        return errorResponse('Zoom must be between 1 and 18.', 400);
      }
      updates.zoom = zoom;
    }
    if (presets !== undefined) updates.presets = presets;
    if (basemapStyle !== undefined) {
      if (!isBasemapStyleId(basemapStyle)) {
        return errorResponse('Invalid basemap style.', 400);
      }
      updates.basemapStyle = basemapStyle;
    }

    const saved = await saveMapConfig(updates);
    return successResponse(saved);
  } catch (error) {
    return handleApiError(error);
  }
});

export const DELETE = withAuth(async (request: NextRequest, context) => {
  const { roles } = context;
  if (!roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions.', 403);
  }

  try {
    await saveMapConfig(getDefaultMapConfig());
    return successResponse(getDefaultMapConfig());
  } catch (error) {
    return handleApiError(error);
  }
});
