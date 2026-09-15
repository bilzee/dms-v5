import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { errorResponse, handleApiError, successResponse } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { UpdateSectionSchema } from '@/lib/validation/questions'

interface RouteParams {
  params: { id: string }
}

/**
 * PUT /api/v1/admin/sections/[id] — ADMIN only.
 * Title/description edits bump contentVersion only. Category/order changes are
 * structural: freeze-gated on the section's active question keys (409
 * `question_frozen`) and bump structureVersion.
 */
export const PUT = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required.', 403)
  }

  try {
    const body = await request.json()
    const { reason, ...input } = UpdateSectionSchema.parse(body)
    const section = await QuestionRegistryService.updateSection(params.id, input, context.userId, reason)
    return successResponse(section)
  } catch (error) {
    return handleApiError(error)
  }
})

/**
 * DELETE /api/v1/admin/sections/[id] — ADMIN only.
 * Deletes the section. Only sections with zero questions (active or inactive)
 * can be deleted — otherwise 400 `section_not_empty`. Bumps structureVersion
 * and requires `reason`.
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
    await QuestionRegistryService.deleteSection(params.id, context.userId, reason)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleApiError(error)
  }
})
