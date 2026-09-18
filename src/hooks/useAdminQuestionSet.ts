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
 *
 * P10-3 rule governance: `{ rules: true }` additionally normalizes the
 * response's `rules` array through the shared AST zod schema into
 * `AdminRuleRow`s (ids + isActive kept for the Rules tab), and
 * `useAdminRuleMutations` wraps POST/PUT/DELETE /api/v1/admin/rules with
 * mandatory-reason validation and cache invalidation.
 */

import { useMemo, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api'
import type { RapidAssessmentType } from '@/lib/questions/answers'
import { RuleAstSchema, evaluateRules } from '@/lib/questions/rule-engine'
import type { Compare, BoolGate, When, CrossFieldViolation } from '@/lib/questions/rule-engine'

// Shared AST value types re-exported for the rule authoring UI (RuleEditDialog
// and the rules table import everything from this one module).
export type { Compare, BoolGate, When } from '@/lib/questions/rule-engine'

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

/**
 * Cross-field rule row normalized for the admin Rules tab (P10-3).
 * `expression`/`when` pass through the shared AST zod schema on every load,
 * so a hand-edited DB row drifting from the grammar is flagged by the loader
 * (`rulesError`) instead of rendering a silently broken editor.
 */
export interface AdminRuleRow {
  id: string
  ruleKey: string
  kind: 'REFINEMENT' | 'AGGREGATE'
  name: string
  message: string
  when: When | null
  expression: Compare
  referenceKeys: string[]
  isActive: boolean
  order: number
}

interface RuleRowRaw {
  id?: unknown
  ruleKey?: unknown
  kind?: unknown
  name?: unknown
  message?: unknown
  when?: unknown
  expression?: unknown
  referenceKeys?: unknown
  isActive?: unknown
  order?: unknown
}

interface QuestionSetResponse {
  sections: AdminSectionRow[]
  structureVersion: number
  contentVersion: number
  rules?: unknown[]
}

/** Passes a raw rule row through the shared AST zod schema (throws on drift). */
function normalizeRule(raw: RuleRowRaw): AdminRuleRow {
  const ast = RuleAstSchema.parse({ when: raw.when ?? undefined, violationWhen: raw.expression })
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    ruleKey: typeof raw.ruleKey === 'string' ? raw.ruleKey : '',
    kind: raw.kind === 'AGGREGATE' ? 'AGGREGATE' : 'REFINEMENT',
    name: typeof raw.name === 'string' ? raw.name : '',
    message: typeof raw.message === 'string' ? raw.message : '',
    when: (raw.when ?? null) as When | null,
    expression: ast.violationWhen as Compare,
    referenceKeys: Array.isArray(raw.referenceKeys)
      ? raw.referenceKeys.filter((key): key is string => typeof key === 'string')
      : [],
    isActive: raw.isActive !== false,
    order: typeof raw.order === 'number' ? raw.order : 0,
  }
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

async function fetchAdminRules(
  assessmentType: RapidAssessmentType,
  includeInactive: boolean
): Promise<AdminRuleRow[]> {
  const query = new URLSearchParams({ assessmentType })
  if (includeInactive) query.set('includeInactive', '1')
  const result = await apiGet<{ rules?: unknown[] }>(`/api/v1/questions?${query.toString()}`)
  if (!result.success) {
    throw new Error(result.error || 'Failed to load cross-field rules')
  }
  const rows = result.data?.rules
  if (!Array.isArray(rows)) {
    throw new Error('Question set response is missing rules')
  }
  // RuleAstSchema.parse inside normalizeRule is the drift tripwire.
  return rows.map((row) => normalizeRule(row as RuleRowRaw))
}

export interface UseAdminQuestionSetOptions {
  /**
   * Request inactive rows too (requires ADMIN — the route enforces it).
   * Defaults to true for the admin editor; pass false for plain reads.
   */
  includeInactive?: boolean
  /** Also load the type's cross-field rules through the shared AST schema (P10-3). */
  rules?: boolean
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
  const withRules = options.rules ?? false

  const query = useQuery({
    queryKey: ['admin-question-set', assessmentType, includeInactive],
    queryFn: () => fetchAdminQuestionSet(assessmentType, includeInactive),
    staleTime: 15_000,
    retry: 1,
  })

  const rulesQuery = useQuery({
    queryKey: ['admin-rule-set', assessmentType, includeInactive],
    queryFn: () => fetchAdminRules(assessmentType, includeInactive),
    enabled: withRules,
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
    rules: withRules ? (rulesQuery.data ?? []) : [],
    rulesError: withRules && rulesQuery.error
      ? rulesQuery.error instanceof Error
        ? rulesQuery.error.message
        : String(rulesQuery.error)
      : null,
    isLoading: query.isLoading,
    error:
      query.error instanceof Error
        ? query.error.message
        : query.error
          ? String(query.error)
          : null,
    refetch: async () => {
      await query.refetch()
      if (withRules) await rulesQuery.refetch()
    },
  }
}

// ---------------------------------------------------------------------------
// Rule authoring mutations (P10-3)
// ---------------------------------------------------------------------------

/** Payload for POST /api/v1/admin/rules (create). */
export interface CreateRulePayload {
  assessmentType: RapidAssessmentType
  ruleKey: string
  kind: 'REFINEMENT' | 'AGGREGATE'
  name: string
  message: string
  when?: When | null
  expression: Compare
  referenceKeys: string[]
  order?: number
  reason: string
}

/** Payload for PUT /api/v1/admin/rules/[id] (edit). */
export type UpdateRulePayload = Partial<Omit<CreateRulePayload, 'assessmentType'>> &
  Pick<CreateRulePayload, 'reason'> & { isActive?: boolean }

/** Fires a rule draft against the live engine WITHOUT persisting anything. */
export function dryRunRule(
  rule: {
    ruleKey: string
    kind: 'REFINEMENT' | 'AGGREGATE'
    message: string
    when: When | null
    expression: Compare
    referenceKeys: string[]
  },
  answers: Record<string, unknown>
): CrossFieldViolation[] {
  return evaluateRules(
    [
      {
        ruleKey: rule.ruleKey,
        kind: rule.kind,
        message: rule.message,
        when: rule.when ?? undefined,
        expression: rule.expression,
        referenceKeys: rule.referenceKeys,
        order: 0,
      },
    ],
    answers
  )
}

/**
 * Rule governance mutations for one assessment type. Every call enforces the
 * mandatory `reason` client-side (mirroring the server's reason_required) and
 * invalidates the admin rule/question-set caches so a follow-up read reflects
 * the server's version bump immediately.
 */
export function useAdminRuleMutations(assessmentType: RapidAssessmentType) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const invalidate = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-rule-set', assessmentType] }),
      queryClient.invalidateQueries({ queryKey: ['admin-question-set', assessmentType] }),
      queryClient.invalidateQueries({ queryKey: ['question-set', assessmentType] }),
    ])
  }, [queryClient, assessmentType])

  const createRule = useMutation({
    mutationFn: async (payload: CreateRulePayload) => {
      setError(null)
      if (!payload.reason.trim()) {
        throw new Error('reason_required: a change reason is required')
      }
      const result = await apiPost('/api/v1/admin/rules', payload)
      if (!result.success) {
        const detailErrors = (result.details as { errors?: string[] } | undefined)?.errors
        throw new Error(
          detailErrors && detailErrors.length > 0
            ? `${result.error}: ${detailErrors.join('; ')}`
            : result.error || 'Failed to create rule'
        )
      }
      return result.data
    },
    onSuccess: invalidate,
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : String(mutationError)),
  })

  const updateRule = useMutation({
    mutationFn: async ({ id, ...payload }: UpdateRulePayload & { id: string }) => {
      setError(null)
      if (!payload.reason.trim()) {
        throw new Error('reason_required: a change reason is required')
      }
      const result = await apiPut(`/api/v1/admin/rules/${id}`, payload)
      if (!result.success) {
        const detailErrors = (result.details as { errors?: string[] } | undefined)?.errors
        throw new Error(
          detailErrors && detailErrors.length > 0
            ? `${result.error}: ${detailErrors.join('; ')}`
            : result.error || 'Failed to update rule'
        )
      }
      return result.data
    },
    onSuccess: invalidate,
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : String(mutationError)),
  })

  const deactivateRule = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      setError(null)
      if (!reason.trim()) {
        throw new Error('reason_required: a change reason is required')
      }
      const result = await apiDelete(`/api/v1/admin/rules/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!result.success) {
        throw new Error(result.error || 'Failed to deactivate rule')
      }
      return undefined
    },
    onSuccess: invalidate,
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : String(mutationError)),
  })

  return {
    createRule,
    updateRule,
    deactivateRule,
    /** Human-readable error of the LAST failed mutation (cleared per attempt). */
    error,
    /** True while any rule mutation request is in flight. */
    isMutating: createRule.isPending || updateRule.isPending || deactivateRule.isPending,
  }
}
