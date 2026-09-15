/**
 * Dynamic Question Registry — P3 pure gap engine.
 *
 * One evaluation path for every assessment type (including POPULATION, which
 * simply has zero GAP questions and therefore derives LOW):
 *
 *   analyzeGaps(snapshotStructure, answers, registryRows)
 *
 * Inputs:
 * - `snapshotStructure` — the structure the assessment was answered against
 *   (a live `QuestionSnapshot` for new assessments, or the stored
 *   `RapidAssessment.questionSnapshot` JSON for re-derivation). It defines
 *   WHICH questions are GAP questions, their `inverted` semantics, their
 *   frozen presentation text, and their ordering.
 * - `answers` — the canonical answers map (`answers[key]`). A GAP condition
 *   is strictly `inverted ? answers[key] === true : answers[key] === false`;
 *   `undefined`/`null` means the question was never answered (never a gap).
 * - `registryRows` — ALL live registry rows of the type (regardless of
 *   `isActive`), used only to resolve each key's severity via the ladder:
 *
 * Severity resolution ladder per snapshot GAP key:
 *   1. live registry row (matched by key, regardless of isActive) → source 'registry'
 *   2. severity frozen in the snapshot itself (current snapshots carry none —
 *      the field is optional so a future snapshot format needs no engine edit)
 *      → source 'snapshot'
 *   3. nothing → source 'unmapped' with severity MEDIUM
 *
 * Assessment severity = MAX severity over gapped fields (CRITICAL > HIGH >
 * MEDIUM > LOW), LOW when there are no gaps. Unknown/unparseable severities
 * floor at MEDIUM — never silently LOW.
 *
 * The engine is a PURE function of its inputs (no I/O, no clock, stable
 * ordering): a second derivation pass with unchanged inputs is byte-identical.
 */

/** The four severities a GAP field can carry (never UNCLASSIFIED). */
export type GapSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

/** Where a row's resolved severity came from — the ladder audit surface. */
export type GapRowSource = 'registry' | 'snapshot' | 'unmapped'

const SEVERITY_WEIGHT: Record<GapSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

export function normalizeGapSeverity(value: unknown): GapSeverity {
  return typeof value === 'string' && value in SEVERITY_WEIGHT
    ? (value as GapSeverity)
    : 'MEDIUM'
}

export interface GapEngineSnapshotQuestion {
  /** Question key (camelCase, e.g. hasFunctionalClinic). */
  key: string
  label?: string | null
  /** Question type; GAP questions are BOOLEAN, but the engine does not require it. */
  type?: string | null
  /** 'GAP' | 'CONTEXT' — only GAP questions participate in derivation. */
  category?: string | null
  /** true → `answers[key] === true` is the gap condition. */
  inverted?: boolean | null
  gapLabel?: string | null
  gapMeaning?: string | null
  recommendation?: string | null
  /** Dormant rung of the severity ladder — snapshots today carry none. */
  severity?: string | null
  /** 1-based order within the section. */
  order?: number | null
}

export interface GapEngineSnapshotSection {
  order?: number | null
  questions?: readonly GapEngineSnapshotQuestion[]
}

/** Loosely typed so live snapshots, stored snapshot JSON, and fixtures all fit. */
export interface GapEngineSnapshotStructure {
  sections?: readonly GapEngineSnapshotSection[]
}

/** A live registry row — only `questionKey` + `severity` drive the ladder. */
export interface GapEngineRegistryRow {
  questionKey: string
  severity?: string | null
}

export interface GapEngineRow {
  key: string
  label: string
  gapLabel: string | null
  severity: GapSeverity
  source: GapRowSource
  recommendation: string | null
  unanswered: boolean
}

export interface GapEngineResult {
  hasGap: boolean
  gapFields: string[]
  severity: GapSeverity
  recommendations: string[]
  fieldSeverityMap: Record<string, GapSeverity>
  /** Truth table: one row per GAP question in the snapshot, presentation order. */
  rows: GapEngineRow[]
  /** Keys of GAP questions with no answer (never gaps, flagged not fabricated). */
  unanswered: string[]
}

interface GapCandidate {
  question: GapEngineSnapshotQuestion
  /** Presentation order: section order, then question order, then position. */
  sectionOrder: number
  order: number
  index: number
}

function collectGapCandidates(structure: GapEngineSnapshotStructure | null | undefined): GapCandidate[] {
  const sections = Array.isArray(structure?.sections) ? structure.sections : []
  const candidates: GapCandidate[] = []
  let index = 0
  for (let sectionIdx = 0; sectionIdx < sections.length; sectionIdx++) {
    const section = sections[sectionIdx]
    const questions = Array.isArray(section?.questions) ? section.questions : []
    const sectionOrder = typeof section?.order === 'number' ? section.order : sectionIdx + 1
    for (let questionIdx = 0; questionIdx < questions.length; questionIdx++) {
      const question = questions[questionIdx]
      if (!question || question.category !== 'GAP') continue
      candidates.push({
        question,
        sectionOrder,
        order: typeof question.order === 'number' ? question.order : questionIdx + 1,
        index: index++,
      })
    }
  }
  return candidates
}

export function analyzeGaps(
  snapshotStructure: GapEngineSnapshotStructure | null | undefined,
  answers: Record<string, unknown> | null | undefined,
  registryRows: readonly GapEngineRegistryRow[] | null | undefined
): GapEngineResult {
  const registryByQuestionKey = new Map<string, GapEngineRegistryRow>()
  for (const row of registryRows ?? []) {
    if (row && typeof row.questionKey === 'string') {
      registryByQuestionKey.set(row.questionKey, row)
    }
  }

  const answerMap = answers ?? {}
  const rows: Array<GapEngineRow & { candidate: GapCandidate; isGap: boolean }> = []

  for (const candidate of collectGapCandidates(snapshotStructure)) {
    const { question } = candidate
    const answer = answerMap[question.key]
    const missing = answer === undefined || answer === null
    const isGap = !missing && (question.inverted === true ? answer === true : answer === false)

    const liveRow = registryByQuestionKey.get(question.key)
    let severity: GapSeverity
    let source: GapRowSource
    if (liveRow) {
      severity = normalizeGapSeverity(liveRow.severity)
      source = 'registry'
    } else if (question.severity !== undefined && question.severity !== null) {
      severity = normalizeGapSeverity(question.severity)
      source = 'snapshot'
    } else {
      severity = 'MEDIUM'
      source = 'unmapped'
    }

    rows.push({
      key: question.key,
      label: typeof question.label === 'string' && question.label.length > 0 ? question.label : question.key,
      gapLabel: typeof question.gapLabel === 'string' ? question.gapLabel : null,
      severity,
      source,
      recommendation: typeof question.recommendation === 'string' ? question.recommendation : null,
      unanswered: missing,
      candidate,
      isGap,
    })
  }

  const gapped = rows.filter((row) => row.isGap)
  // Gap surfaces are ordered severity DESC, then presentation order ASC —
  // deterministic, so identical inputs produce byte-identical output.
  const sorted = [...gapped].sort((a, b) => {
    const weightDiff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]
    if (weightDiff !== 0) return weightDiff
    if (a.candidate.sectionOrder !== b.candidate.sectionOrder) {
      return a.candidate.sectionOrder - b.candidate.sectionOrder
    }
    if (a.candidate.order !== b.candidate.order) return a.candidate.order - b.candidate.order
    return a.candidate.index - b.candidate.index
  })

  const gapFields = sorted.map((row) => row.key)
  const fieldSeverityMap: Record<string, GapSeverity> = {}
  for (const row of sorted) fieldSeverityMap[row.key] = row.severity
  const recommendations = sorted
    .map((row) => row.recommendation)
    .filter((recommendation): recommendation is string => recommendation !== null)

  return {
    hasGap: gapped.length > 0,
    gapFields,
    severity: sorted.length > 0 ? sorted[0].severity : 'LOW',
    recommendations,
    fieldSeverityMap,
    rows: rows.map(({ candidate, isGap, ...row }) => row),
    unanswered: rows.filter((row) => row.unanswered).map((row) => row.key),
  }
}
