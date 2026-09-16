'use client'

/**
 * Dynamic Assessment Form (P4) — one registry-driven form for every
 * assessment type. Replaces the six deleted hardcoded forms
 * (Health/Population/Food/WASH/Shelter/SecurityAssessmentForm).
 *
 * Layout follows plan §2.4's zones:
 *   Z1 SectionProgress + StickyFormHeader (live gap count + registry badge)
 *   Z2 Incident & Entity context
 *   Z3 GAP sections (sky tint; checkbox items with per-question GAP/NO_GAP
 *      badges; untouched questions are neutral and NEVER gaps)
 *   Z4 CONTEXT sections (2-col grid; selects/multi-pills full width)
 *   Z5 auto Risk Assessment card (pure `analyzeGaps` preview)
 *   Z6 GPS / Photos / Additional Details
 *   Z7 draft autosave (30s) + manual save + flash + submit
 *
 * Everything question-shaped renders from the live question set
 * (`useQuestionSet`); nothing about HEALTH/FOOD/... is hardcoded beyond type
 * chrome (icon/title). Submitting produces the canonical answers payload
 * `{ type, rapidAssessmentDate, assessorName, ..., answers }` validated
 * against the current registry via `buildAssessmentSchema` (client) — the
 * server re-validates against the snapshot it freezes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useForm, useWatch, Controller, type Resolver, type FieldErrors, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import { AlertTriangle, Droplets, Home, Hospital, Loader2, Save, Shield, Users, UtensilsCrossed } from '@/lib/icons'
import type { AnswerValue, RapidAssessmentType } from '@/lib/questions/answers'
import { coerceArray } from '@/lib/questions/answers'
import { analyzeGaps } from '@/lib/questions/gap-engine'
import { crossFieldSuperRefine, evaluateCrossFieldRules, type CrossFieldViolation } from '@/lib/questions/cross-field-rules'
import { buildAssessmentSchema } from '@/lib/validation/dynamic-assessment'
import { useQuestionSet, type QuestionDef, type QuestionSectionDef } from '@/hooks/useQuestionSet'
import { useRapidAssessmentDrafts } from '@/hooks/useRapidAssessmentDrafts'
import { getCurrentUserName } from '@/utils/assessment-utils'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FormItem, FormLabel, FormDescription, FormControl, FormMessage, Form } from '@/components/ui/form'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { StickyFormHeader } from '@/components/shared/StickyFormHeader'
import { SectionProgress } from '@/components/shared/SectionProgress'
import { TagPillSelect } from '@/components/shared/TagPillSelect'
import { IncidentSelector } from '@/components/shared/IncidentSelector'
import { EntitySelector } from '@/components/shared/EntitySelector'
import { GPSCapture } from '@/components/shared/GPSCapture'
import { MediaField } from '@/components/shared/MediaField'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssessmentFormSubmitPayload {
  type: RapidAssessmentType
  rapidAssessmentDate: string
  assessorName: string
  location?: string
  coordinates?: {
    latitude: number
    longitude: number
    accuracy?: number
    timestamp: string
    captureMethod: 'GPS' | 'MANUAL'
  }
  mediaAttachments?: string[]
  entityId: string
  incidentId: string
  answers: Record<string, AnswerValue>
}

export interface DynamicAssessmentFormProps {
  assessmentType: RapidAssessmentType
  entityId?: string
  incidentId?: string
  /** Stored answers map (edit/reassessment hydration). */
  initialAnswers?: Record<string, unknown> | null
  /** Disable the incident/entity selectors (reassessment lock). */
  lockIncidentEntity?: boolean
  /** Meta field names to disable (e.g. rejected-edit freezes). */
  readonlyFields?: string[]
  isReassessment?: boolean
  previousAssessmentDate?: string
  onSubmit: (payload: AssessmentFormSubmitPayload) => Promise<void> | void
  onCancel?: () => void
}

type AnswersFormValues = Record<string, AnswerValue>

interface TypeChrome {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  submitLabel: string
}

const TYPE_CHROME: Record<RapidAssessmentType, TypeChrome> = {
  HEALTH: {
    icon: Hospital,
    title: 'Health Assessment',
    description: 'Assess healthcare facilities, services, and common health issues in the affected area',
    submitLabel: 'Submit Health Assessment',
  },
  POPULATION: {
    icon: Users,
    title: 'Population Assessment',
    description: 'Collect population demographics and vulnerable groups data for the affected area',
    submitLabel: 'Submit Population Assessment',
  },
  FOOD: {
    icon: UtensilsCrossed,
    title: 'Food & Nutrition Assessment',
    description: 'Assess food availability, access, and nutrition status in the affected area',
    submitLabel: 'Submit Food & Nutrition Assessment',
  },
  WASH: {
    icon: Droplets,
    title: 'WASH Assessment',
    description: 'Assess water, sanitation, and hygiene conditions in the affected area',
    submitLabel: 'Submit WASH Assessment',
  },
  SHELTER: {
    icon: Home,
    title: 'Shelter Assessment',
    description: 'Assess shelter conditions, adequacy, and needs in the affected area',
    submitLabel: 'Submit Shelter Assessment',
  },
  SECURITY: {
    icon: Shield,
    title: 'Security Assessment',
    description: 'Assess safety, protection, and security concerns in the affected area',
    submitLabel: 'Submit Security Assessment',
  },
}

/** kebabCase(questionKey) — the stable widget testid convention. */
function kebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** Hand-written legacy widget testids that kebabCase(questionKey) cannot reproduce. */
const LEGACY_TESTID_OVERRIDES: Record<string, string> = {
  additionalHealthDetails: 'additional-details',
}

/** Widget testid: kebabCase(questionKey), except preserved hand-written legacy ids. */
function testIdFor(questionKey: string): string {
  return LEGACY_TESTID_OVERRIDES[questionKey] ?? kebabCase(questionKey)
}

function todayIsoDate(): string {
  return new Date().toISOString().split('T')[0]
}

/** Date-only input → full ISO at local midnight (legacy timestamp display parity). */
function toDateIsoTimestamp(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00`).toISOString()
}

/** Form-wide defaults (legacy parity): boolean false / number 0 / array [] / choice '' / text ''. */
function buildDefaultValues(
  questions: QuestionDef[],
  initialAnswers?: Record<string, unknown> | null
): AnswersFormValues {
  const values: AnswersFormValues = {}
  for (const question of questions) {
    const initial = initialAnswers?.[question.key]
    const hasInitial = initial !== undefined && initial !== null
    switch (question.type) {
      case 'BOOLEAN':
        values[question.key] = hasInitial && typeof initial === 'boolean' ? initial : false
        break
      case 'NUMBER':
        values[question.key] = hasInitial && typeof initial === 'number' ? initial : 0
        break
      case 'MULTI_SELECT':
        values[question.key] = hasInitial ? coerceArray(initial) : []
        break
      default:
        values[question.key] = hasInitial && typeof initial === 'string' ? initial : ''
        break
    }
  }
  return values
}

/** Sections whose questions are all free-text render as Z6 "Additional Details". */
function isAdditionalTextSection(section: QuestionSectionDef): boolean {
  return section.questions.length > 0 && section.questions.every((q) => q.type === 'TEXT_LONG')
}

// ---------------------------------------------------------------------------
// Component (loader shell → inner form)
// ---------------------------------------------------------------------------

export function DynamicAssessmentForm(props: DynamicAssessmentFormProps) {
  const { assessmentType } = props
  const { sections, questions, isLoading, error, structureVersion, contentVersion } = useQuestionSet(assessmentType)

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto" data-testid={`${assessmentType.toLowerCase()}-form-loading`}>
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Loading assessment questions…</span>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || questions.length === 0) {
    return (
      <div className="max-w-4xl mx-auto space-y-4" data-testid={`${assessmentType.toLowerCase()}-form-error`}>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {error ?? `No registry questions are configured for assessment type ${assessmentType}.`}
          </AlertDescription>
        </Alert>
        {props.onCancel && (
          <Button variant="outline" onClick={props.onCancel}>
            Go Back
          </Button>
        )}
      </div>
    )
  }

  return (
    <DynamicAssessmentFormInner
      {...props}
      sections={sections.filter((section) => section.questions.length > 0)}
      questions={questions}
      structureVersion={structureVersion}
      contentVersion={contentVersion}
    />
  )
}

interface InnerProps extends DynamicAssessmentFormProps {
  sections: QuestionSectionDef[]
  questions: QuestionDef[]
  structureVersion: number | null
  contentVersion: number | null
}

function DynamicAssessmentFormInner(props: InnerProps) {
  const {
    assessmentType,
    entityId,
    incidentId,
    initialAnswers,
    lockIncidentEntity,
    readonlyFields = [],
    isReassessment,
    previousAssessmentDate,
    onSubmit,
    onCancel,
    sections,
    questions,
    structureVersion,
    contentVersion,
  } = props

  const chrome = TYPE_CHROME[assessmentType]
  const formContainerRef = useRef<HTMLDivElement>(null)

  // ---- meta state (type-independent chrome fields) ------------------------
  const [assessorName, setAssessorName] = useState(() => getCurrentUserName())
  const [assessmentDate, setAssessmentDate] = useState(todayIsoDate())
  const [locationName, setLocationName] = useState('')
  const [selectedEntity, setSelectedEntity] = useState<string>(entityId ?? '')
  const [selectedIncident, setSelectedIncident] = useState<string>(incidentId ?? '')
  const [gpsLocation, setGpsLocation] = useState<AssessmentFormSubmitPayload['coordinates'] | null>(null)
  const [photos, setPhotos] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draftSaved, setDraftSaved] = useState(false)

  // ---- per-question interaction gating -------------------------------------
  // A question is "touched" once the assessor interacts with it (or once it is
  // hydrated from stored answers on the edit page). Untouched GAP questions
  // are unanswered for the preview engine — never gaps, never badged.
  const [touchedKeys, setTouchedKeys] = useState<Set<string>>(() => {
    const touched = new Set<string>()
    for (const question of questions) {
      const value = initialAnswers?.[question.key]
      if (value !== undefined && value !== null) touched.add(question.key)
    }
    return touched
  })
  const markInteracted = useCallback((key: string) => {
    setTouchedKeys((previous) => (previous.has(key) ? previous : new Set(previous).add(key)))
  }, [])

  // ---- form (registry-compiled schema + '' sanitizing resolver) ------------
  const gapQuestionKeys = useMemo(
    () => questions.filter((q) => q.category === 'GAP').map((q) => q.key),
    [questions]
  )
  const gapKeySet = useMemo(() => new Set(gapQuestionKeys), [gapQuestionKeys])

  // `buildAssessmentSchema` consumes snapshot-style defs (questionType/required).
  const schemaInput = useMemo(
    () => ({
      sections: sections.map((section) => ({
        questions: section.questions.map((question) => ({
          key: question.key,
          questionType: question.type,
          required: question.required,
          options: question.options,
          numberMin: question.numberMin,
          numberMax: question.numberMax,
        })),
      })),
    }),
    [sections]
  )
  const submitSchema = useMemo(
    () => buildAssessmentSchema(schemaInput).superRefine(crossFieldSuperRefine(assessmentType)),
    [schemaInput, assessmentType]
  )

  const defaultValues = useMemo(() => buildDefaultValues(questions, initialAnswers), []) // eslint-disable-line react-hooks/exhaustive-deps

  const resolver = useMemo<Resolver<AnswersFormValues>>(() => {
    const base = zodResolver(submitSchema)
    return (values, context, options) => {
      // Unanswered optional inputs (empty string / undefined / null) travel as
      // ABSENT: they pass `.optional()` validation and never reach the server
      // as ''. zodResolver returns the parsed output, so `handleSubmit` hands
      // us the already-stripped answers map.
      const sanitized: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(values ?? {})) {
        if (value === '' || value === undefined || value === null) continue
        sanitized[key] = value
      }
      return base(sanitized as never, context, options) as never
    }
  }, [submitSchema])

  const form = useForm<AnswersFormValues>({
    resolver,
    defaultValues,
  })
  const { control, handleSubmit, formState, getValues } = form
  const watchedValues = useWatch({ control })

  // Late-arriving initialAnswers (reassessment prefill resolves after mount):
  // apply them once when they land, unless the assessor already edited (the
  // legacy forms reset on initialData change the same way).
  const appliedInitialAnswersRef = useRef(initialAnswers)
  useEffect(() => {
    if (initialAnswers === appliedInitialAnswersRef.current) return
    appliedInitialAnswersRef.current = initialAnswers
    if (!initialAnswers || formState.isDirty) return
    form.reset(buildDefaultValues(questions, initialAnswers))
    const touched = new Set<string>()
    for (const question of questions) {
      const value = initialAnswers[question.key]
      if (value !== undefined && value !== null) touched.add(question.key)
    }
    setTouchedKeys(touched)
  }, [initialAnswers, questions, form, formState.isDirty])

  // ---- live gap preview (untouched GAP questions = unanswered, never gaps) -
  const engineStructure = useMemo(
    () => ({
      sections: sections.map((section) => ({
        order: section.order,
        questions: section.questions.map((question) => ({
          key: question.key,
          label: question.label,
          category: question.category,
          inverted: question.inverted,
          gapLabel: question.gapLabel,
          gapMeaning: question.gapMeaning,
          recommendation: question.recommendation,
          order: question.order,
        })),
      })),
    }),
    [sections]
  )
  const registryRows = useMemo(
    () => questions.map((question) => ({ questionKey: question.key, severity: question.severity })),
    [questions]
  )

  const gapResult = useMemo(() => {
    const preview: Record<string, unknown> = {}
    for (const key of gapQuestionKeys) {
      preview[key] = touchedKeys.has(key) ? watchedValues?.[key] : undefined
    }
    return analyzeGaps(engineStructure, preview, registryRows)
  }, [engineStructure, registryRows, gapQuestionKeys, touchedKeys, watchedValues])

  const gapCount = gapResult.gapFields.length
  const hasInteracted = useMemo(
    () => Array.from(touchedKeys).some((key) => gapKeySet.has(key)),
    [touchedKeys, gapKeySet]
  )
  const gapLabels = useMemo(
    () =>
      gapResult.gapFields.map((key) => {
        const row = gapResult.rows.find((candidate) => candidate.key === key)
        return row?.gapLabel ?? row?.label ?? key
      }),
    [gapResult]
  )

  // Inverted-aware per-question badge map (mirrors the engine's gap condition).
  const gapBadgeMap = useMemo(() => {
    const map: Record<string, 'GAP' | 'NO_GAP'> = {}
    for (const question of questions) {
      if (question.category !== 'GAP' || !touchedKeys.has(question.key)) continue
      const value = watchedValues?.[question.key]
      const isGap = question.inverted ? value === true : value === false
      map[question.key] = isGap ? 'GAP' : 'NO_GAP'
    }
    return map
  }, [questions, touchedKeys, watchedValues])

  // ---- cross-field rules (live alerts + submit gating) ---------------------
  const crossFieldViolations = useMemo(
    () => evaluateCrossFieldRules(assessmentType, (watchedValues ?? {}) as Record<string, unknown>),
    [assessmentType, watchedValues]
  )
  const violationsBySection = useMemo(() => {
    const keyToSection = new Map<string, string>()
    for (const section of sections) {
      for (const question of section.questions) keyToSection.set(question.key, section.key)
    }
    const grouped = new Map<string, CrossFieldViolation[]>()
    for (const violation of crossFieldViolations) {
      const sectionKey = keyToSection.get(violation.key) ?? sections[0]?.key ?? ''
      const bucket = grouped.get(sectionKey) ?? []
      bucket.push(violation)
      grouped.set(sectionKey, bucket)
    }
    return grouped
  }, [crossFieldViolations, sections])

  // ---- sections split by zone (GAP sections first, then order ASC) ---------
  const additionalSections = useMemo(() => sections.filter(isAdditionalTextSection), [sections])
  const additionalSectionKeys = useMemo(() => new Set(additionalSections.map((s) => s.key)), [additionalSections])
  const contentSections = useMemo(
    () => sections.filter((section) => !additionalSectionKeys.has(section.key)),
    [sections, additionalSectionKeys]
  )
  const gapSections = useMemo(() => contentSections.filter((s) => s.category === 'GAP'), [contentSections])
  const contextSections = useMemo(() => contentSections.filter((s) => s.category !== 'GAP'), [contentSections])

  const formSections = useMemo(
    () => [
      { id: 'section-incident', label: 'Incident' },
      ...gapSections.map((section) => ({ id: `section-${section.key}`, label: section.title })),
      ...contextSections.map((section) => ({ id: `section-${section.key}`, label: section.title })),
      { id: 'section-location', label: 'Location' },
      { id: 'section-photos', label: 'Photos' },
      ...(additionalSections.length > 0 ? [{ id: 'section-additional', label: 'Additional' }] : []),
    ],
    [gapSections, contextSections, additionalSections.length]
  )

  // ---- drafts (30s autosave + manual save + flash + count) ------------------
  const { drafts, saveDraft } = useRapidAssessmentDrafts(assessmentType)

  const draftSnapshot = useCallback(() => {
    return {
      answers: getValues(),
      assessorName,
      rapidAssessmentDate: assessmentDate,
      location: locationName,
      photos,
      gpsLocation,
    }
  }, [getValues, assessorName, assessmentDate, locationName, photos, gpsLocation])

  const flashDraftSaved = useCallback(() => {
    setDraftSaved(true)
    setTimeout(() => setDraftSaved(false), 2000)
  }, [])

  const handleSaveDraft = useCallback(
    (isAutosave: boolean) => {
      saveDraft(draftSnapshot(), selectedEntity, selectedIncident, isAutosave)
      if (!isAutosave) flashDraftSaved()
    },
    [saveDraft, draftSnapshot, selectedEntity, selectedIncident, flashDraftSaved]
  )

  // Autosave every 30s while dirty (no restore-on-mount — parity; p5 owns that).
  const autosaveRef = useRef(handleSaveDraft)
  autosaveRef.current = handleSaveDraft
  const dirty = formState.isDirty || photos.length > 0 || gpsLocation !== null || touchedKeys.size > 0
  useEffect(() => {
    if (!dirty) return
    const interval = setInterval(() => autosaveRef.current(true), 30_000)
    return () => clearInterval(interval)
  }, [dirty])

  // ---- submit ----------------------------------------------------------------
  const submitDisabled =
    isSubmitting || crossFieldViolations.length > 0 || !selectedEntity || !selectedIncident

  const handleFormSubmit = handleSubmit(async (data) => {
    if (!selectedEntity || !selectedIncident || submitDisabled) return
    setIsSubmitting(true)
    try {
      await onSubmit({
        type: assessmentType,
        rapidAssessmentDate: toDateIsoTimestamp(assessmentDate),
        assessorName: assessorName || getCurrentUserName(),
        ...(locationName ? { location: locationName } : {}),
        ...(gpsLocation ? { coordinates: gpsLocation } : {}),
        ...(photos.length > 0 ? { mediaAttachments: photos } : {}),
        entityId: selectedEntity,
        incidentId: selectedIncident,
        answers: data as Record<string, AnswerValue>,
      })
    } finally {
      setIsSubmitting(false)
    }
  })

  // ---------------------------------------------------------------------------
  return (
    <div
      className="max-w-4xl mx-auto space-y-6"
      data-testid={`${assessmentType.toLowerCase()}-assessment-form`}
      ref={formContainerRef}
    >
      {/* Z1 — section progress + sticky header */}
      <SectionProgress containerRef={formContainerRef} sections={formSections} />

      <StickyFormHeader
        icon={<chrome.icon className="h-5 w-5" />}
        title={chrome.title}
        description={chrome.description}
        gapCount={gapCount}
        gapLabels={gapLabels}
        hasInteracted={hasInteracted}
        isReassessment={isReassessment}
        previousAssessmentDate={previousAssessmentDate}
        extraBadges={
          structureVersion !== null && contentVersion !== null ? (
            <Badge variant="outline" data-testid="registry-version-badge">
              Registry v{structureVersion}.{contentVersion}
            </Badge>
          ) : undefined
        }
      />

      <Form {...form}>
        <form onSubmit={handleFormSubmit} className="space-y-6 pb-8">
          {/* Z2 — incident & entity context */}
          <Card id="section-incident">
            <CardHeader>
              <CardTitle>Incident & Entity</CardTitle>
              <CardDescription className="hidden sm:block">
                Select the incident and entity this assessment belongs to
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <IncidentSelector
                    value={selectedIncident}
                    onValueChange={setSelectedIncident}
                    disabled={lockIncidentEntity || readonlyFields.includes('incidentId')}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <FormLabel>Entity *</FormLabel>
                  <EntitySelector
                    value={selectedEntity}
                    onValueChange={setSelectedEntity}
                    disabled={lockIncidentEntity || readonlyFields.includes('entityId')}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <FormLabel htmlFor="assessor-name">Assessor Name *</FormLabel>
                  <Input
                    id="assessor-name"
                    value={assessorName}
                    onChange={(event) => setAssessorName(event.target.value)}
                    placeholder="Your name"
                    disabled={readonlyFields.includes('assessorName')}
                    data-testid="assessor-name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <FormLabel htmlFor="assessment-date">Assessment Date *</FormLabel>
                  <Input
                    id="assessment-date"
                    type="date"
                    value={assessmentDate}
                    onChange={(event) => setAssessmentDate(event.target.value)}
                    disabled={readonlyFields.includes('rapidAssessmentDate')}
                    data-testid="assessment-date"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <FormLabel htmlFor="location-name">Location</FormLabel>
                  <Input
                    id="location-name"
                    value={locationName}
                    onChange={(event) => setLocationName(event.target.value)}
                    placeholder="Where was this assessed?"
                    disabled={readonlyFields.includes('location')}
                    data-testid="location-name"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Z3 — GAP sections (tinted; GAP-category sections render first) */}
          {gapSections.map((section) => (
            <Card
              key={section.key}
              id={`section-${section.key}`}
              className="bg-sky-50/50 dark:bg-sky-950/20"
              data-testid={`section-${kebabCase(section.key)}`}
            >
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                {section.description && (
                  <CardDescription className="hidden sm:block">{section.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {section.questions.map((question) => (
                    <QuestionField
                      key={question.key}
                      question={question}
                      control={control}
                      errors={formState.errors}
                      gapStatus={gapBadgeMap[question.key] ?? null}
                      onInteract={() => markInteracted(question.key)}
                    />
                  ))}
                </div>
                <SectionViolations violations={violationsBySection.get(section.key)} />
              </CardContent>
            </Card>
          ))}

          {/* Z4 — CONTEXT sections */}
          {contextSections.map((section) => (
            <Card key={section.key} id={`section-${section.key}`} data-testid={`section-${kebabCase(section.key)}`}>
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                {section.description && (
                  <CardDescription className="hidden sm:block">{section.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {section.questions.map((question) => (
                    <QuestionField
                      key={question.key}
                      question={question}
                      control={control}
                      errors={formState.errors}
                      gapStatus={gapBadgeMap[question.key] ?? null}
                      onInteract={() => markInteracted(question.key)}
                    />
                  ))}
                </div>
                <SectionViolations violations={violationsBySection.get(section.key)} />
              </CardContent>
            </Card>
          ))}

          {/* Z5 — Risk Assessment preview (engine rows, severity-sorted) */}
          {hasInteracted && gapCount > 0 && (
            <Card data-testid="risk-assessment-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Risk Assessment
                </CardTitle>
                <CardDescription className="hidden sm:block">
                  Preview derived from confirmed gaps — the submitted assessment remains the source of truth.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {gapResult.gapFields.map((key) => {
                  const row = gapResult.rows.find((candidate) => candidate.key === key)
                  if (!row) return null
                  const severityVariant =
                    row.severity === 'CRITICAL' || row.severity === 'HIGH'
                      ? 'destructive'
                      : row.severity === 'MEDIUM'
                        ? 'secondary'
                        : 'outline'
                  return (
                    <div
                      key={key}
                      className="flex items-start gap-3 rounded-lg bg-red-50 p-3 dark:bg-red-900/10"
                      data-testid={`risk-row-${kebabCase(key)}`}
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-orange-500" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{row.gapLabel ?? row.label} Gap</p>
                          <Badge variant={severityVariant as 'destructive' | 'secondary' | 'outline'}>{row.severity}</Badge>
                        </div>
                        {row.recommendation && <p className="text-sm text-muted-foreground">{row.recommendation}</p>}
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          {/* Z6 — GPS / Photos / Additional Details */}
          <Card id="section-location">
            <CardHeader>
              <CardTitle>GPS Location</CardTitle>
              <CardDescription className="hidden sm:block">
                Capture GPS coordinates automatically or enter them manually
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GPSCapture
                onLocationCapture={(latitude, longitude) =>
                  setGpsLocation({
                    latitude,
                    longitude,
                    timestamp: new Date().toISOString(),
                    captureMethod: 'GPS',
                  })
                }
                disabled={readonlyFields.includes('coordinates')}
                required={false}
              />
            </CardContent>
          </Card>

          <Card id="section-photos">
            <CardHeader>
              <CardTitle>Photos</CardTitle>
              <CardDescription className="hidden sm:block">
                Attach photos of the assessed area (optional)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MediaField onPhotosChange={setPhotos} maxPhotos={5} maxFileSize={10} />
            </CardContent>
          </Card>

          {additionalSections.length > 0 && (
            <Card id="section-additional" data-testid="section-additional-details">
              <CardHeader>
                <CardTitle>Additional Details</CardTitle>
                <CardDescription className="hidden sm:block">
                  Optional notes captured from the registry&apos;s free-text questions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {additionalSections.map((section) => (
                  <div key={section.key} className="space-y-3">
                    {section.questions.length > 1 && <p className="text-sm font-medium">{section.title}</p>}
                    {section.questions.map((question) => (
                      <Controller
                        key={question.key}
                        control={control}
                        name={question.key}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{question.label}</FormLabel>
                            {question.helperText && <FormDescription>{question.helperText}</FormDescription>}
                            <FormControl>
                              <Textarea
                                placeholder="Additional details (optional)"
                                className="min-h-[100px]"
                                data-testid={testIdFor(question.key)}
                                {...field}
                                value={(field.value as string) ?? ''}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Z7 — draft + submit */}
          <div className="space-y-2 border-t pt-4">
            {draftSaved && (
              <p className="text-sm font-medium text-green-600" data-testid="draft-saved-flash">
                Draft saved successfully
              </p>
            )}
            {drafts.length > 0 && (
              <p className="text-sm text-muted-foreground" data-testid="draft-count">
                {drafts.length} draft{drafts.length !== 1 ? 's' : ''} saved for this assessment type
              </p>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              {onCancel && (
                <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
                  Cancel
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSaveDraft(false)}
                disabled={isSubmitting || !dirty}
                data-testid="save-draft-button"
              >
                <Save className="h-4 w-4" />
                Save Draft
              </Button>
              <Button type="submit" disabled={submitDisabled} data-testid="submit-assessment-button">
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <chrome.icon className="h-4 w-4" />
                )}
                {isSubmitting ? 'Submitting…' : chrome.submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-question renderer (widget matrix from the layout contract)
// ---------------------------------------------------------------------------

interface QuestionFieldProps {
  question: QuestionDef
  control: UseFormReturn<AnswersFormValues>['control']
  errors: FieldErrors<AnswersFormValues>
  /** 'GAP' | 'NO_GAP' | null (null = untouched or not a GAP question). */
  gapStatus: 'GAP' | 'NO_GAP' | null
  onInteract: () => void
}

function isFullWidth(question: QuestionDef): boolean {
  return (
    question.type === 'SINGLE_CHOICE' || question.type === 'MULTI_SELECT' || question.type === 'TEXT_LONG'
  )
}

function QuestionField({ question, control, errors, gapStatus, onInteract }: QuestionFieldProps) {
  const testId = testIdFor(question.key)
  const error = errors[question.key]?.message

  const badge =
    gapStatus !== null ? (
      <span data-testid={`${testId}-gap-badge`} className="inline-flex">
        <StatusBadge domain="assessment" status={gapStatus} label={gapStatus === 'GAP' ? 'Gap' : 'No Gap'} />
      </span>
    ) : null

  return (
    <Controller
      control={control}
      name={question.key}
      render={({ field }) => (
        <FormItem
          className={
            question.type === 'BOOLEAN'
              ? 'flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-background'
              : isFullWidth(question)
                ? 'md:col-span-2'
                : undefined
          }
          data-testid={`question-${testId}`}
        >
          {question.type === 'BOOLEAN' ? (
            <>
              <FormControl>
                <Checkbox
                  checked={field.value === true}
                  onCheckedChange={(checked) => {
                    onInteract()
                    field.onChange(checked === true)
                  }}
                  data-testid={testId}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel className="flex items-center gap-2">
                  {question.label}
                  {question.required && <span className="text-destructive">*</span>}
                  {badge}
                </FormLabel>
                {question.helperText && <FormDescription>{question.helperText}</FormDescription>}
              </div>
              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            </>
          ) : question.type === 'SINGLE_CHOICE' ? (
            <>
              <FormLabel>
                {question.label}
                {question.required && <span className="text-destructive"> *</span>}
              </FormLabel>
              {question.helperText && <FormDescription>{question.helperText}</FormDescription>}
              <Select
                value={(field.value as string) ?? ''}
                onValueChange={(value) => {
                  onInteract()
                  field.onChange(value)
                }}
              >
                <FormControl>
                  <SelectTrigger data-testid={testId}>
                    <SelectValue placeholder={`Select ${question.label.toLowerCase()}`} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {question.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            </>
          ) : question.type === 'MULTI_SELECT' ? (
            <>
              <FormLabel>
                {question.label}
                {question.required && <span className="text-destructive"> *</span>}
              </FormLabel>
              {question.helperText && <FormDescription>{question.helperText}</FormDescription>}
              <TagPillSelect
                data-testid={testId}
                options={question.options.map((option) => ({
                  id: option.value,
                  label: option.label,
                  ...(option.description ? { description: option.description } : {}),
                }))}
                selected={(field.value as string[]) ?? []}
                onChange={(selected) => {
                  onInteract()
                  field.onChange(selected)
                }}
              />
              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            </>
          ) : question.type === 'NUMBER' ? (
            <>
              <FormLabel>
                {question.label}
                {question.required && <span className="text-destructive"> *</span>}
              </FormLabel>
              {question.helperText && <FormDescription>{question.helperText}</FormDescription>}
              <FormControl>
                <Input
                  type="number"
                  min={question.numberMin ?? 0}
                  max={question.numberMax ?? undefined}
                  value={(field.value as number) ?? 0}
                  onChange={(event) => {
                    onInteract()
                    field.onChange(parseInt(event.target.value, 10) || 0)
                  }}
                  data-testid={testId}
                />
              </FormControl>
              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            </>
          ) : (
            <>
              <FormLabel>{question.label}</FormLabel>
              {question.helperText && <FormDescription>{question.helperText}</FormDescription>}
              <FormControl>
                <Textarea
                  className="min-h-[100px]"
                  value={(field.value as string) ?? ''}
                  onChange={(event) => {
                    onInteract()
                    field.onChange(event.target.value)
                  }}
                  data-testid={testId}
                />
              </FormControl>
              {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            </>
          )}
        </FormItem>
      )}
    />
  )
}

/** Destructive inline alerts for a section's cross-field violations. */
function SectionViolations({ violations }: { violations?: CrossFieldViolation[] }) {
  if (!violations || violations.length === 0) return null
  return (
    <>
      {violations.map((violation, index) => (
        <Alert
          key={`${violation.key}-${violation.message}`}
          variant="destructive"
          data-testid={`cross-field-alert-${kebabCase(violation.key)}${index > 0 ? `-${index}` : ''}`}
        >
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Validation Error:</strong> {violation.message}
          </AlertDescription>
        </Alert>
      ))}
    </>
  )
}

// Re-exported for consumers (pages) that need the payload type.
export type { AnswerValue }
