import { NextRequest } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { successResponse, errorResponse, handleApiError } from '@/lib/api/response'
import { prisma } from '@/lib/db/client'

interface RouteParams {
  params: { id: string }
}

/**
 * GET /api/v1/admin/rules/[id]/audit — ADMIN only.
 *
 * Latest 50 `question_audit_logs` rows for the rule (entityType RULE), newest
 * first, with the acting user's email/name — the rule editor's audit timeline,
 * mirroring /admin/questions/[id]/audit.
 */
export const GET = withAuth(async (request: NextRequest, context, { params }: RouteParams) => {
  if (!context.roles.includes('ADMIN')) {
    return errorResponse('Insufficient permissions. Admin role required to view the rule audit trail.', 403)
  }

  try {
    const entries = await prisma.questionAuditLog.findMany({
      where: { entityType: 'RULE', entityId: params.id },
      orderBy: { actedAt: 'desc' },
      take: 50,
      include: { actor: { select: { email: true, name: true } } },
    })
    return successResponse({ entries })
  } catch (error) {
    return handleApiError(error)
  }
})
