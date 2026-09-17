'use client'

import { useEffect, useState } from 'react'
import type { AdminQuestionRow } from '@/hooks/useAdminQuestionSet'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Loader2, Save } from '@/lib/icons'

/**
 * Dynamic Question Registry — GAP severity ladder table (P8).
 *
 * Read/stage table of one assessment type's GAP questions: label + key, gap
 * wording, the current severity badge and an inline CRITICAL/HIGH/MEDIUM
 * select. Picking a new severity only STAGES the change (`pendingChanges`);
 * nothing is written until the coordinator confirms the impact dialog and
 * presses Save All — the owner then PATCHes
 * `/api/v1/admin/questions/[id]/severity` for every staged row and the
 * server-reported affected counts surface in toasts.
 *
 * Bulk staging: checkbox selection (`gap-row-checkbox` / `gap-select-all`)
 * plus one bulk severity pick stages every selected row at once — the same
 * staged pipeline, the same confirm gate.
 *
 * The confirm dialog quotes impact two ways: the staged rule count
 * (`gap-confirm-count`) and — when the owner passes `fetchImpact` — the
 * server-quoted number of active-incident assessments those rules will
 * re-derive (`gap-confirm-impact`), fetched from `GET …/[id]/impact` (the
 * same ACTIVE-incident population the severity PATCH re-derives).
 *
 * Every other field is read-only: severities are derivation rules, so no
 * structural controls exist here.
 */

const GAP_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM'] as const
type GapSeverity = (typeof GAP_SEVERITIES)[number]

export type { GapSeverity }

export interface GapSeverityChange {
  question: AdminQuestionRow
  severity: GapSeverity
}

export interface GapSeverityTableProps {
  questions: AdminQuestionRow[]
  /**
   * Applies every staged severity change (the owner PATCHes each row and
   * surfaces the server's affected counts). Resolve with `true` when every
   * PATCH succeeded so the table can drop its staging.
   */
  onApplyChanges: (changes: GapSeverityChange[]) => Promise<boolean>
  /**
   * Optional server-impact quote for the confirm dialog: maps question id →
   * affected (active-incident) assessment count. Fetch failures never block —
   * the dialog simply omits the quote.
   */
  fetchImpact?: (questions: AdminQuestionRow[]) => Promise<Record<string, number>>
  disabled?: boolean
}

export function GapSeverityTable({
  questions,
  onApplyChanges,
  fetchImpact,
  disabled = false,
}: GapSeverityTableProps) {
  const [staged, setStaged] = useState<Record<string, GapSeverity>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkSeverity, setBulkSeverity] = useState<GapSeverity | ''>('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [impactQuote, setImpactQuote] = useState<{
    total: number
    byId: Record<string, number>
  } | null>(null)
  const [impactLoading, setImpactLoading] = useState(false)

  const stagedChanges: GapSeverityChange[] = questions
    .filter((question) => question.id in staged)
    .map((question) => ({ question, severity: staged[question.id] }))

  const stageSeverity = (question: AdminQuestionRow, severity: GapSeverity) => {
    setStaged((current) => {
      const next = { ...current }
      if (severity === question.severity) {
        delete next[question.id] // picked back the live value → unstage
      } else {
        next[question.id] = severity
      }
      return next
    })
  }

  const toggleRow = (questionId: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(questionId)
      else next.delete(questionId)
      return next
    })
  }

  const allSelected = questions.length > 0 && selected.size === questions.length

  const toggleSelectAll = (checked: boolean) => {
    setSelected(checked ? new Set(questions.map((question) => question.id)) : new Set())
  }

  const applyBulkSeverity = () => {
    if (!bulkSeverity || selected.size === 0) return
    setStaged((current) => {
      const next = { ...current }
      for (const question of questions) {
        if (!selected.has(question.id)) continue
        if (bulkSeverity === question.severity) delete next[question.id]
        else next[question.id] = bulkSeverity
      }
      return next
    })
    setBulkSeverity('')
  }

  // Quote server-side impact whenever the confirm dialog opens (staged set is
  // frozen while the dialog is open — the Save All button is the only entry).
  useEffect(() => {
    if (!confirmOpen) {
      setImpactQuote(null)
      return
    }
    if (!fetchImpact || stagedChanges.length === 0) return
    let cancelled = false
    setImpactLoading(true)
    fetchImpact(stagedChanges.map((change) => change.question))
      .then((byId) => {
        if (cancelled) return
        const total = stagedChanges.reduce(
          (sum, change) => sum + (byId[change.question.id] ?? 0),
          0
        )
        setImpactQuote({ total, byId })
      })
      .catch(() => {
        // Impact is advisory — a failed quote never blocks the apply.
      })
      .finally(() => {
        if (!cancelled) setImpactLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen, fetchImpact])

  const applyStaged = async () => {
    if (stagedChanges.length === 0) return
    setApplying(true)
    const allSucceeded = await onApplyChanges(stagedChanges)
    setApplying(false)
    setConfirmOpen(false)
    if (allSucceeded) {
      setStaged({})
      setSelected(new Set())
    }
  }

  return (
    <div className="space-y-3" data-testid="gap-severity-table">
      <div className="flex flex-wrap items-end gap-3">
        <div className="max-w-[200px] space-y-1">
          <p className="text-xs text-muted-foreground">Bulk severity</p>
          <Select
            value={bulkSeverity}
            onValueChange={(value) => setBulkSeverity(value as GapSeverity)}
            disabled={disabled || applying || selected.size === 0}
          >
            <SelectTrigger className="h-8 text-xs" data-testid="gap-bulk-severity-select">
              <SelectValue placeholder="Select severity" />
            </SelectTrigger>
            <SelectContent>
              {GAP_SEVERITIES.map((severity) => (
                <SelectItem key={severity} value={severity} className="text-xs">
                  {severity}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={applyBulkSeverity}
          disabled={disabled || applying || selected.size === 0 || bulkSeverity === ''}
          data-testid="gap-bulk-apply-button"
        >
          Apply to {selected.size} selected
        </Button>
        <p className="text-xs text-muted-foreground">
          Bulk picks stage the selected rows — nothing is written until Save All.
        </p>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[3rem]">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) => toggleSelectAll(checked === true)}
                  aria-label="Select all GAP questions"
                  data-testid="gap-select-all"
                />
              </TableHead>
              <TableHead className="w-[28%]">Question</TableHead>
              <TableHead>Gap label</TableHead>
              <TableHead className="w-[16%]">Severity</TableHead>
              <TableHead className="w-[18%]">Change to</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {questions.map((question) => {
              const pending = question.id in staged
              const selectedValue = pending
                ? staged[question.id]
                : GAP_SEVERITIES.includes(question.severity as GapSeverity)
                  ? (question.severity as GapSeverity)
                  : undefined
              return (
                <TableRow key={question.id} data-testid="gap-severity-row">
                  <TableCell>
                    <Checkbox
                      checked={selected.has(question.id)}
                      onCheckedChange={(checked) => toggleRow(question.id, checked === true)}
                      aria-label={`Select ${question.questionKey}`}
                      data-testid="gap-row-checkbox"
                      data-question-key={question.questionKey}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{question.label}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {question.questionKey}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {question.gapLabel ?? '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span data-testid="gap-severity-badge">
                        <StatusBadge status={question.severity} domain="severity" size="sm" />
                      </span>
                      {pending && (
                        <Badge variant="secondary" data-testid="gap-row-pending">
                          Pending
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={selectedValue}
                      onValueChange={(value) => stageSeverity(question, value as GapSeverity)}
                      disabled={disabled || applying}
                    >
                      <SelectTrigger
                        className="h-8 w-full text-xs"
                        aria-label={`Severity for ${question.questionKey}`}
                        data-testid="gap-severity-select"
                      >
                        <SelectValue placeholder="Select severity" />
                      </SelectTrigger>
                      <SelectContent>
                        {GAP_SEVERITIES.map((severity) => (
                          <SelectItem key={severity} value={severity} className="text-xs">
                            {severity}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {stagedChanges.length > 0 && (
        <Alert data-testid="gap-pending-banner">
          <Save className="h-4 w-4" />
          <AlertTitle>
            {stagedChanges.length} severity change
            {stagedChanges.length === 1 ? '' : 's'} staged
          </AlertTitle>
          <AlertDescription>
            Severities are derivation rules — applying them re-derives affected
            assessments under active incidents immediately.
          </AlertDescription>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStaged({})}
              disabled={applying}
              data-testid="gap-cancel-button"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={applying}
              data-testid="gap-save-all-button"
            >
              {applying ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save All
            </Button>
          </div>
        </Alert>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="gap-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Apply severity changes</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to change{' '}
              <span className="font-medium" data-testid="gap-confirm-count">
                {stagedChanges.length} GAP severity rule
                {stagedChanges.length === 1 ? '' : 's'}
              </span>
              . Existing assessments under active incidents are re-derived
              immediately; the server reports how many were affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {fetchImpact && (
            <p className="text-sm text-muted-foreground" data-testid="gap-confirm-impact">
              {impactLoading
                ? 'Checking how many active-incident assessments these rules affect…'
                : impactQuote
                  ? `${impactQuote.total} assessment${impactQuote.total === 1 ? '' : 's'} under active incidents will be re-derived.`
                  : ''}
            </p>
          )}
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-3 text-sm">
            {stagedChanges.map(({ question, severity }) => (
              <li key={question.id} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{question.questionKey}</span>
                <span className="text-muted-foreground">
                  {question.severity} &rarr; <span className="font-medium">{severity}</span>
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault() // stay open while the PATCHes run
                void applyStaged()
              }}
              disabled={applying}
              data-testid="gap-confirm-apply"
            >
              {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply Changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
