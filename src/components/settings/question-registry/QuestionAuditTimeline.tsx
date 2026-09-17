'use client'

import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { History } from '@/lib/icons'

/**
 * Dynamic Question Registry — audit timeline (P8).
 *
 * Vertical timeline of the latest 50 `question_audit_logs` entries for one
 * question (action badge, actor email, timestamp, reason, changed field
 * names). Read-only; refetches whenever `refreshKey` changes (e.g. after a
 * successful save in the edit dialog).
 */

export interface QuestionAuditEntry {
  id: string
  action: string
  reason: string | null
  changes: unknown
  actedAt: string
  actor?: { email: string; name: string | null } | null
}

interface AuditResponse {
  entries: QuestionAuditEntry[]
}

/** Changed-field names from the audit `changes` payload ({field: {from,to}} shaped or plain). */
function changedFieldNames(changes: unknown): string[] {
  if (typeof changes !== 'object' || changes === null) return []
  const record = changes as Record<string, unknown>
  if (Array.isArray(record)) return []
  return Object.keys(record)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ACTION_BADGE_CLASSES: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  UPDATE: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800',
  UPDATE_SEVERITY: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800',
  DEACTIVATE: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800',
  REORDER: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800',
}

export interface QuestionAuditTimelineProps {
  questionId: string
  /** Bump to force a refetch (e.g. save counter of the owning dialog). */
  refreshKey?: number
}

export function QuestionAuditTimeline({ questionId, refreshKey = 0 }: QuestionAuditTimelineProps) {
  const query = useQuery({
    queryKey: ['question-audit', questionId, refreshKey],
    queryFn: async () => {
      const result = await apiGet<AuditResponse>(
        `/api/v1/admin/questions/${questionId}/audit`
      )
      if (!result.success) {
        throw new Error(result.error || 'Failed to load audit trail')
      }
      return result.data as AuditResponse
    },
    enabled: Boolean(questionId),
    staleTime: 10_000,
    retry: 1,
  })

  const entries = query.data?.entries ?? []

  return (
    <div data-testid="question-audit-timeline" className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <History className="h-4 w-4 text-muted-foreground" />
        Audit trail
      </div>

      {query.isLoading ? (
        <div className="space-y-2" data-testid="audit-timeline-loading">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : query.error ? (
        <p className="text-sm text-destructive" data-testid="audit-timeline-error">
          {query.error instanceof Error ? query.error.message : 'Failed to load audit trail'}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="audit-timeline-empty">
          No audit entries recorded for this question yet.
        </p>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-4">
          {entries.map((entry) => {
            const fields = changedFieldNames(entry.changes)
            return (
              <li key={entry.id} className="relative" data-testid="audit-timeline-entry">
                <span
                  className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
                  aria-hidden
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      ACTION_BADGE_CLASSES[entry.action] ??
                      'bg-muted text-foreground border-border'
                    }
                  >
                    {entry.action.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(entry.actedAt)}
                  </span>
                  {entry.actor && (
                    <span className="text-xs text-muted-foreground" data-testid="audit-entry-actor">
                      by {entry.actor.email}
                    </span>
                  )}
                </div>
                {fields.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Changed: <span className="font-mono">{fields.join(', ')}</span>
                  </p>
                )}
                {entry.reason && (
                  <p className="mt-1 text-xs italic text-muted-foreground">
                    &ldquo;{entry.reason}&rdquo;
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
