/**
 * Dynamic Question Registry — canonical answers map layer.
 *
 * `RapidAssessment.answers` is the single store of type-specific answers:
 * `{ [questionKey]: boolean | number | string | string[] }`, validated against
 * the CURRENT registry snapshot by `buildAssessmentSchema` (see
 * `src/lib/validation/dynamic-assessment.ts`) on both the client and the
 * server. The typed transport (`healthData` and friends) and its converter
 * were deleted with the six hardcoded forms (P4).
 *
 * This module owns:
 * - the answer value types (`AnswerValue`, `RapidAssessmentAnswers`)
 * - `questionKeysForType` — catalog presentation order
 * - `fromAnswers` — read-side hydration: rebuild a fully-defaulted form values
 *   object (booleans `false`, numbers `0`, arrays `[]`, choices `''`, free
 *   text `undefined`) from a stored answers map, tolerant of missing keys.
 */

import {
  ASSESSMENT_TYPES,
  CatalogAssessmentType,
  QUESTION_CATALOG,
} from './registry-validation'

export type RapidAssessmentType = CatalogAssessmentType

/** Values storable in `RapidAssessment.answers`. */
export type AnswerValue = boolean | number | string | string[] | undefined
export type RapidAssessmentAnswers = Record<string, AnswerValue>

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

/** Normalizes any stored value into a string array (multi-select answer). */
export function coerceArray(value: unknown): string[] {
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
 * Rebuilds a fully-defaulted form-values object from an answers map
 * (read/detail-page hydration). Defaults follow the legacy form schemas:
 * booleans `false`, numbers `0`, arrays `[]`, choices `''`, free-text
 * `undefined`. Unknown/absent keys fall back to the default for their
 * catalog question type.
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

export { ASSESSMENT_TYPES }
