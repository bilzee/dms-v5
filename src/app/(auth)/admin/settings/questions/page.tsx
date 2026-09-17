'use client'

import { RoleBasedRoute } from '@/components/shared/RoleBasedRoute'
import { QuestionRegistryEditor } from '@/components/settings/question-registry/QuestionRegistryEditor'

/**
 * Dynamic Question Registry — admin editor page (P8).
 *
 * ADMIN-only. The editor defaults to the HEALTH assessment type and offers
 * the full type switcher inline.
 */
export default function AdminQuestionRegistryPage() {
  return (
    <RoleBasedRoute requiredRole="ADMIN">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <QuestionRegistryEditor />
      </div>
    </RoleBasedRoute>
  )
}
