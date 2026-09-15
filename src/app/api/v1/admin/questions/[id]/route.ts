import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { UpdateQuestionSchema } from '@/lib/validation/questions'

interface RouteParams {
  params: { id: string }
}

/**
 * PUT /api/v1/admin/questions/[id] — ADMIN only.
 * Tier A edits (label/helperText/gap phrasing/recommendation/severity/option
 * copy+append) bump contentVersion only. Tier B edits (questionType/category/
 * inverted/required/section move/number bounds/option-value removal) bump
 * structureVersion and are freeze-gated (409 `question_frozen`). Renaming
 * `questionKey` is rejected with 400 `question_key_immutable`.
 */
export const PUT = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required.', 403)
  }

  try {
    const body = await request.json()
    const { reason, ...input } = UpdateQuestionSchema.parse(body)
    const question = await QuestionRegistryService.updateQuestion(params.id, input, context.userId, reason)
    return successResponse(question)
  } catch (error) {
    return handleApiError(error)
  }
})

/**
 * DELETE /api/v1/admin/questions/[id] — ADMIN only.
 * Soft-deactivates the question (isActive=false). Freeze-gated, structurally
 * validated (deactivating the last active GAP of a non-POPULATION type rolls
 * back with 400 `registry_invalid`) and bumps structureVersion. `reason`
 * required.
 */
export const DELETE = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required.', 403)
  }

  try {
    let reason: string | undefined
    const body = await request.json().catch(() => ({}))
    if (body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string') {
      reason = (body as { reason: string }).reason
    }
    await QuestionRegistryService.deactivateQuestion(params.id, context.userId, reason)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleApiError(error)
  }
})
