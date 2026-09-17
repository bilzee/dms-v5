'use client'

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { ASSESSMENT_TYPES } from '@/lib/questions/answers'
import type { RapidAssessmentType } from '@/lib/questions/answers'
import {
  useAdminQuestionSet,
  type AdminQuestionRow,
  type AdminSectionRow,
} from '@/hooks/useAdminQuestionSet'
import {
  QuestionEditDialog,
  type QuestionEditDialogMode,
} from '@/components/settings/question-registry/QuestionEditDialog'
import { QuestionAuditTimeline } from '@/components/settings/question-registry/QuestionAuditTimeline'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from '@/lib/icons'

/**
 * Dynamic Question Registry — admin editor (P8).
 *
 * Full governance surface for one assessment type (Tabs across types):
 * - loads rows (incl. inactive) via `useAdminQuestionSet`
 * - structure/content version badges + full-registry JSON export
 * - search (label/key) + questionType filter over every section
 * - per-section cards with one row per question:
 *   edit / duplicate / audit trail / move up / move down / deactivate
 * - question lifecycle via `QuestionEditDialog` (create / edit / duplicate)
 * - question reorder → POST /api/v1/admin/questions/reorder
 *   `{sectionId, questionIds, reason}`
 * - section create (`POST /api/v1/admin/sections`) and retitle
 *   (`PUT /api/v1/admin/sections/[id]`)
 * - section reorder → POST /api/v1/admin/questions/reorder
 *   `{sectionIds, reason}`
 * - deactivation behind an impact pre-check dialog (`/impact`): total snapshot
 *   usage, usage under ACTIVE incidents (freeze rule) and the latest snapshot;
 *   a required reason is audit-logged.
 */

const QUESTION_TYPE_FILTERS = [
  'ALL',
  'BOOLEAN',
  'NUMBER',
  'SINGLE_CHOICE',
  'MULTI_SELECT',
  'TEXT_LONG',
] as const
type QuestionTypeFilter = (typeof QUESTION_TYPE_FILTERS)[number]

const SECTION_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface QuestionImpact {
  questionKey: string
  snapshotCount: number
  activeUnderIncidentCount: number
  latestSnapshot: {
    rapidAssessmentDate: string
    structureVersion: number
    contentVersion: number
  } | null
}

function formatImpactDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

/** Swaps `ids[index]` with its neighbor — the reordered array for /reorder. */
function swapAt(ids: string[], index: number, direction: -1 | 1): string[] {
  const next = ids.slice()
  const target = index + direction
  if (target < 0 || target >= next.length) return ids
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

interface QuestionDialogState {
  open: boolean
  mode: QuestionEditDialogMode
  question: AdminQuestionRow | null
  defaultSectionId?: string
}

export function QuestionRegistryEditor() {
  const [assessmentType, setAssessmentType] = useState<RapidAssessmentType>('HEALTH')
  const { sections, questions, structureVersion, contentVersion, isLoading, error, refetch } =
    useAdminQuestionSet(assessmentType)

  // >12 active GAP questions is a soft cap: the assessor form renders every
  // active GAP question, so ladders this long slow rapid assessments down.
  const activeGapCount = questions.filter((q) => q.category === 'GAP' && q.isActive).length

  // ---- search + questionType filter ----------------------------------------
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<QuestionTypeFilter>('ALL')

  const visibleSections = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return sections
      .map((section) => ({
        ...section,
        questions: section.questions.filter((question) => {
          if (typeFilter !== 'ALL' && question.questionType !== typeFilter) return false
          if (!needle) return true
          return (
            question.label.toLowerCase().includes(needle) ||
            question.questionKey.toLowerCase().includes(needle)
          )
        }),
      }))
      .filter((section) => section.questions.length > 0)
  }, [sections, search, typeFilter])

  // ---- question dialog (create / edit / duplicate) --------------------------
  const [questionDialog, setQuestionDialog] = useState<QuestionDialogState>({
    open: false,
    mode: 'edit',
    question: null,
  })

  const openCreateQuestion = () =>
    setQuestionDialog({ open: true, mode: 'create', question: null })

  const openEditQuestion = (question: AdminQuestionRow) =>
    setQuestionDialog({ open: true, mode: 'edit', question })

  const openDuplicateQuestion = (question: AdminQuestionRow) =>
    setQuestionDialog({ open: true, mode: 'duplicate', question })

  // ---- per-row audit dialog -------------------------------------------------
  const [auditQuestion, setAuditQuestion] = useState<AdminQuestionRow | null>(null)

  // ---- reorder (shared reason prompt) ---------------------------------------
  // Reorder payloads need a mandatory reason; the dialog collects it once and
  // the pending action executes on confirm.
  type PendingReorder =
    | { kind: 'questions'; sectionId: string; questionIds: string[]; label: string }
    | { kind: 'sections'; sectionIds: string[]; label: string }
  const [pendingReorder, setPendingReorder] = useState<PendingReorder | null>(null)
  const [reorderOpen, setReorderOpen] = useState(false)
  const [reorderReason, setReorderReason] = useState('')
  const [reordering, setReordering] = useState(false)

  const requestQuestionMove = (section: AdminSectionRow, index: number, direction: -1 | 1) => {
    const question = section.questions[index]
    if (!question) return
    const questionIds = swapAt(
      section.questions.map((row) => row.id),
      index,
      direction
    )
    setPendingReorder({
      kind: 'questions',
      sectionId: section.id,
      questionIds,
      label: question.label,
    })
    setReorderReason('')
    setReorderOpen(true)
  }

  const requestSectionMove = (index: number, direction: -1 | 1) => {
    const sectionIds = swapAt(
      sections.map((section) => section.id),
      index,
      direction
    )
    setPendingReorder({ kind: 'sections', sectionIds, label: sections[index]?.title ?? '' })
    setReorderReason('')
    setReorderOpen(true)
  }

  const confirmReorder = async () => {
    if (!pendingReorder) return
    const reason = reorderReason.trim()
    if (!reason) return
    setReordering(true)
    const payload =
      pendingReorder.kind === 'questions'
        ? {
            sectionId: pendingReorder.sectionId,
            questionIds: pendingReorder.questionIds,
            reason,
          }
        : { sectionIds: pendingReorder.sectionIds, reason }
    const result = await apiPost('/api/v1/admin/questions/reorder', payload)
    setReordering(false)
    if (!result.success) {
      toast.error(result.error || 'Failed to reorder')
      return
    }
    toast.success('Order updated')
    setReorderOpen(false)
    setPendingReorder(null)
    void refetch()
  }

  // ---- section create / retitle ---------------------------------------------
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false)
  const [sectionEditing, setSectionEditing] = useState<AdminSectionRow | null>(null)
  const [sectionKey, setSectionKey] = useState('')
  const [sectionTitle, setSectionTitle] = useState('')
  const [sectionCategory, setSectionCategory] = useState<'GAP' | 'CONTEXT'>('GAP')
  const [sectionDescription, setSectionDescription] = useState('')
  const [sectionReason, setSectionReason] = useState('')
  const [sectionSaving, setSectionSaving] = useState(false)

  const openCreateSection = () => {
    setSectionEditing(null)
    setSectionKey('')
    setSectionTitle('')
    setSectionCategory('GAP')
    setSectionDescription('')
    setSectionReason('')
    setSectionDialogOpen(true)
  }

  const openRetitleSection = (section: AdminSectionRow) => {
    setSectionEditing(section)
    setSectionKey(section.sectionKey)
    setSectionTitle(section.title)
    setSectionCategory(section.category === 'CONTEXT' ? 'CONTEXT' : 'GAP')
    setSectionDescription(section.description ?? '')
    setSectionReason('')
    setSectionDialogOpen(true)
  }

  const submitSection = async () => {
    const reason = sectionReason.trim()
    if (!reason || !sectionTitle.trim()) return
    if (!sectionEditing && !SECTION_KEY_PATTERN.test(sectionKey.trim())) return
    setSectionSaving(true)
    const result = sectionEditing
      ? await apiPut(`/api/v1/admin/sections/${sectionEditing.id}`, {
          title: sectionTitle.trim(),
          description: sectionDescription.trim() || null,
          reason,
        })
      : await apiPost('/api/v1/admin/sections', {
          assessmentType,
          sectionKey: sectionKey.trim(),
          title: sectionTitle.trim(),
          category: sectionCategory,
          ...(sectionDescription.trim() ? { description: sectionDescription.trim() } : {}),
          reason,
        })
    setSectionSaving(false)
    if (!result.success) {
      toast.error(result.error || 'Failed to save section')
      return
    }
    toast.success(sectionEditing ? 'Section updated' : 'Section created')
    setSectionDialogOpen(false)
    void refetch()
  }

  // ---- deactivation (impact pre-check) ---------------------------------------
  const [deactivateTarget, setDeactivateTarget] = useState<AdminQuestionRow | null>(null)
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [deactivateReason, setDeactivateReason] = useState('')
  const [deactivating, setDeactivating] = useState(false)
  const [impact, setImpact] = useState<QuestionImpact | null>(null)
  const [impactError, setImpactError] = useState<string | null>(null)
  const impactSeqRef = useRef(0)

  const [exporting, setExporting] = useState(false)

  const openDeactivate = async (question: AdminQuestionRow) => {
    const seq = ++impactSeqRef.current
    setDeactivateTarget(question)
    setDeactivateOpen(true)
    setDeactivateReason('')
    setImpact(null)
    setImpactError(null)

    const result = await apiGet<QuestionImpact>(`/api/v1/admin/questions/${question.id}/impact`)
    if (seq !== impactSeqRef.current) return // a newer dialog superseded this request
    if (!result.success || !result.data) {
      setImpactError(result.error || 'Failed to load usage impact')
      return
    }
    setImpact(result.data)
  }

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return
    const reason = deactivateReason.trim()
    if (!reason) return

    setDeactivating(true)
    const result = await apiDelete(`/api/v1/admin/questions/${deactivateTarget.id}`, {
      body: JSON.stringify({ reason }),
    })
    setDeactivating(false)

    if (!result.success) {
      if (result.error === 'question_frozen') {
        const details = result.details as { affectedCount?: unknown } | undefined
        const affected =
          typeof details?.affectedCount === 'number' ? details.affectedCount : 'an unknown number of'
        toast.error(
          `Question is used by ${affected} assessment${affected === 1 ? '' : 's'} under active incidents and cannot be deactivated.`
        )
        return
      }
      toast.error(result.error || 'Failed to deactivate question')
      return
    }

    toast.success(`Deactivated "${deactivateTarget.label}"`)
    setDeactivateOpen(false)
    setDeactivateTarget(null)
    setDeactivateReason('')
    void refetch()
  }

  const exportRegistry = async () => {
    setExporting(true)
    const result = await apiGet<Record<string, unknown>>('/api/v1/admin/questions/export')
    setExporting(false)
    if (!result.success || !result.data) {
      toast.error(result.error || 'Failed to export the question registry')
      return
    }
    try {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `question-registry-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success('Registry export downloaded')
    } catch {
      toast.error('Failed to generate the export file')
    }
  }

  const sectionKeyInvalid = !sectionEditing && !SECTION_KEY_PATTERN.test(sectionKey.trim())

  return (
    <div className="space-y-6" data-testid="question-registry-editor">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Question Registry</h1>
            {typeof structureVersion === 'number' && (
              <Badge variant="outline" data-testid="registry-structure-version">
                structure v{structureVersion}
              </Badge>
            )}
            {typeof contentVersion === 'number' && (
              <Badge variant="outline" data-testid="registry-content-version">
                content v{contentVersion}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Tier A edits (labels, helper text, GAP phrasing, severity) bump the content
            version. Structural changes and deactivation are governed by registry
            invariants and the incident freeze rule.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openCreateSection}
            data-testid="registry-add-section-button"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Section
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openCreateQuestion}
            disabled={sections.length === 0}
            data-testid="registry-add-question-button"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Question
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void exportRegistry()}
            disabled={exporting}
            data-testid="registry-export-button"
          >
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export
          </Button>
        </div>
      </div>

      <Tabs value={assessmentType} onValueChange={(value) => setAssessmentType(value as RapidAssessmentType)}>
        <TabsList className="flex-wrap" data-testid="registry-type-tabs">
          {ASSESSMENT_TYPES.map((type) => (
            <TabsTrigger key={type} value={type} data-testid={`registry-type-tab-${type}`}>
              {type}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 space-y-2">
          <Label htmlFor="registry-search">Search</Label>
          <Input
            id="registry-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by label or question key…"
            data-testid="registry-search-input"
          />
        </div>
        <div className="max-w-xs space-y-2">
          <Label htmlFor="registry-type-filter">Question type</Label>
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as QuestionTypeFilter)}>
            <SelectTrigger id="registry-type-filter" data-testid="registry-type-filter">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_TYPE_FILTERS.map((type) => (
                <SelectItem key={type} value={type}>
                  {type === 'ALL' ? 'All types' : type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {activeGapCount > 12 && (
        <Alert data-testid="registry-gap-soft-cap-warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>High GAP question count</AlertTitle>
          <AlertDescription>
            {activeGapCount} active GAP questions — above the 12-question soft
            cap. Assessors answer every active GAP question during a rapid
            assessment; consider consolidating the ladder. This warning never
            blocks anything.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-4" data-testid="registry-loading">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : error ? (
        <Alert variant="destructive" data-testid="registry-error">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Failed to load the question registry</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : sections.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="registry-empty">
          No sections configured for this assessment type.
        </p>
      ) : visibleSections.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="registry-no-results">
          No questions match the current search or filter.
        </p>
      ) : (
        <div className="space-y-4">
          {visibleSections.map((section) => {
            const sectionIndex = sections.findIndex((row) => row.id === section.id)
            return (
              <Card key={section.id} data-testid="registry-section">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      aria-label="Move section up"
                      data-testid="registry-section-move-up-button"
                      disabled={sectionIndex <= 0}
                      onClick={() => requestSectionMove(sectionIndex, -1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      aria-label="Move section down"
                      data-testid="registry-section-move-down-button"
                      disabled={sectionIndex >= sections.length - 1}
                      onClick={() => requestSectionMove(sectionIndex, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <CardTitle className="text-base">{section.title}</CardTitle>
                    <Badge variant="outline">{section.category}</Badge>
                    {!section.isActive && <Badge variant="secondary">Inactive</Badge>}
                    <span className="font-mono text-xs text-muted-foreground">
                      {section.sectionKey}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      aria-label={`Retitle ${section.sectionKey}`}
                      data-testid="registry-retitle-section-button"
                      onClick={() => openRetitleSection(section)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                  {section.description && (
                    <CardDescription>{section.description}</CardDescription>
                  )}
                </CardHeader>
                <CardContent className="pb-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[32%]">Label</TableHead>
                        <TableHead>Key</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {section.questions.map((question, index) => (
                        <TableRow
                          key={question.id}
                          className={question.isActive ? undefined : 'opacity-60'}
                          data-testid="registry-question-row"
                        >
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{question.label}</span>
                              {!question.isActive && (
                                <Badge variant="secondary">Inactive</Badge>
                              )}
                            </div>
                            {question.helperText && (
                              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                                {question.helperText}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {question.questionKey}
                          </TableCell>
                          <TableCell className="text-xs">{question.questionType}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{question.category}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            {question.required ? 'Yes' : 'No'}
                          </TableCell>
                          <TableCell>
                            {question.category === 'GAP' ? (
                              <StatusBadge status={question.severity} domain="severity" size="sm" />
                            ) : (
                              <span className="text-xs text-muted-foreground">&mdash;</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                aria-label={`Move ${question.questionKey} up`}
                                data-testid="registry-move-up-button"
                                disabled={index <= 0}
                                onClick={() => requestQuestionMove(section, index, -1)}
                              >
                                <ChevronUp className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                aria-label={`Move ${question.questionKey} down`}
                                data-testid="registry-move-down-button"
                                disabled={index >= section.questions.length - 1}
                                onClick={() => requestQuestionMove(section, index, 1)}
                              >
                                <ChevronDown className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditQuestion(question)}
                                aria-label={`Edit ${question.questionKey}`}
                                data-testid="registry-edit-button"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openDuplicateQuestion(question)}
                                aria-label={`Duplicate ${question.questionKey}`}
                                data-testid="registry-duplicate-button"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setAuditQuestion(question)}
                                aria-label={`Audit trail for ${question.questionKey}`}
                                data-testid="registry-audit-button"
                              >
                                <History className="h-4 w-4" />
                              </Button>
                              {question.isActive && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => void openDeactivate(question)}
                                  aria-label={`Deactivate ${question.questionKey}`}
                                  data-testid="registry-deactivate-button"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <QuestionEditDialog
        open={questionDialog.open}
        onOpenChange={(open) => setQuestionDialog((state) => ({ ...state, open }))}
        mode={questionDialog.mode}
        assessmentType={assessmentType}
        sections={sections}
        question={questionDialog.question}
        onSaved={() => void refetch()}
      />

      <Dialog
        open={auditQuestion !== null}
        onOpenChange={(open) => {
          if (!open) setAuditQuestion(null)
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="registry-audit-dialog">
              Audit trail — {auditQuestion?.questionKey}
            </DialogTitle>
            <DialogDescription>
              Every change to this question, newest first (reasons are audit-logged).
            </DialogDescription>
          </DialogHeader>
          {auditQuestion && <QuestionAuditTimeline questionId={auditQuestion.id} refreshKey={0} />}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={reorderOpen}
        onOpenChange={(open) => {
          setReorderOpen(open)
          if (!open) setPendingReorder(null)
        }}
      >
        <AlertDialogContent data-testid="registry-reorder-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Reorder {pendingReorder?.kind === 'sections' ? 'section' : 'question'}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingReorder
                ? pendingReorder.kind === 'sections'
                  ? `Move "${pendingReorder.label}" — new section order applies to the next assessment.`
                  : `Move "${pendingReorder.label}" within its section — new order applies to the next assessment.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="registry-reorder-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="registry-reorder-reason"
              value={reorderReason}
              onChange={(event) => setReorderReason(event.target.value)}
              maxLength={2000}
              placeholder="Why is the order changing? (audit log)"
              data-testid="registry-reorder-reason-input"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reordering}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (!reorderReason.trim()) return
                void confirmReorder()
              }}
              disabled={reordering || !reorderReason.trim()}
              data-testid="registry-reorder-confirm"
            >
              {reordering && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={sectionDialogOpen}
        onOpenChange={(open) => {
          setSectionDialogOpen(open)
          if (!open) setSectionEditing(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle data-testid="registry-section-dialog-title">
              {sectionEditing ? 'Edit section' : 'Add section'}
            </DialogTitle>
            <DialogDescription>
              {sectionEditing
                ? 'Retitle or redescription — section keys and categories are fixed after creation.'
                : 'New sections are append-only and take effect on the next assessment.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!sectionEditing && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="registry-section-key">
                    Section key <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="registry-section-key"
                    className="font-mono"
                    value={sectionKey}
                    onChange={(event) => setSectionKey(event.target.value)}
                    placeholder="kebab-case, e.g. health-gaps"
                    data-testid="registry-section-key-input"
                  />
                  {sectionKey.trim() !== '' && sectionKeyInvalid && (
                    <p className="text-xs text-destructive" data-testid="registry-section-key-error">
                      Section keys are kebab-case (lowercase letters/digits separated by single hyphens).
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registry-section-category">Category</Label>
                  <Select
                    value={sectionCategory}
                    onValueChange={(value) => setSectionCategory(value as 'GAP' | 'CONTEXT')}
                  >
                    <SelectTrigger id="registry-section-category" data-testid="registry-section-category-select">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GAP">GAP</SelectItem>
                      <SelectItem value="CONTEXT">CONTEXT</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    A section&apos;s category binds every question inside it (invariant).
                  </p>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="registry-section-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="registry-section-title"
                value={sectionTitle}
                onChange={(event) => setSectionTitle(event.target.value)}
                maxLength={200}
                data-testid="registry-section-title-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-section-description">Description</Label>
              <Textarea
                id="registry-section-description"
                rows={2}
                maxLength={1000}
                value={sectionDescription}
                onChange={(event) => setSectionDescription(event.target.value)}
                data-testid="registry-section-description-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="registry-section-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Input
                id="registry-section-reason"
                value={sectionReason}
                onChange={(event) => setSectionReason(event.target.value)}
                maxLength={2000}
                placeholder="Why is this change being made? (audit log)"
                data-testid="registry-section-reason-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSectionDialogOpen(false)} disabled={sectionSaving}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitSection()}
              disabled={
                sectionSaving ||
                !sectionTitle.trim() ||
                !sectionReason.trim() ||
                sectionKeyInvalid
              }
              data-testid="registry-section-save-button"
            >
              {sectionSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {sectionEditing ? 'Save section' : 'Create section'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deactivateOpen}
        onOpenChange={(open) => {
          setDeactivateOpen(open)
          if (!open) {
            impactSeqRef.current += 1
            setDeactivateTarget(null)
            setImpact(null)
            setImpactError(null)
            setDeactivateReason('')
          }
        }}
      >
        <AlertDialogContent data-testid="deactivate-question-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate question</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget
                ? `Deactivating "${deactivateTarget.label}" (${deactivateTarget.questionKey}) removes it from new assessments. Existing snapshots keep their projected copy.`
                : 'Deactivating a question removes it from new assessments.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            {impactError && (
              <p className="text-sm text-destructive" data-testid="deactivate-impact-error">
                {impactError}
              </p>
            )}
            {!impact && !impactError && (
              <p className="text-sm text-muted-foreground" data-testid="deactivate-impact-loading">
                Checking usage impact…
              </p>
            )}
            {impact && (
              <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Assessments using this question</span>
                  <span className="font-medium" data-testid="deactivate-impact-total">
                    {impact.snapshotCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Under active incidents</span>
                  <span className="font-medium" data-testid="deactivate-impact-active">
                    {impact.activeUnderIncidentCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Latest assessment</span>
                  <span className="font-medium">
                    {impact.latestSnapshot
                      ? `${formatImpactDate(impact.latestSnapshot.rapidAssessmentDate)} (structure v${impact.latestSnapshot.structureVersion}, content v${impact.latestSnapshot.contentVersion})`
                      : '—'}
                  </span>
                </div>
              </div>
            )}
            {impact && impact.activeUnderIncidentCount > 0 && (
              <Alert variant="destructive" data-testid="deactivate-frozen-warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Freeze rule applies</AlertTitle>
                <AlertDescription>
                  This question is used by {impact.activeUnderIncidentCount} assessment
                  {impact.activeUnderIncidentCount === 1 ? '' : 's'} under active incidents.
                  Structural changes — including deactivation — will be rejected with a
                  <span className="font-mono"> question_frozen</span> error until those
                  incidents close.
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="deactivate-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Input
                id="deactivate-reason"
                value={deactivateReason}
                onChange={(event) => setDeactivateReason(event.target.value)}
                maxLength={2000}
                placeholder="Why is this question being deactivated? (audit log)"
                data-testid="deactivate-reason-input"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deactivating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault() // keep the dialog open on client-side validation
                if (!deactivateReason.trim()) return
                void confirmDeactivate()
              }}
              disabled={deactivating || !deactivateReason.trim() || !impact}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="deactivate-confirm-button"
            >
              {deactivating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
