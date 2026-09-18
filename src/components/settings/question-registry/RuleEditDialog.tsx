'use client'

import { useEffect, useMemo, useState } from 'react'
import { CreateRuleSchema, UpdateRuleSchema } from '@/lib/validation/questions'
import {
  COMPARE_OPS,
  evaluateRules,
  WhenSchema,
  type CompareOp,
  type Operand,
  type When,
  type CrossFieldViolation,
} from '@/lib/questions/rule-engine'
import type { RapidAssessmentType } from '@/lib/questions/answers'
import {
  dryRunRule,
  useAdminRuleMutations,
  type AdminQuestionRow,
  type AdminRuleRow,
} from '@/hooks/useAdminQuestionSet'
import { apiGet } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { History, Loader2, Play } from '@/lib/icons'

/**
 * Dynamic Question Registry — cross-field rule authoring dialog (P10-3).
 *
 * Create / edit a `CrossFieldRule` through the same zod grammar the admin API
 * boundary uses (`CreateRuleSchema` / `UpdateRuleSchema` share the engine's AST
 * schema, so the dialog can never construct a payload the server rejects on
 * grammar alone; registry invariants — referenceKeys ⊆ active questions of the
 * type, kebab ruleKey uniqueness — are still server-enforced).
 *
 * - ruleKey: kebab-case, create-only (immutable after creation)
 * - gate editor: none | boolean question gate | advanced (raw `When` JSON for
 *   the seeded Compare-shaped aggregate gates)
 * - violation condition: flat `Compare {op, left, right}` with operands
 *   question | literal | sum(keys) — the full seeded grammar
 * - referenceKeys chips DERIVED from the gate + condition (click a chip to
 *   choose where the violation is reported); edit mode preserves legacy keys
 * - `{{value:key}}` / `{{sum:…}}` token inserter for the message
 * - mandatory audit reason + pending structureVersion bump badge
 * - dry run: seeded from the LATEST assessment answers of the type
 *   (GET /rapid-assessments?type=X&limit=1), editable; fires the DRAFT (plus
 *   the other active rules for context) via the live engine — nothing persists
 * - edit mode embeds the RULE audit timeline (newest first)
 */

export type RuleEditDialogMode = 'create' | 'edit'

const RULE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface RuleAuditEntry {
  id: string
  action: string
  reason: string | null
  actedAt: string
  actor?: { email?: string; name?: string | null } | null
}

// ---- local editor state (parsed into the shared AST on save) ---------------

type OperandState =
  | { type: 'question'; key: string }
  | { type: 'literal'; text: string }
  | { type: 'sum'; text: string }

type GateState =
  | { mode: 'none' }
  | { mode: 'bool'; questionKey: string; is: boolean }
  | { mode: 'advanced'; json: string }

function operandToState(operand: Operand): OperandState {
  switch (operand.type) {
    case 'question':
      return { type: 'question', key: operand.key }
    case 'literal':
      return { type: 'literal', text: String(operand.value) }
    case 'sum':
      return { type: 'sum', text: operand.keys.join(', ') }
  }
}

function gateToState(when: When | null): GateState {
  if (!when) return { mode: 'none' }
  if ('questionKey' in when) {
    return { mode: 'bool', questionKey: when.questionKey, is: when.is }
  }
  return { mode: 'advanced', json: JSON.stringify(when, null, 2) }
}

function toOperand(state: OperandState): { ok: true; operand: Operand } | { ok: false; error: string } {
  switch (state.type) {
    case 'question':
      if (!state.key) return { ok: false, error: 'Select a question for every question operand.' }
      return { ok: true, operand: { type: 'question', key: state.key } }
    case 'literal': {
      const value = Number(state.text)
      if (state.text.trim() === '' || !Number.isFinite(value)) {
        return { ok: false, error: 'Literal operands must be a finite number.' }
      }
      return { ok: true, operand: { type: 'literal', value } }
    }
    case 'sum': {
      const keys = state.text.split(',').map((key) => key.trim()).filter((key) => key !== '')
      if (keys.length === 0) {
        return { ok: false, error: 'Sum operands need at least one comma-separated question key.' }
      }
      return { ok: true, operand: { type: 'sum', keys } }
    }
  }
}

function toWhen(state: GateState): { ok: true; when: When | null } | { ok: false; error: string } {
  switch (state.mode) {
    case 'none':
      return { ok: true, when: null }
    case 'bool':
      if (!state.questionKey) return { ok: false, error: 'Select a gate question.' }
      return { ok: true, when: { questionKey: state.questionKey, is: state.is } }
    case 'advanced': {
      let parsedJson: unknown
      try {
        parsedJson = JSON.parse(state.json)
      } catch {
        return { ok: false, error: 'The advanced gate must be valid JSON.' }
      }
      const parsed = WhenSchema.safeParse(parsedJson)
      if (!parsed.success) {
        return {
          ok: false,
          error:
            'The advanced gate must be a boolean gate {"questionKey","is"} or a compare {"op","left","right"}.',
        }
      }
      return { ok: true, when: parsed.data }
    }
  }
}

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

function describeWhen(when: When | null): string {
  if (!when) return 'always'
  if ('questionKey' in when) return `${when.questionKey} = ${when.is}`
  return `${describeOperand(when.left)} ${when.op} ${describeOperand(when.right)}`
}

function formatAuditDate(value: string): string {
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

function OperandEditor({
  label,
  state,
  onChange,
  questions,
}: {
  label: string
  state: OperandState
  onChange: (next: OperandState) => void
  questions: AdminQuestionRow[]
}) {
  const slug = label.toLowerCase()
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={state.type}
        onValueChange={(value) => {
          if (value === 'question') {
            onChange({ type: 'question', key: questions[0]?.questionKey ?? '' })
          } else if (value === 'literal') {
            onChange({ type: 'literal', text: '0' })
          } else {
            onChange({ type: 'sum', text: '' })
          }
        }}
      >
        <SelectTrigger data-testid={`rule-dialog-${slug}-operand-type`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="question">Question value</SelectItem>
          <SelectItem value="literal">Literal number</SelectItem>
          <SelectItem value="sum">Sum of questions</SelectItem>
        </SelectContent>
      </Select>
      {state.type === 'question' && (
        <Select value={state.key} onValueChange={(key) => onChange({ type: 'question', key })}>
          <SelectTrigger data-testid={`rule-dialog-${slug}-operand-question`}>
            <SelectValue placeholder="Select a question" />
          </SelectTrigger>
          <SelectContent>
            {questions.map((question) => (
              <SelectItem key={question.id} value={question.questionKey}>
                {question.label} ({question.questionKey})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {state.type === 'literal' && (
        <Input
          type="number"
          value={state.text}
          onChange={(event) => onChange({ type: 'literal', text: event.target.value })}
          data-testid={`rule-dialog-${slug}-operand-literal`}
        />
      )}
      {state.type === 'sum' && (
        <Input
          className="font-mono"
          value={state.text}
          onChange={(event) => onChange({ type: 'sum', text: event.target.value })}
          placeholder="comma-separated keys, e.g. populationUnder5, pregnantWomen"
          data-testid={`rule-dialog-${slug}-operand-sum`}
        />
      )}
    </div>
  )
}

interface RuleEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: RuleEditDialogMode
  assessmentType: RapidAssessmentType
  /** Active rules of the assessment type (duplicate-key guard + dry-run context). */
  rules: AdminRuleRow[]
  /** Active question rows of the assessment type (operand/referenceKey pickers). */
  questions: AdminQuestionRow[]
  rule?: AdminRuleRow | null
  /** Current registry structureVersion (rules are always structural). */
  structureVersion: number | null
  onSaved: () => void
}

export function RuleEditDialog({
  open,
  onOpenChange,
  mode,
  assessmentType,
  rules,
  questions,
  rule,
  structureVersion,
  onSaved,
}: RuleEditDialogProps) {
  const { createRule, updateRule, error: mutationError, isMutating } =
    useAdminRuleMutations(assessmentType)

  const [ruleKey, setRuleKey] = useState('')
  const [kind, setKind] = useState<'REFINEMENT' | 'AGGREGATE'>('REFINEMENT')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [gate, setGate] = useState<GateState>({ mode: 'none' })
  const [op, setOp] = useState<CompareOp>('>')
  const [left, setLeft] = useState<OperandState>({ type: 'literal', text: '0' })
  const [right, setRight] = useState<OperandState>({ type: 'literal', text: '0' })
  const [primaryKey, setPrimaryKey] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ---- dry run (draft + context, nothing persisted) -------------------------
  const [dryAnswers, setDryAnswers] = useState('')
  const [dryError, setDryError] = useState<string | null>(null)
  const [dryViolations, setDryViolations] = useState<{
    draft: CrossFieldViolation[]
    context: CrossFieldViolation[]
  } | null>(null)

  // ---- edit-mode audit timeline ---------------------------------------------
  const [auditEntries, setAuditEntries] = useState<RuleAuditEntry[] | null>(null)

  // ---- dry-run source (latest assessment of the type) ------------------------
  const [drySource, setDrySource] = useState<'loading' | 'latest' | 'empty' | 'unavailable'>('loading')

  const booleanQuestions = useMemo(
    () => questions.filter((question) => question.questionType === 'BOOLEAN'),
    [questions]
  )
  const gateQuestions = booleanQuestions.length > 0 ? booleanQuestions : questions
  const numberQuestions = useMemo(
    () => questions.filter((question) => question.questionType === 'NUMBER'),
    [questions]
  )
  // Numeric operands are the sane default (num() coerces booleans/text to 0);
  // fall back to all questions when the type has no NUMBER questions.
  const operandQuestions = numberQuestions.length > 0 ? numberQuestions : questions

  /** Question keys referenced by the draft gate + condition (derived referenceKeys). */
  const derivedReferenceKeys = useMemo(() => {
    const keys: string[] = []
    const push = (key: string | undefined) => {
      const trimmed = key?.trim()
      if (!trimmed || keys.includes(trimmed)) return
      if (questions.some((question) => question.questionKey === trimmed)) keys.push(trimmed)
    }
    if (gate.mode === 'bool') push(gate.questionKey)
    if (left.type === 'question') push(left.key)
    if (left.type === 'sum') left.text.split(',').forEach(push)
    if (right.type === 'question') push(right.key)
    if (right.type === 'sum') right.text.split(',').forEach(push)
    return keys
  }, [gate, left, right, questions])

  /** Operand question keys in operand order — token-insert targets + primary-key preference. */
  const operandKeys = useMemo(() => {
    const keys: string[] = []
    const push = (key: string | undefined) => {
      const trimmed = key?.trim()
      if (trimmed && !keys.includes(trimmed)) keys.push(trimmed)
    }
    if (left.type === 'question') push(left.key)
    if (left.type === 'sum') left.text.split(',').forEach(push)
    if (right.type === 'question') push(right.key)
    if (right.type === 'sum') right.text.split(',').forEach(push)
    return keys.filter((key) => derivedReferenceKeys.includes(key))
  }, [left, right, derivedReferenceKeys])

  /** referenceKeys payload: primary (violation-report key) first, then the rest; edit mode keeps legacy keys. */
  const effectiveReferenceKeys = useMemo(() => {
    const primary =
      primaryKey && derivedReferenceKeys.includes(primaryKey)
        ? primaryKey
        : operandKeys[0] ?? derivedReferenceKeys[0] ?? null
    const rest = derivedReferenceKeys.filter((key) => key !== primary)
    const legacy = (rule?.referenceKeys ?? []).filter(
      (key) => key !== primary && !derivedReferenceKeys.includes(key)
    )
    return primary ? [primary, ...rest, ...legacy] : legacy
  }, [primaryKey, derivedReferenceKeys, operandKeys, rule])

  useEffect(() => {
    if (!open) return
    setRuleKey(rule?.ruleKey ?? '')
    setKind(rule?.kind ?? 'REFINEMENT')
    setName(rule?.name ?? '')
    setMessage(rule?.message ?? '')
    setGate(gateToState(rule?.when ?? null))
    setOp(rule?.expression.op ?? '>')
    setLeft(
      operandToState(
        rule?.expression.left ??
          (questions[0] ? { type: 'question', key: questions[0].questionKey } : { type: 'literal', value: 0 })
      )
    )
    setRight(operandToState(rule?.expression.right ?? { type: 'literal', value: 0 }))
    setPrimaryKey(rule?.referenceKeys[0] ?? null)
    setReason('')
    setSubmitError(null)
    setDryAnswers('')
    setDryError(null)
    setDryViolations(null)
    setAuditEntries(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule])

  useEffect(() => {
    if (!open || mode !== 'edit' || !rule) return
    let cancelled = false
    apiGet<{ entries: RuleAuditEntry[] }>(`/api/v1/admin/rules/${rule.id}/audit`).then((result) => {
      if (cancelled) return
      setAuditEntries(result.success && result.data ? result.data.entries : [])
    })
    return () => {
      cancelled = true
    }
  }, [open, mode, rule])

  // Seed the dry-run textarea with the latest assessment answers of the type
  // (createdAt desc, ADMIN may query without userId). Failure degrades to a
  // manual-paste hint — the dialog never blocks on this fetch.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDrySource('loading')
    apiGet<{ items?: Array<{ answers?: unknown; createdAt?: string }> }>(
      `/api/v1/rapid-assessments?type=${assessmentType}&limit=1&page=1`
    ).then((result) => {
      if (cancelled) return
      const latest = result.success && result.data && Array.isArray(result.data.items)
        ? result.data.items[0]
        : undefined
      if (!result.success || !result.data) {
        setDrySource('unavailable')
        return
      }
      if (!latest || typeof latest.answers !== 'object' || latest.answers === null) {
        setDryAnswers('{}')
        setDrySource('empty')
        return
      }
      setDryAnswers(JSON.stringify(latest.answers, null, 2))
      setDrySource('latest')
    })
    return () => {
      cancelled = true
    }
  }, [open, assessmentType])

  /** Builds the validated gate + expression + referenceKeys shared by save and dry run. */
  const buildAst = ():
    | { ok: true; when: When | null; expression: { op: CompareOp; left: Operand; right: Operand }; referenceKeys: string[] }
    | { ok: false; error: string } => {
    const gateResult = toWhen(gate)
    if (!gateResult.ok) return gateResult
    const leftResult = toOperand(left)
    if (!leftResult.ok) return leftResult
    const rightResult = toOperand(right)
    if (!rightResult.ok) return rightResult
    if (effectiveReferenceKeys.length === 0) {
      return {
        ok: false,
        error: 'The condition must reference at least one question of this assessment type.',
      }
    }
    return {
      ok: true,
      when: gateResult.when,
      expression: { op, left: leftResult.operand, right: rightResult.operand },
      referenceKeys: effectiveReferenceKeys,
    }
  }

  /** Appends a message token (token inserter) to the violation message. */
  const insertToken = (token: string) => {
    setMessage((current) => (current === '' ? token : `${current} ${token}`))
  }

  const runDryRun = () => {
    setDryError(null)
    setDryViolations(null)
    let answers: unknown
    try {
      answers = JSON.parse(dryAnswers)
    } catch {
      setDryError('Answers must be valid JSON, e.g. {"totalPopulation": 100}.')
      return
    }
    if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
      setDryError('Answers must be a JSON object.')
      return
    }
    const built = buildAst()
    if (!built.ok) {
      setDryError(built.error)
      return
    }
    const values = answers as Record<string, unknown>
    const draftReferenceKeys = built.referenceKeys
    const draftViolations = dryRunRule(
      {
        ruleKey: ruleKey.trim() || 'draft-rule',
        kind,
        message: message.trim() || 'Draft rule message',
        when: built.when,
        expression: built.expression,
        referenceKeys: draftReferenceKeys,
      },
      values
    )
    const contextViolations = evaluateRules(
      rules.filter((row) => row.isActive && row.id !== rule?.id),
      values
    )
    setDryViolations({ draft: draftViolations, context: contextViolations })
  }

  const handleSave = async () => {
    setSubmitError(null)
    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      setSubmitError('A change reason is required (audit log).')
      return
    }
    const trimmedName = name.trim()
    const trimmedMessage = message.trim()
    if (!trimmedName) {
      setSubmitError('Name is required.')
      return
    }
    if (!trimmedMessage) {
      setSubmitError('Message is required.')
      return
    }
    const trimmedKey = ruleKey.trim()
    if (mode === 'create') {
      if (!RULE_KEY_PATTERN.test(trimmedKey)) {
        setSubmitError('Rule keys are kebab-case (lowercase letters/digits separated by single hyphens).')
        return
      }
      if (rules.some((row) => row.ruleKey === trimmedKey)) {
        setSubmitError(`A rule with key "${trimmedKey}" already exists for this assessment type.`)
        return
      }
    }
    const built = buildAst()
    if (!built.ok) {
      setSubmitError(built.error)
      return
    }

    if (mode === 'create') {
      const parsed = CreateRuleSchema.safeParse({
        assessmentType,
        ruleKey: trimmedKey,
        kind,
        name: trimmedName,
        message: trimmedMessage,
        when: built.when,
        expression: built.expression,
        referenceKeys: built.referenceKeys,
        reason: trimmedReason,
      })
      if (!parsed.success) {
        setSubmitError(parsed.error.issues.map((issue) => issue.message).join('; '))
        return
      }
      try {
        await createRule.mutateAsync({ ...parsed.data, reason: trimmedReason })
        onSaved()
        onOpenChange(false)
      } catch {
        // the mutation hook surfaces the server error via `mutationError`
      }
      return
    }

    if (!rule) return
    const parsed = UpdateRuleSchema.safeParse({
      kind,
      name: trimmedName,
      message: trimmedMessage,
      when: built.when,
      expression: built.expression,
      referenceKeys: built.referenceKeys,
      reason: trimmedReason,
    })
    if (!parsed.success) {
      setSubmitError(parsed.error.issues.map((issue) => issue.message).join('; '))
      return
    }
    try {
      await updateRule.mutateAsync({ id: rule.id, ...parsed.data, reason: trimmedReason })
      onSaved()
      onOpenChange(false)
    } catch {
      // the mutation hook surfaces the server error via `mutationError`
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="rule-dialog-title">
            {mode === 'create' ? 'Create rule' : `Edit rule — ${rule?.ruleKey ?? ''}`}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'New cross-field rule — structural change, applies to the next assessment.'
              : 'ruleKey is immutable; every change is audit-logged with a reason.'}
          </DialogDescription>
        </DialogHeader>

        {typeof structureVersion === 'number' && (
          <div>
            <Badge variant="outline" data-testid="rule-dialog-version-badge">
              structure v{structureVersion} → v{structureVersion + 1} on save
            </Badge>
          </div>
        )}

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rule-dialog-key">
                Rule key <span className="text-destructive">*</span>
              </Label>
              <Input
                id="rule-dialog-key"
                className="font-mono"
                value={ruleKey}
                onChange={(event) => setRuleKey(event.target.value)}
                disabled={mode === 'edit'}
                placeholder="kebab-case, e.g. food-sufficient-but-short-duration"
                data-testid="rule-dialog-key-input"
              />
              {mode === 'create' && (
                <p className="text-xs text-muted-foreground">
                  kebab-case, unique per assessment type, immutable after creation.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="rule-dialog-kind">Kind</Label>
              <Select
                value={kind}
                onValueChange={(value) => setKind(value === 'AGGREGATE' ? 'AGGREGATE' : 'REFINEMENT')}
              >
                <SelectTrigger id="rule-dialog-kind" data-testid="rule-dialog-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="REFINEMENT">REFINEMENT</SelectItem>
                  <SelectItem value="AGGREGATE">AGGREGATE</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                REFINEMENT violations block online submission; AGGREGATE violations stay
                advisory (client-side only).
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-dialog-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rule-dialog-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={200}
              data-testid="rule-dialog-name-input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-dialog-message">
              Violation message <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="rule-dialog-message"
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={1000}
              data-testid="rule-dialog-message-input"
            />
            <p className="text-xs text-muted-foreground" data-testid="rule-dialog-token-help">
              Tokens: <span className="font-mono">{'{{value:questionKey}}'}</span> renders an
              answer&rsquo;s number, <span className="font-mono">{'{{sum:key1,key2}}'}</span> renders
              their sum.
            </p>
            {operandKeys.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" data-testid="rule-dialog-token-inserter">
                <span className="text-xs text-muted-foreground">Insert:</span>
                {operandKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-xs hover:bg-muted"
                    onClick={() => insertToken(`{{value:${key}}}`)}
                    data-testid={`rule-dialog-token-value-${key}`}
                  >
                    {`{{value:${key}}}`}
                  </button>
                ))}
                {operandKeys.length >= 2 && (
                  <button
                    type="button"
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-xs hover:bg-muted"
                    onClick={() => insertToken(`{{sum:${operandKeys.join(',')}}}`)}
                    data-testid="rule-dialog-token-sum"
                  >
                    {`{{sum:${operandKeys.join(',')}}}`}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <Label htmlFor="rule-dialog-gate-mode">Gate (when the rule evaluates)</Label>
            <Select
              value={gate.mode}
              onValueChange={(value) => {
                if (value === 'none') {
                  setGate({ mode: 'none' })
                } else if (value === 'bool') {
                  setGate({ mode: 'bool', questionKey: gateQuestions[0]?.questionKey ?? '', is: true })
                } else {
                  setGate({ mode: 'advanced', json: '' })
                }
              }}
            >
              <SelectTrigger id="rule-dialog-gate-mode" data-testid="rule-dialog-gate-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No gate — always evaluate</SelectItem>
                <SelectItem value="bool">Boolean question gate</SelectItem>
                <SelectItem value="advanced">Advanced (raw when JSON)</SelectItem>
              </SelectContent>
            </Select>
            {gate.mode === 'bool' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  value={gate.questionKey}
                  onValueChange={(questionKey) => setGate({ mode: 'bool', questionKey, is: gate.is })}
                >
                  <SelectTrigger data-testid="rule-dialog-gate-question">
                    <SelectValue placeholder="Select a boolean question" />
                  </SelectTrigger>
                  <SelectContent>
                    {gateQuestions.map((question) => (
                      <SelectItem key={question.id} value={question.questionKey}>
                        {question.label} ({question.questionKey})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={gate.is ? 'true' : 'false'}
                  onValueChange={(value) => setGate({ mode: 'bool', questionKey: gate.questionKey, is: value === 'true' })}
                >
                  <SelectTrigger data-testid="rule-dialog-gate-is">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">is true</SelectItem>
                    <SelectItem value="false">is false</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {gate.mode === 'advanced' && (
              <div className="space-y-1">
                <Textarea
                  rows={3}
                  className="font-mono text-xs"
                  value={gate.json}
                  onChange={(event) => setGate({ mode: 'advanced', json: event.target.value })}
                  placeholder='e.g. {"op":">","left":{"type":"question","key":"totalPopulation"},"right":{"type":"literal","value":0}}'
                  data-testid="rule-dialog-gate-json"
                />
                <p className="text-xs text-muted-foreground">
                  A boolean gate <span className="font-mono">{'{"questionKey","is"}'}</span> or a
                  compare <span className="font-mono">{'{"op","left","right"}'}</span> — round-trips
                  the seeded aggregate gates.
                </p>
              </div>
            )}
            {gate.mode === 'none' && (
              <p className="text-xs text-muted-foreground">Current gate: {describeWhen(null)}.</p>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <Label>Violation condition</Label>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <OperandEditor label="Left" state={left} onChange={setLeft} questions={operandQuestions} />
              <div className="space-y-2">
                <Label htmlFor="rule-dialog-op">Op</Label>
                <Select value={op} onValueChange={(value) => setOp(value as CompareOp)}>
                  <SelectTrigger id="rule-dialog-op" data-testid="rule-dialog-op">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPARE_OPS.map((candidate) => (
                      <SelectItem key={candidate} value={candidate}>
                        {candidate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <OperandEditor label="Right" state={right} onChange={setRight} questions={operandQuestions} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              Reference keys <span className="text-destructive">*</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              Derived from the gate and condition (must be active questions of this
              assessment type). Click a chip to choose where the violation is reported —
              the first chip is the report key.
            </p>
            {effectiveReferenceKeys.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="rule-dialog-reference-keys">
                The condition must reference at least one question — pick a question operand
                or add gate/sum keys.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5" data-testid="rule-dialog-reference-keys">
                {effectiveReferenceKeys.map((key, index) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPrimaryKey(key)}
                    className={`rounded border px-2 py-0.5 font-mono text-xs ${
                      index === 0
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border hover:bg-muted'
                    }`}
                    data-testid={`rule-dialog-reference-chip-${key}`}
                  >
                    {index === 0 ? `${key} · reports` : key}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rule-dialog-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rule-dialog-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={2000}
              placeholder="Why is this change being made? (audit log)"
              data-testid="rule-dialog-reason-input"
            />
          </div>

          {(submitError || mutationError) && (
            <p className="text-sm text-destructive" data-testid="rule-dialog-error">
              {submitError ?? mutationError}
            </p>
          )}

          <div className="space-y-2 rounded-md border border-dashed border-border p-3">
            <Label htmlFor="rule-dialog-dry-run-input">Dry run (nothing is saved)</Label>
            <p className="text-xs text-muted-foreground" data-testid="rule-dialog-dry-run-source">
              {drySource === 'loading' && 'Loading the latest assessment answers…'}
              {drySource === 'latest' &&
                'Seeded from the latest assessment of this type — edit the JSON below or run as-is.'}
              {drySource === 'empty' &&
                'No assessment of this type yet — empty-values preview (unknown keys coerce to 0).'}
              {drySource === 'unavailable' &&
                'Preview unavailable (could not load assessments) — paste answers JSON manually.'}
            </p>
            <Textarea
              id="rule-dialog-dry-run-input"
              rows={2}
              className="font-mono text-xs"
              value={dryAnswers}
              onChange={(event) => setDryAnswers(event.target.value)}
              placeholder='Answers JSON, e.g. {"isFoodSufficient": true, "availableFoodDurationDays": 2}'
              data-testid="rule-dialog-dry-run-input"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runDryRun}
              disabled={dryAnswers.trim() === ''}
              data-testid="rule-dialog-dry-run-button"
            >
              <Play className="mr-2 h-4 w-4" />
              Run against live engine
            </Button>
            {dryError && <p className="text-sm text-destructive" data-testid="rule-dialog-dry-run-error">{dryError}</p>}
            {dryViolations && (
              <div className="space-y-1 text-sm" data-testid="rule-dialog-dry-run-result">
                {dryViolations.draft.length === 0 ? (
                  <p className="font-medium">No violations from this rule for these answers.</p>
                ) : (
                  <div className="space-y-1">
                    <p className="font-medium text-destructive">
                      This rule fires {dryViolations.draft.length} violation
                      {dryViolations.draft.length === 1 ? '' : 's'}:
                    </p>
                    <ul className="list-disc pl-4">
                      {dryViolations.draft.map((violation, index) => (
                        <li key={`${violation.key}-${index}`}>
                          <span className="font-mono text-xs">{violation.key}</span> —{' '}
                          {violation.message} ({violation.kind})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {dryViolations.context.length > 0 && (
                  <p className="text-muted-foreground">
                    {dryViolations.context.length} other active rule
                    {dryViolations.context.length === 1 ? '' : 's'} also fire with these answers.
                  </p>
                )}
              </div>
            )}
          </div>

          {mode === 'edit' && (
            <div className="space-y-2" data-testid="rule-dialog-audit">
              <div className="flex items-center gap-2 text-sm font-medium">
                <History className="h-4 w-4" />
                Audit trail
              </div>
              {auditEntries === null ? (
                <p className="text-sm text-muted-foreground">Loading audit trail…</p>
              ) : auditEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit entries.</p>
              ) : (
                <ol className="space-y-2">
                  {auditEntries.map((entry) => (
                    <li key={entry.id} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{entry.action}</Badge>
                        <span className="text-muted-foreground">
                          {formatAuditDate(entry.actedAt)}
                        </span>
                        {entry.actor?.email && (
                          <span className="text-muted-foreground">{entry.actor.email}</span>
                        )}
                      </div>
                      {entry.reason && <p className="mt-1">Reason: {entry.reason}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMutating}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={isMutating || reason.trim() === ''}
            data-testid="rule-dialog-save-button"
          >
            {isMutating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'create' ? 'Create rule' : 'Save rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
