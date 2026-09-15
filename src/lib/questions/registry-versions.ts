/**
 * Dynamic Question Registry — per-type structure/content version counters.
 *
 * The counters live in `SystemSetting` under section `QUESTION_REGISTRY` with
 * keys `structureVersion/{TYPE}` / `contentVersion/{TYPE}` and JSON-number
 * values (see spec Design Notes). `prisma/seed-questions.ts` initializes both
 * to 1 per type; P2 (admin governance) owns later bumps. Rows in
 * `RapidAssessment` are stamped with the counter values at write time.
 */

import type { PrismaClient } from '@prisma/client'
import type { RapidAssessmentType } from './legacy-convert'

export const REGISTRY_VERSION_SECTION = 'QUESTION_REGISTRY'

export interface RegistryVersions {
  structureVersion: number
  contentVersion: number
}

export function structureVersionSettingKey(assessmentType: RapidAssessmentType): string {
  return `structureVersion/${assessmentType}`
}

export function contentVersionSettingKey(assessmentType: RapidAssessmentType): string {
  return `contentVersion/${assessmentType}`
}

/** Parses a stored JSON counter; anything missing/malformed falls back to 1. */
function parseCounter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? value : 1
}

/**
 * Reads the current version counters for an assessment type.
 * Missing settings default to 1/1 (a database seeded by `seedQuestions`
 * always has explicit rows; the fallback keeps read paths resilient).
 */
export async function getRegistryVersions(
  db: PrismaClient,
  assessmentType: RapidAssessmentType
): Promise<RegistryVersions> {
  const structureKey = structureVersionSettingKey(assessmentType)
  const contentKey = contentVersionSettingKey(assessmentType)
  const rows = await db.systemSetting.findMany({
    where: { section: REGISTRY_VERSION_SECTION, key: { in: [structureKey, contentKey] } },
    select: { key: true, value: true },
  })
  const byKey = new Map(rows.map((row) => [row.key, row.value]))
  return {
    structureVersion: parseCounter(byKey.get(structureKey)),
    contentVersion: parseCounter(byKey.get(contentKey)),
  }
}
