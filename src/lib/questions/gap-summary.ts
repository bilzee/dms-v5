/**
 * P7 pure ranked-category-summary module (no I/O, no clock, no mocks).
 *
 * Derives the dashboard "gap summary cards" for one assessment type from the
 * STORED `gapAnalysis` of the latest assessments (the P3 engine output is the
 * single source of truth — this module never re-derives gaps from answers):
 * - a key is gapped for a reporting entity iff it appears in that entity's
 *   stored `gapAnalysis.gapFields`
 * - a row's severity is the MAX stored per-field severity across reporting
 *   entities (fieldSeverityMap; unmapped/invalid values floor to MEDIUM via
 *   the engine's normalizeGapSeverity)
 * - label/meaning/order come from the live registry projection
 *   (`SummaryQuestionMeta`, built by the situation route from
 *   `QuestionRegistryService.getQuestionSet` — labels/meanings/orders are
 *   always CURRENT, deactivation is prospective); keys absent from the live
 *   set fall back to the stored row's `gapLabel` → `label` → the key itself,
 *   with `meaning: null` and `order: +Infinity`
 * - rows are ranked severity DESC → spread DESC → registry order ASC → key ASC
 *   (individual-entity cards have constant spread, degrading to severity ×
 *   order), then sliced to the category row limit
 * - the overflow chip carries `{hiddenCount, highest hidden severity, count at
 *   that severity}` and ALL overflow rows are carried in `rows` so the card can
 *   expand without a refetch
 *
 * `resolveGapRowLimit` pins the §2.7 setting clamp: 1..7, default 5 on
 * missing/non-number/zero/invalid values.
 */

import { normalizeGapSeverity, type GapSeverity } from './gap-engine'

export type { GapSeverity }

export const GAP_ROWS_PER_CATEGORY_DEFAULT = 5
export const GAP_ROWS_PER_CATEGORY_CEILING = 7

const SEVERITY_RANK: Record<GapSeverity, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }

/** Live-registry projection of one question (current label/meaning/order). */
export interface SummaryQuestionMeta {
  key: string
  label: string
  gapLabel: string | null
  gapMeaning: string | null
  category: 'GAP' | 'CONTEXT'
  questionType: string
  /** Monotonic presentation order across sections (registry order). */
  order: number
}

/**
 * Registry projection for one assessment type, embedded once per dashboard
 * payload (built by the situation route; consumed by the client panels).
 * Shared here so the route and client cannot drift apart.
 */
export interface QuestionTypeMetadata {
  questions: SummaryQuestionMeta[]
  structureVersion: number
  contentVersion: number
}

/** One ranked gap row rendered by a summary card. */
export interface CategoryGapRow {
  key: string
  /** Resolved display label: metadata gapLabel → label → stored fallback → key. */
  label: string
  /** Registry gapMeaning (null for keys absent from the live set). */
  meaning: string | null
  severity: GapSeverity
  /** Entities reporting the gap (always 1 for individual-entity cards). */
  spread: number
  /** Reporting denominator for the "N of M" chip. */
  total: number
  /** Registry presentation order (+Infinity for keys absent from the live set). */
  order: number
}

export interface GapSummaryStamp {
  contentVersion: number
  computedAt: string
}

export interface CategoryGapSummary {
  /** ALL ranked rows (the limit only affects hiddenCount — overflow rows are carried). */
  rows: CategoryGapRow[]
  totalGapRows: number
  hiddenCount: number
  /** Highest severity among hidden rows + how many hidden rows sit at it. */
  hiddenSeverityHint: { severity: GapSeverity; count: number } | null
  hasGaps: boolean
  overallSeverity: GapSeverity
  /** Present on aggregated summaries only (individual cards are unstamped). */
  stamp?: GapSummaryStamp
}

/** §2.7 setting clamp: 1..7; missing/non-number/0/invalid → default 5. */
export function resolveGapRowLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return GAP_ROWS_PER_CATEGORY_DEFAULT
  }
  return Math.min(Math.max(Math.floor(value), 1), GAP_ROWS_PER_CATEGORY_CEILING)
}

/** Severity DESC → spread DESC → registry order ASC → key ASC. Returns a new array. */
export function rankGapRows(rows: readonly CategoryGapRow[]): CategoryGapRow[] {
  return [...rows].sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (severityDiff !== 0) return severityDiff
    if (b.spread !== a.spread) return b.spread - a.spread
    if (a.order !== b.order) return a.order - b.order
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// Stored-shape readers (defensive: stored JSON is untyped)
// ---------------------------------------------------------------------------

interface StoredRowLike {
  key?: unknown
  label?: unknown
  gapLabel?: unknown
}

export interface StoredGapAnalysisLike {
  gapFields?: readonly unknown[]
  fieldSeverityMap?: Record<string, unknown>
  rows?: readonly StoredRowLike[]
}

export interface StoredAssessmentLike {
  gapAnalysis?: StoredGapAnalysisLike | null
}

interface AccumulatedGap {
  severity: GapSeverity
  spread: number
}

function accumulateStoredGaps(
  assessments: readonly StoredAssessmentLike[]
): { accumulated: Map<string, AccumulatedGap>; fallbackLabels: Map<string, string> } {
  const accumulated = new Map<string, AccumulatedGap>()
  const fallbackLabels = new Map<string, string>()

  for (const assessment of assessments) {
    const gapAnalysis = assessment?.gapAnalysis
    if (!gapAnalysis) continue

    const gapFields = Array.isArray(gapAnalysis.gapFields) ? gapAnalysis.gapFields : []
    const severityMap = gapAnalysis.fieldSeverityMap

    for (const rawKey of gapFields) {
      if (typeof rawKey !== 'string') continue
      const severity = normalizeGapSeverity(severityMap?.[rawKey])
      const existing = accumulated.get(rawKey)
      if (!existing) {
        accumulated.set(rawKey, { severity, spread: 1 })
      } else {
        if (SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity]) {
          existing.severity = severity
        }
        existing.spread += 1
      }
    }

    for (const row of Array.isArray(gapAnalysis.rows) ? gapAnalysis.rows : []) {
      if (!row || typeof row.key !== 'string' || fallbackLabels.has(row.key)) continue
      const label =
        (typeof row.gapLabel === 'string' && row.gapLabel) ||
        (typeof row.label === 'string' && row.label) ||
        ''
      if (label) fallbackLabels.set(row.key, label)
    }
  }

  return { accumulated, fallbackLabels }
}

function buildRows(
  accumulated: Map<string, AccumulatedGap>,
  fallbackLabels: Map<string, string>,
  metadata: ReadonlyMap<string, SummaryQuestionMeta>,
  total: number
): CategoryGapRow[] {
  const rows: CategoryGapRow[] = []
  for (const [key, { severity, spread }] of accumulated) {
    const meta = metadata.get(key)
    rows.push({
      key,
      label: meta ? (meta.gapLabel || meta.label) : (fallbackLabels.get(key) || key),
      meaning: meta?.gapMeaning ?? null,
      severity,
      spread,
      total,
      order: meta?.order ?? Number.POSITIVE_INFINITY,
    })
  }
  return rows
}

function finalizeSummary(
  rows: CategoryGapRow[],
  limit: number,
  stamp?: GapSummaryStamp
): CategoryGapSummary {
  const ranked = rankGapRows(rows)
  const hiddenCount = Math.max(0, ranked.length - limit)
  const hiddenRows = ranked.slice(limit)
  const hiddenSeverityHint =
    hiddenRows.length > 0
      ? {
          severity: hiddenRows[0].severity,
          count: hiddenRows.filter((row) => row.severity === hiddenRows[0].severity).length,
        }
      : null

  return {
    rows: ranked,
    totalGapRows: ranked.length,
    hiddenCount,
    hiddenSeverityHint,
    hasGaps: ranked.length > 0,
    overallSeverity: ranked.length > 0 ? ranked[0].severity : 'LOW',
    stamp,
  }
}

export interface BuildCategoryGapSummaryInput {
  assessments: readonly StoredAssessmentLike[]
  metadata?: readonly SummaryQuestionMeta[]
  limit?: number
  contentVersion?: number
  computedAt?: string
}

/**
 * Aggregated ("All Entities") summary for one assessment type: derives ranked
 * rows from the stored gapAnalysis of every latest assessment, labels them
 * from the live registry projection, and stamps contentVersion + computedAt
 * (both injected by the caller — no clock in here).
 */
export function buildCategoryGapSummary(input: BuildCategoryGapSummaryInput): CategoryGapSummary {
  const limit = resolveGapRowLimit(input.limit)
  const metadata = new Map((input.metadata ?? []).map((meta) => [meta.key, meta]))
  const { accumulated, fallbackLabels } = accumulateStoredGaps(input.assessments)
  const rows = buildRows(accumulated, fallbackLabels, metadata, input.assessments.length)

  const stamp =
    input.contentVersion !== undefined && input.computedAt !== undefined
      ? { contentVersion: input.contentVersion, computedAt: input.computedAt }
      : undefined

  return finalizeSummary(rows, limit, stamp)
}

/**
 * Individual-entity summary for one assessment type: the same join/ranking/
 * limit/chip contract over a single stored gapAnalysis, with spread locked to
 * 1 (severity × order ranking) and no stamp (registry-stamped aggregates only).
 */
export function buildIndividualGapSummary(
  gapAnalysis: StoredGapAnalysisLike | null | undefined,
  metadata: readonly SummaryQuestionMeta[] | undefined,
  limit: number
): CategoryGapSummary {
  return buildCategoryGapSummary({
    assessments: [{ gapAnalysis: gapAnalysis ?? null }],
    metadata,
    limit,
  })
}
