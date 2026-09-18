'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  useAdminQuestionSet,
  useAdminRuleMutations,
  type AdminRuleRow,
} from '@/hooks/useAdminQuestionSet'
import type { RapidAssessmentType } from '@/lib/questions/answers'
import type { Operand, When } from '@/lib/questions/rule-engine'
import { RuleEditDialog } from '@/components/settings/question-registry/RuleEditDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
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
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from '@/lib/icons'

/**
 * Dynamic Question Registry — cross-field rules panel (P10-3).
 *
 * The "Rules" view of the admin editor for one assessment type:
 * - loads active + inactive rules via `useAdminQuestionSet(…, { rules: true })`
 *   (rows pass through the shared AST zod schema — hand-edited DB drift
 *   surfaces as `rulesError`, never a silently broken editor);
 * - search (ruleKey/name/message) + kind filter;
 * - one row per rule: edit / deactivate (active) or reactivate (inactive),
 *   both behind a mandatory-reason dialog;
 * - rule lifecycle authoring via `RuleEditDialog` (create / edit);
 * - every mutation bumps the structure version (rules are always structural).
 */

const KIND_FILTERS = ['ALL', 'REFINEMENT', 'AGGREGATE'] as const
type KindFilter = (typeof KIND_FILTERS)[number]

function describeOperand(operand: Operand): string {
  switch (operand.type) {
    case 'question':
      return operand.key
    case 'sum':
      return `sum(${operand.keys.join('+')})`
    case 'literal':
      return String(operand.value)
  }
}

function describeGate(when: When | null): string {
  if (!when) return '—'
  if ('questionKey' in when) return `${when.questionKey} = ${when.is}`
  return `${describeOperand(when.left)} ${when.op} ${describeOperand(when.right)}`
}

interface RuleDialogState {
  open: boolean
  mode: 'create' | 'edit'
  rule: AdminRuleRow | null
}

export function CrossFieldRulesPanel({ assessmentType }: { assessmentType: RapidAssessmentType }) {
  const { sections, rules, rulesError, structureVersion, isLoading, refetch } =
    useAdminQuestionSet(assessmentType, {
      rules: true,
    })
  const { deactivateRule, updateRule, isMutating } = useAdminRuleMutations(assessmentType)

  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL')

  const questions = useMemo(
    () => sections.flatMap((section) => section.questions).filter((question) => question.isActive),
    [sections]
  )

  const visibleRules = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rules.filter((rule) => {
      if (kindFilter !== 'ALL' && rule.kind !== kindFilter) return false
      if (!needle) return true
      return (
        rule.ruleKey.toLowerCase().includes(needle) ||
        rule.name.toLowerCase().includes(needle) ||
        rule.message.toLowerCase().includes(needle)
      )
    })
  }, [rules, search, kindFilter])

  /** id → index within the full (unfiltered) rules array — move-neighbor lookup. */
  const ruleIndexById = useMemo(() => {
    const map = new Map<string, number>()
    rules.forEach((rule, index) => map.set(rule.id, index))
    return map
  }, [rules])

  // ---- create / edit dialog --------------------------------------------------
  const [ruleDialog, setRuleDialog] = useState<RuleDialogState>({
    open: false,
    mode: 'edit',
    rule: null,
  })

  const openCreateRule = () => setRuleDialog({ open: true, mode: 'create', rule: null })
  const openEditRule = (rule: AdminRuleRow) => setRuleDialog({ open: true, mode: 'edit', rule })

  // ---- reorder (shared reason dialog; two sequential PUTs swap orders) -------
  // CrossFieldRule has no unique order constraint, so a swap is two PUTs each
  // carrying the other row's order — every PUT bumps the structure version and
  // is audit-logged with the shared reason.
  const [moveTarget, setMoveTarget] = useState<{ rule: AdminRuleRow; direction: -1 | 1 } | null>(
    null
  )
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveReason, setMoveReason] = useState('')
  const [moving, setMoving] = useState(false)

  const requestRuleMove = (rule: AdminRuleRow, direction: -1 | 1) => {
    setMoveTarget({ rule, direction })
    setMoveReason('')
    setMoveOpen(true)
  }

  const confirmRuleMove = async () => {
    if (!moveTarget) return
    const reason = moveReason.trim()
    if (!reason) return
    const index = ruleIndexById.get(moveTarget.rule.id)
    if (index === undefined) return
    const neighbor = rules[index + moveTarget.direction]
    if (!neighbor) return
    setMoving(true)
    try {
      await updateRule.mutateAsync({ id: moveTarget.rule.id, order: neighbor.order, reason })
      await updateRule.mutateAsync({ id: neighbor.id, order: moveTarget.rule.order, reason })
      toast.success('Rule order updated')
      setMoveOpen(false)
      setMoveTarget(null)
      setMoveReason('')
      void refetch()
    } catch (mutationError) {
      toast.error(
        mutationError instanceof Error ? mutationError.message : 'Failed to reorder rule'
      )
    } finally {
      setMoving(false)
    }
  }

  // ---- lifecycle (deactivate / reactivate) dialog -----------------------------
  const [lifecycleTarget, setLifecycleTarget] = useState<AdminRuleRow | null>(null)
  const [lifecycleOpen, setLifecycleOpen] = useState(false)
  const [lifecycleReason, setLifecycleReason] = useState('')

  const openLifecycle = (rule: AdminRuleRow) => {
    setLifecycleTarget(rule)
    setLifecycleReason('')
    setLifecycleOpen(true)
  }

  const confirmLifecycle = async () => {
    if (!lifecycleTarget) return
    const reason = lifecycleReason.trim()
    if (!reason) return
    try {
      if (lifecycleTarget.isActive) {
        await deactivateRule.mutateAsync({ id: lifecycleTarget.id, reason })
        toast.success(`Deactivated "${lifecycleTarget.ruleKey}"`)
      } else {
        await updateRule.mutateAsync({ id: lifecycleTarget.id, isActive: true, reason })
        toast.success(`Reactivated "${lifecycleTarget.ruleKey}"`)
      }
      setLifecycleOpen(false)
      setLifecycleTarget(null)
      setLifecycleReason('')
      void refetch()
    } catch (mutationError) {
      toast.error(
        mutationError instanceof Error ? mutationError.message : 'The rule change failed'
      )
    }
  }

  const deactivating = lifecycleTarget?.isActive ?? false

  return (
    <Card data-testid="rules-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Cross-field rules</CardTitle>
            <Badge variant="outline" data-testid="rules-count">
              {rules.length} rule{rules.length === 1 ? '' : 's'}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={openCreateRule}
              data-testid="rules-new-button"
            >
              <Plus className="mr-2 h-4 w-4" />
              New rule
            </Button>
          </div>
        </div>
        <CardDescription>
          REFINEMENT rules block online submission when violated; AGGREGATE rules stay
          client-side. Every change bumps the structure version and is audit-logged.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex-1 space-y-2">
            <Label htmlFor="rules-search">Search</Label>
            <Input
              id="rules-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by rule key, name or message…"
              data-testid="rules-search-input"
            />
          </div>
          <div className="max-w-xs space-y-2">
            <Label htmlFor="rules-kind-filter">Kind</Label>
            <Select
              value={kindFilter}
              onValueChange={(value) => setKindFilter(value as KindFilter)}
            >
              <SelectTrigger id="rules-kind-filter" data-testid="rules-kind-filter">
                <SelectValue placeholder="All kinds" />
              </SelectTrigger>
              <SelectContent>
                {KIND_FILTERS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {kind === 'ALL' ? 'All kinds' : kind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3" data-testid="rules-loading">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rulesError ? (
          <Alert variant="destructive" data-testid="rules-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Failed to load cross-field rules</AlertTitle>
            <AlertDescription>{rulesError}</AlertDescription>
          </Alert>
        ) : visibleRules.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="rules-empty">
            {rules.length === 0
              ? 'No rules — by design for this assessment type. Rules are authored per type as gaps are discovered.'
              : 'No rules match the current search or filter.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="rules-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Order</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Gate</TableHead>
                  <TableHead>References</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRules.map((rule) => (
                  <TableRow
                    key={rule.id}
                    className={rule.isActive ? undefined : 'opacity-60'}
                    data-testid="rules-table-row"
                  >
                    <TableCell className="text-xs" data-testid="rules-rule-order">
                      {rule.order}
                    </TableCell>
                    <TableCell className="font-mono text-xs" data-testid="rules-rule-key">
                      {rule.ruleKey}
                    </TableCell>
                    <TableCell className="text-sm" data-testid="rules-rule-name">
                      {rule.name}
                    </TableCell>
                    <TableCell className="max-w-[16rem]" data-testid="rules-rule-message">
                      <span className="line-clamp-1 text-xs text-muted-foreground" title={rule.message}>
                        {rule.message}
                      </span>
                    </TableCell>
                    <TableCell data-testid="rules-rule-kind">
                      <Badge variant="outline">{rule.kind}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs" data-testid="rules-rule-gate">
                      {describeGate(rule.when)}
                    </TableCell>
                    <TableCell data-testid="rules-rule-refs">
                      <div className="flex flex-wrap gap-1">
                        {rule.referenceKeys.map((key, keyIndex) => (
                          <Badge
                            key={key}
                            variant={keyIndex === 0 ? 'default' : 'outline'}
                            className="font-mono text-xs"
                          >
                            {key}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell data-testid="rules-rule-active">
                      {rule.isActive ? (
                        <Badge>Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          aria-label={`Move ${rule.ruleKey} up`}
                          data-testid="rules-move-up-button"
                          disabled={ruleIndexById.get(rule.id) === 0}
                          onClick={() => requestRuleMove(rule, -1)}
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          aria-label={`Move ${rule.ruleKey} down`}
                          data-testid="rules-move-down-button"
                          disabled={ruleIndexById.get(rule.id) === rules.length - 1}
                          onClick={() => requestRuleMove(rule, 1)}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditRule(rule)}
                          aria-label={`Edit ${rule.ruleKey}`}
                          data-testid="rules-edit-button"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {rule.isActive ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => openLifecycle(rule)}
                            aria-label={`Deactivate ${rule.ruleKey}`}
                            data-testid="rules-deactivate-button"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openLifecycle(rule)}
                            aria-label={`Reactivate ${rule.ruleKey}`}
                            data-testid="rules-reactivate-button"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <RuleEditDialog
        open={ruleDialog.open}
        onOpenChange={(open) => setRuleDialog((state) => ({ ...state, open }))}
        mode={ruleDialog.mode}
        assessmentType={assessmentType}
        rules={rules}
        questions={questions}
        rule={ruleDialog.rule}
        structureVersion={structureVersion}
        onSaved={() => void refetch()}
      />

      <AlertDialog
        open={moveOpen}
        onOpenChange={(open) => {
          setMoveOpen(open)
          if (!open) setMoveTarget(null)
        }}
      >
        <AlertDialogContent data-testid="rules-reorder-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Reorder rule</AlertDialogTitle>
            <AlertDialogDescription>
              {moveTarget
                ? `Move "${moveTarget.rule.ruleKey}" ${moveTarget.direction === -1 ? 'up' : 'down'} one position — new order applies to the next assessment.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rules-reorder-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rules-reorder-reason"
              value={moveReason}
              onChange={(event) => setMoveReason(event.target.value)}
              maxLength={2000}
              placeholder="Why is the order changing? (audit log)"
              data-testid="rules-reorder-reason-input"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={moving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (!moveReason.trim()) return
                void confirmRuleMove()
              }}
              disabled={moving || !moveReason.trim()}
              data-testid="rules-reorder-confirm"
            >
              {moving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={lifecycleOpen}
        onOpenChange={(open) => {
          setLifecycleOpen(open)
          if (!open) setLifecycleTarget(null)
        }}
      >
        <AlertDialogContent data-testid="rules-deactivate-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deactivating ? 'Deactivate rule' : 'Reactivate rule'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lifecycleTarget
                ? deactivating
                  ? `Deactivating "${lifecycleTarget.ruleKey}" removes it from new validations. Existing assessments keep their stored violations.`
                  : `Reactivating "${lifecycleTarget.ruleKey}" returns it to new validations for this assessment type.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rules-lifecycle-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rules-lifecycle-reason"
              value={lifecycleReason}
              onChange={(event) => setLifecycleReason(event.target.value)}
              maxLength={2000}
              placeholder="Why is this change being made? (audit log)"
              data-testid="rules-deactivate-reason-input"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (!lifecycleReason.trim()) return
                void confirmLifecycle()
              }}
              disabled={isMutating || !lifecycleReason.trim()}
              className={deactivating ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              data-testid="rules-deactivate-confirm"
            >
              {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deactivating ? 'Deactivate' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
