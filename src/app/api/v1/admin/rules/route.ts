import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { CreateRuleSchema } from '@/lib/validation/questions'

/**
 * POST /api/v1/admin/rules — ADMIN only.
 *
 * Creates a cross-field rule for an assessment type (P10-2 governance,
 * mirroring /admin/questions): `reason` is mandatory (400 reason_required),
 * `expression`/`when` must satisfy the shared AST grammar, and every
 * `referenceKeys` entry must be an ACTIVE question key of the type
 * (400 registry_invalid). Bumps the type's structureVersion.
 */
export const POST = withAuth(async (request: NextRequest, context) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required.', 403)
  }

  try {
    const body = await request.json()
    const { reason, ...input } = CreateRuleSchema.parse(body)
    const rule = await QuestionRegistryService.createRule(input, context.userId, reason)
    return successResponse(rule)
  } catch (error) {
    return handleApiError(error)
  }
})
