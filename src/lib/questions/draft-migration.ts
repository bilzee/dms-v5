/**
 * Dynamic Question Registry — P5 offline draft migration.
 *
 * localStorage drafts (`rapid-assessment-drafts`, written by
 * `useRapidAssessmentDrafts`) predate the registry in the wild. Two shapes
 * exist in storage:
 *
 *   LEGACY (typed forms, pre-p1) — `data` IS the answers map: flat typed
 *     fields keyed by (what became) question keys, no `answers` wrapper, no
 *     `structureVersion`/`questionKeys`.
 *   REGISTRY — `data = { answers, assessorName?, rapidAssessmentDate?,
 *     location?, photos?, gpsLocation?, structureVersion?, questionKeys? }`
 *     (older registry drafts may lack the version fields).
 *
 * Migration maps BY QUESTION KEY against the CURRENT snapshot:
 *   - keys present in the snapshot hydrate the form (carried);
 *   - keys absent from the snapshot are UNMAPPED: they never hydrate (no
 *     widget exists) but are KEPT in storage under `data.unmappedAnswers` —
 *     never silently dropped (ruling 7's spirit) — and surfaced in the UI;
 *   - `structureVersion` defaults to 1 and `questionKeys` falls back to the
 *     seed catalog (`questionKeysForType`) when the draft predates versioning.
 *
 * `restoreOfflineDraft` is pure and DOM-free (Node-testable); callers provide
 * the snapshot. `applyDraftMigration` persists the normalized draft through
 * the drafts-hook storage (localStorage `rapid-assessment-drafts`) unless a
 * custom `migrate` writer is injected (tests).
 */

import { questionKeysForType, type RapidAssessmentType } from './answers'
import { snapshotQuestionKeys } from './offline-answers'

/** Any snapshot-shaped object with sections[].questions[].key. */
type SnapshotLike = { sections?: Array<{ questions?: Array<{ key?: unknown }> }> } | null | undefined

/** localStorage key shared with `useRapidAssessmentDrafts`. */
export const DRAFTS_STORAGE_KEY = 'rapid-assessment-drafts'

/** Structural shape of a stored draft record (subset the migration reads). */
export interface DraftRecord {
  id: string
  assessmentType?: string
  entityId?: string
  incidentId?: string
  data?: Record<string, unknown> | null
}

/** An unmapped answer — kept in storage, never dropped, never hydrated. */
export interface UnmappedAnswer {
  key: string
  value: unknown
}

/** Result of reconciling a stored draft against the current snapshot. */
export interface RestoredOfflineDraft {
  /** Snapshot-mapped answers only (unmapped keys never hydrate the form). */
  answers: Record<string, unknown>
  /** Answers that no longer map to a question — kept in storage. */
  unmappedAnswers: UnmappedAnswer[]
  /** How many answers carried over (the receipt's N). */
  carried: number
  /** The draft's declared structure version (1 when it predates versioning). */
  structureVersion: number
  /** The draft's declared question-key view (catalog fallback for legacy drafts). */
  questionKeys: string[]
  /** True when the draft predated the answers shape (typed-forms era). */
  legacy: boolean
}

/** Draft meta keys that are not answers in registry-shaped drafts. */
const META_KEYS = new Set([
  'answers',
  'assessorName',
  'rapidAssessmentDate',
  'location',
  'photos',
  'gpsLocation',
  'structureVersion',
  'questionKeys',
  'unmappedAnswers',
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Reconciles a stored offline draft against the CURRENT registry snapshot.
 * Pure: no I/O, no DOM, no clock. Legacy typed drafts (flat `data`) map by
 * question key; unmapped answers are reported, never dropped.
 */
export function restoreOfflineDraft(
  assessmentType: RapidAssessmentType,
  snapshot: SnapshotLike,
  draft: DraftRecord | null | undefined
): RestoredOfflineDraft {
  const data = isPlainObject(draft?.data) ? draft!.data : {}
  const answersWrapper = isPlainObject(data.answers) ? data.answers : null
  const legacy = answersWrapper === null
  const rawAnswers: Record<string, unknown> = legacy
    ? Object.fromEntries(Object.entries(data).filter(([key]) => !META_KEYS.has(key)))
    : answersWrapper

  const structureVersion =
    typeof data.structureVersion === 'number' && Number.isFinite(data.structureVersion)
      ? data.structureVersion
      : 1

  const questionKeys = Array.isArray(data.questionKeys)
    ? data.questionKeys.filter((key): key is string => typeof key === 'string')
    : questionKeysForType(assessmentType)

  // Previously stored unmapped answers survive every re-migration — the
  // reconciliation below only appends keys newly absent from the snapshot.
  const priorUnmapped: UnmappedAnswer[] = Array.isArray(data.unmappedAnswers)
    ? data.unmappedAnswers.filter(
        (entry): entry is UnmappedAnswer =>
          isPlainObject(entry) && typeof entry.key === 'string' && entry.key.length > 0 && 'value' in entry
      )
    : []
  const unmappedByKey = new Map<string, UnmappedAnswer>(
    priorUnmapped.map((entry) => [entry.key, entry])
  )

  const snapshotKeys = new Set(snapshotQuestionKeys(snapshot))
  const answers: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rawAnswers)) {
    if (value === undefined || value === null) continue
    if (snapshotKeys.has(key)) {
      answers[key] = value
    } else if (!unmappedByKey.has(key)) {
      unmappedByKey.set(key, { key, value })
    }
  }
  const unmappedAnswers = [...unmappedByKey.values()]

  return {
    answers,
    unmappedAnswers,
    carried: Object.keys(answers).length,
    structureVersion,
    questionKeys,
    legacy,
  }
}

/** Normalized draft payload persisted by the migration (unmapped kept). */
export interface NormalizedDraftData {
  answers: Record<string, unknown>
  structureVersion: number
  questionKeys: string[]
  unmappedAnswers: UnmappedAnswer[]
}

export interface DraftMigrationOptions {
  assessmentType: RapidAssessmentType
  snapshot: SnapshotLike
  /** Storage writer; defaults to the drafts-hook localStorage persistence. */
  migrate?: (normalized: NormalizedDraftData) => void
}

/**
 * Reconciles a stored draft against the current snapshot and persists the
 * normalized `{ answers, structureVersion, questionKeys, unmappedAnswers }`
 * payload — unmapped answers are KEPT under `unmappedAnswers`, never dropped.
 * Returns the same reconciliation result as `restoreOfflineDraft` so callers
 * drive their receipt/banners from it.
 */
export function applyDraftMigration(
  draft: DraftRecord | null | undefined,
  options: DraftMigrationOptions
): RestoredOfflineDraft {
  const restored = restoreOfflineDraft(options.assessmentType, options.snapshot, draft)

  const normalized: NormalizedDraftData = {
    answers: restored.answers,
    structureVersion: restored.structureVersion,
    questionKeys: restored.questionKeys,
    unmappedAnswers: restored.unmappedAnswers,
  }

  if (options.migrate) {
    options.migrate(normalized)
    return restored
  }

  // Default writer: update the draft record in the shared localStorage store.
  if (typeof window !== 'undefined' && draft) {
    try {
      const raw = window.localStorage.getItem(DRAFTS_STORAGE_KEY)
      const drafts = raw ? (JSON.parse(raw) as DraftRecord[]) : []
      const index = drafts.findIndex((entry) => entry.id === draft.id)
      if (index !== -1) {
        drafts[index] = {
          ...drafts[index],
          data: {
            ...drafts[index].data,
            answers: normalized.answers,
            structureVersion: normalized.structureVersion,
            questionKeys: normalized.questionKeys,
            unmappedAnswers: normalized.unmappedAnswers,
          },
        }
        window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts))
      }
    } catch {
      // localStorage may be full, unavailable, or hold corrupted JSON — the
      // in-memory reconciliation result still drives the UI.
    }
  }

  return restored
}
