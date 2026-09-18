import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { UpdateRuleSchema } from '@/lib/validation/questions'

interface RouteParams {
  params: { id: string }
}

/**
 * PUT /api/v1/admin/rules/[id] — ADMIN only.
 * Edits name/message/kind/when/expression/referenceKeys/order/isActive.
 * `ruleKey` is rejected with 400 `rule_key_immutable`. Every edit bumps the
 * type's structureVersion (validation semantics changed) and requires a
 * `reason`. Rules are never per-question freeze-gated.
 */
export const PUT = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required.', 403)
  }

  try {
    const body = await request.json()
    const { reason, ...input } = UpdateRuleSchema.parse(body)
    const rule = await QuestionRegistryService.updateRule(params.id, input, context.userId, reason)
    return successResponse(rule)
  } catch (error) {
    return handleApiError(error)
  }
})

/**
 * DELETE /api/v1/admin/rules/[id] — ADMIN only.
 * Soft-deactivates the rule (isActive=false) with a mandatory `reason`,
 * a RULE audit row and a structureVersion bump. Deactivating the last
 * active REFINEMENT of a type is allowed (validation is optional by design);
 * deactivating a rule also lifts the question-deactivation guard for its
 * referenced keys.
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
    await QuestionRegistryService.deactivateRule(params.id, context.userId, reason)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return handleApiError(error)
  }
})
