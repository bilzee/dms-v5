'use client'

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPatch } from '@/lib/api'
import type { RapidAssessmentType } from '@/lib/questions/answers'
import { useAdminQuestionSet, type AdminQuestionRow } from '@/hooks/useAdminQuestionSet'
import { RoleBasedRoute } from '@/components/shared/RoleBasedRoute'
import {
  GapSeverityTable,
  type GapSeverityChange,
} from '@/components/settings/question-registry/GapSeverityTable'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle } from '@/lib/icons'

/**
 * Dynamic Question Registry — coordinator GAP severity ladder page (P8).
 *
 * COORDINATOR (or ADMIN). Tabs across the five GAP-bearing assessment types
 * (POPULATION is context-only). Each tab loads the active registry rows for
 * its type (plain authenticated read, no `includeInactive`), filters to GAP
 * questions and lets the coordinator re-ladder severities via staged changes:
 * per-row picks, checkbox bulk staging, a confirm dialog that quotes both the
 * staged count and the server-side active-incident impact
 * (`GET /api/v1/admin/questions/[id]/impact`), then Save All PATCHes
 * `PATCH /api/v1/admin/questions/[id]/severity` for each staged row.
 * Severities are derivation rules: the API re-derives affected active-incident
 * assessments and the success toast surfaces the server-reported count.
 */

/** Types with a GAP ladder (POPULATION is context-only — no tab). */
const GAP_LADDER_TYPES = ['HEALTH', 'FOOD', 'WASH', 'SHELTER', 'SECURITY'] as const

interface SeverityPatchResponse {
  question: AdminQuestionRow
  affectedCount: number
}

interface QuestionImpactResponse {
  questionKey: string
  snapshotCount: number
  activeUnderIncidentCount: number
}

export default function CoordinatorGapFieldManagementPage() {
  const [assessmentType, setAssessmentType] = useState<RapidAssessmentType>('HEALTH')

  const { questions, isLoading, error, refetch } = useAdminQuestionSet(assessmentType, {
    includeInactive: false,
  })

  const gapQuestions = useMemo(
    () => questions.filter((question) => question.category === 'GAP' && question.isActive),
    [questions]
  )

  /** Applies every staged change; resolves true only if all PATCHes succeeded. */
  const handleApplyChanges = async (changes: GapSeverityChange[]) => {
    let allSucceeded = true
    for (const { question, severity } of changes) {
      const result = await apiPatch<SeverityPatchResponse>(
        `/api/v1/admin/questions/${question.id}/severity`,
        { severity }
      )
      if (!result.success || !result.data) {
        allSucceeded = false
        toast.error(`${question.questionKey}: ${result.error || 'Failed to update severity'}`)
        continue
      }
      const affected = result.data.affectedCount
      toast.success(
        affected > 0
          ? `${question.questionKey} → ${severity} — re-derived ${affected} assessment${affected === 1 ? '' : 's'} under active incidents`
          : `${question.questionKey} → ${severity}`
      )
    }
    void refetch()
    return allSucceeded
  }

  /**
   * Server-impact quote for the confirm dialog — the same ACTIVE-incident
   * population the severity PATCH re-derives. Failures resolve to 0 per row
   * (the quote is advisory and never blocks the apply).
   */
  const fetchImpact = useCallback(async (staged: AdminQuestionRow[]) => {
    const entries = await Promise.all(
      staged.map(async (question) => {
        const result = await apiGet<QuestionImpactResponse>(
          `/api/v1/admin/questions/${question.id}/impact`
        )
        const count =
          result.success && result.data && typeof result.data.activeUnderIncidentCount === 'number'
            ? result.data.activeUnderIncidentCount
            : 0
        return [question.id, count] as const
      })
    )
    return Object.fromEntries(entries)
  }, [])

  return (
    <RoleBasedRoute requiredRoles={['COORDINATOR', 'ADMIN']}>
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 lg:px-8" data-testid="gap-field-management-page">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground">GAP Field Severity</h1>
          <p className="text-sm text-muted-foreground">
            Tune the severity ladder for GAP questions. Severity is a derivation
            rule — existing assessments are re-derived immediately and no
            historical snapshot is invalidated. Stage changes per row (or in
            bulk), then Save All to apply.
          </p>
        </div>

        <Tabs
          value={assessmentType}
          onValueChange={(value) => setAssessmentType(value as RapidAssessmentType)}
        >
          <TabsList className="flex-wrap" data-testid="gap-type-tabs">
            {GAP_LADDER_TYPES.map((type) => (
              <TabsTrigger key={type} value={type} data-testid={`gap-type-tab-${type}`}>
                {type}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading ? (
          <div className="space-y-2" data-testid="gap-page-loading">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive" data-testid="gap-page-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load GAP questions</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : gapQuestions.length === 0 ? (
          <Alert data-testid="gap-page-empty">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>No GAP questions for this assessment type</AlertTitle>
            <AlertDescription>
              Only GAP questions carry a severity ladder — this type may have its
              GAP questions deactivated.
            </AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{assessmentType} GAP ladder</CardTitle>
              <CardDescription>
                {gapQuestions.length} GAP question{gapQuestions.length === 1 ? '' : 's'}.
                Pick CRITICAL, HIGH or MEDIUM per question; Save All applies the
                staged changes immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <GapSeverityTable
                questions={gapQuestions}
                onApplyChanges={handleApplyChanges}
                fetchImpact={fetchImpact}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </RoleBasedRoute>
  )
}
