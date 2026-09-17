import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toast } from 'sonner'

import { QuestionEditDialog } from '@/components/settings/question-registry/QuestionEditDialog'
import type {
  AdminQuestionRow,
  AdminSectionRow,
} from '@/hooks/useAdminQuestionSet'
import { apiPost, apiPut } from '@/lib/api'

/**
 * Unit — QuestionEditDialog (P8): the admin question lifecycle dialog
 * (edit / create / duplicate). Verifies the contract the spec pins down:
 *
 * - GAP questions expose gapLabel/gapMeaning/recommendation + severity and the
 *   Z5 risk-row preview; CONTEXT questions hide all GAP metadata
 * - edit mode: the question key is immutable (disabled input); create/duplicate
 *   modes take a fresh camelCase key
 * - `reason` is required (client-side) before anything is sent
 * - success PUTs the full governed payload (category derived from the section,
 *   CONTEXT sends explicit nulls + LOW) and invalidates BOTH React Query
 *   caches (admin rows + the live assessor form)
 * - create POSTs with assessmentType + questionKey and closes the dialog
 * - duplicate keys 409 with `question_key_duplicate` → inline key error and
 *   the dialog stays open
 * - 400 registry_invalid renders the invariant error list inline
 * - 409 question_frozen renders the frozen banner quoting the affected count
 *   and offers "Create copy with new key" (duplicate mode, `${key}New`,
 *   reason carried)
 * - other error codes surface as toasts
 *
 * NOTE: tests/setup.ts globally stubs react-hook-form and several ui
 * primitives with value-only fakes; this suite needs real RHF + event-faithful
 * inputs/selects/dialog, so it overrides those mocks locally. The dialog calls
 * `useQueryClient`, so every render is wrapped in a real QueryClientProvider.
 */

// Real React Hook Form (overrides the global tests/setup.ts stub).
jest.mock('react-hook-form', () => jest.requireActual('react-hook-form'))

// Sonner with `info` (the setup stub only covers success/error, but the
// frozen-banner escalation flow toasts an informational hint).
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}))

// Event-faithful Input/Textarea (the setup stub passes values, not events).
// forwardRef is required: React 18 strips `ref` from plain function
// components' props, which would silently drop react-hook-form's register()
// ref and leave defaultValues/resets unwritten into the DOM inputs.
jest.mock('@/components/ui/input', () => {
  const React = require('react')
  return {
    Input: React.forwardRef((props: any, ref: any) => <input ref={ref} {...props} />),
  }
})

jest.mock('@/components/ui/textarea', () => {
  const React = require('react')
  return {
    Textarea: React.forwardRef((props: any, ref: any) => <textarea ref={ref} {...props} />),
  }
})

// Alert with AlertTitle (the setup stub omits AlertTitle, which the dialog uses).
jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children, ...props }: any) => <div role="alert" {...props}>{children}</div>,
  AlertTitle: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  AlertDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}))

// Dialog without portals (content renders inline).
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
}))

// Event-faithful Select (same pattern as DynamicAssessmentForm.test.tsx):
// SelectItem clicks call the root's onValueChange through a local context.
jest.mock('@/components/ui/select', () => {
  const React = require('react')
  const SelectContext = React.createContext({
    value: '',
    onValueChange: (_value: string) => {},
  })
  return {
    Select: ({ value, onValueChange, children }: any) => (
      <SelectContext.Provider value={{ value: value ?? '', onValueChange }}>
        {children}
      </SelectContext.Provider>
    ),
    SelectContent: ({ children }: any) => <>{children}</>,
    SelectItem: ({ value, children }: any) => {
      const { onValueChange } = React.useContext(SelectContext)
      return (
        <button
          type="button"
          data-testid={`select-option-${value}`}
          onClick={() => onValueChange(value)}
        >
          {children}
        </button>
      )
    },
    SelectTrigger: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  }
})

// Value-only Checkbox/Switch (the previews render them statically).
jest.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, ...props }: any) => (
    <input type="checkbox" checked={!!checked} readOnly {...props} />
  ),
}))

jest.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, ...props }: any) => (
    <input type="checkbox" checked={!!checked} readOnly {...props} />
  ),
}))

// Deterministic badge: renders the status text it is given.
jest.mock('@/components/shared/StatusBadge', () => ({
  StatusBadge: ({ status, label }: any) => (
    <span data-testid="status-badge">{label ?? status}</span>
  ),
}))

jest.mock('@/lib/icons', () => {
  const stub = (name: string) => {
    const Stub = (props: any) => <span data-testid={`icon-${name}`} {...props} />
    return Stub
  }
  return {
    AlertTriangle: stub('alert-triangle'),
    Loader2: stub('loader'),
    Plus: stub('plus'),
    Save: stub('save'),
    X: stub('x'),
  }
})

jest.mock('@/lib/api', () => ({
  apiPut: jest.fn(),
  apiPost: jest.fn(),
}))

// The embedded timeline renders inside the same dialog; stub it and expose its
// refreshKey so the "timeline refetches after save" contract is assertable.
jest.mock('@/components/settings/question-registry/QuestionAuditTimeline', () => ({
  QuestionAuditTimeline: ({ questionId, refreshKey }: any) => (
    <div
      data-testid="audit-timeline-stub"
      data-question-id={questionId}
      data-refresh-key={refreshKey}
    />
  ),
}))

const mockApiPut = apiPut as jest.Mock
const mockApiPost = apiPost as jest.Mock

function gapSection(): AdminSectionRow {
  return {
    id: 'sec-1',
    sectionKey: 'health-gaps',
    title: 'Health gaps',
    description: null,
    category: 'GAP',
    order: 1,
    isActive: true,
    questions: [],
  }
}

function contextSection(): AdminSectionRow {
  return {
    id: 'sec-2',
    sectionKey: 'health-context',
    title: 'Health context',
    description: null,
    category: 'CONTEXT',
    order: 2,
    isActive: true,
    questions: [],
  }
}

function question(overrides: Partial<AdminQuestionRow> = {}): AdminQuestionRow {
  return {
    id: 'q-1',
    questionKey: 'hasFunctionalClinic',
    sectionId: 'sec-1',
    questionType: 'BOOLEAN',
    label: 'Functional clinic on site',
    helperText: null,
    required: true,
    category: 'GAP',
    inverted: false,
    gapLabel: 'No functional clinic',
    gapMeaning: 'The health facility is not functional',
    recommendation: 'Deploy a mobile clinic team',
    severity: 'MEDIUM',
    numberMin: null,
    numberMax: null,
    order: 1,
    isActive: true,
    version: 2,
    ...overrides,
  }
}

function contextQuestion(): AdminQuestionRow {
  return question({
    id: 'q-2',
    questionKey: 'clinicName',
    sectionId: 'sec-2',
    category: 'CONTEXT',
    questionType: 'TEXT_LONG',
    required: false,
    severity: 'LOW',
    helperText: 'old helper',
    gapLabel: null,
    gapMeaning: null,
    recommendation: null,
  })
}

interface RenderOptions {
  mode?: 'edit' | 'create' | 'duplicate'
  question?: AdminQuestionRow | null
  sections?: AdminSectionRow[]
  onSaved?: jest.Mock
}

function renderDialog({
  mode = 'edit',
  question: q = question(),
  sections = [gapSection(), contextSection()],
  onSaved = jest.fn(),
}: RenderOptions = {}) {
  const user = userEvent.setup()
  const onOpenChange = jest.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
  const view = render(
    <QueryClientProvider client={queryClient}>
      <QuestionEditDialog
        open
        onOpenChange={onOpenChange}
        mode={mode}
        assessmentType="HEALTH"
        sections={sections}
        question={q}
        onSaved={onSaved}
      />
    </QueryClientProvider>
  )
  return { user, onSaved, onOpenChange, invalidateSpy, ...view }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockApiPut.mockResolvedValue({ success: true, data: { question: {} } })
  mockApiPost.mockResolvedValue({ success: true, data: { question: {} } })
})

describe('QuestionEditDialog — field surface', () => {
  test('GAP questions show GAP metadata + severity prefilled from the registry row', () => {
    renderDialog()

    // The key is visible but immutable in edit mode.
    const keyInput = screen.getByTestId('question-key-input') as HTMLInputElement
    expect(keyInput.value).toBe('hasFunctionalClinic')
    expect(keyInput).toBeDisabled()

    // GAP metadata prefilled.
    expect((screen.getByTestId('question-label-input') as HTMLInputElement).value).toBe(
      'Functional clinic on site'
    )
    expect((screen.getByTestId('question-gap-label-input') as HTMLInputElement).value).toBe(
      'No functional clinic'
    )
    expect((screen.getByTestId('question-gap-meaning-input') as HTMLTextAreaElement).value).toBe(
      'The health facility is not functional'
    )
    expect(
      (screen.getByTestId('question-recommendation-input') as HTMLTextAreaElement).value
    ).toBe('Deploy a mobile clinic team')
    expect(screen.getByTestId('question-severity-select')).toBeInTheDocument()
    expect(screen.getByTestId('question-inverted-switch')).toBeInTheDocument()

    // The Z5 risk-row preview quotes the gap wording + severity.
    const z5 = screen.getByTestId('question-z5-preview')
    expect(z5).toHaveTextContent('No functional clinic Gap')
    expect(z5).toHaveTextContent('MEDIUM')
  })

  test('CONTEXT questions hide all GAP metadata', () => {
    renderDialog({ question: contextQuestion() })

    expect(screen.queryByTestId('question-gap-label-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('question-gap-meaning-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('question-recommendation-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('question-severity-select')).not.toBeInTheDocument()
    expect(screen.queryByTestId('question-inverted-switch')).not.toBeInTheDocument()
    expect(screen.queryByTestId('question-z5-preview')).not.toBeInTheDocument()
    expect(screen.getByTestId('question-label-input')).toBeInTheDocument()
    expect(screen.getByTestId('question-required-switch')).toBeInTheDocument()
    expect(screen.getByTestId('question-midform-preview')).toBeInTheDocument()
  })
})

describe('QuestionEditDialog — validation', () => {
  test('a reason is required before anything is sent', async () => {
    const { user, onSaved } = renderDialog()

    await user.click(screen.getByTestId('question-save-button'))

    expect(screen.getByTestId('question-reason-error')).toHaveTextContent(
      'A reason is required for registry changes'
    )
    expect(mockApiPut).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  test('an empty label is rejected', async () => {
    const { user } = renderDialog()

    await user.clear(screen.getByTestId('question-label-input'))
    await user.type(screen.getByTestId('question-reason-input'), 'clarify wording')
    await user.click(screen.getByTestId('question-save-button'))

    expect(screen.getByTestId('question-label-error')).toHaveTextContent('Label is required')
    expect(mockApiPut).not.toHaveBeenCalled()
  })

  test('create mode rejects a non-camelCase key before anything is sent', async () => {
    const { user } = renderDialog({ mode: 'create', question: null })

    await user.type(screen.getByTestId('question-key-input'), 'has-clinic')
    await user.type(screen.getByTestId('question-label-input'), 'Clinic on site')
    await user.type(screen.getByTestId('question-reason-input'), 'new question')
    await user.click(screen.getByTestId('question-save-button'))

    expect(screen.getByTestId('question-key-required-error')).toHaveTextContent(
      'Keys are camelCase'
    )
    expect(mockApiPost).not.toHaveBeenCalled()
  })
})

describe('QuestionEditDialog — edit submit outcomes', () => {
  test('success PUTs the full GAP payload and invalidates both query caches', async () => {
    const { user, onSaved, onOpenChange, invalidateSpy } = renderDialog()

    await user.type(screen.getByTestId('question-reason-input'), '  clarify wording  ')
    await user.click(screen.getByTestId('select-option-CRITICAL'))
    await user.click(screen.getByTestId('question-save-button'))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(mockApiPut).toHaveBeenCalledWith('/api/v1/admin/questions/q-1', {
      sectionId: 'sec-1',
      questionType: 'BOOLEAN',
      label: 'Functional clinic on site',
      helperText: null,
      required: true,
      inverted: false,
      reason: 'clarify wording',
      category: 'GAP',
      gapLabel: 'No functional clinic',
      gapMeaning: 'The health facility is not functional',
      recommendation: 'Deploy a mobile clinic team',
      severity: 'CRITICAL',
      numberMin: null,
      numberMax: null,
      options: [],
    })

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Question updated')
    // Edit mode keeps the dialog open and refreshes the embedded timeline.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByTestId('audit-timeline-stub')).toHaveAttribute('data-refresh-key', '1')
    // Both caches refresh: admin rows + the live assessor form.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-question-set'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['question-set', 'HEALTH'] })
    // The reason clears for the next edit.
    expect((screen.getByTestId('question-reason-input') as HTMLInputElement).value).toBe('')
  })

  test('CONTEXT payload sends explicit GAP nulls + LOW severity (metadata strip)', async () => {
    const { user } = renderDialog({ question: contextQuestion() })

    await user.clear(screen.getByTestId('question-helptext-input'))
    await user.type(screen.getByTestId('question-reason-input'), 'remove helper')
    await user.click(screen.getByTestId('question-save-button'))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    expect(mockApiPut).toHaveBeenCalledWith('/api/v1/admin/questions/q-2', {
      sectionId: 'sec-2',
      questionType: 'TEXT_LONG',
      label: 'Functional clinic on site',
      helperText: null,
      required: false,
      inverted: false,
      reason: 'remove helper',
      category: 'CONTEXT',
      gapLabel: null,
      gapMeaning: null,
      recommendation: null,
      severity: 'LOW',
      numberMin: null,
      numberMax: null,
      options: [],
    })
  })

  test('registry_invalid renders the invariant errors inline and keeps the dialog open', async () => {
    mockApiPut.mockResolvedValueOnce({
      success: false,
      error: 'registry_invalid',
      details: {
        errors: ['GAP questions must be BOOLEAN', 'gapLabel is required for GAP questions'],
      },
    })
    const { user, onSaved } = renderDialog()

    await user.type(screen.getByTestId('question-reason-input'), 'try an invalid change')
    await user.click(screen.getByTestId('question-save-button'))

    const alert = await screen.findByTestId('question-invariant-errors')
    expect(alert).toHaveTextContent('GAP questions must be BOOLEAN')
    expect(alert).toHaveTextContent('gapLabel is required for GAP questions')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByTestId('question-edit-dialog-title')).toBeInTheDocument()
  })

  test('question_frozen renders the banner and "Create copy with new key" escalates to duplicate mode', async () => {
    mockApiPut.mockResolvedValueOnce({
      success: false,
      error: 'question_frozen',
      details: { questionKey: 'hasFunctionalClinic', affectedCount: 3 },
    })
    const { user, onSaved } = renderDialog()

    await user.type(screen.getByTestId('question-reason-input'), 'structural attempt')
    await user.click(screen.getByTestId('question-save-button'))

    const banner = await screen.findByTestId('question-frozen-banner')
    expect(banner).toHaveTextContent('used by 3 assessments under active incidents')
    expect(onSaved).not.toHaveBeenCalled()

    // Escalation: duplicate mode prefills `${key}New` and carries the reason.
    await user.click(screen.getByTestId('question-create-new-key-button'))
    expect(toast.info).toHaveBeenCalled()
    expect(screen.getByTestId('question-edit-dialog-title')).toHaveTextContent(
      'Duplicate question'
    )
    const keyInput = screen.getByTestId('question-key-input') as HTMLInputElement
    expect(keyInput.value).toBe('hasFunctionalClinicNew')
    expect(keyInput).toBeEnabled()
    await waitFor(() =>
      expect((screen.getByTestId('question-reason-input') as HTMLInputElement).value).toBe(
        'structural attempt'
      )
    )
  })

  test('other error codes surface as a toast and never call onSaved', async () => {
    mockApiPut.mockResolvedValueOnce({ success: false, error: 'question_not_found' })
    const { user, onSaved } = renderDialog()

    await user.type(screen.getByTestId('question-reason-input'), 'stale id')
    await user.click(screen.getByTestId('question-save-button'))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('question_not_found'))
    expect(onSaved).not.toHaveBeenCalled()
  })
})

describe('QuestionEditDialog — create / duplicate', () => {
  test('create POSTs assessmentType + a fresh camelCase key and closes the dialog', async () => {
    const { user, onSaved, onOpenChange, invalidateSpy } = renderDialog({
      mode: 'create',
      question: null,
    })

    await user.type(screen.getByTestId('question-key-input'), 'hasColdChain')
    await user.type(screen.getByTestId('question-label-input'), 'Cold chain functional')
    await user.type(screen.getByTestId('question-gap-label-input'), 'No cold chain')
    await user.type(screen.getByTestId('question-gap-meaning-input'), 'Vaccines cannot be stored safely')
    await user.type(screen.getByTestId('question-recommendation-input'), 'Procure cold boxes')
    await user.type(screen.getByTestId('question-reason-input'), 'add question')
    await user.click(screen.getByTestId('question-save-button'))

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))
    expect(mockApiPost).toHaveBeenCalledWith('/api/v1/admin/questions', {
      sectionId: 'sec-1',
      questionType: 'BOOLEAN',
      label: 'Cold chain functional',
      helperText: null,
      required: true,
      inverted: false,
      reason: 'add question',
      category: 'GAP',
      gapLabel: 'No cold chain',
      gapMeaning: 'Vaccines cannot be stored safely',
      recommendation: 'Procure cold boxes',
      severity: 'MEDIUM',
      numberMin: null,
      numberMax: null,
      options: [],
      assessmentType: 'HEALTH',
      questionKey: 'hasColdChain',
    })

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Question created')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-question-set'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['question-set', 'HEALTH'] })
  })

  test('duplicate keys 409 with an inline key error and the dialog stays open', async () => {
    mockApiPost.mockResolvedValueOnce({
      success: false,
      error: 'question_key_duplicate',
    })
    const { user, onOpenChange } = renderDialog({ mode: 'create', question: null })

    await user.type(screen.getByTestId('question-key-input'), 'hasFunctionalClinic')
    await user.type(screen.getByTestId('question-label-input'), 'Clinic copy')
    await user.type(screen.getByTestId('question-gap-label-input'), 'No functional clinic')
    await user.type(screen.getByTestId('question-gap-meaning-input'), 'The facility is down')
    await user.type(screen.getByTestId('question-recommendation-input'), 'Deploy a team')
    await user.type(screen.getByTestId('question-reason-input'), 'duplicate attempt')
    await user.click(screen.getByTestId('question-save-button'))

    const error = await screen.findByTestId('question-key-error')
    expect(error).toHaveTextContent('already exists in this assessment type')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByTestId('question-edit-dialog-title')).toBeInTheDocument()
  })

  test('duplicate mode prefills from the source question with a fresh key', () => {
    renderDialog({ mode: 'duplicate' })

    const keyInput = screen.getByTestId('question-key-input') as HTMLInputElement
    expect(keyInput.value).toBe('hasFunctionalClinicNew')
    expect(keyInput).toBeEnabled()
    expect((screen.getByTestId('question-label-input') as HTMLInputElement).value).toBe(
      'Functional clinic on site'
    )
    expect((screen.getByTestId('question-gap-label-input') as HTMLInputElement).value).toBe(
      'No functional clinic'
    )
  })
})
