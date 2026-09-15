import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { ReorderSchema } from '@/lib/validation/questions'

/**
 * POST /api/v1/admin/questions/reorder — ADMIN only.
 * Body is either `{ sectionIds }` (reorder the active sections of one
 * assessment type) or `{ sectionId, questionIds }` (reorder the active
 * questions of one section). Assigned orders are contiguous 1..n, the
 * structureVersion bumps, and any moved key that appears in the snapshot of
 * an ACTIVE-incident non-DRAFT assessment rejects the whole reorder with
 * 409 `question_frozen`. `reason` required.
 */
export const POST = withAuth(async (request: NextRequest, context) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required.', 403)
  }

  try {
    const body = await request.json()
    const { reason, ...payload } = ReorderSchema.parse(body)
    const result = await QuestionRegistryService.reorder(payload, context.userId, reason)
    return successResponse(result)
  } catch (error) {
    return handleApiError(error)
  }
})
