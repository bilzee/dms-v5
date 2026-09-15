/**
 * Pure gap derivation shared by the runtime analyzer (gap-analysis.service)
 * and the database seed — one source of truth for gap detection, the severity
 * MAX roll-up, and recommendation collection from registry question rows.
 * Callers filter to GAP questions before invoking.
 */

export interface GapDerivationQuestion {
  questionKey: string
  inverted: boolean
  severity: string
  recommendation: string | null
}

export interface DerivedGapAnalysis {
  hasGap: boolean
  gapFields: string[]
  severity: string
  recommendations: string[]
  fieldSeverityMap: Record<string, string>
}

const SEVERITY_ORDER: Record<string, number> = {
  UNCLASSIFIED: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
}

export function deriveGapAnalysisFromQuestions(
  questions: GapDerivationQuestion[],
  answers: Record<string, unknown>
): DerivedGapAnalysis {
  const gapFields: string[] = []
  const fieldSeverityMap: Record<string, string> = {}
  const recommendations: string[] = []
  let hasGap = false
  let severity = 'LOW'

  for (const question of questions) {
    const value = answers[question.questionKey]
    // Legacy semantics: inverted questions gap on true, everything else on falsy.
    const isGap = question.inverted ? value === true : !value
    if (!isGap) continue

    hasGap = true
    gapFields.push(question.questionKey)
    fieldSeverityMap[question.questionKey] = question.severity
    if (question.recommendation) {
      recommendations.push(question.recommendation)
    }
    if (SEVERITY_ORDER[question.severity] > SEVERITY_ORDER[severity]) {
      severity = question.severity
    }
  }

  return { hasGap, gapFields, severity, recommendations, fieldSeverityMap }
}
