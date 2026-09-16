/**
 * Dynamic Question Registry — per-assessment question snapshot projection.
 *
 * `buildQuestionSnapshot(questions, versions)` freezes the presentation +
 * gap metadata of a registry's questions at answer time into
 * `RapidAssessment.questionSnapshot`, so historical assessments render and
 * re-derive identically even if the live registry changes later.
 *
 * Structure-only by design: `severity` is deliberately NOT projected — it
 * stays live in the registry (the P3 severity ladder resolves it there), so
 * snapshots never carry it.
 */

import type { RegistryVersions } from './registry-versions'

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

/**
 * Projects registry question rows into the immutable per-assessment snapshot.
 * Sections are ordered by `section.order`, questions by `order`; the snapshot
 * copies presentation + gap metadata. Severity is intentionally excluded —
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
