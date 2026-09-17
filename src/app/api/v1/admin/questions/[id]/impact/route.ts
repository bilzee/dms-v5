import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { prisma } from '@/lib/db/client'

interface RouteParams {
  params: { id: string }
}

/**
 * Snapshot projection (structure-only, severity deliberately absent — see
 * question-snapshot.ts): `{ sections: [{ questions: [{ key }] }] }`.
 */
function snapshotHasKey(snapshot: unknown, questionKey: string): boolean {
  if (typeof snapshot !== 'object' || snapshot === null) return false
  const sections = (snapshot as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return false
  for (const section of sections) {
    if (typeof section !== 'object' || section === null) continue
    const questions = (section as { questions?: unknown }).questions
    if (!Array.isArray(questions)) continue
    for (const question of questions) {
      if (
        typeof question === 'object' &&
        question !== null &&
        (question as { key?: unknown }).key === questionKey
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * GET /api/v1/admin/questions/[id]/impact — ADMIN or COORDINATOR.
 *
 * Read-only impact report quoted before deactivating (admin editor) and
 * before severity re-ladder confirmations (coordinator severity page —
 * severity PATCHes re-derive the same ACTIVE-incident population):
 * - `snapshotCount`: non-DRAFT assessments whose frozen snapshot contains the
 *   question key (any incident status);
 * - `activeUnderIncidentCount`: the freeze-rule subset (ACTIVE incidents) —
 *   mirrors QuestionRegistryService.countFrozenSnapshots semantics. Also
 *   echoed as `affectedCount` (the PATCH response's name for it);
 * - `latestSnapshot`: the most recent affected assessment's date + registry
 *   versions (structure/content), null when never used.
 */
export const GET = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  if (!context.roles.includes('ADMIN') && !context.roles.includes('COORDINATOR')) {
    return errorResponse('Insufficient permissions. Admin or Coordinator role required to view question impact.', 403)
  }

  try {
    const question = await prisma.question.findUnique({
      where: { id: params.id },
      select: { questionKey: true, assessmentType: true },
    })
    if (!question) {
      return errorResponse('Question not found', 404)
    }

    const rows = await prisma.rapidAssessment.findMany({
      where: {
        rapidAssessmentType: question.assessmentType,
        verificationStatus: { not: 'DRAFT' },
      },
      orderBy: { rapidAssessmentDate: 'desc' },
      select: {
        rapidAssessmentDate: true,
        structureVersion: true,
        contentVersion: true,
        questionSnapshot: true,
        incident: { select: { status: true } },
      },
    })

    let snapshotCount = 0
    let activeUnderIncidentCount = 0
    let latestSnapshot: {
      rapidAssessmentDate: Date
      structureVersion: number
      contentVersion: number
    } | null = null

    for (const row of rows) {
      if (!snapshotHasKey(row.questionSnapshot, question.questionKey)) continue
      snapshotCount += 1
      if (row.incident?.status === 'ACTIVE') activeUnderIncidentCount += 1
      if (!latestSnapshot) {
        latestSnapshot = {
          rapidAssessmentDate: row.rapidAssessmentDate,
          // Legacy pre-registry snapshots have no version stamp; report 0.
          structureVersion: row.structureVersion ?? 0,
          contentVersion: row.contentVersion ?? 0,
        }
      }
    }

    return successResponse({
      questionKey: question.questionKey,
      snapshotCount,
      activeUnderIncidentCount,
      // Alias for the severity-PATCH confirm dialog (same population).
      affectedCount: activeUnderIncidentCount,
      latestSnapshot,
    })
  } catch (error) {
    return handleApiError(error)
  }
})
