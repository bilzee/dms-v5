import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { RuleEditDialog } from '@/components/settings/question-registry/RuleEditDialog'
import type {
  AdminQuestionRow,
  AdminRuleRow,
} from '@/hooks/useAdminQuestionSet'
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'

/**
 * Unit — RuleEditDialog (P10-3): the cross-field rule authoring dialog.
 * Pins the spec contract:
 *
 * - pending structureVersion badge (vN → vN+1 on save)
 * - create: dry-run textarea seeded from the LATEST assessment of the type
 *   (GET /rapid-assessments?type=…&limit=1) and never blocks on failure
 * - `reason` is required before anything is sent (save disabled)
 * - create-only `ruleKey` kebab grammar + client-side duplicate guard
 * - shared-zod AST grammar: literal must be finite, sum needs ≥1 key,
 *   advanced gate must parse into the engine's WhenSchema
 * - token inserter appends `{{value:key}}` / `{{sum:…}}` to the message
 * - dry run fires the DRAFT through the live engine (interpolated message)
 * - edit: ruleKey immutable (disabled input), audit trail embedded,
 *   PUT omits ruleKey and preserves legacy referenceKeys
 * - server error branches surface inline (rule_key_duplicate /
 *   registry_invalid with the invariant list / rule_key_immutable)
 *
 * Same local mock overrides as QuestionEditDialog.test.tsx (see its NOTE on
 * the value-only global stubs in tests/setup.ts).
 */

// Event-faithful Input/Textarea (the setup stub passes values, not events).
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

// Dialog without portals (content renders inline).
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
}))

// Event-faithful Select: SelectItem clicks call the root's onValueChange
// through a local context. NOTE: the two OperandEditors each render the
// question/literal/sum items, so those option buttons appear TWICE —
// getAllByTestId(...)[0] is Left, [1] is Right (DOM order).
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
    History: stub('history'),
    Loader2: stub('loader'),
    Play: stub('play'),
  }
})

jest.mock('@/lib/api', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiPut: jest.fn(),
  apiDelete: jest.fn(),
}))

const mockApiGet = apiGet as jest.Mock
const mockApiPost = apiPost as jest.Mock
const mockApiPut = apiPut as jest.Mock

function question(key: string, overrides: Partial<AdminQuestionRow> = {}): AdminQuestionRow {
  return {
    id: `q-${key}`,
    questionKey: key,
    sectionId: 'sec-population-1',
    questionType: 'NUMBER',
    label: `Label ${key}`,
    helperText: null,
    required: true,
    category: 'GAP',
    inverted: false,
    gapLabel: null,
    gapMeaning: null,
    recommendation: null,
    severity: 'MEDIUM',
    numberMin: null,
    numberMax: null,
    order: 1,
    isActive: true,
    version: 1,
    ...overrides,
  }
}

const questions: AdminQuestionRow[] = [
  question('totalPopulation'),
  question('populationUnder5'),
  question('pregnantWomen'),
  question('isFoodSufficient', { questionType: 'BOOLEAN' }),
]

function rule(overrides: Partial<AdminRuleRow> = {}): AdminRuleRow {
  return {
    id: 'rule-1',
    ruleKey: 'population-under5-plus-pregnant-exceeds-total',
    kind: 'REFINEMENT',
    name: 'Demographic sum exceeds total',
    message:
      'Under-5 plus pregnant women ({{sum:populationUnder5,pregnantWomen}}) exceeds the total population ({{value:totalPopulation}}).',
    when: null,
    expression: {
      op: '>',
      left: { type: 'sum', keys: ['populationUnder5', 'pregnantWomen'] },
      right: { type: 'question', key: 'totalPopulation' },
    },
    referenceKeys: ['populationUnder5'],
    isActive: true,
    order: 1,
    ...overrides,
  }
}

const rules: AdminRuleRow[] = [
  rule(),
  rule({
    id: 'rule-2',
    ruleKey: 'food-sufficient-but-short-duration',
    name: 'Food sufficient but short duration',
    message: 'Food is sufficient for under 3 days.',
    expression: {
      op: '<',
      left: { type: 'question', key: 'availableFoodDurationDays' },
      right: { type: 'literal', value: 3 },
    },
    referenceKeys: ['availableFoodDurationDays'],
    order: 2,
  }),
]

type DialogProps = React.ComponentProps<typeof RuleEditDialog>

function renderDialog(props: Partial<DialogProps> = {}) {
  const onSaved = jest.fn()
  const onOpenChange = jest.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RuleEditDialog
        open
        onOpenChange={onOpenChange}
        mode="create"
        assessmentType="POPULATION"
        rules={rules}
        questions={questions}
        rule={null}
        structureVersion={7}
        onSaved={onSaved}
        {...props}
      />
    </QueryClientProvider>
  )
  return { onSaved, onOpenChange }
}

/** Awaits the dry-run seeding effect (button enables once answers arrive). */
async function waitForDryRunSeed() {
  await waitFor(() =>
    expect(screen.getByTestId('rule-dialog-dry-run-button')).toBeEnabled()
  )
}

describe('RuleEditDialog (P10-3)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockApiGet.mockImplementation(async (url: string) => {
      if (url.includes('/audit')) {
        return {
          success: true,
          data: {
            entries: [
              {
                id: 'audit-1',
                action: 'CREATED',
                reason: 'seed baseline',
                actedAt: '2026-01-01T00:00:00.000Z',
                actor: { email: 'admin@example.org' },
              },
            ],
          },
        }
      }
      if (url.includes('/rapid-assessments')) {
        return {
          success: true,
          data: { items: [{ answers: { totalPopulation: 100, populationUnder5: 60 } }] },
        }
      }
      return { success: true, data: {} }
    })
    mockApiPost.mockResolvedValue({ success: true, data: {} })
    mockApiPut.mockResolvedValue({ success: true, data: {} })
  })

  test('create: shows the pending structureVersion badge and seeds the dry run from the latest assessment', async () => {
    renderDialog()

    expect(screen.getByTestId('rule-dialog-version-badge').textContent).toContain(
      'structure v7 → v8 on save'
    )

    await waitForDryRunSeed()
    const dryInput = screen.getByTestId('rule-dialog-dry-run-input') as HTMLTextAreaElement
    expect(dryInput.value).toContain('"totalPopulation"')
    expect(screen.getByTestId('rule-dialog-dry-run-source').textContent).toContain(
      'Seeded from the latest assessment'
    )
  })

  test('create: save stays disabled until a reason is entered', () => {
    renderDialog()

    const save = screen.getByTestId('rule-dialog-save-button')
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByTestId('rule-dialog-name-input'), {
      target: { value: 'New rule' },
    })
    fireEvent.change(screen.getByTestId('rule-dialog-message-input'), {
      target: { value: 'Message' },
    })
    fireEvent.change(screen.getByTestId('rule-dialog-key-input'), {
      target: { value: 'new-rule' },
    })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByTestId('rule-dialog-reason-input'), {
      target: { value: 'why not' },
    })
    expect(save).toBeEnabled()
  })

  test('create: rejects non-kebab rule keys client-side', async () => {
    renderDialog()
    const user = userEvent.setup()

    await user.type(screen.getByTestId('rule-dialog-key-input'), 'Bad_Key')
    await user.type(screen.getByTestId('rule-dialog-name-input'), 'New rule')
    await user.type(screen.getByTestId('rule-dialog-message-input'), 'Message')
    await user.type(screen.getByTestId('rule-dialog-reason-input'), 'reason')
    await user.click(screen.getByTestId('rule-dialog-save-button'))

    expect(screen.getByTestId('rule-dialog-error').textContent).toContain(
      'Rule keys are kebab-case'
    )
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  test('create: rejects duplicate rule keys for the assessment type client-side', async () => {
    renderDialog()
    const user = userEvent.setup()

    await user.type(
      screen.getByTestId('rule-dialog-key-input'),
      'food-sufficient-but-short-duration'
    )
    await user.type(screen.getByTestId('rule-dialog-name-input'), 'New rule')
    await user.type(screen.getByTestId('rule-dialog-message-input'), 'Message')
    await user.type(screen.getByTestId('rule-dialog-reason-input'), 'reason')
    await user.click(screen.getByTestId('rule-dialog-save-button'))

    expect(screen.getByTestId('rule-dialog-error').textContent).toContain(
      'already exists for this assessment type'
    )
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  test('create: POSTs the validated payload with derived referenceKeys and closes on success', async () => {
    const { onSaved, onOpenChange } = renderDialog()
    const user = userEvent.setup()

    await user.type(screen.getByTestId('rule-dialog-key-input'), 'total-must-be-positive')
    await user.type(screen.getByTestId('rule-dialog-name-input'), 'Total positive')
    await user.type(screen.getByTestId('rule-dialog-message-input'), 'Total must be positive')
    await user.type(screen.getByTestId('rule-dialog-reason-input'), 'registry hardening')
    await user.click(screen.getByTestId('rule-dialog-save-button'))

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))
    const [url, payload] = mockApiPost.mock.calls[0]
    expect(url).toBe('/api/v1/admin/rules')
    expect(payload).toMatchObject({
      assessmentType: 'POPULATION',
      ruleKey: 'total-must-be-positive',
      kind: 'REFINEMENT',
      name: 'Total positive',
      message: 'Total must be positive',
      reason: 'registry hardening',
      // default draft: left = question totalPopulation, op >, right = literal 0
      expression: {
        op: '>',
        left: { type: 'question', key: 'totalPopulation' },
        right: { type: 'literal', value: 0 },
      },
      referenceKeys: ['totalPopulation'],
    })

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('grammar: sum operands need at least one question key', async () => {
    renderDialog()
    const user = userEvent.setup()

    await waitForDryRunSeed()
    // Left operand (first of the two OperandEditors) switches to "Sum of questions".
    await user.click(screen.getAllByTestId('select-option-sum')[0])
    fireEvent.change(screen.getByTestId('rule-dialog-left-operand-sum'), {
      target: { value: '   ' },
    })
    await user.click(screen.getByTestId('rule-dialog-dry-run-button'))

    expect(screen.getByTestId('rule-dialog-dry-run-error').textContent).toContain(
      'Sum operands need at least one comma-separated question key'
    )
  })

  test('grammar: literal operands must be finite numbers', async () => {
    renderDialog()
    const user = userEvent.setup()

    await waitForDryRunSeed()
    await user.click(screen.getAllByTestId('select-option-literal')[0])
    fireEvent.change(screen.getByTestId('rule-dialog-left-operand-literal'), {
      target: { value: 'abc' },
    })
    await user.click(screen.getByTestId('rule-dialog-dry-run-button'))

    expect(screen.getByTestId('rule-dialog-dry-run-error').textContent).toContain(
      'Literal operands must be a finite number'
    )
  })

  test('grammar: advanced gate must be JSON matching the shared WhenSchema', async () => {
    renderDialog()
    const user = userEvent.setup()

    await waitForDryRunSeed()
    await user.click(screen.getByTestId('select-option-advanced'))

    const gateJson = screen.getByTestId('rule-dialog-gate-json')
    fireEvent.change(gateJson, { target: { value: '{bad json' } })
    await user.click(screen.getByTestId('rule-dialog-dry-run-button'))
    expect(screen.getByTestId('rule-dialog-dry-run-error').textContent).toContain(
      'must be valid JSON'
    )

    fireEvent.change(gateJson, { target: { value: '{"nope": 1}' } })
    await user.click(screen.getByTestId('rule-dialog-dry-run-button'))
    expect(screen.getByTestId('rule-dialog-dry-run-error').textContent).toContain(
      'must be a boolean gate'
    )
  })

  test('validation: condition sum keys must be active questions of the assessment type', async () => {
    renderDialog()
    const user = userEvent.setup()

    await waitForDryRunSeed()
    await user.click(screen.getAllByTestId('select-option-sum')[0])
    fireEvent.change(screen.getByTestId('rule-dialog-left-operand-sum'), {
      target: { value: 'ghostKey, populationUnder5' },
    })
    await user.click(screen.getByTestId('rule-dialog-dry-run-button'))

    expect(screen.getByTestId('rule-dialog-dry-run-error').textContent).toContain(
      'not active questions of this assessment type: ghostKey'
    )
  })

  test('validation: boolean gates need BOOLEAN questions — NUMBER keys are never offered', async () => {
    renderDialog({
      questions: [question('totalPopulation'), question('populationUnder5')],
    })
    const user = userEvent.setup()

    await waitForDryRunSeed()
    // "Boolean question gate" with zero BOOLEAN questions → no fallback key.
    await user.click(screen.getByTestId('select-option-bool'))
    await user.click(screen.getByTestId('rule-dialog-dry-run-button'))
    expect(screen.getByTestId('rule-dialog-dry-run-error').textContent).toContain(
      'Select a gate question'
    )

    // Advanced path: a hand-written bool gate on a NUMBER key is rejected.
    await user.click(screen.getByTestId('select-option-advanced'))
    fireEvent.change(screen.getByTestId('rule-dialog-gate-json'), {
      target: { value: '{"questionKey": "totalPopulation", "is": true}' },
    })
    await user.click(screen.getByTestId('rule-dialog-dry-run-button'))
    expect(screen.getByTestId('rule-dialog-dry-run-error').textContent).toContain(
      'Boolean gates must reference a BOOLEAN question'
    )
  })

  test('token inserter appends {{value:key}} and {{sum:…}} tokens', async () => {
    renderDialog()
    const user = userEvent.setup()

    await waitForDryRunSeed()
    // Right operand → question, then pick populationUnder5 so two keys exist.
    await user.click(screen.getAllByTestId('select-option-question')[1])
    await user.click(screen.getAllByTestId('select-option-populationUnder5')[1])

    await user.click(screen.getByTestId('rule-dialog-token-value-totalPopulation'))
    expect(screen.getByTestId('rule-dialog-message-input')).toHaveValue(
      '{{value:totalPopulation}}'
    )

    await user.click(screen.getByTestId('rule-dialog-token-sum'))
    expect(screen.getByTestId('rule-dialog-message-input')).toHaveValue(
      '{{value:totalPopulation}} {{sum:totalPopulation,populationUnder5}}'
    )
  })

  test('dry run fires the draft through the live engine with token interpolation', async () => {
    renderDialog()
    const user = userEvent.setup()

    await waitForDryRunSeed()
    // No trailing space: the token inserter adds its own separator.
    await user.type(screen.getByTestId('rule-dialog-message-input'), 'Total is')
    await user.click(screen.getByTestId('rule-dialog-token-value-totalPopulation'))

    await user.click(screen.getByTestId('rule-dialog-dry-run-button'))

    const result = screen.getByTestId('rule-dialog-dry-run-result')
    await waitFor(() =>
      expect(result.textContent).toContain('This rule fires 1 violation')
    )
    // {{value:totalPopulation}} renders the seeded answer's number.
    expect(result.textContent).toContain('Total is 100')
    expect(result.textContent).toContain('refinement')
  })

  test('dry run rejects non-JSON / non-object answers', async () => {
    renderDialog()
    const user = userEvent.setup()

    await waitForDryRunSeed()
    fireEvent.change(screen.getByTestId('rule-dialog-dry-run-input'), {
      target: { value: '{oops' },
    })
    await user.click(screen.getByTestId('rule-dialog-dry-run-button'))
    expect(screen.getByTestId('rule-dialog-dry-run-error').textContent).toContain(
      'Answers must be valid JSON'
    )
  })

  test('edit: ruleKey is immutable, the audit trail renders, and the dry run still seeds', async () => {
    renderDialog({ mode: 'edit', rule: rule() })

    expect(screen.getByTestId('rule-dialog-key-input')).toBeDisabled()
    expect(
      screen.getByTestId('rule-dialog-key-input').getAttribute('value')
    ).toBe('population-under5-plus-pregnant-exceeds-total')

    await waitFor(() =>
      expect(screen.getByTestId('rule-dialog-audit').textContent).toContain('CREATED')
    )
    expect(screen.getByTestId('rule-dialog-audit').textContent).toContain('seed baseline')

    await waitForDryRunSeed()
  })

  test('edit: PUTs the payload without ruleKey and preserves legacy referenceKeys', async () => {
    renderDialog({
      mode: 'edit',
      rule: rule({ referenceKeys: ['populationUnder5', 'legacyExtra'] }),
    })
    const user = userEvent.setup()

    await user.type(screen.getByTestId('rule-dialog-reason-input'), 'tighten message')
    await user.click(screen.getByTestId('rule-dialog-save-button'))

    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1))
    const [url, payload] = mockApiPut.mock.calls[0]
    expect(url).toBe('/api/v1/admin/rules/rule-1')
    expect(payload).not.toHaveProperty('ruleKey')
    expect(payload).toMatchObject({
      reason: 'tighten message',
      // operand order (sum keys then right question) with the edit-mode
      // primary (populationUnder5) first and the legacy key preserved last
      referenceKeys: [
        'populationUnder5',
        'pregnantWomen',
        'totalPopulation',
        'legacyExtra',
      ],
    })
  })

  test('server error: rule_key_duplicate surfaces inline and keeps the dialog open', async () => {
    const { onOpenChange } = renderDialog()
    const user = userEvent.setup()

    mockApiPost.mockResolvedValueOnce({ success: false, error: 'rule_key_duplicate' })

    await user.type(screen.getByTestId('rule-dialog-key-input'), 'fresh-rule')
    await user.type(screen.getByTestId('rule-dialog-name-input'), 'New rule')
    await user.type(screen.getByTestId('rule-dialog-message-input'), 'Message')
    await user.type(screen.getByTestId('rule-dialog-reason-input'), 'reason')
    await user.click(screen.getByTestId('rule-dialog-save-button'))

    await waitFor(() =>
      expect(screen.getByTestId('rule-dialog-error').textContent).toContain(
        'rule_key_duplicate'
      )
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('server error: registry_invalid renders the invariant error list inline', async () => {
    renderDialog()
    const user = userEvent.setup()

    mockApiPost.mockResolvedValueOnce({
      success: false,
      error: 'registry_invalid',
      details: { errors: ['referenceKeys question "ghostKey" is not active for POPULATION'] },
    })

    await user.type(screen.getByTestId('rule-dialog-key-input'), 'fresh-rule')
    await user.type(screen.getByTestId('rule-dialog-name-input'), 'New rule')
    await user.type(screen.getByTestId('rule-dialog-message-input'), 'Message')
    await user.type(screen.getByTestId('rule-dialog-reason-input'), 'reason')
    await user.click(screen.getByTestId('rule-dialog-save-button'))

    await waitFor(() =>
      expect(screen.getByTestId('rule-dialog-error').textContent).toContain(
        'registry_invalid'
      )
    )
    expect(screen.getByTestId('rule-dialog-error').textContent).toContain(
      'referenceKeys question "ghostKey" is not active for POPULATION'
    )
  })

  test('server error: rule_key_immutable surfaces inline on edit', async () => {
    renderDialog({ mode: 'edit', rule: rule() })
    const user = userEvent.setup()

    mockApiPut.mockResolvedValueOnce({ success: false, error: 'rule_key_immutable' })

    await user.type(screen.getByTestId('rule-dialog-reason-input'), 'rename attempt')
    await user.click(screen.getByTestId('rule-dialog-save-button'))

    await waitFor(() =>
      expect(screen.getByTestId('rule-dialog-error').textContent).toContain(
        'rule_key_immutable'
      )
    )
  })
})
