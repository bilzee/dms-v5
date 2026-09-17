import React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  GapSeverityTable,
  type GapSeverityChange,
} from '@/components/settings/question-registry/GapSeverityTable'
import type { AdminQuestionRow } from '@/hooks/useAdminQuestionSet'

/**
 * Unit — GapSeverityTable (P8): the coordinator's staged severity ladder.
 * Verifies the contract the spec pins down:
 *
 * - one row per GAP question (label + key, gap wording, severity badge) and
 *   nothing is written on selection — changes only STAGE
 * - staged rows badge Pending and the pending banner quotes the staged count
 *   with Cancel / Save All
 * - bulk staging: checkbox selection (per-row + select-all) plus one bulk
 *   severity pick stages every selected row through the same pipeline
 * - Save All opens a confirm dialog quoting the impact (staged count +
 *   per-key old → new list + the server-quoted active-incident count via
 *   `fetchImpact`) before anything is applied
 * - Apply calls onApplyChanges once with every pending row; staging clears
 *   only when the owner reports success
 * - re-picking the live severity unstages a row; `disabled` locks the ladder
 *
 * NOTE: tests/setup.ts globally stubs several ui primitives with value-only
 * fakes; this suite needs event-faithful selects/checkboxes, an Alert with
 * AlertTitle and a portal-free AlertDialog, so it overrides those mocks
 * locally.
 */

// Event-faithful Select (same pattern as DynamicAssessmentForm.test.tsx):
// SelectItem clicks call the root's onValueChange through a local context,
// and the root's `disabled` gates every trigger.
jest.mock('@/components/ui/select', () => {
  const React = require('react')
  const SelectContext = React.createContext({
    value: '',
    onValueChange: (_value: string) => {},
    disabled: false,
  })
  return {
    Select: ({ value, onValueChange, disabled, children }: any) => (
      <SelectContext.Provider value={{ value: value ?? '', onValueChange, disabled: !!disabled }}>
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
    SelectTrigger: ({ children, ...props }: any) => {
      const { disabled } = React.useContext(SelectContext)
      return (
        <button type="button" disabled={disabled} {...props}>
          {children}
        </button>
      )
    },
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  }
})

// Event-faithful Checkbox (selection column + select-all).
jest.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      {...props}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}))

// Alert with AlertTitle (the setup stub omits AlertTitle, used by the banner).
jest.mock('@/components/ui/alert', () => ({
  Alert: ({ children, ...props }: any) => <div role="alert" {...props}>{children}</div>,
  AlertTitle: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  AlertDescription: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}))

// Portal-free AlertDialog gated on its `open` prop.
jest.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: any) => (open ? <>{children}</> : null),
  AlertDialogAction: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
  AlertDialogCancel: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
  AlertDialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
}))

// Deterministic severity badge: renders the status text.
jest.mock('@/components/shared/StatusBadge', () => ({
  StatusBadge: ({ status }: any) => <span data-testid="severity-badge">{status}</span>,
}))

jest.mock('@/lib/icons', () => {
  const stub = (name: string) => {
    const Stub = (props: any) => <span data-testid={`icon-${name}`} {...props} />
    return Stub
  }
  return {
    Loader2: stub('loader'),
    Save: stub('save'),
  }
})

function gapQuestion(overrides: Partial<AdminQuestionRow> = {}): AdminQuestionRow {
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
    gapMeaning: null,
    recommendation: null,
    severity: 'MEDIUM',
    numberMin: null,
    numberMax: null,
    order: 1,
    isActive: true,
    version: 2,
    ...overrides,
  }
}

const QUESTIONS: AdminQuestionRow[] = [
  gapQuestion(),
  gapQuestion({
    id: 'q-2',
    questionKey: 'isFoodSufficient',
    label: 'Food sufficient',
    gapLabel: null,
    severity: 'HIGH',
    order: 2,
  }),
]

function renderTable(
  questions: AdminQuestionRow[] = QUESTIONS,
  onApplyChanges: (changes: GapSeverityChange[]) => Promise<boolean> = jest.fn().mockResolvedValue(true),
  disabled = false,
  fetchImpact?: (questions: AdminQuestionRow[]) => Promise<Record<string, number>>
) {
  const user = userEvent.setup()
  const view = render(
    <GapSeverityTable
      questions={questions}
      onApplyChanges={onApplyChanges}
      disabled={disabled}
      fetchImpact={fetchImpact}
    />
  )
  return { user, onApplyChanges, ...view }
}

/** The bulk-severity Select renders first in the DOM — before the row selects. */
function bulkOption(user: ReturnType<typeof userEvent.setup>, severity: string) {
  return user.click(screen.getAllByTestId(`select-option-${severity}`)[0])
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GapSeverityTable — rows', () => {
  test('renders one row per GAP question with label, key, gap wording and severity', () => {
    renderTable()

    const rows = screen.getAllByTestId('gap-severity-row')
    expect(rows).toHaveLength(2)

    expect(within(rows[0]).getByText('Functional clinic on site')).toBeInTheDocument()
    expect(within(rows[0]).getByText('hasFunctionalClinic')).toBeInTheDocument()
    expect(within(rows[0]).getByText('No functional clinic')).toBeInTheDocument()
    expect(within(rows[0]).getByTestId('gap-severity-badge')).toHaveTextContent('MEDIUM')

    // Null gap wording renders the em-dash placeholder.
    expect(within(rows[1]).getByText('—')).toBeInTheDocument()
    expect(within(rows[1]).getByTestId('gap-severity-badge')).toHaveTextContent('HIGH')

    // Selection column: one checkbox per row, keyed by question key.
    const checkboxes = screen.getAllByTestId('gap-row-checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).toHaveAttribute('data-question-key', 'hasFunctionalClinic')
    expect(checkboxes[1]).toHaveAttribute('data-question-key', 'isFoodSufficient')
  })

  test('the ladder offers exactly CRITICAL / HIGH / MEDIUM per row', () => {
    renderTable()
    const rows = screen.getAllByTestId('gap-severity-row')
    for (const row of rows) {
      expect(within(row).getByTestId('select-option-CRITICAL')).toBeInTheDocument()
      expect(within(row).getByTestId('select-option-HIGH')).toBeInTheDocument()
      expect(within(row).getByTestId('select-option-MEDIUM')).toBeInTheDocument()
    }
  })

  test('disabled locks every row select', () => {
    renderTable(QUESTIONS, undefined, true)
    for (const select of screen.getAllByTestId('gap-severity-select')) {
      expect(select).toBeDisabled()
    }
  })
})

describe('GapSeverityTable — staging', () => {
  test('picking a severity only stages the change; nothing is applied yet', async () => {
    const { user } = renderTable()

    const firstRow = screen.getAllByTestId('gap-severity-row')[0]
    await user.click(within(firstRow).getByTestId('select-option-CRITICAL'))

    // Row badges Pending while the live severity badge is unchanged.
    expect(within(firstRow).getByTestId('gap-row-pending')).toBeInTheDocument()
    expect(within(firstRow).getByTestId('gap-severity-badge')).toHaveTextContent('MEDIUM')

    // Banner quotes the staged count; nothing was applied.
    expect(screen.getByTestId('gap-pending-banner')).toHaveTextContent(
      '1 severity change staged'
    )
  })

  test('re-picking the live severity unstages the row and drops the banner', async () => {
    const { user } = renderTable()

    const firstRow = screen.getAllByTestId('gap-severity-row')[0]
    await user.click(within(firstRow).getByTestId('select-option-CRITICAL'))
    expect(screen.getByTestId('gap-pending-banner')).toBeInTheDocument()

    await user.click(within(firstRow).getByTestId('select-option-MEDIUM'))
    expect(screen.queryByTestId('gap-pending-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('gap-row-pending')).not.toBeInTheDocument()
  })

  test('Cancel drops all staged changes', async () => {
    const { user } = renderTable()

    await user.click(within(screen.getAllByTestId('gap-severity-row')[0]).getByTestId('select-option-CRITICAL'))
    await user.click(within(screen.getAllByTestId('gap-severity-row')[1]).getByTestId('select-option-MEDIUM'))
    expect(screen.getByTestId('gap-pending-banner')).toHaveTextContent('2 severity changes staged')

    await user.click(screen.getByTestId('gap-cancel-button'))
    expect(screen.queryByTestId('gap-pending-banner')).not.toBeInTheDocument()
  })
})

describe('GapSeverityTable — bulk staging', () => {
  test('select-all + a bulk pick stages every selected row through the same pipeline', async () => {
    const { user } = renderTable()

    await user.click(screen.getByTestId('gap-select-all'))
    await bulkOption(user, 'CRITICAL')
    await user.click(screen.getByTestId('gap-bulk-apply-button'))

    expect(screen.getByTestId('gap-pending-banner')).toHaveTextContent('2 severity changes staged')
    for (const row of screen.getAllByTestId('gap-severity-row')) {
      expect(within(row).getByTestId('gap-row-pending')).toBeInTheDocument()
    }
  })

  test('per-row checkboxes drive the bulk scope ("Apply to N selected")', async () => {
    const { user } = renderTable()

    const applyButton = screen.getByTestId('gap-bulk-apply-button')
    expect(applyButton).toBeDisabled()

    await user.click(screen.getAllByTestId('gap-row-checkbox')[1])
    expect(applyButton).toHaveTextContent('Apply to 1 selected')

    await bulkOption(user, 'MEDIUM')
    await user.click(applyButton)

    // Only the selected row staged (HIGH → MEDIUM); the other row untouched.
    expect(screen.getByTestId('gap-pending-banner')).toHaveTextContent('1 severity change staged')
    const rows = screen.getAllByTestId('gap-severity-row')
    expect(within(rows[0]).queryByTestId('gap-row-pending')).not.toBeInTheDocument()
    expect(within(rows[1]).getByTestId('gap-row-pending')).toBeInTheDocument()
  })

  test('a bulk pick equal to the live severity unstages selected rows', async () => {
    const { user } = renderTable()

    await user.click(screen.getByTestId('gap-select-all'))
    await bulkOption(user, 'HIGH')
    await user.click(screen.getByTestId('gap-bulk-apply-button'))

    // q-2 is already HIGH (no change); only q-1 (MEDIUM → HIGH) stages.
    expect(screen.getByTestId('gap-pending-banner')).toHaveTextContent('1 severity change staged')
  })
})

describe('GapSeverityTable — Save All', () => {
  test('the confirm dialog quotes the staged impact before anything is applied', async () => {
    const { user, onApplyChanges } = renderTable()

    await user.click(within(screen.getAllByTestId('gap-severity-row')[0]).getByTestId('select-option-CRITICAL'))
    await user.click(screen.getByTestId('gap-save-all-button'))

    const dialog = screen.getByTestId('gap-confirm-dialog')
    expect(screen.getByTestId('gap-confirm-count')).toHaveTextContent('1 GAP severity rule')
    expect(dialog).toHaveTextContent('hasFunctionalClinic')
    expect(dialog).toHaveTextContent('MEDIUM')
    expect(dialog).toHaveTextContent('CRITICAL')
    expect(onApplyChanges).not.toHaveBeenCalled()
  })

  test('fetchImpact quotes the server-side active-incident count in the dialog', async () => {
    const fetchImpact = jest.fn().mockResolvedValue({ 'q-1': 2, 'q-2': 0 })
    const { user } = renderTable(QUESTIONS, undefined, false, fetchImpact)

    await user.click(within(screen.getAllByTestId('gap-severity-row')[0]).getByTestId('select-option-CRITICAL'))
    await user.click(screen.getByTestId('gap-save-all-button'))

    // The quote covers exactly the staged rows (sum 2 = q-1 only).
    await waitFor(() =>
      expect(screen.getByTestId('gap-confirm-impact')).toHaveTextContent(
        '2 assessments under active incidents will be re-derived'
      )
    )
    expect(fetchImpact).toHaveBeenCalledTimes(1)
    expect(fetchImpact.mock.calls[0][0]).toMatchObject([{ id: 'q-1' }])
  })

  test('a failed impact quote never blocks — the line stays blank', async () => {
    const fetchImpact = jest.fn().mockRejectedValue(new Error('quote unavailable'))
    const { user } = renderTable(QUESTIONS, undefined, false, fetchImpact)

    await user.click(within(screen.getAllByTestId('gap-severity-row')[0]).getByTestId('select-option-CRITICAL'))
    await user.click(screen.getByTestId('gap-save-all-button'))

    await waitFor(() => expect(fetchImpact).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByTestId('gap-confirm-impact').textContent).toBe('')
    )
    // The apply button stays usable — the quote is advisory only.
    expect(screen.getByTestId('gap-confirm-apply')).toBeEnabled()
  })

  test('Apply calls onApplyChanges once with every staged row and clears staging on success', async () => {
    const onApplyChanges = jest.fn().mockResolvedValue(true)
    const { user } = renderTable(QUESTIONS, onApplyChanges)

    await user.click(within(screen.getAllByTestId('gap-severity-row')[0]).getByTestId('select-option-CRITICAL'))
    await user.click(within(screen.getAllByTestId('gap-severity-row')[1]).getByTestId('select-option-MEDIUM'))
    await user.click(screen.getByTestId('gap-save-all-button'))
    await user.click(screen.getByTestId('gap-confirm-apply'))

    await waitFor(() => expect(onApplyChanges).toHaveBeenCalledTimes(1))
    const changes = onApplyChanges.mock.calls[0][0] as GapSeverityChange[]
    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({
      question: { questionKey: 'hasFunctionalClinic' },
      severity: 'CRITICAL',
    })
    expect(changes[1]).toMatchObject({
      question: { questionKey: 'isFoodSufficient' },
      severity: 'MEDIUM',
    })

    await waitFor(() =>
      expect(screen.queryByTestId('gap-confirm-dialog')).not.toBeInTheDocument()
    )
    expect(screen.queryByTestId('gap-pending-banner')).not.toBeInTheDocument()
    // A successful apply also drops the row selection.
    expect((screen.getByTestId('gap-select-all') as HTMLInputElement).checked).toBe(false)
  })

  test('a failed apply keeps the staging so the coordinator can retry', async () => {
    const onApplyChanges = jest.fn().mockResolvedValue(false)
    const { user } = renderTable(QUESTIONS, onApplyChanges)

    await user.click(within(screen.getAllByTestId('gap-severity-row')[0]).getByTestId('select-option-CRITICAL'))
    await user.click(screen.getByTestId('gap-save-all-button'))
    await user.click(screen.getByTestId('gap-confirm-apply'))

    await waitFor(() =>
      expect(screen.queryByTestId('gap-confirm-dialog')).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('gap-pending-banner')).toBeInTheDocument()
    expect(screen.getByTestId('gap-row-pending')).toBeInTheDocument()
  })
})
