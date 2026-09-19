/**
 * Dynamic Question Registry — P5 offline answer ingestion.
 *
 * Offline submissions are NEVER REJECTED for registry drift (ruling 7): a
 * field assessor's answers were captured against the client's registry view,
 * which may be older than the server's current registry. Instead of the
 * online path's strict strip/422 semantics, offline ingestion:
 *
 *   - keeps EVERY non-null answer verbatim — nothing is discarded. Known
 *     MULTI_SELECT values that replayed as JSON strings (p4 deferred BH-6)
 *     are normalized to arrays; anything not safely coercible is kept as-is.
 *   - classifies drift into warnings (never errors):
 *       added   — active registry keys absent from answers (the assessor
 *                 never saw them; they render unanswered)
 *       removed — answered keys whose registry row exists but is inactive
 *       unknown — answered keys with no registry row at all
 *
 * Classification needs ALL registry rows of the type (active + inactive);
 * the gap engine separately renders answered keys that fall outside the
 * frozen snapshot as source-'unknown' informational rows.
 *
 * Pure module (like the gap engine): deterministic, no I/O, no clock.
 */

import type { RapidAssessmentType } from './answers'

export type OfflineSyncWarningType = 'added' | 'removed' | 'unknown'

/** Drift record surfaced per assessment sync result (response-only). */
export interface OfflineSyncWarning {
  assessmentId: string
  key: string
  type: OfflineSyncWarningType
  message: string
}

/** Per-list drift buckets surfaced to the syncing client. */
export interface OfflineIngestWarnings {
  added: string[]
  removed: string[]
  unknown: string[]
}

export interface OfflineIngestResult {
  /** The ingested answers map — every non-null value, verbatim (normalized MULTI_SELECTs included). */
  answers: Record<string, unknown>
  warnings: OfflineIngestWarnings
  /** MULTI_SELECT keys whose replayed string could not be normalized (stored verbatim, flagged). */
  unparsedKeys: string[]
}

/** Result of the shared MULTI_SELECT replay normalization (transport boundary). */
export interface NormalizedAnswerValues {
  answers: Record<string, unknown>
  /** MULTI_SELECT keys whose string value was kept verbatim because it could not parse into a string array. */
  unparsedKeys: string[]
}

/** Live registry row projection used for warning classification. */
export interface OfflineRegistryRow {
  questionKey: string
  isActive: boolean
}

/** Snapshot-shaped object with sections[].questions[] carrying key + type. */
type SnapshotLike = {
  sections?: Array<{ questions?: Array<{ key?: unknown; type?: unknown }> }>
} | null | undefined

/** Extracts the question keys of a snapshot in presentation order. */
export function snapshotQuestionKeys(snapshot: SnapshotLike): string[] {
  const keys: string[] = []
  for (const section of snapshot?.sections ?? []) {
    for (const question of section.questions ?? []) {
      if (typeof question?.key === 'string' && question.key.length > 0) keys.push(question.key)
    }
  }
  return keys
}

/** Question key → question type map for a snapshot. */
function snapshotTypeMap(snapshot: SnapshotLike): Map<string, string> {
  const map = new Map<string, string>()
  for (const section of snapshot?.sections ?? []) {
    for (const question of section.questions ?? []) {
      if (typeof question?.key === 'string' && typeof question.type === 'string') {
        map.set(question.key, question.type)
      }
    }
  }
  return map
}

/**
 * Parses a JSON-string multi-select replay (P10-4 / deferred BH-6):
 * `'["Malaria"]'` → `['Malaria']`. Only a clean string-array replay
 * normalizes; anything else (unparseable, non-array, or entries the form
 * could not have produced) fails — filtering in place would silently
 * discard captured data.
 */
function parseMultiSelectReplay(value: string): { ok: true; values: string[] } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
      return { ok: true, values: parsed }
    }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}

/**
 * Shared MULTI_SELECT replay normalization at the offline transport boundary
 * (idempotent): every non-null answer is kept; MULTI_SELECT keys carrying a
 * JSON string normalize to arrays, keys whose string cannot parse into a
 * string array stay VERBATIM (never-reject) and are reported in
 * `unparsedKeys` so the stored gapAnalysis can flag them.
 */
export function normalizeAnswerValues(
  answers: Record<string, unknown> | null | undefined,
  questionTypes: ReadonlyMap<string, string>
): NormalizedAnswerValues {
  const normalized: Record<string, unknown> = {}
  const unparsedKeys: string[] = []
  for (const [key, value] of Object.entries(answers ?? {})) {
    // Never materialize undefined/null into storage (answers contract parity).
    if (value === undefined || value === null) continue
    if (questionTypes.get(key) === 'MULTI_SELECT' && typeof value === 'string') {
      const replay = parseMultiSelectReplay(value)
      if (replay.ok) {
        normalized[key] = replay.values
      } else {
        normalized[key] = value
        unparsedKeys.push(key)
      }
    } else {
      normalized[key] = value
    }
  }
  return { answers: normalized, unparsedKeys }
}

/**
 * Ingests an offline answers map against the CURRENT frozen snapshot and ALL
 * live registry rows of the type. Never throws, never drops a non-null
 * answer — the result is always a storable answers map plus warnings.
 */
export function ingestOfflineAnswers(
  assessmentType: RapidAssessmentType,
  answers: Record<string, unknown> | null | undefined,
  snapshot: SnapshotLike,
  registryRows: readonly OfflineRegistryRow[] | null | undefined
): OfflineIngestResult {
  const types = snapshotTypeMap(snapshot)
  const rowByKey = new Map<string, OfflineRegistryRow>()
  for (const row of registryRows ?? []) {
    if (row && typeof row.questionKey === 'string') rowByKey.set(row.questionKey, row)
  }

  const { answers: normalizedAnswers, unparsedKeys } = normalizeAnswerValues(answers, types)

  const ingested: Record<string, unknown> = {}
  const removed: string[] = []
  const unknown: string[] = []

  for (const [key, value] of Object.entries(normalizedAnswers)) {
    ingested[key] = value

    const row = rowByKey.get(key)
    if (!row) unknown.push(key)
    else if (!row.isActive) removed.push(key)
  }

  // ADDED: active registry keys the answers carry no value for (documented
  // over-warning proxy — optional skipped answers also land here).
  const answered = new Set(Object.keys(ingested))
  const added: string[] = []
  for (const row of registryRows ?? []) {
    if (!row || !row.isActive || answered.has(row.questionKey)) continue
    if (!types.has(row.questionKey)) continue // active rows must be in the frozen snapshot
    added.push(row.questionKey)
  }

  void assessmentType
  return { answers: ingested, warnings: { added, removed, unknown }, unparsedKeys }
}

/** Stored gapAnalysis flag rows for unparseable MULTI_SELECT replays (additive, written only when non-empty). */
export interface AnswerNormalizationFlag {
  key: string
  message: string
}

/** Builds the additive `answerNormalizationFlags` gapAnalysis entries. */
export function toAnswerNormalizationFlags(unparsedKeys: readonly string[]): AnswerNormalizationFlag[] {
  return unparsedKeys.map((key) => ({
    key,
    message: `Answer for "${key}" was captured offline as an unparseable multi-select string; it was stored verbatim.`,
  }))
}

/** Builds the drift warning records for one assessment. */
export function toOfflineSyncWarnings(
  assessmentId: string,
  assessmentType: RapidAssessmentType,
  warnings: OfflineIngestWarnings
): OfflineSyncWarning[] {
  const records: OfflineSyncWarning[] = []
  for (const key of warnings.added) {
    records.push({
      assessmentId,
      key,
      type: 'added',
      message: `Question "${key}" was added to the ${assessmentType} registry after this assessment was captured offline; it is recorded as unanswered.`,
    })
  }
  for (const key of warnings.removed) {
    records.push({
      assessmentId,
      key,
      type: 'removed',
      message: `Question "${key}" is no longer active in the ${assessmentType} registry; its offline answer is retained unchanged.`,
    })
  }
  for (const key of warnings.unknown) {
    records.push({
      assessmentId,
      key,
      type: 'unknown',
      message: `Answer key "${key}" does not match any question in the ${assessmentType} registry; the value was retained unchanged.`,
    })
  }
  return records
}
