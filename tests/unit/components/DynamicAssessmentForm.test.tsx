import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  DynamicAssessmentForm,
  type DynamicAssessmentFormProps,
} from '@/components/forms/assessment/DynamicAssessmentForm'
import { useQuestionSet } from '@/hooks/useQuestionSet'
import type { QuestionDef, QuestionSectionDef } from '@/hooks/useQuestionSet'
import { useRapidAssessmentDrafts } from '@/hooks/useRapidAssessmentDrafts'

/**
 * Unit — DynamicAssessmentForm (P4): one registry-driven form for every
 * assessment type. Verifies the interaction contract the spec pins down:
 *
 * - GAP-first section ordering with kebab-case testids
 * - untouched GAP questions are neutral (no badge, no gap, no risk card)
 * - touched questions badge GAP/NO_GAP with inverted questions flipped
 * - live cross-field alerts disable submit until resolved
 * - submit emits the canonical answers payload (defaults present, empties
 *   stripped, media/coordinates attached)
 * - draft save + flash + count, registry version badge, locked selectors
 *
 * NOTE: tests/setup.ts globally stubs react-hook-form and ui/input with
 * value-only fakes; this suite needs the real RHF (useForm/useWatch/
 * Controller + resolver) and event-faithful inputs, so it overrides both
 * mocks locally.
 */

// Real React Hook Form (overrides the global tests/setup.ts stub).
jest.mock('react-hook-form', () => jest.requireActual('react-hook-form'))

// Event-faithful Input (overrides the setup stub that passes values, not
// events — the form's number parsing reads event.target.value).
jest.mock('@/components/ui/input', () => ({
  Input: (props: any) => <input {...props} />,
}))

jest.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked === true}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      {...props}
    />
  ),
}))

jest.mock('@/components/ui/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))

// Event-faithful Select (overrides the setup stub): SelectItem clicks call the
// root's onValueChange through a local context, so SINGLE_CHOICE questions are
// interactive; SelectTrigger keeps the form's kebab-case data-testid.
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

jest.mock('@/lib/icons', () => {
  const stub = (name: string) => {
    const Stub = (props: any) => <span data-testid={`icon-${name}`} {...props} />
    return Stub
  }
  return {
    AlertTriangle: stub('alert-triangle'),
    Droplets: stub('droplets'),
    Home: stub('home'),
    Hospital: stub('hospital'),
    Loader2: stub('loader'),
    Save: stub('save'),
    Shield: stub('shield'),
    Users: stub('users'),
    UtensilsCrossed: stub('utensils'),
  }
})

jest.mock('@/hooks/useQuestionSet', () => ({
  useQuestionSet: jest.fn(),
}))

jest.mock('@/hooks/useRapidAssessmentDrafts', () => ({
  useRapidAssessmentDrafts: jest.fn(),
}))

jest.mock('@/components/shared/StickyFormHeader', () => ({
  StickyFormHeader: ({ title, gapCount, gapLabels, hasInteracted, extraBadges }: any) => (
    <div data-testid="sticky-form-header">
      <span data-testid="header-title">{title}</span>
      <span data-testid="header-gap-count">{gapCount}</span>
      <span data-testid="header-interacted">{String(hasInteracted)}</span>
      <span data-testid="header-gap-labels">{(gapLabels ?? []).join('|')}</span>
      {extraBadges}
    </div>
  ),
}))

jest.mock('@/components/shared/SectionProgress', () => ({
  SectionProgress: () => <nav data-testid="section-progress" />,
}))

jest.mock('@/components/shared/IncidentSelector', () => ({
  IncidentSelector: ({ value, onValueChange, disabled }: any) => (
    <select
      data-testid="incident-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">Select incident…</option>
      <option value="incident-1">Flood 2024</option>
    </select>
  ),
}))

jest.mock('@/components/shared/EntitySelector', () => ({
  EntitySelector: ({ value, onValueChange, disabled }: any) => (
    <select
      data-testid="entity-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">Select entity…</option>
      <option value="entity-1">Community A</option>
    </select>
  ),
}))

jest.mock('@/components/shared/GPSCapture', () => ({
  GPSCapture: ({ onLocationCapture }: any) => (
    <button
      type="button"
      data-testid="gps-capture-button"
      onClick={() => onLocationCapture(11.506, 13.098)}
    >
      Capture GPS
    </button>
  ),
}))

jest.mock('@/components/shared/MediaField', () => ({
  MediaField: ({ onPhotosChange }: any) => (
    <button
      type="button"
      data-testid="attach-photo-button"
      onClick={() => onPhotosChange(['data:image/jpeg;base64,abc'])}
    >
      Attach Photo
    </button>
  ),
}))

jest.mock('@/components/shared/TagPillSelect', () => ({
  TagPillSelect: ({ options, selected, onChange, ...props }: any) => (
    <div data-testid="tag-pill-select" {...props}>
      {options.map((option: any) => (
        <button
          key={option.id}
          type="button"
          data-testid={`tag-${option.id}`}
          aria-pressed={selected.includes(option.id)}
          onClick={() =>
            onChange(
              selected.includes(option.id)
                ? selected.filter((value: string) => value !== option.id)
                : [...selected, option.id]
            )
          }
        >
          {option.label}
        </button>
      ))}
    </div>
  ),
}))

// ---------------------------------------------------------------------------
// WASH fixture (normalized QuestionSetView shape) — GAP booleans (one
// inverted), MULTI_SELECT, NUMBER and TEXT_LONG questions.
// ---------------------------------------------------------------------------

function question(
  overrides: Partial<QuestionDef> & Pick<QuestionDef, 'key' | 'type' | 'label'>
): QuestionDef {
  return {
    helperText: null,
    required: false,
    options: [],
    category: 'CONTEXT',
    inverted: false,
    gapLabel: null,
    gapMeaning: null,
    recommendation: null,
    severity: null,
    numberMin: null,
    numberMax: null,
    order: 1,
    ...overrides,
  }
}

const WASH_SECTIONS: QuestionSectionDef[] = [
  {
    key: 'water-access',
    title: 'Water Access and Availability',
    description: 'Evaluate water access and sufficiency',
    category: 'GAP',
    order: 1,
    questions: [
      question({
        key: 'isWaterSufficient',
        type: 'BOOLEAN',
        label: 'Water Sufficient',
        required: true,
        category: 'GAP',
        gapLabel: 'Insufficient water',
        gapMeaning: 'Water quantity is not sufficient for basic needs',
        recommendation: 'Deploy water trucking services',
        severity: 'MEDIUM',
      }),
      question({
        key: 'hasCleanWaterAccess',
        type: 'BOOLEAN',
        label: 'Clean Water Access',
        required: true,
        category: 'GAP',
        gapLabel: 'No clean water access',
        severity: 'MEDIUM',
      }),
    ],
  },
  {
    key: 'sanitation',
    title: 'Sanitation Assessment',
    description: null,
    category: 'GAP',
    order: 2,
    questions: [
      question({
        key: 'areLatrinesSufficient',
        type: 'BOOLEAN',
        label: 'Latrines Sufficient',
        required: true,
        category: 'GAP',
        gapLabel: 'Insufficient latrines',
        recommendation: 'Construct emergency sanitation facilities',
        severity: 'MEDIUM',
      }),
      question({
        key: 'hasOpenDefecationConcerns',
        type: 'BOOLEAN',
        label: 'Open Defecation Concerns',
        required: true,
        category: 'GAP',
        inverted: true,
        gapLabel: 'Open defecation concerns',
        severity: 'MEDIUM',
      }),
    ],
  },
  {
    key: 'water-sources',
    title: 'Water Sources',
    description: null,
    category: 'CONTEXT',
    order: 3,
    questions: [
      question({
        key: 'primaryWaterSource',
        type: 'SINGLE_CHOICE',
        label: 'Primary Water Source',
        required: true,
        options: [
          { value: 'Borehole', label: 'Borehole' },
          { value: 'River/Stream', label: 'River/Stream' },
          { value: 'Trucked', label: 'Trucked' },
        ],
      }),
      question({
        key: 'waterSource',
        type: 'MULTI_SELECT',
        label: 'Water Sources',
        options: [
          { value: 'Borehole', label: 'Borehole' },
          { value: 'River/Stream', label: 'River/Stream' },
        ],
      }),
    ],
  },
  {
    key: 'sanitation-facilities',
    title: 'Sanitation Facilities',
    description: null,
    category: 'CONTEXT',
    order: 4,
    questions: [
      question({
        key: 'functionalLatrinesAvailable',
        type: 'NUMBER',
        label: 'Functional Latrines',
        required: true,
        numberMin: 0,
      }),
    ],
  },
  {
    key: 'additional',
    title: 'Additional Details',
    description: null,
    category: 'CONTEXT',
    order: 5,
    questions: [
      question({ key: 'additionalWashDetails', type: 'TEXT_LONG', label: 'Additional Details' }),
      // Pins the LEGACY_TESTID_OVERRIDES mapping (additionalHealthDetails is the
      // one hand-written legacy widget id the form preserves).
      question({ key: 'additionalHealthDetails', type: 'TEXT_LONG', label: 'Notes' }),
    ],
  },
]

const WASH_QUESTIONS = WASH_SECTIONS.flatMap((section) => section.questions)

const mockUseQuestionSet = useQuestionSet as jest.Mock
const mockUseDrafts = useRapidAssessmentDrafts as jest.Mock
const mockSaveDraft = jest.fn()
let mockDrafts: Array<Record<string, unknown>> = []

beforeEach(() => {
  jest.clearAllMocks()
  mockDrafts = []
  mockUseQuestionSet.mockReturnValue({
    questionSet: {
      sections: WASH_SECTIONS,
      questions: WASH_QUESTIONS,
      structureVersion: 3,
      contentVersion: 7,
    },
    sections: WASH_SECTIONS,
    questions: WASH_QUESTIONS,
    structureVersion: 3,
    contentVersion: 7,
    isLoading: false,
    error: null,
  })
  mockUseDrafts.mockImplementation(() => ({
    drafts: mockDrafts,
    currentDraft: null,
    saveDraft: mockSaveDraft,
    loadDraft: jest.fn(),
    deleteDraft: jest.fn(),
    clearCurrentDraft: jest.fn(),
  }))
})

function renderForm(props: Partial<DynamicAssessmentFormProps> = {}) {
  const mockOnSubmit = jest.fn().mockResolvedValue(undefined)
  const user = userEvent.setup()
  const view = render(
    <DynamicAssessmentForm
      assessmentType="WASH"
      entityId="entity-1"
      incidentId="incident-1"
      onSubmit={mockOnSubmit}
      {...props}
    />
  )
  return { user, mockOnSubmit, ...view }
}

describe('DynamicAssessmentForm — loader and error shells', () => {
  test('renders the loading shell while the registry loads', () => {
    mockUseQuestionSet.mockReturnValue({
      questionSet: null,
      sections: [],
      questions: [],
      structureVersion: null,
      contentVersion: null,
      isLoading: true,
      error: null,
    })
    renderForm()
    expect(screen.getByTestId('wash-form-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('wash-assessment-form')).not.toBeInTheDocument()
  })

  test('renders the error shell with the message and a Go Back action', () => {
    mockUseQuestionSet.mockReturnValue({
      questionSet: null,
      sections: [],
      questions: [],
      structureVersion: null,
      contentVersion: null,
      isLoading: false,
      error: 'Registry unavailable',
    })
    renderForm({ onCancel: jest.fn() })
    const shell = screen.getByTestId('wash-form-error')
    expect(shell).toHaveTextContent('Registry unavailable')
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument()
  })

  test('empty question sets render the error shell', () => {
    mockUseQuestionSet.mockReturnValue({
      questionSet: null,
      sections: [],
      questions: [],
      structureVersion: null,
      contentVersion: null,
      isLoading: false,
      error: null,
    })
    renderForm()
    expect(screen.getByTestId('wash-form-error')).toHaveTextContent(
      'No registry questions are configured for assessment type WASH'
    )
  })
})

describe('DynamicAssessmentForm — layout zones', () => {
  test('renders GAP sections first, then CONTEXT sections, in registry order', () => {
    const { container } = renderForm()
    const sectionOrder = [
      'section-water-access',
      'section-sanitation',
      'section-water-sources',
      'section-sanitation-facilities',
      'section-additional-details',
    ]
    const nodes = sectionOrder.map((testid) => screen.getByTestId(testid))
    for (let index = 1; index < nodes.length; index += 1) {
      const position = nodes[index - 1].compareDocumentPosition(nodes[index])
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(container).toBeDefined()
  })

  test('renders kebab-case question testids and the registry version badge', () => {
    renderForm()
    expect(screen.getByTestId('question-is-water-sufficient')).toBeInTheDocument()
    expect(screen.getByTestId('are-latrines-sufficient')).toBeInTheDocument()
    expect(screen.getByTestId('functional-latrines-available')).toBeInTheDocument()
    expect(screen.getByTestId('additional-wash-details')).toBeInTheDocument()
    // MULTI_SELECT widget carries the kebab-case testid through TagPillSelect.
    expect(screen.getByTestId('water-source')).toBeInTheDocument()
    // Preserved hand-written legacy widget id (override map).
    expect(screen.getByTestId('additional-details')).toBeInTheDocument()
    expect(screen.queryByTestId('additional-health-details')).not.toBeInTheDocument()
    expect(screen.getByTestId('registry-version-badge')).toHaveTextContent('Registry v3.7')
  })

  test('locks the incident and entity selectors when lockIncidentEntity is set', () => {
    renderForm({ lockIncidentEntity: true })
    expect(screen.getByTestId('incident-select')).toBeDisabled()
    expect(screen.getByTestId('entity-select')).toBeDisabled()
  })

  test('disables meta inputs listed in readonlyFields', () => {
    renderForm({ readonlyFields: ['assessorName', 'rapidAssessmentDate'] })
    expect(screen.getByTestId('assessor-name')).toBeDisabled()
    expect(screen.getByTestId('assessment-date')).toBeDisabled()
    expect(screen.getByTestId('location-name')).not.toBeDisabled()
  })
})

describe('DynamicAssessmentForm — interaction gating (untouched = never a gap)', () => {
  test('untouched GAP questions render neutral: no badge, no gap count, no risk card', () => {
    renderForm()
    expect(screen.queryByTestId('is-water-sufficient-gap-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('risk-assessment-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('header-gap-count')).toHaveTextContent('0')
    expect(screen.getByTestId('header-interacted')).toHaveTextContent('false')
  })

  test('checking then unchecking a GAP question flips NO_GAP → GAP and updates the header', async () => {
    const { user } = renderForm()

    await user.click(screen.getByTestId('is-water-sufficient'))
    let badge = screen.getByTestId('is-water-sufficient-gap-badge')
    expect(badge).toHaveTextContent(/no gap/i)

    await user.click(screen.getByTestId('is-water-sufficient'))
    badge = screen.getByTestId('is-water-sufficient-gap-badge')
    expect(badge).toHaveTextContent(/^gap$/i)

    expect(screen.getByTestId('header-gap-count')).toHaveTextContent('1')
    expect(screen.getByTestId('header-interacted')).toHaveTextContent('true')
    expect(screen.getByTestId('header-gap-labels')).toHaveTextContent('Insufficient water')
  })

  test('the risk card appears only after a confirmed gap', async () => {
    const { user } = renderForm()
    await user.click(screen.getByTestId('is-water-sufficient')) // true → NO_GAP
    expect(screen.queryByTestId('risk-assessment-card')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('is-water-sufficient')) // false → GAP
    expect(screen.getByTestId('risk-assessment-card')).toBeInTheDocument()
    expect(screen.getByTestId('risk-row-is-water-sufficient')).toHaveTextContent(
      'Insufficient water'
    )
  })

  test('inverted GAP questions flip the badge polarity (true = gap)', async () => {
    const { user } = renderForm()

    await user.click(screen.getByTestId('has-open-defecation-concerns'))
    let badge = screen.getByTestId('has-open-defecation-concerns-gap-badge')
    expect(badge).toHaveTextContent(/^gap$/i)

    await user.click(screen.getByTestId('has-open-defecation-concerns'))
    badge = screen.getByTestId('has-open-defecation-concerns-gap-badge')
    expect(badge).toHaveTextContent(/no gap/i)
  })
})

describe('DynamicAssessmentForm — cross-field validation (live)', () => {
  test('sufficient latrines with none functional disables submit until fixed', async () => {
    const { user } = renderForm()

    await user.click(screen.getByTestId('are-latrines-sufficient')) // true, count still 0
    // The WASH rule attaches to the functionalLatrinesAvailable key.
    const alert = screen.getByTestId('cross-field-alert-functional-latrines-available')
    expect(alert).toHaveTextContent('Latrines marked sufficient but none are functional')
    expect(screen.getByTestId('submit-assessment-button')).toBeDisabled()

    await user.clear(screen.getByTestId('functional-latrines-available'))
    await user.type(screen.getByTestId('functional-latrines-available'), '5')
    await waitFor(() =>
      expect(
        screen.queryByTestId('cross-field-alert-functional-latrines-available')
      ).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('submit-assessment-button')).not.toBeDisabled()
  })
})

describe('DynamicAssessmentForm — SINGLE_CHOICE questions', () => {
  test('renders the choice widget with its options', () => {
    renderForm()
    expect(screen.getByTestId('question-primary-water-source')).toBeInTheDocument()
    expect(screen.getByTestId('primary-water-source')).toBeInTheDocument()
    expect(screen.getByTestId('select-option-Borehole')).toBeInTheDocument()
    expect(screen.getByTestId('select-option-Trucked')).toBeInTheDocument()
  })

  test('submit is blocked while a required SINGLE_CHOICE is unanswered', async () => {
    const { user, mockOnSubmit } = renderForm()
    await user.click(screen.getByTestId('submit-assessment-button'))
    expect(mockOnSubmit).not.toHaveBeenCalled()
  })

  test('selecting an option includes it in the answers payload', async () => {
    const { user, mockOnSubmit } = renderForm()
    await user.click(screen.getByTestId('select-option-Borehole'))
    await user.click(screen.getByTestId('submit-assessment-button'))
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1))
    expect(mockOnSubmit.mock.calls[0][0].answers.primaryWaterSource).toBe('Borehole')
  })
})

describe('DynamicAssessmentForm — submit payload', () => {
  test('emits the canonical answers payload: defaults present, empties stripped', async () => {
    const { user, mockOnSubmit } = renderForm()

    await user.clear(screen.getByTestId('assessor-name'))
    await user.type(screen.getByTestId('assessor-name'), 'Jane Assessor')
    await user.type(screen.getByTestId('location-name'), 'Maiduguri')
    await user.click(screen.getByTestId('gps-capture-button'))
    await user.click(screen.getByTestId('attach-photo-button'))
    await user.click(screen.getByTestId('tag-Borehole'))
    await user.click(screen.getByTestId('select-option-Trucked'))
    // additionalWashDetails intentionally left empty — must be stripped.

    await user.click(screen.getByTestId('submit-assessment-button'))
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1))

    const payload = mockOnSubmit.mock.calls[0][0]
    expect(payload.type).toBe('WASH')
    expect(payload.entityId).toBe('entity-1')
    expect(payload.incidentId).toBe('incident-1')
    expect(payload.assessorName).toBe('Jane Assessor')
    expect(payload.location).toBe('Maiduguri')
    expect(payload.coordinates).toMatchObject({
      latitude: 11.506,
      longitude: 13.098,
      captureMethod: 'GPS',
    })
    expect(payload.mediaAttachments).toEqual(['data:image/jpeg;base64,abc'])

    // Untouched booleans/numbers travel as their defaults; typed text/choices
    // are kept; untouched empty free text is ABSENT from the answers map.
    expect(payload.answers).toMatchObject({
      isWaterSufficient: false,
      hasCleanWaterAccess: false,
      areLatrinesSufficient: false,
      hasOpenDefecationConcerns: false,
      functionalLatrinesAvailable: 0,
      waterSource: ['Borehole'],
      primaryWaterSource: 'Trucked',
    })
    expect(payload.answers).not.toHaveProperty('additionalWashDetails')
    expect(payload.answers).not.toHaveProperty('additionalHealthDetails')
    expect(payload.answers).not.toHaveProperty('washData') // legacy typed transport is gone
  })

  test('submit does not call onSubmit while a cross-field violation is live', async () => {
    const { user, mockOnSubmit } = renderForm()
    await user.click(screen.getByTestId('are-latrines-sufficient')) // violation
    await user.click(screen.getByTestId('submit-assessment-button'))
    expect(mockOnSubmit).not.toHaveBeenCalled()
  })
})

describe('DynamicAssessmentForm — drafts', () => {
  test('Save Draft is disabled while pristine (nothing to save yet)', () => {
    renderForm()
    expect(screen.getByTestId('save-draft-button')).toBeDisabled()
  })

  test('save draft persists a snapshot with the selected entity/incident and flashes', async () => {
    const { user } = renderForm()
    // Touch a question so the form is dirty (pristine forms cannot save).
    await user.click(screen.getByTestId('is-water-sufficient'))
    await user.click(screen.getByTestId('is-water-sufficient'))
    expect(screen.getByTestId('save-draft-button')).not.toBeDisabled()
    await user.click(screen.getByTestId('save-draft-button'))

    expect(mockSaveDraft).toHaveBeenCalledTimes(1)
    const [snapshot, entityId, incidentId, autoSaved] = mockSaveDraft.mock.calls[0]
    expect(snapshot).toMatchObject({
      answers: expect.objectContaining({ isWaterSufficient: false, functionalLatrinesAvailable: 0 }),
      rapidAssessmentDate: expect.any(String),
    })
    expect(entityId).toBe('entity-1')
    expect(incidentId).toBe('incident-1')
    expect(autoSaved).toBe(false)
    expect(screen.getByTestId('draft-saved-flash')).toHaveTextContent('Draft saved successfully')
  })

  test('shows the saved draft count for the assessment type', () => {
    mockDrafts = [{ id: 'draft-1' }, { id: 'draft-2' }]
    renderForm()
    expect(screen.getByTestId('draft-count')).toHaveTextContent(
      '2 drafts saved for this assessment type'
    )
  })
})

describe('DynamicAssessmentForm — hydration', () => {
  test('initialAnswers seed values, marks those questions touched, and prefill entity/incident', async () => {
    const { user, mockOnSubmit } = renderForm({
      initialAnswers: {
        isWaterSufficient: false,
        waterSource: ['Borehole', 'River/Stream'],
        primaryWaterSource: 'Borehole',
      },
    })

    // Hydrated GAP answer counts as interacted → badge + header reflect it.
    expect(screen.getByTestId('is-water-sufficient-gap-badge')).toHaveTextContent(/^gap$/i)
    expect(screen.getByTestId('header-gap-count')).toHaveTextContent('1')
    expect(screen.getByTestId('header-interacted')).toHaveTextContent('true')
    expect(screen.getByTestId('risk-assessment-card')).toBeInTheDocument()

    await user.click(screen.getByTestId('submit-assessment-button'))
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1))
    const payload = mockOnSubmit.mock.calls[0][0]
    expect(payload.answers.waterSource).toEqual(['Borehole', 'River/Stream'])
    expect(payload.answers.primaryWaterSource).toBe('Borehole')
    expect((screen.getByTestId('entity-select') as HTMLSelectElement).value).toBe('entity-1')
    expect((screen.getByTestId('incident-select') as HTMLSelectElement).value).toBe('incident-1')
  })

  test('late-arriving initialAnswers (reassessment prefill) hydrate once they land', async () => {
    const view = renderForm()
    expect(screen.queryByTestId('is-water-sufficient-gap-badge')).not.toBeInTheDocument()

    view.rerender(
      <DynamicAssessmentForm
        assessmentType="WASH"
        entityId="entity-1"
        incidentId="incident-1"
        initialAnswers={{ isWaterSufficient: false, primaryWaterSource: 'Trucked' }}
        onSubmit={view.mockOnSubmit}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('is-water-sufficient-gap-badge')).toHaveTextContent(/^gap$/i)
    )
    expect(screen.getByTestId('header-gap-count')).toHaveTextContent('1')
    expect(screen.getByTestId('header-interacted')).toHaveTextContent('true')
  })
})

// ---------------------------------------------------------------------------
// POPULATION suppression — a context-only type (zero GAP questions) never
// shows gap UI: no GAP badge anywhere, header never flips to interacted, no
// risk card, while the cross-field sum rules stay live.
// ---------------------------------------------------------------------------

const POPULATION_SECTIONS: QuestionSectionDef[] = [
  {
    key: 'population',
    title: 'Population',
    description: null,
    category: 'CONTEXT',
    order: 1,
    questions: [
      question({ key: 'totalPopulation', type: 'NUMBER', label: 'Total Population', required: true, numberMin: 0 }),
      question({ key: 'populationMale', type: 'NUMBER', label: 'Male Population', required: true, numberMin: 0 }),
      question({ key: 'populationFemale', type: 'NUMBER', label: 'Female Population', required: true, numberMin: 0 }),
    ],
  },
  {
    key: 'additional-details',
    title: 'Additional Details',
    description: null,
    category: 'CONTEXT',
    order: 2,
    questions: [
      question({ key: 'additionalPopulationDetails', type: 'TEXT_LONG', label: 'Additional Details' }),
    ],
  },
]

describe('DynamicAssessmentForm — POPULATION (context-only) suppression', () => {
  beforeEach(() => {
    mockUseQuestionSet.mockReturnValue({
      questionSet: {
        sections: POPULATION_SECTIONS,
        questions: POPULATION_SECTIONS.flatMap((section) => section.questions),
        structureVersion: 1,
        contentVersion: 1,
      },
      sections: POPULATION_SECTIONS,
      questions: POPULATION_SECTIONS.flatMap((section) => section.questions),
      structureVersion: 1,
      contentVersion: 1,
      isLoading: false,
      error: null,
    })
  })

  test('renders the type root testid with all-CONTEXT sections and no gap chrome', () => {
    renderForm({ assessmentType: 'POPULATION' })
    expect(screen.getByTestId('population-assessment-form')).toBeInTheDocument()
    expect(screen.getByTestId('section-population')).toBeInTheDocument()
    expect(screen.getByTestId('section-additional-details')).toBeInTheDocument()
    expect(screen.getByTestId('header-gap-count')).toHaveTextContent('0')
    expect(screen.getByTestId('header-interacted')).toHaveTextContent('false')
    expect(screen.queryByTestId('risk-assessment-card')).not.toBeInTheDocument()
  })

  test('answering every question never flips the header or spawns a risk card', async () => {
    const { user } = renderForm({ assessmentType: 'POPULATION' })
    await user.clear(screen.getByTestId('total-population'))
    await user.type(screen.getByTestId('total-population'), '500')
    await user.clear(screen.getByTestId('population-male'))
    await user.type(screen.getByTestId('population-male'), '240')
    await user.type(screen.getByTestId('additional-population-details'), 'Influx last week')

    expect(screen.getByTestId('header-gap-count')).toHaveTextContent('0')
    expect(screen.getByTestId('header-interacted')).toHaveTextContent('false')
    expect(screen.queryByTestId('risk-assessment-card')).not.toBeInTheDocument()
  })

  test('cross-field sum rules stay live: gender sum over the total alerts and blocks submit', async () => {
    const { user, mockOnSubmit } = renderForm({ assessmentType: 'POPULATION' })
    await user.clear(screen.getByTestId('total-population'))
    await user.type(screen.getByTestId('total-population'), '500')
    await user.clear(screen.getByTestId('population-male'))
    await user.type(screen.getByTestId('population-male'), '300')
    await user.clear(screen.getByTestId('population-female'))
    await user.type(screen.getByTestId('population-female'), '300')

    const alert = screen.getByTestId('cross-field-alert-population-male')
    expect(alert).toHaveTextContent(/cannot exceed the Total Population/i)
    expect(screen.getByTestId('submit-assessment-button')).toBeDisabled()

    await user.clear(screen.getByTestId('population-female'))
    await user.type(screen.getByTestId('population-female'), '200')
    await waitFor(() =>
      expect(screen.queryByTestId('cross-field-alert-population-male')).not.toBeInTheDocument()
    )

    await user.click(screen.getByTestId('submit-assessment-button'))
    await waitFor(() => expect(mockOnSubmit).toHaveBeenCalledTimes(1))
    expect(mockOnSubmit.mock.calls[0][0].answers).toMatchObject({
      totalPopulation: 500,
      populationMale: 300,
      populationFemale: 200,
    })
  })
})
