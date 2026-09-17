/**
 * Dynamic Question Registry — admin editor question set hook (P8).
 *
 * `useAdminQuestionSet(assessmentType, { includeInactive })` loads the raw
 * registry rows (ids, isActive, sectionId, severity, gap metadata, ...) from
 * `GET /api/v1/questions?assessmentType=` via React Query.
 *
 * Unlike `useQuestionSet` (which normalizes into snapshot-style definitions
 * for the assessor form and drops row ids), this hook keeps the raw registry
 * shape so the admin editor and the coordinator severity page can address
 * rows by id for the governance mutations (PUT/PATCH/DELETE).
 *
 * - `includeInactive: true` (default, ADMIN only server-side) also returns
 *   inactive rows — the admin editor needs them for Tier B lifecycle view.
 * - `includeInactive: false` is the plain authenticated read the coordinator
 *   severity ladder page uses.
 *
 * After any mutation the caller is responsible for `refetch()`-ing (the
 * registry is versioned; we deliberately do not mutate cached rows in place).
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import type { RapidAssessmentType } from '@/lib/questions/answers'

/** Raw registry question row (subset of the Prisma `Question` columns the UI needs). */
export interface AdminQuestionRow {
  id: string
  questionKey: string
  sectionId: string
  questionType: string
  label: string
  helperText: string | null
  required: boolean
  category: string
  inverted: boolean
  gapLabel: string | null
  gapMeaning: string | null
  recommendation: string | null
  severity: string
  numberMin: number | null
  numberMax: number | null
  order: number
  isActive: boolean
  version: number
}

/** Raw registry section row with nested question rows. */
export interface AdminSectionRow {
  id: string
  sectionKey: string
  title: string
  description: string | null
  category: string
  order: number
  isActive: boolean
  questions: AdminQuestionRow[]
}

export interface AdminQuestionSetView {
  sections: AdminSectionRow[]
  structureVersion: number
  contentVersion: number
}

interface QuestionSetResponse {
  sections: AdminSectionRow[]
  structureVersion: number
  contentVersion: number
}

async function fetchAdminQuestionSet(
  assessmentType: RapidAssessmentType,
  includeInactive: boolean
): Promise<AdminQuestionSetView> {
  const query = new URLSearchParams({ assessmentType })
  if (includeInactive) query.set('includeInactive', '1')
  const result = await apiGet<QuestionSetResponse>(`/api/v1/questions?${query.toString()}`)
  if (!result.success) {
    throw new Error(result.error || 'Failed to load question set')
  }
  const payload = result.data
  if (!payload || !Array.isArray(payload.sections)) {
    throw new Error('Question set response is missing sections')
  }
  return {
    sections: payload.sections,
    structureVersion:
      typeof payload.structureVersion === 'number' ? payload.structureVersion : 1,
    contentVersion: typeof payload.contentVersion === 'number' ? payload.contentVersion : 1,
  }
}

export interface UseAdminQuestionSetOptions {
  /**
   * Request inactive rows too (requires ADMIN — the route enforces it).
   * Defaults to true for the admin editor; pass false for plain reads.
   */
  includeInactive?: boolean
}

/**
 * Loads the registry question set for one assessment type as raw rows.
 * Short stale window: registry edits bump versions, so repeat navigation is
 * fast but never pinned to a stale catalog for a whole session.
 */
export function useAdminQuestionSet(
  assessmentType: RapidAssessmentType,
  options: UseAdminQuestionSetOptions = {}
) {
  const includeInactive = options.includeInactive ?? true

  const query = useQuery({
    queryKey: ['admin-question-set', assessmentType, includeInactive],
    queryFn: () => fetchAdminQuestionSet(assessmentType, includeInactive),
    staleTime: 15_000,
    retry: 1,
  })

  const questionSet = useMemo(() => query.data ?? null, [query.data])
  const sections = useMemo(
    () =>
      (questionSet?.sections ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((section) => ({
          ...section,
          questions: section.questions
            .slice()
            .sort((a, b) => a.order - b.order),
        })),
    [questionSet]
  )

  return {
    questionSet,
    sections,
    questions: sections.flatMap((section) => section.questions),
    structureVersion: questionSet?.structureVersion ?? null,
    contentVersion: questionSet?.contentVersion ?? null,
    isLoading: query.isLoading,
    error:
      query.error instanceof Error
        ? query.error.message
        : query.error
          ? String(query.error)
          : null,
    refetch: query.refetch,
  }
}
