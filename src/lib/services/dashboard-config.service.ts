/**
 * Dashboard configuration service (P7) — reads coordinator-tunable dashboard
 * settings from SystemSetting behind a small TTL cache.
 *
 * Current surface (§2.7):
 * - `getGapRowsPerCategory()` — the "max gap rows per category card" setting
 *   (section DASHBOARD / key gapRowsPerCategory, stored as a JSON number).
 *   The value is clamped 1..7 by `resolveGapRowLimit`; missing / non-number /
 *   zero / out-of-range values NEVER throw — they resolve to the default (5),
 *   so a bad setting can at most change presentation density, never fail the
 *   dashboard.
 *
 * Modeled after map-config.service (module-level cache + expiry); there is no
 * write surface yet, so invalidation exists only for tests.
 */

import { prisma } from '@/lib/db/client';
import { resolveGapRowLimit } from '@/lib/questions/gap-summary';

const DASHBOARD_CONFIG_SECTION = 'DASHBOARD';
const GAP_ROWS_PER_CATEGORY_KEY = 'gapRowsPerCategory';

const CACHE_TTL_MS = 30 * 1000;

let cachedGapRowsPerCategory: number | null = null;
let cacheExpiry = 0;

/** Drops the cached settings (used by tests; no write surface exists yet). */
export function clearDashboardConfigCache(): void {
  cachedGapRowsPerCategory = null;
  cacheExpiry = 0;
}

/**
 * The effective max gap rows a category summary card renders before the
 * "+N more" overflow chip. Never throws: DB errors and invalid stored values
 * both resolve to the §2.7 default.
 */
export async function getGapRowsPerCategory(): Promise<number> {
  if (cachedGapRowsPerCategory !== null && Date.now() < cacheExpiry) {
    return cachedGapRowsPerCategory;
  }

  let value: unknown = undefined;
  try {
    const row = await prisma.systemSetting.findUnique({
      where: {
        section_key: {
          section: DASHBOARD_CONFIG_SECTION,
          key: GAP_ROWS_PER_CATEGORY_KEY,
        },
      },
      select: { value: true },
    });
    value = row?.value;
  } catch (error) {
    console.warn('[dashboard-config] gapRowsPerCategory lookup failed, using default:', error);
  }

  const resolved = resolveGapRowLimit(value);
  cachedGapRowsPerCategory = resolved;
  cacheExpiry = Date.now() + CACHE_TTL_MS;
  return resolved;
}
