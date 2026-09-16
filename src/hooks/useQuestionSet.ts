/**
 * Dynamic Question Registry — live question set hook (P4).
 *
 * `useQuestionSet(assessmentType)` loads the CURRENT registry question set
 * for a type from `GET /api/v1/questions?assessmentType=` via React Query and
 * normalizes the raw registry rows into snapshot-style definitions the
 * `DynamicAssessmentForm` renders from:
 *
 * - sections/questions keyed by `key` / `type` (snapshot naming),
 * - `options` parsed into `QuestionOption[]`,
 * - `severity` retained (preview severities must match the server's ladder).
 *
 * The hook deliberately does NO answer logic — defaults/hydration live in
 * `@/lib/questions/answers`, submit validation in
 * `@/lib/validation/dynamic-assessment`.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { RapidAssessmentType } from '@/lib/questions/answers'

/** Selectable option for SINGLE_CHOICE / MULTI_SELECT questions (registry `options` JSON). */
export interface QuestionOption {
  value: string
  label: string
  description?: string
}

export interface QuestionDef {
  key: string
  type: string
  label: string
  helperText: string | null
  required: boolean
  options: QuestionOption[]
  category: string
  inverted: boolean
  gapLabel: string | null
  gapMeaning: string | null
  recommendation: string | null
  severity: string | null
  numberMin: number | null
  numberMax: number | null
  order: number
}

export interface QuestionSectionDef {
  key: string
  title: string
  description: string | null
  category: string
  order: number
  questions: QuestionDef[]
}

export interface QuestionSetView {
  sections: QuestionSectionDef[]
  questions: QuestionDef[]
  structureVersion: number
  contentVersion: number
}

/** Raw question row as returned by the questions route. */
interface QuestionRow {
  questionKey: string
  questionType: string
  label: string
  helperText?: string | null
  required?: boolean
  options?: unknown
  category?: string
  inverted?: boolean
  gapLabel?: string | null
  gapMeaning?: string | null
  recommendation?: string | null
  severity?: string | null
  numberMin?: number | null
  numberMax?: number | null
  order?: number
}

interface SectionRow {
  sectionKey: string
  title: string
  description?: string | null
  category?: string
  order?: number
  questions: QuestionRow[]
}

interface QuestionSetResponse {
  sections: SectionRow[]
  structureVersion: number
  contentVersion: number
}

function normalizeOptions(options: unknown): QuestionOption[] {
  if (!Array.isArray(options)) return []
  const parsed: QuestionOption[] = []
  for (const option of options) {
    if (
      typeof option === 'object' &&
      option !== null &&
      typeof (option as { value?: unknown }).value === 'string' &&
      typeof (option as { label?: unknown }).label === 'string'
    ) {
      const record = option as { value: string; label: string; description?: unknown }
      parsed.push({
        value: record.value,
        label: record.label,
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
      })
    }
  }
  return parsed
}

function normalizeQuestion(row: QuestionRow): QuestionDef {
  return {
    key: row.questionKey,
    type: row.questionType,
    label: row.label,
    helperText: row.helperText ?? null,
    required: row.required === true,
    options: normalizeOptions(row.options),
    category: row.category ?? 'CONTEXT',
    inverted: row.inverted === true,
    gapLabel: row.gapLabel ?? null,
    gapMeaning: row.gapMeaning ?? null,
    recommendation: row.recommendation ?? null,
    severity: row.severity ?? null,
    numberMin: typeof row.numberMin === 'number' ? row.numberMin : null,
    numberMax: typeof row.numberMax === 'number' ? row.numberMax : null,
    order: typeof row.order === 'number' ? row.order : 0,
  }
}

function normalizeQuestionSet(data: QuestionSetResponse): QuestionSetView {
  const sections: QuestionSectionDef[] = (data.sections ?? [])
    .map((section) => ({
      key: section.sectionKey,
      title: section.title,
      description: section.description ?? null,
      category: section.category ?? 'CONTEXT',
      order: typeof section.order === 'number' ? section.order : 0,
      questions: (section.questions ?? []).map(normalizeQuestion),
    }))
    .sort((a, b) => a.order - b.order)

  return {
    sections,
    questions: sections.flatMap((section) => section.questions),
    structureVersion: typeof data.structureVersion === 'number' ? data.structureVersion : 1,
    contentVersion: typeof data.contentVersion === 'number' ? data.contentVersion : 1,
  }
}

async function fetchQuestionSet(assessmentType: RapidAssessmentType): Promise<QuestionSetView> {
  const result = await apiGet(`/api/v1/questions?assessmentType=${assessmentType}`)
  if (!result.success) {
    throw new Error(result.error || 'Failed to load question set')
  }
  const payload = (result.data ?? {}) as Partial<QuestionSetResponse>
  if (!Array.isArray(payload.sections)) {
    throw new Error('Question set response is missing sections')
  }
  return normalizeQuestionSet(payload as QuestionSetResponse)
}

/**
 * Loads the live registry question set for one assessment type. The query is
 * keyed by type + registry versions are immutable enough between edits that
 * a 60s stale window keeps repeat navigation instant without pinning stale
 * definitions for a whole session.
 */
export function useQuestionSet(assessmentType: RapidAssessmentType) {
  const query = useQuery({
    queryKey: ['question-set', assessmentType],
    queryFn: () => fetchQuestionSet(assessmentType),
    staleTime: 60_000,
    retry: 1,
  })

  const questionSet = useMemo(
    () => (query.data ? query.data : null),
    [query.data]
  )

  return {
    questionSet,
    sections: questionSet?.sections ?? [],
    questions: questionSet?.questions ?? [],
    structureVersion: questionSet?.structureVersion ?? null,
    contentVersion: questionSet?.contentVersion ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
  }
}
