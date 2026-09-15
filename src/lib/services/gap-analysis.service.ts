/**
 * Gap Analysis Service — Dynamic Question Registry edition.
 *
 * Replaces the per-type hardcoded analyzers and the GapFieldSeverity lookup
 * table with the `Question` registry: gap detection, per-field severity,
 * assessment severity and recommendations are all derived from the active
 * GAP questions for the assessment type.
 *
 * Behavior parity with the legacy analyzers:
 * - Non-inverted GAP booleans indicate a gap when falsy (false/undefined).
 * - Inverted GAP booleans (hasOpenDefecationConcerns, areOvercrowded,
 *   gbvCasesReported) indicate a gap when true.
 * - Assessment severity = MAX(severity of gapped questions), LOW when no gaps.
 * - Recommendations = the gapped questions' registry `recommendation`, in
 *   registry order.
 *
 * The stored `gapAnalysis` JSON shape is unchanged:
 * `{ hasGap, gapFields, severity, recommendations, fieldSeverityMap? }`.
 */

import { AssessmentType, Priority } from '@prisma/client'
import { prisma } from '@/lib/db/client'
import { deriveGapAnalysisFromQuestions } from '@/lib/questions/gap-derivation'

type FieldSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
type FieldSeverityMap = Record<string, FieldSeverity>

export interface GapAnalysis {
  hasGap: boolean;
  gapFields: string[];
  severity: Priority;
  recommendations: string[];
  fieldSeverityMap?: FieldSeverityMap;
}

// Legacy per-type result aliases (shape-identical; kept for existing consumers).
export type HealthGapAnalysis = GapAnalysis;
export type FoodGapAnalysis = GapAnalysis;
export type WASHGapAnalysis = GapAnalysis;
export type ShelterGapAnalysis = GapAnalysis;
export type SecurityGapAnalysis = GapAnalysis;

/** Assessment types that carry GAP questions. POPULATION is context-only. */
const GAP_ASSESSMENT_TYPES = new Set<AssessmentType>(['HEALTH', 'FOOD', 'WASH', 'SHELTER', 'SECURITY'])

interface GapQuestionMeta {
  questionKey: string
  inverted: boolean
  severity: Priority
  recommendation: string | null
}

/**
 * Short-lived cache of GAP question metadata per assessment type so a single
 * dashboard render does not re-query the registry per assessment.
 */
let gapQuestionCache = new Map<AssessmentType, GapQuestionMeta[]>()
let gapQuestionCacheTimestamp = 0
const GAP_QUESTION_CACHE_DURATION_MS = 30 * 1000

function clearGapQuestionCache(): void {
  gapQuestionCache = new Map()
  gapQuestionCacheTimestamp = 0
}

async function getGapQuestions(assessmentType: AssessmentType): Promise<GapQuestionMeta[]> {
  const now = Date.now()
  if (now - gapQuestionCacheTimestamp < GAP_QUESTION_CACHE_DURATION_MS && gapQuestionCache.has(assessmentType)) {
    return gapQuestionCache.get(assessmentType)!
  }

  const questions = await prisma.question.findMany({
    where: {
      assessmentType,
      category: 'GAP',
      isActive: true,
    },
    orderBy: [{ section: { order: 'asc' } }, { order: 'asc' }],
    select: {
      questionKey: true,
      inverted: true,
      severity: true,
      recommendation: true,
    },
  })

  const meta = questions.map((q) => ({
    questionKey: q.questionKey,
    inverted: q.inverted,
    severity: q.severity,
    recommendation: q.recommendation,
  }))

  if (now - gapQuestionCacheTimestamp >= GAP_QUESTION_CACHE_DURATION_MS) {
    gapQuestionCache = new Map()
  }
  gapQuestionCache.set(assessmentType, meta)
  gapQuestionCacheTimestamp = now

  return meta
}

/**
 * Evaluates gap questions against an answers map (or legacy typed payload —
 * the keys are identical) and derives the stored gapAnalysis JSON.
 */
export async function analyzeGaps(
  assessmentType: AssessmentType,
  answers: Record<string, unknown> | null | undefined
): Promise<GapAnalysis> {
  if (!GAP_ASSESSMENT_TYPES.has(assessmentType)) {
    return { hasGap: false, gapFields: [], severity: Priority.LOW, recommendations: [] }
  }

  const source = answers ?? {}
  let questions: GapQuestionMeta[]
  try {
    questions = await getGapQuestions(assessmentType)
  } catch (error) {
    console.error(`[gap-analysis] Failed to load GAP questions for ${assessmentType}:`, error)
    throw error
  }

  return deriveGapAnalysisFromQuestions(questions, source) as GapAnalysis
}

/**
 * Derives the assessment priority from gap analysis. POPULATION assessments
 * are context-only and always derive LOW.
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

/** Cached registry lookup of a single GAP field's severity (MEDIUM if unknown). */
export async function getGapFieldSeverity(
  assessmentType: AssessmentType,
  questionKey: string
): Promise<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'> {
  const questions = await getGapQuestions(assessmentType)
  const question = questions.find((q) => q.questionKey === questionKey)
  return question ? (question.severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW') : 'MEDIUM'
}

export default {
  analyzeGaps,
  derivePriorityFromGaps,
  analyzeHealthGaps,
  analyzeFoodGaps,
  analyzeWASHGaps,
  analyzeShelterGaps,
  analyzeSecurityGaps,
  getGapFieldSeverity,
};
