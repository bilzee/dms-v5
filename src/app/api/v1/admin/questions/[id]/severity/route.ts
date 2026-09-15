import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { SeverityPatchSchema } from '@/lib/validation/questions'

interface RouteParams {
  params: { id: string }
}

/**
 * PATCH /api/v1/admin/questions/[id]/severity — ADMIN or COORDINATOR.
 * GAP questions only, value ∈ {CRITICAL, HIGH, MEDIUM}. Content-bump only:
 * severity is derived live (never frozen into snapshots) and stored
 * assessments are NOT recomputed here (that is P4, always explicit).
 */
export const PATCH = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  if (!context.roles.includes('ADMIN') && !context.roles.includes('COORDINATOR')) {
    return errorResponse('Insufficient permissions. Admin or Coordinator role required.', 403)
  }

  try {
    const body = await request.json()
    const { severity, reason } = SeverityPatchSchema.parse(body)
    const question = await QuestionRegistryService.setSeverity(params.id, severity, context.userId, reason)
    return successResponse(question)
  } catch (error) {
    return handleApiError(error)
  }
})
