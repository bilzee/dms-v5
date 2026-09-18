/**
 * Gap Analysis Service — Dynamic Question Registry edition (P3 engine wrapper).
 *
 * All derivation is delegated to the pure engine
 * (`src/lib/questions/gap-engine.ts`): the snapshot structure defines which
 * questions are GAP questions (and their inverted semantics / presentation
 * text), while the live registry rows — regardless of `isActive` — resolve
 * each key's severity through the ladder (registry → snapshot → MEDIUM).
 * There is one evaluation path for every assessment type; POPULATION simply
 * has zero GAP questions and therefore derives LOW.
 *
 * Stored `gapAnalysis` JSON keeps the legacy keys
 * (`hasGap`, `gapFields`, `severity`, `recommendations`, `fieldSeverityMap`)
 * and adds the engine's `rows` (per-question truth table with the ladder
 * `source`) and `unanswered` (keys never answered — flagged, never scored).
 */

import { AssessmentType, Priority } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import {
  analyzeGaps as runEngine,
  normalizeGapSeverity,
  type GapEngineRegistryRow,
  type GapEngineResult,
  type GapEngineSnapshotStructure,
} from '@/lib/questions/gap-engine'

type FieldSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
type FieldSeverityMap = Record<string, FieldSeverity>

export interface GapAnalysisRow {
  key: string
  label: string
  gapLabel: string | null
  severity: FieldSeverity
  /** 'unknown' = offline-sync drift: an answer key mappable to neither the
   * snapshot nor the live registry (P5 offline ingestion reports it). */
  source: 'registry' | 'snapshot' | 'unmapped' | 'unknown'
  recommendation: string | null
  unanswered: boolean
}

export interface GapAnalysis {
  hasGap: boolean;
  gapFields: string[];
  severity: Priority;
  recommendations: string[];
  fieldSeverityMap?: FieldSeverityMap;
  rows: GapAnalysisRow[];
  unanswered: string[];
}

// Legacy per-type result aliases (shape-identical; kept for existing consumers).
export type HealthGapAnalysis = GapAnalysis;
export type FoodGapAnalysis = GapAnalysis;
export type WASHGapAnalysis = GapAnalysis;
export type ShelterGapAnalysis = GapAnalysis;
export type SecurityGapAnalysis = GapAnalysis;

/** Assessment types that carry GAP questions. POPULATION is context-only. */
const GAP_ASSESSMENT_TYPES = new Set<AssessmentType>(['HEALTH', 'FOOD', 'WASH', 'SHELTER', 'SECURITY'])

interface RegistryView {
  /** Active-registry projection (the snapshot a NEW assessment would freeze). */
  structure: GapEngineSnapshotStructure
  /** ALL rows of the type, regardless of `isActive` — the severity ladder. */
  registryRows: GapEngineRegistryRow[]
}

/**
 * Short-lived per-type cache of the registry view so a single dashboard render
 * does not re-query the registry per assessment. Per-entry TTL (P10-1): each
 * type expires independently — loading a fresh entry for one type never
 * refreshes another type's clock, so no entry can outlive its 30 s TTL.
 */
const registryViewCache = new Map<AssessmentType, { view: RegistryView; expiresAt: number }>()
const REGISTRY_VIEW_CACHE_DURATION_MS = 30 * 1000

function clearGapQuestionCache(): void {
  registryViewCache.clear()
}

async function loadRegistryView(assessmentType: AssessmentType): Promise<RegistryView> {
  const now = Date.now()
  const cached = registryViewCache.get(assessmentType)
  if (cached && cached.expiresAt > now) {
    return cached.view
  }

  // One query for both engine inputs: every row of the type (the ladder does
  // not care about isActive), with section ordering for the structure.
  const rows = await prisma.question.findMany({
    where: { assessmentType },
    orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
    select: {
      questionKey: true,
      label: true,
      category: true,
      inverted: true,
      gapLabel: true,
      recommendation: true,
      severity: true,
      order: true,
      isActive: true,
      section: { select: { order: true, isActive: true } },
    },
  })

  // Active-registry structure (mirrors QuestionRegistryService.getQuestionSet:
  // active sections with their active questions, section order → question order).
  const sections = new Map<number, {
    order: number
    questions: Array<{
      key: string
      label: string
      category: string
      inverted: boolean
      gapLabel: string | null
      recommendation: string | null
      order: number
    }>
  }>()
  for (const row of rows) {
    if (!row.isActive || !row.section?.isActive) continue
    const sectionOrder = row.section.order
    const bucket = sections.get(sectionOrder) ?? { order: sectionOrder, questions: [] }
    bucket.questions.push({
      key: row.questionKey,
      label: row.label,
      category: row.category,
      inverted: row.inverted,
      gapLabel: row.gapLabel,
      recommendation: row.recommendation,
      order: row.order,
    })
    sections.set(sectionOrder, bucket)
  }
  const structure: GapEngineSnapshotStructure = {
    sections: [...sections.keys()]
      .sort((a, b) => a - b)
      .map((order) => ({ order, questions: sections.get(order)!.questions })),
  }

  const registryRows: GapEngineRegistryRow[] = rows.map((row) => ({
    questionKey: row.questionKey,
    severity: row.severity,
  }))

  // Lazily prune expired entries so the map cannot grow unbounded.
  for (const [key, entry] of registryViewCache) {
    if (entry.expiresAt <= now) registryViewCache.delete(key)
  }
  const view = { structure, registryRows }
  registryViewCache.set(assessmentType, {
    view,
    expiresAt: now + REGISTRY_VIEW_CACHE_DURATION_MS,
  })
  return view
}

function toGapAnalysis(result: GapEngineResult): GapAnalysis {
  return {
    hasGap: result.hasGap,
    gapFields: result.gapFields,
    severity: result.severity as Priority,
    recommendations: result.recommendations,
    fieldSeverityMap: result.fieldSeverityMap,
    rows: result.rows,
    unanswered: result.unanswered,
  }
}

/**
 * Evaluates the CURRENT registry snapshot against an answers map (or legacy
 * typed payload — the keys are identical). Used by readers without a stored
 * snapshot (dashboard fallbacks) and by tests.
 */
export async function analyzeGaps(
  assessmentType: AssessmentType,
  answers: Record<string, unknown> | null | undefined
): Promise<GapAnalysis> {
  let view: RegistryView
  try {
    view = await loadRegistryView(assessmentType)
  } catch (error) {
    console.error(`[gap-analysis] Failed to load registry view for ${assessmentType}:`, error)
    throw error
  }
  return toGapAnalysis(runEngine(view.structure, answers ?? {}, view.registryRows))
}

/**
 * Re-derives an assessment's gap analysis from the snapshot it was answered
 * against (the live `QuestionSnapshot` for fresh writes, or the stored
 * `RapidAssessment.questionSnapshot` JSON for re-derivation), resolving
 * severities against ALL live registry rows of the type.
 *
 * Answered keys absent from the snapshot structure (P5 never-reject offline
 * drift, persisted verbatim in `answers`) self-derive as source-'unknown'
 * informational rows inside the engine — never scored.
 */
export async function analyzeGapsFromSnapshot(
  assessmentType: AssessmentType,
  snapshotStructure: GapEngineSnapshotStructure | null | undefined,
  answers: Record<string, unknown> | null | undefined
): Promise<GapAnalysis> {
  const { registryRows } = await loadRegistryView(assessmentType)
  return toGapAnalysis(runEngine(snapshotStructure, answers ?? {}, registryRows))
}

/**
 * Derives the assessment priority from gap analysis. POPULATION assessments
 * are context-only and always derive LOW (the engine returns LOW for a type
 * with zero GAP questions, so the contract holds trivially).
 */
export function derivePriorityFromGaps(assessmentType: AssessmentType, gapAnalysis: GapAnalysis): Priority {
  if (!GAP_ASSESSMENT_TYPES.has(assessmentType)) {
    return Priority.LOW
  }
  return gapAnalysis.severity
}

// Legacy per-type analyzer signatures (answers keys === legacy field names).
export async function analyzeHealthGaps(data: any): Promise<HealthGapAnalysis> {
  return analyzeGaps(AssessmentType.HEALTH, data)
}

export async function analyzeFoodGaps(data: any): Promise<FoodGapAnalysis> {
  return analyzeGaps(AssessmentType.FOOD, data)
}

export async function analyzeWASHGaps(data: any): Promise<WASHGapAnalysis> {
  return analyzeGaps(AssessmentType.WASH, data)
}

export async function analyzeShelterGaps(data: any): Promise<ShelterGapAnalysis> {
  return analyzeGaps(AssessmentType.SHELTER, data)
}

export async function analyzeSecurityGaps(data: any): Promise<SecurityGapAnalysis> {
  return analyzeGaps(AssessmentType.SECURITY, data)
}

export { clearGapQuestionCache }

/**
 * Cached registry lookup of a single GAP field's severity (MEDIUM if unknown).
 * Resolves against all live rows — a deactivated row still resolves, matching
 * the engine's ladder (unknown/UNCLASSIFIED severities normalize to MEDIUM).
 */
export async function getGapFieldSeverity(
  assessmentType: AssessmentType,
  questionKey: string
): Promise<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'> {
  const { registryRows } = await loadRegistryView(assessmentType)
  const row = registryRows.find((r) => r.questionKey === questionKey)
  return row ? normalizeGapSeverity(row.severity) : 'MEDIUM'
}

export default {
  analyzeGaps,
  analyzeGapsFromSnapshot,
  derivePriorityFromGaps,
  analyzeHealthGaps,
  analyzeFoodGaps,
  analyzeWASHGaps,
  analyzeShelterGaps,
  analyzeSecurityGaps,
  getGapFieldSeverity,
};
