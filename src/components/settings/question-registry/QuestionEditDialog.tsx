'use client'

import { useEffect, useMemo, useState } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiPost, apiPut } from '@/lib/api'
import type { RapidAssessmentType } from '@/lib/questions/answers'
import type { AdminQuestionRow, AdminSectionRow } from '@/hooks/useAdminQuestionSet'
import { QuestionAuditTimeline } from '@/components/settings/question-registry/QuestionAuditTimeline'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { AlertTriangle, Loader2, Plus, Save, X } from '@/lib/icons'

/**
 * Dynamic Question Registry — admin question dialog (P8).
 *
 * One dialog, three modes:
 * - `edit`      → PUT  /api/v1/admin/questions/[id]   (every editable field)
 * - `create`    → POST /api/v1/admin/questions
 * - `duplicate` → POST /api/v1/admin/questions (prefilled from a source
 *   question; a fresh camelCase key is required — duplicate keys 409 with
 *   `question_key_duplicate` and render inline without closing the dialog)
 *
 * `category` is derived from the selected section (questions must match their
 * section's category). GAP sections force BOOLEAN + required + severity ∈
 * {CRITICAL, HIGH, MEDIUM} + gap metadata (registry invariants); CONTEXT
 * sections hide the GAP metadata and send explicit nulls / LOW severity.
 *
 * Tier B structural edits (type, required, inverted, section, options, number
 * bounds) are rejected with 409 `question_frozen` while the key appears in a
 * non-DRAFT snapshot under an ACTIVE incident. The banner quotes the server's
 * `affectedCount`, keeps content edits available, and offers
 * "Create copy with new key" (switches to duplicate mode, prefills
 * `${questionKey}New`, carries the typed reason).
 *
 * Live previews mirror DynamicAssessmentForm's rendering exactly:
 * - `question-widget-preview`  — the raw widget for the chosen type
 * - `question-midform-preview` — in-section appearance (GAP tint + badge)
 * - `question-z5-preview`      — the auto Risk Assessment row (GAP only)
 *
 * On success both React Query caches are invalidated: the admin editor's
 * `['admin-question-set', …]` rows and the assessor form's
 * `['question-set', assessmentType]` (label edits must refresh live forms).
 */

const GAP_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM'] as const
type GapSeverity = (typeof GAP_SEVERITIES)[number]

const QUESTION_TYPE_OPTIONS = [
  'BOOLEAN',
  'NUMBER',
  'SINGLE_CHOICE',
  'MULTI_SELECT',
  'TEXT_LONG',
] as const
type QuestionTypeValue = (typeof QUESTION_TYPE_OPTIONS)[number]

const CHOICE_TYPES: readonly QuestionTypeValue[] = ['SINGLE_CHOICE', 'MULTI_SELECT']

const QUESTION_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*$/

export type QuestionEditDialogMode = 'edit' | 'create' | 'duplicate'

interface QuestionEditFormValues {
  questionKey: string
  sectionId: string
  questionType: QuestionTypeValue
  label: string
  helperText: string
  required: boolean
  inverted: boolean
  gapLabel: string
  gapMeaning: string
  recommendation: string
  severity: GapSeverity
  numberMin: string
  numberMax: string
  options: { value: string; label: string }[]
  reason: string
}

export interface QuestionEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: QuestionEditDialogMode
  assessmentType: RapidAssessmentType
  sections: AdminSectionRow[]
  /** Required for `edit` and `duplicate`; ignored for `create`. */
  question?: AdminQuestionRow | null
  /** Preselected section for `create` (defaults to the first section). */
  defaultSectionId?: string
  /** Called after a successful save (the owner refetches the registry). */
  onSaved?: () => void
}

function buildDefaultValues(
  mode: QuestionEditDialogMode,
  question: AdminQuestionRow | null | undefined,
  sections: AdminSectionRow[],
  defaultSectionId?: string
): QuestionEditFormValues {
  // `edit` seeds from the live row (key immutable); `duplicate` seeds the
  // create shape prefilled from the source question with a fresh `${key}New`.
  if (mode === 'edit' && question) {
    return {
      questionKey: question.questionKey,
      sectionId: question.sectionId,
      questionType:
        (QUESTION_TYPE_OPTIONS as readonly string[]).includes(question.questionType)
          ? (question.questionType as QuestionTypeValue)
          : 'BOOLEAN',
      label: question.label,
      helperText: question.helperText ?? '',
      required: question.required,
      inverted: question.inverted,
      gapLabel: question.gapLabel ?? '',
      gapMeaning: question.gapMeaning ?? '',
      recommendation: question.recommendation ?? '',
      severity: GAP_SEVERITIES.includes(question.severity as GapSeverity)
        ? (question.severity as GapSeverity)
        : 'MEDIUM',
      numberMin: question.numberMin !== null ? String(question.numberMin) : '',
      numberMax: question.numberMax !== null ? String(question.numberMax) : '',
      options: [], // seeded below for choice types
      reason: '',
    }
  }
  const preferredSectionId =
    defaultSectionId ?? (mode === 'duplicate' && question ? question.sectionId : undefined)
  const sectionId = preferredSectionId ?? sections[0]?.id ?? ''
  const isDuplicate = mode === 'duplicate' && question
  return {
    questionKey: isDuplicate ? `${question.questionKey}New` : '',
    sectionId,
    questionType:
      isDuplicate && (QUESTION_TYPE_OPTIONS as readonly string[]).includes(question.questionType)
        ? (question.questionType as QuestionTypeValue)
        : 'BOOLEAN',
    label: isDuplicate ? question.label : '',
    helperText: isDuplicate ? (question.helperText ?? '') : '',
    required: isDuplicate ? question.required : true,
    inverted: isDuplicate ? question.inverted : false,
    gapLabel: isDuplicate ? (question.gapLabel ?? '') : '',
    gapMeaning: isDuplicate ? (question.gapMeaning ?? '') : '',
    recommendation: isDuplicate ? (question.recommendation ?? '') : '',
    severity:
      isDuplicate && GAP_SEVERITIES.includes(question.severity as GapSeverity)
        ? (question.severity as GapSeverity)
        : 'MEDIUM',
    numberMin: isDuplicate && question.numberMin !== null ? String(question.numberMin) : '',
    numberMax: isDuplicate && question.numberMax !== null ? String(question.numberMax) : '',
    options: [],
    reason: '',
  }
}

export function QuestionEditDialog({
  open,
  onOpenChange,
  mode,
  assessmentType,
  sections,
  question,
  defaultSectionId,
  onSaved,
}: QuestionEditDialogProps) {
  const queryClient = useQueryClient()

  // `duplicate` can be entered from inside the dialog (frozen banner's
  // "create copy with new key" action) — the override survives until reopen.
  const [modeOverride, setModeOverride] = useState<QuestionEditDialogMode | null>(null)
  const effectiveMode: QuestionEditDialogMode = modeOverride ?? mode

  const [saving, setSaving] = useState(false)
  const [invariantErrors, setInvariantErrors] = useState<string[]>([])
  const [frozenAffected, setFrozenAffected] = useState<number | null>(null)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)

  const form = useForm<QuestionEditFormValues>({
    defaultValues: buildDefaultValues(effectiveMode, question, sections, defaultSectionId),
  })
  const { control, register, watch, setValue, formState } = form
  const optionsArray = useFieldArray({ control, name: 'options' })

  const watchedSectionId = watch('sectionId')
  const watchedType = watch('questionType')
  const watchedLabel = watch('label')
  const watchedHelper = watch('helperText')
  const watchedGapLabel = watch('gapLabel')
  const watchedGapMeaning = watch('gapMeaning')
  const watchedRecommendation = watch('recommendation')
  const watchedSeverity = watch('severity')
  const watchedInverted = watch('inverted')

  // Edit mode: moving across categories is blocked client-side (category must
  // match the section — invariant); create/duplicate derive it from selection.
  const selectableSections = useMemo(
    () =>
      effectiveMode === 'edit' && question
        ? sections.filter((section) => section.category === question.category)
        : sections,
    [sections, effectiveMode, question]
  )

  const sectionRow = useMemo(
    () => selectableSections.find((section) => section.id === watchedSectionId) ?? null,
    [selectableSections, watchedSectionId]
  )
  const isGap = (sectionRow?.category ?? question?.category ?? 'GAP') === 'GAP'
  const isCreate = effectiveMode !== 'edit'

  // Re-seed whenever the dialog (re)opens, the mode flips (including the
  // frozen-banner's create-copy action), or a different question is passed.
  useEffect(() => {
    if (!open) return
    const seed = buildDefaultValues(effectiveMode, question, sections, defaultSectionId)
    if (effectiveMode !== 'create' && question) {
      const raw = (question as unknown as { options?: { value: string; label: string }[] }).options
      seed.options = Array.isArray(raw)
        ? raw.map((option) => ({ value: option.value, label: option.label }))
        : []
    }
    form.reset(seed)
    setInvariantErrors([])
    setFrozenAffected(null)
    setKeyError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveMode, question])

  useEffect(() => {
    setModeOverride(null)
  }, [open, mode, question])

  // GAP sections force BOOLEAN (GAP ⇒ BOOLEAN+required invariant).
  useEffect(() => {
    if (isGap && watch('questionType') !== 'BOOLEAN') setValue('questionType', 'BOOLEAN')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGap])

  const onSubmit = async (values: QuestionEditFormValues) => {
    setSaving(true)
    setInvariantErrors([])
    setFrozenAffected(null)
    setKeyError(null)

    const payload: Record<string, unknown> = {
      sectionId: values.sectionId,
      questionType: isGap ? 'BOOLEAN' : values.questionType,
      label: values.label.trim(),
      helperText: values.helperText.trim() || null,
      required: isGap ? true : values.required,
      inverted: isGap ? values.inverted : false,
      reason: values.reason.trim(),
    }
    if (isGap) {
      payload.category = 'GAP'
      // GAP metadata is min(1) on create and never clearable on update.
      payload.gapLabel = values.gapLabel.trim()
      payload.gapMeaning = values.gapMeaning.trim()
      payload.recommendation = values.recommendation.trim()
      payload.severity = values.severity
    } else {
      payload.category = 'CONTEXT'
      // Explicit nulls strip any stale metadata when flipping GAP → CONTEXT.
      payload.gapLabel = null
      payload.gapMeaning = null
      payload.recommendation = null
      payload.severity = 'LOW'
    }
    if (payload.questionType === 'NUMBER') {
      payload.numberMin = values.numberMin.trim() === '' ? null : Number(values.numberMin)
      payload.numberMax = values.numberMax.trim() === '' ? null : Number(values.numberMax)
    } else {
      payload.numberMin = null
      payload.numberMax = null
    }
    if (CHOICE_TYPES.includes(payload.questionType as QuestionTypeValue)) {
      payload.options = values.options
        .map((option) => ({ value: option.value.trim(), label: option.label.trim() }))
        .filter((option) => option.value !== '' && option.label !== '')
    } else {
      payload.options = []
    }

    let result
    if (isCreate) {
      result = await apiPost('/api/v1/admin/questions', {
        ...payload,
        assessmentType,
        questionKey: values.questionKey.trim(),
      })
    } else {
      if (!question) {
        setSaving(false)
        return
      }
      // questionKey deliberately omitted — keys are immutable
      // (`question_key_immutable`); it is rendered disabled in edit mode.
      result = await apiPut(`/api/v1/admin/questions/${question.id}`, payload)
    }
    setSaving(false)

    if (!result.success) {
      if (result.error === 'question_key_duplicate') {
        setKeyError(
          `Question key "${values.questionKey.trim()}" already exists in this assessment type — pick a different camelCase key.`
        )
        return
      }
      if (result.error === 'question_key_immutable') {
        setKeyError('Question keys are immutable and cannot be changed after creation.')
        return
      }
      if (result.error === 'registry_invalid') {
        const details = result.details as { errors?: unknown } | undefined
        const errors = Array.isArray(details?.errors)
          ? details.errors.filter((e): e is string => typeof e === 'string')
          : []
        setInvariantErrors(
          errors.length > 0 ? errors : ['The change violates a registry invariant.']
        )
        return
      }
      if (result.error === 'question_frozen') {
        const details = result.details as { affectedCount?: unknown } | undefined
        setFrozenAffected(
          typeof details?.affectedCount === 'number' ? details.affectedCount : 0
        )
        return
      }
      toast.error(result.error || 'Failed to save question')
      return
    }

    // Label/structure edits must refresh BOTH the admin rows and the live
    // assessor form cache for this type.
    void queryClient.invalidateQueries({ queryKey: ['admin-question-set'] })
    void queryClient.invalidateQueries({ queryKey: ['question-set', assessmentType] })

    toast.success(isCreate ? 'Question created' : 'Question updated')
    if (isCreate) {
      onSaved?.()
      onOpenChange(false)
      return
    }
    setValue('reason', '', { shouldDirty: false })
    setSavedCount((count) => count + 1)
    onSaved?.()
  }

  const createCopyWithNewKey = () => {
    if (!question) return
    const carriedReason = watch('reason')
    setModeOverride('duplicate')
    setFrozenAffected(null)
    setKeyError(null)
    setInvariantErrors([])
    // The mode effect reseeds via buildDefaultValues (key `${key}New`); the
    // admin's typed reason rides along for the audit log.
    setTimeout(() => setValue('reason', carriedReason), 0)
    toast.info('Prefilled as a new question — adjust the key and save.')
  }

  if (effectiveMode !== 'create' && !question) return null

  const severityVariant =
    watchedSeverity === 'CRITICAL' || watchedSeverity === 'HIGH'
      ? 'destructive'
      : watchedSeverity === 'MEDIUM'
        ? 'secondary'
        : 'outline'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="question-edit-dialog-title">
            {effectiveMode === 'edit'
              ? 'Edit question'
              : effectiveMode === 'duplicate'
                ? 'Duplicate question'
                : 'Add question'}
          </DialogTitle>
          <DialogDescription>
            {effectiveMode === 'edit'
              ? 'Content edits bump the content version. Structural changes respect the incident freeze rule; every change is audit-logged with your reason.'
              : 'New questions are append-only and take effect on the next assessment. Pick a unique camelCase key; every change is audit-logged.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {frozenAffected !== null && (
            <Alert variant="destructive" data-testid="question-frozen-banner">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Question is frozen</AlertTitle>
              <AlertDescription className="space-y-2">
                <span data-testid="question-frozen-banner-text">
                  This question is used by {frozenAffected} assessment
                  {frozenAffected === 1 ? '' : 's'} under active incidents. Structural
                  changes are rejected until those incidents close — content edits
                  (label, helper text, GAP phrasing, severity) remain available.
                </span>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={createCopyWithNewKey}
                    data-testid="question-create-new-key-button"
                  >
                    Create copy with new key
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {invariantErrors.length > 0 && (
            <Alert variant="destructive" data-testid="question-invariant-errors">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Change rejected by registry invariants</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4">
                  {invariantErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Key + section + type (identity / structural placement) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="question-key">
                Question key {!isCreate && <span className="text-xs text-muted-foreground">(immutable)</span>}
              </Label>
              <Input
                id="question-key"
                data-testid="question-key-input"
                className="font-mono"
                maxLength={100}
                disabled={!isCreate}
                placeholder="camelCase, e.g. hasFunctionalClinic"
                {...register('questionKey', {
                  required: isCreate ? 'A question key is required' : false,
                  validate: (value) =>
                    !isCreate || QUESTION_KEY_PATTERN.test(value.trim())
                      ? true
                      : 'Keys are camelCase: letters first, then letters/digits only',
                })}
              />
              {formState.errors.questionKey && (
                <p className="text-xs text-destructive" data-testid="question-key-required-error">
                  {formState.errors.questionKey.message}
                </p>
              )}
              {keyError && (
                <p className="text-xs text-destructive" data-testid="question-key-error">
                  {keyError}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="question-section">Section</Label>
              <Controller
                control={control}
                name="sectionId"
                rules={{ required: 'A section is required' }}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="question-section" data-testid="question-section-select">
                      <SelectValue placeholder="Select section" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectableSections.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.title} ({section.category})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted-foreground">
                Category is derived from the section ({isGap ? 'GAP' : 'CONTEXT'}) and must match it.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="question-type">Question type</Label>
              <Controller
                control={control}
                name="questionType"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      if (isGap && value !== 'BOOLEAN') return
                      field.onChange(value as QuestionTypeValue)
                    }}
                  >
                    <SelectTrigger id="question-type" data-testid="question-type-select">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {QUESTION_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type} disabled={isGap && type !== 'BOOLEAN'}>
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {isGap && (
                <p className="text-xs text-muted-foreground">
                  GAP questions are always BOOLEAN + required (invariant).
                </p>
              )}
            </div>

            {!isGap && (
              <div className="space-y-2">
                <Label htmlFor="question-required">Required</Label>
                <Controller
                  control={control}
                  name="required"
                  render={({ field }) => (
                    <div className="flex items-center gap-2 pt-2" data-testid="question-required-switch">
                      <Switch
                        id="question-required"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                      <span className="text-sm text-muted-foreground">
                        {field.value ? 'Required' : 'Optional'}
                      </span>
                    </div>
                  )}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="question-label">Label</Label>
            <Input
              id="question-label"
              data-testid="question-label-input"
              maxLength={500}
              {...register('label', {
                required: 'Label is required',
                maxLength: { value: 500, message: 'Label must be at most 500 characters' },
                validate: (value) => value.trim().length > 0 || 'Label is required',
              })}
            />
            {formState.errors.label && (
              <p className="text-xs text-destructive" data-testid="question-label-error">
                {formState.errors.label.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="question-helptext">Helper text</Label>
            <Textarea
              id="question-helptext"
              data-testid="question-helptext-input"
              rows={2}
              maxLength={1000}
              placeholder="Shown under the label on the assessment form (optional)"
              {...register('helperText')}
            />
          </div>

          {isGap && (
            <div className="space-y-4 rounded-md border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                GAP metadata (drives the gap analysis and report wording)
              </p>
              <div className="space-y-2">
                <Label htmlFor="question-gap-label">Gap label</Label>
                <Input
                  id="question-gap-label"
                  data-testid="question-gap-label-input"
                  maxLength={200}
                  {...register('gapLabel', {
                    validate: (value) => value.trim().length > 0 || 'GAP questions need a gap label',
                  })}
                />
                {formState.errors.gapLabel && (
                  <p className="text-xs text-destructive">{formState.errors.gapLabel.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="question-gap-meaning">Gap meaning</Label>
                <Textarea
                  id="question-gap-meaning"
                  data-testid="question-gap-meaning-input"
                  rows={2}
                  maxLength={500}
                  {...register('gapMeaning', {
                    validate: (value) => value.trim().length > 0 || 'GAP questions need a gap meaning',
                  })}
                />
                {formState.errors.gapMeaning && (
                  <p className="text-xs text-destructive">{formState.errors.gapMeaning.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="question-recommendation">Recommendation</Label>
                <Textarea
                  id="question-recommendation"
                  data-testid="question-recommendation-input"
                  rows={2}
                  maxLength={1000}
                  {...register('recommendation', {
                    validate: (value) =>
                      value.trim().length > 0 || 'GAP questions need a recommendation',
                  })}
                />
                {formState.errors.recommendation && (
                  <p className="text-xs text-destructive">
                    {formState.errors.recommendation.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="question-severity">Severity</Label>
                <Controller
                  control={control}
                  name="severity"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="question-severity" data-testid="question-severity-select">
                        <SelectValue placeholder="Severity" />
                      </SelectTrigger>
                      <SelectContent>
                        {GAP_SEVERITIES.map((severity) => (
                          <SelectItem key={severity} value={severity}>
                            {severity}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  GAP severities are derived live and never frozen — changing
                  them does not invalidate existing snapshots.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="question-inverted">Inverted (checked = no gap)</Label>
                <Controller
                  control={control}
                  name="inverted"
                  render={({ field }) => (
                    <div className="flex items-center gap-2" data-testid="question-inverted-switch">
                      <Switch
                        id="question-inverted"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                      <span className="text-sm text-muted-foreground">
                        {field.value
                          ? 'Checked means NO gap (e.g. "is safe")'
                          : 'Unchecked means a gap (e.g. "is missing")'}
                      </span>
                    </div>
                  )}
                />
              </div>
            </div>
          )}

          {!isGap && watchedType === 'NUMBER' && (
            <div className="grid grid-cols-1 gap-4 rounded-md border border-border p-3 sm:grid-cols-2">
              <p className="text-xs font-medium text-muted-foreground sm:col-span-2">
                Number bounds
              </p>
              <div className="space-y-2">
                <Label htmlFor="question-number-min">Minimum</Label>
                <Input
                  id="question-number-min"
                  type="number"
                  data-testid="question-number-min-input"
                  {...register('numberMin', {
                    validate: (value) =>
                      value.trim() === '' || Number.isInteger(Number(value))
                        ? true
                        : 'Minimum must be a whole number',
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="question-number-max">Maximum</Label>
                <Input
                  id="question-number-max"
                  type="number"
                  data-testid="question-number-max-input"
                  {...register('numberMax', {
                    validate: (value) => {
                      if (value.trim() !== '' && !Number.isInteger(Number(value))) {
                        return 'Maximum must be a whole number'
                      }
                      const min = watch('numberMin')
                      if (
                        value.trim() !== '' &&
                        min.trim() !== '' &&
                        Number(value) < Number(min)
                      ) {
                        return 'Maximum must be ≥ minimum'
                      }
                      return true
                    },
                  })}
                />
              </div>
            </div>
          )}

          {CHOICE_TYPES.includes(watchedType) && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Options ({watchedType === 'MULTI_SELECT' ? 'multi-select pills' : 'dropdown entries'})
              </p>
              {optionsArray.fields.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No options yet — choice questions need at least one option.
                </p>
              )}
              {optionsArray.fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-2">
                  <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      className="font-mono"
                      placeholder="value"
                      maxLength={100}
                      data-testid={`question-option-value-input-${index}`}
                      {...register(`options.${index}.value` as const, {
                        required: 'Option value is required',
                      })}
                    />
                    <Input
                      placeholder="label"
                      maxLength={200}
                      data-testid={`question-option-label-input-${index}`}
                      {...register(`options.${index}.label` as const, {
                        required: 'Option label is required',
                      })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove option ${index + 1}`}
                    data-testid={`question-remove-option-button-${index}`}
                    onClick={() => optionsArray.remove(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => optionsArray.append({ value: '', label: '' })}
                data-testid="question-add-option-button"
              >
                <Plus className="mr-1 h-4 w-4" />
                Add option
              </Button>
            </div>
          )}

          {/* Previews (live; mirror DynamicAssessmentForm rendering) */}
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <p className="text-xs font-medium text-muted-foreground">Previews (live)</p>

            <div className="space-y-2" data-testid="question-widget-preview">
              <p className="text-xs text-muted-foreground">Widget</p>
              <div className="pointer-events-none">
                {watchedType === 'BOOLEAN' ? (
                  <div className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-background">
                    <Checkbox checked={false} />
                    <div className="space-y-1 leading-none">
                      <p className="text-sm font-medium leading-none">
                        {watchedLabel || 'Question label'}
                        <span className="text-destructive"> *</span>
                      </p>
                      {watchedHelper && (
                        <p className="text-xs text-muted-foreground">{watchedHelper}</p>
                      )}
                    </div>
                  </div>
                ) : watchedType === 'NUMBER' ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {watchedLabel || 'Question label'} <span className="text-destructive">*</span>
                    </p>
                    <Input type="number" disabled placeholder="0" />
                  </div>
                ) : watchedType === 'SINGLE_CHOICE' ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {watchedLabel || 'Question label'} <span className="text-destructive">*</span>
                    </p>
                    <div className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
                      {`Select ${(watchedLabel || 'question label').toLowerCase()}`}
                    </div>
                  </div>
                ) : watchedType === 'MULTI_SELECT' ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {watchedLabel || 'Question label'} <span className="text-destructive">*</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(optionsArray.fields.length > 0
                        ? optionsArray.fields.map((_, index) => watch(`options.${index}.label`))
                        : ['Option A', 'Option B']
                      )
                        .filter((label): label is string => Boolean(label))
                        .map((label, index) => (
                          <span
                            key={`${label}-${index}`}
                            className="rounded-full border px-3 py-1 text-sm"
                          >
                            {label}
                          </span>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">{watchedLabel || 'Question label'}</p>
                    <Textarea disabled className="min-h-[100px]" />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2" data-testid="question-midform-preview">
              <p className="text-xs text-muted-foreground">In-section appearance</p>
              <div
                className={
                  isGap
                    ? 'rounded-md border bg-sky-50/50 p-3 dark:bg-sky-950/20'
                    : 'rounded-md border p-3'
                }
              >
                <div className="flex flex-row items-start space-x-3 space-y-0">
                  <div className="flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium leading-none">
                      {watchedLabel || 'Question label'}
                      <span className="text-destructive">*</span>
                      {isGap && (
                        <StatusBadge
                          domain="assessment"
                          status={watchedInverted ? 'GAP' : 'NO_GAP'}
                          label={watchedInverted ? 'Gap' : 'No Gap'}
                        />
                      )}
                    </p>
                    {watchedHelper && (
                      <p className="mt-1 text-xs text-muted-foreground">{watchedHelper}</p>
                    )}
                  </div>
                </div>
                {isGap && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Badge appears once the assessor answers (sample:{' '}
                    {watchedInverted ? 'checked = gap' : 'checked = no gap'}).
                  </p>
                )}
              </div>
            </div>

            {isGap && (
              <div className="space-y-2" data-testid="question-z5-preview">
                <p className="text-xs text-muted-foreground">Risk Assessment (Z5) row</p>
                <div className="flex items-start gap-3 rounded-lg bg-red-50 p-3 dark:bg-red-900/10">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-orange-500" />
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">
                        {watchedGapLabel || watchedLabel || 'Gap'} Gap
                      </p>
                      <Badge variant={severityVariant as 'destructive' | 'secondary' | 'outline'}>
                        {watchedSeverity}
                      </Badge>
                    </div>
                    {watchedGapMeaning && (
                      <p className="text-xs text-muted-foreground">{watchedGapMeaning}</p>
                    )}
                    {watchedRecommendation && (
                      <p className="text-sm text-muted-foreground">{watchedRecommendation}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="question-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="question-reason"
              data-testid="question-reason-input"
              maxLength={2000}
              placeholder="Why is this change being made? (audit log)"
              {...register('reason', {
                required: 'A reason is required for registry changes',
                maxLength: { value: 2000, message: 'Reason must be at most 2000 characters' },
                validate: (value) => value.trim().length > 0 || 'A reason is required',
              })}
            />
            {formState.errors.reason && (
              <p className="text-xs text-destructive" data-testid="question-reason-error">
                {formState.errors.reason.message}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {effectiveMode === 'edit' ? 'Close' : 'Cancel'}
            </Button>
            <Button type="submit" disabled={saving} data-testid="question-save-button">
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {effectiveMode === 'edit' ? 'Save changes' : 'Create question'}
            </Button>
          </DialogFooter>
        </form>

        {effectiveMode === 'edit' && question && (
          <QuestionAuditTimeline questionId={question.id} refreshKey={savedCount} />
        )}
      </DialogContent>
    </Dialog>
  )
}
