import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { createdResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { QuestionRegistryService } from '@/lib/services/question-registry.service'
import { CreateSectionSchema } from '@/lib/validation/questions'

/**
 * POST /api/v1/admin/sections — ADMIN only.
 * Creates a registry section. Ungated by the freeze rule (a new section has no
 * questions yet) but structurally validated in-transaction and bumps
 * structureVersion. `reason` is mandatory for this structural action.
 */
export const POST = withAuth(async (request: NextRequest, context) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required.', 403)
  }

  try {
    const body = await request.json()
    const { reason, ...input } = CreateSectionSchema.parse(body)
    const section = await QuestionRegistryService.createSection(input, context.userId, reason)
    return createdResponse(section)
  } catch (error) {
    return handleApiError(error)
  }
})
