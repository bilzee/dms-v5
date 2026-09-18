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
 * - `hydrateFromSnapshot` — snapshot-driven hydration: typed values for every
 *   key of a snapshot's sections (raw passthrough + `unmappedKeys` for
 *   drifted keys, never fabricating defaults)
 * - `fromAnswers` — catalog-hydration wrapper over `hydrateFromSnapshot`
 *   (read-side hydration with the legacy typed defaults, tolerant of missing
 *   keys, dropping unknown ones)
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

// ---------------------------------------------------------------------------
// Snapshot hydration (P10-1)
// ---------------------------------------------------------------------------

/**
 * Loose structural view of a question snapshot: `sections[].questions[]` each
 * carrying `{ key, type }`. Deliberately permissive so stored
 * `RapidAssessment.questionSnapshot` JSON, live `QuestionSnapshot` objects,
 * catalog projections, and test fixtures all fit without adapters.
 */
export interface SnapshotHydrationStructure {
  sections?: unknown
}

/** Result of snapshot hydration: typed values + the raw-drift manifest. */
export interface HydratedAnswers {
  /**
   * Every question key of the structure hydrated to its typed default/value,
   * plus the RAW stored value for unmapped keys (present in `answers` but in
   * neither the structure nor the catalog) — typed defaults are never
   * fabricated for unknown keys.
   */
  values: Record<string, AnswerValue>
  /** Answer keys present in neither the structure nor the catalog (drift). */
  unmappedKeys: string[]
}

/** Hydrates one value against its question type (default on shape mismatch). */
function hydrateTypedValue(questionType: unknown, value: unknown): AnswerValue {
  switch (questionType) {
    case 'BOOLEAN':
      return typeof value === 'boolean' ? value : false
    case 'NUMBER':
      return typeof value === 'number' ? value : 0
    case 'MULTI_SELECT':
      return coerceArray(value)
    case 'SINGLE_CHOICE':
      return typeof value === 'string' ? value : ''
    case 'TEXT_LONG':
    default:
      return typeof value === 'string' ? value : undefined
  }
}

/**
 * Hydrates a stored answers map against a snapshot structure (pure; never
 * throws). Every question of every section is emitted with its typed value or
 * type default (booleans `false`, numbers `0`, arrays `[]`, choices `''`,
 * free-text `undefined`); answer keys found in neither the structure nor the
 * catalog pass through RAW and are listed in `unmappedKeys` — mirroring the
 * gap-engine's drift semantics (no fabricated defaults for unknown keys).
 */
export function hydrateFromSnapshot(
  structure: SnapshotHydrationStructure | null | undefined,
  answers: Record<string, unknown> | null | undefined
): HydratedAnswers {
  const source = answers ?? {}
  const values: Record<string, AnswerValue> = {}
  const present = new Set<string>()

  const sections = Array.isArray(structure?.sections) ? (structure!.sections as unknown[]) : []
  for (const section of sections) {
    const questions = Array.isArray((section as { questions?: unknown })?.questions)
      ? ((section as { questions: unknown[] }).questions as unknown[])
      : []
    for (const question of questions) {
      const key = (question as { key?: unknown })?.key
      if (typeof key !== 'string') continue
      present.add(key)
      values[key] = hydrateTypedValue((question as { type?: unknown })?.type, source[key])
    }
  }

  const unmappedKeys: string[] = []
  for (const key of Object.keys(source)) {
    if (!present.has(key)) {
      unmappedKeys.push(key)
      values[key] = source[key] as AnswerValue
    }
  }
  return { values, unmappedKeys }
}

// Module-level memo: catalog structure per type (`{questionKey, questionType}`
// mapped once to `{key, type}`), so `fromAnswers` never re-projects the catalog.
const catalogStructureMemo = new Map<RapidAssessmentType, SnapshotHydrationStructure>()

function catalogStructureFor(assessmentType: RapidAssessmentType): SnapshotHydrationStructure {
  const memoized = catalogStructureMemo.get(assessmentType)
  if (memoized) return memoized
  const catalog = catalogForType(assessmentType)
  const structure: SnapshotHydrationStructure = {
    sections: catalog.sections.map((section) => ({
      questions: section.questions.map((question) => ({
        key: question.questionKey,
        type: question.questionType,
      })),
    })),
  }
  catalogStructureMemo.set(assessmentType, structure)
  return structure
}

/**
 * Rebuilds a fully-defaulted form-values object from an answers map
 * (read/detail-page hydration). Defaults follow the legacy form schemas:
 * booleans `false`, numbers `0`, arrays `[]`, choices `''`, free-text
 * `undefined`. Unknown/absent keys fall back to the default for their
 * catalog question type.
 *
 * Thin wrapper over `hydrateFromSnapshot` with the memoized catalog structure
 * (P10-1): output is byte-identical to the pre-P10 implementation for the 55
 * catalog keys, and unknown (unmapped) keys are still dropped.
 */
export function fromAnswers(
  assessmentType: RapidAssessmentType,
  answers: RapidAssessmentAnswers | null | undefined
): Record<string, AnswerValue> {
  const { values, unmappedKeys } = hydrateFromSnapshot(
    catalogStructureFor(assessmentType),
    answers
  )
  for (const key of unmappedKeys) delete values[key]
  return values
}

export { ASSESSMENT_TYPES }
