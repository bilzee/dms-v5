/**
 * Dynamic Question Registry — legacy typed-payload ⇄ answers conversion and
 * question-snapshot projection.
 *
 * P1 keeps the legacy assessor forms and the legacy API payload shapes; this module
 * is the seam between them and the registry data model:
 *
 * - `toAnswers(type, typedPayload)` — the server-side bridge used by
 *   `rapid-assessment.service.create()`. Accepts the exact validated legacy payload
 *   (including JSON-stringified array fields) and produces the canonical
 *   `{ [questionKey]: value }` answers map stored on `RapidAssessment.answers`.
 * - `fromAnswers(type, answers)` — the read-side bridge. Rebuilds the legacy
 *   typed-payload shape (arrays as arrays, details as string) for the edit form
 *   hydration path. `fromAnswers(type, toAnswers(type, payload))` is a no-op
 *   (parity is unit-tested for all six types).
 * - `buildQuestionSnapshot(questions, versions)` — the frozen, per-assessment copy
 *   of the questions (labels/options/gap metadata at answer time) stored in
 *   `RapidAssessment.questionSnapshot`. Structure-only: `severity` is deliberately
 *   NOT projected (it stays live in the registry; snapshots never carry it).
 */

import {
  ASSESSMENT_TYPES,
  CatalogAssessmentType,
  QUESTION_CATALOG,
} from './registry-validation'
import type { RegistryVersions } from './registry-versions'

export type RapidAssessmentType = CatalogAssessmentType

/** Values storable in `RapidAssessment.answers`. */
export type AnswerValue = boolean | number | string | string[] | undefined
export type RapidAssessmentAnswers = Record<string, AnswerValue>

/** Structural subset of a registry `Question` row (works with Prisma rows and test fixtures). */
export interface RegistryQuestionRow {
  id: string
  questionKey: string
  questionType: string
  label: string
  helperText?: string | null
  required: boolean
  options?: unknown
  category: string
  inverted: boolean
  gapLabel?: string | null
  gapMeaning?: string | null
  recommendation?: string | null
  severity: string
  numberMin?: number | null
  numberMax?: number | null
  order: number
  sectionId: string
  section?: {
    sectionKey: string
    title: string
    description?: string | null
    category: string
    order: number
  } | null
}

export interface RapidAssessmentQuestion {
  id: string
  key: string
  label: string
  helperText?: string | null
  type: string
  required: boolean
  options?: unknown
  category: string
  inverted: boolean
  gapLabel?: string | null
  gapMeaning?: string | null
  recommendation?: string | null
  numberMin?: number | null
  numberMax?: number | null
  order: number
}

export interface RapidAssessmentSection {
  id: string
  key: string
  title: string
  description?: string | null
  category: string
  order: number
  questions: RapidAssessmentQuestion[]
}

export interface QuestionSnapshot {
  structureVersion: number
  contentVersion: number
  generatedAt: string
  sections: RapidAssessmentSection[]
}

function catalogForType(assessmentType: RapidAssessmentType) {
  const entry = QUESTION_CATALOG.find((c) => c.assessmentType === assessmentType)
  if (!entry) {
    throw new Error(`Unknown assessment type: ${assessmentType}`)
  }
  return entry
}

/** All question keys for a type in presentation order. */
export function questionKeysForType(assessmentType: RapidAssessmentType): string[] {
  return catalogForType(assessmentType).sections.flatMap((section) => section.questions.map((q) => q.questionKey))
}

/** Legacy DB columns / form fields that arrive as JSON strings; parsed into arrays. */
const ARRAY_FIELDS = new Set([
  'commonHealthIssues',
  'foodSource',
  'waterSource',
  'shelterTypes',
  'requiredShelterType',
])

function coerceArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Converts a validated legacy typed payload into the canonical answers map.
 * Array fields (which legacy columns stored as JSON strings) are normalized to
 * real arrays; other values pass through under their legacy field name, which is
 * the registry `questionKey`.
 */
export function toAnswers(
  assessmentType: RapidAssessmentType,
  typedPayload: Record<string, unknown>
): RapidAssessmentAnswers {
  const keys = questionKeysForType(assessmentType)
  const answers: RapidAssessmentAnswers = {}
  for (const key of keys) {
    if (!(key in typedPayload)) continue
    const value = typedPayload[key]
    if (ARRAY_FIELDS.has(key)) {
      answers[key] = coerceArray(value)
    } else if (
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      typeof value === 'string' ||
      value === undefined ||
      value === null
    ) {
      answers[key] = value === null ? undefined : value
    } else {
      answers[key] = JSON.parse(JSON.stringify(value))
    }
  }
  return answers
}

/**
 * Rebuilds the legacy typed payload from an answers map (edit-form hydration).
 * Defaults follow the legacy zod schemas: booleans `false`, numbers `0`,
 * arrays `[]`, free-text `undefined`.
 */
export function fromAnswers(
  assessmentType: RapidAssessmentType,
  answers: RapidAssessmentAnswers | null | undefined
): Record<string, AnswerValue> {
  const catalog = catalogForType(assessmentType)
  const source = answers ?? {}
  const result: Record<string, AnswerValue> = {}
  for (const section of catalog.sections) {
    for (const question of section.questions) {
      const value = source[question.questionKey]
      switch (question.questionType) {
        case 'BOOLEAN':
          result[question.questionKey] = typeof value === 'boolean' ? value : false
          break
        case 'NUMBER':
          result[question.questionKey] = typeof value === 'number' ? value : 0
          break
        case 'MULTI_SELECT':
          result[question.questionKey] = coerceArray(value)
          break
        case 'SINGLE_CHOICE':
          result[question.questionKey] = typeof value === 'string' ? value : ''
          break
        case 'TEXT_LONG':
        default:
          result[question.questionKey] = typeof value === 'string' ? value : undefined
          break
      }
    }
  }
  return result
}

/**
 * Projects registry question rows into the immutable per-assessment snapshot.
 * Sections are ordered by `section.order`, questions by `order`; the snapshot
 * copies presentation + gap metadata so historical assessments render identically
 * even if the live registry changes later. Severity is intentionally excluded —
 * it is a live registry derivation, never frozen into a snapshot.
 */
export function buildQuestionSnapshot(
  questions: RegistryQuestionRow[],
  versions: RegistryVersions
): QuestionSnapshot {
  const sectionMap = new Map<
    string,
    { section: NonNullable<RegistryQuestionRow['section']>; questions: RegistryQuestionRow[] }
  >()

  for (const question of questions) {
    const section = question.section ?? {
      sectionKey: question.sectionId,
      title: question.sectionId,
      description: null,
      category: 'CONTEXT',
      order: Number.MAX_SAFE_INTEGER,
    }
    const bucket = sectionMap.get(question.sectionId)
    if (bucket) {
      bucket.questions.push(question)
    } else {
      sectionMap.set(question.sectionId, { section, questions: [question] })
    }
  }

  const sections: RapidAssessmentSection[] = Array.from(sectionMap.entries())
    .map(([sectionId, { section, questions: sectionQuestions }]) => ({
      id: sectionId,
      key: section.sectionKey,
      title: section.title,
      description: section.description ?? null,
      category: section.category,
      order: section.order,
      questions: sectionQuestions
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((q) => ({
          id: q.id,
          key: q.questionKey,
          label: q.label,
          helperText: q.helperText ?? null,
          type: q.questionType,
          required: q.required,
          options: q.options ?? null,
          category: q.category,
          inverted: q.inverted,
          gapLabel: q.gapLabel ?? null,
          gapMeaning: q.gapMeaning ?? null,
          recommendation: q.recommendation ?? null,
          numberMin: q.numberMin ?? null,
          numberMax: q.numberMax ?? null,
          order: q.order,
        })),
    }))
    .sort((a, b) => a.order - b.order)

  return {
    structureVersion: versions.structureVersion,
    contentVersion: versions.contentVersion,
    generatedAt: new Date().toISOString(),
    sections,
  }
}

export { ASSESSMENT_TYPES }
