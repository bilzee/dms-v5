import React, { type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'

import { useQuestionSet } from '@/hooks/useQuestionSet'
import { apiGet } from '@/lib/api'

/**
 * Unit — useQuestionSet (P4): loads the CURRENT registry question set for one
 * assessment type from `GET /api/v1/questions?assessmentType=` and normalizes
 * the raw registry rows into the snapshot-style view the dynamic form renders
 * from (key/type naming, option parsing, section ordering, version metadata).
 */

jest.mock('@/lib/api', () => ({
  apiGet: jest.fn(),
}))

const mockedApiGet = apiGet as jest.MockedFunction<typeof apiGet>

/** Raw registry rows exactly as the questions route returns them. */
function rawQuestionSet() {
  return {
    sections: [
      {
        // Deliberately out of order — the hook must sort by `order`.
        sectionKey: 'sanitation',
        title: 'Sanitation Assessment',
        description: 'Assess sanitation and hygiene gaps',
        category: 'GAP',
        order: 2,
        questions: [
          {
            questionKey: 'areLatrinesSufficient',
            questionType: 'BOOLEAN',
            label: 'Latrines Sufficient',
            helperText: 'Number of latrines is sufficient for population',
            required: true,
            category: 'GAP',
            inverted: false,
            gapLabel: 'Insufficient latrines',
            gapMeaning: 'Latrine coverage is insufficient',
            recommendation: 'Construct emergency sanitation facilities',
            severity: 'MEDIUM',
            order: 1,
          },
          {
            questionKey: 'hasOpenDefecationConcerns',
            questionType: 'BOOLEAN',
            label: 'Open Defecation Concerns',
            required: true,
            category: 'GAP',
            inverted: true,
            gapLabel: 'Open defecation concerns',
            severity: 'HIGH',
          },
        ],
      },
      {
        sectionKey: 'water-access',
        title: 'Water Access and Availability',
        category: 'GAP',
        order: 1,
        questions: [
          {
            questionKey: 'isWaterSufficient',
            questionType: 'BOOLEAN',
            label: 'Water Sufficient',
            required: true,
            category: 'GAP',
            gapLabel: 'Insufficient water',
            severity: 'CRITICAL',
          },
        ],
      },
      {
        sectionKey: 'context',
        title: 'Context Details',
        category: 'CONTEXT',
        order: 3,
        questions: [
          {
            questionKey: 'waterSource',
            questionType: 'MULTI_SELECT',
            label: 'Water Sources',
            required: false,
            category: 'CONTEXT',
            options: [
              { value: 'Borehole', label: 'Borehole', description: 'Groundwater extraction' },
              { value: 123, label: 'Broken option' }, // invalid: non-string value
              { label: 'Missing value' }, // invalid: no value
              { value: 'River/Stream', label: 'River/Stream' },
            ],
          },
          {
            questionKey: 'functionalLatrinesAvailable',
            questionType: 'NUMBER',
            label: 'Functional Latrines',
            required: true,
            category: 'CONTEXT',
            numberMin: 0,
            numberMax: 500,
            order: 7,
          },
        ],
      },
    ],
    structureVersion: 3,
    contentVersion: 7,
  }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // The hook sets `retry: 1` per-query; without a zero retryDelay the
        // default 1s backoff outlasts waitFor during failure-path tests.
        retryDelay: 0,
      },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function renderQuestionSetHook(type: 'WASH' | 'HEALTH' = 'WASH') {
  return renderHook(() => useQuestionSet(type), { wrapper: createWrapper() })
}

beforeEach(() => {
  mockedApiGet.mockReset()
})

describe('useQuestionSet — success path', () => {
  beforeEach(() => {
    mockedApiGet.mockResolvedValue({ success: true, data: rawQuestionSet() })
  })

  test('fetches the typed question set endpoint', async () => {
    renderQuestionSetHook('WASH')
    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledWith('/api/v1/questions?assessmentType=WASH'))
  })

  test('starts in the loading state', () => {
    mockedApiGet.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderQuestionSetHook()
    expect(result.current.isLoading).toBe(true)
    expect(result.current.sections).toEqual([])
    expect(result.current.questions).toEqual([])
    expect(result.current.questionSet).toBeNull()
    expect(result.current.structureVersion).toBeNull()
    expect(result.current.contentVersion).toBeNull()
  })

  test('sorts sections by order and flattens questions in section order', async () => {
    const { result } = renderQuestionSetHook()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.sections.map((section) => section.key)).toEqual([
      'water-access',
      'sanitation',
      'context',
    ])
    expect(result.current.questions.map((question) => question.key)).toEqual([
      'isWaterSufficient',
      'areLatrinesSufficient',
      'hasOpenDefecationConcerns',
      'waterSource',
      'functionalLatrinesAvailable',
    ])
  })

  test('normalizes question rows to snapshot naming with tolerant defaults', async () => {
    const { result } = renderQuestionSetHook()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const latrines = result.current.questions.find((q) => q.key === 'areLatrinesSufficient')
    expect(latrines).toMatchObject({
      key: 'areLatrinesSufficient',
      type: 'BOOLEAN',
      label: 'Latrines Sufficient',
      helperText: 'Number of latrines is sufficient for population',
      required: true,
      options: [],
      category: 'GAP',
      inverted: false,
      gapLabel: 'Insufficient latrines',
      gapMeaning: 'Latrine coverage is insufficient',
      recommendation: 'Construct emergency sanitation facilities',
      severity: 'MEDIUM',
      numberMin: null,
      numberMax: null,
      order: 1,
    })

    // Row with optional fields absent → null / false / 0 defaults.
    const openDefecation = result.current.questions.find((q) => q.key === 'hasOpenDefecationConcerns')
    expect(openDefecation).toMatchObject({
      type: 'BOOLEAN',
      inverted: true,
      helperText: null,
      gapMeaning: null,
      recommendation: null,
      numberMin: null,
      numberMax: null,
      order: 0,
    })

    const latrineCount = result.current.questions.find((q) => q.key === 'functionalLatrinesAvailable')
    expect(latrineCount).toMatchObject({ type: 'NUMBER', numberMin: 0, numberMax: 500, order: 7 })
  })

  test('parses options, dropping malformed entries and keeping descriptions', async () => {
    const { result } = renderQuestionSetHook()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const waterSource = result.current.questions.find((q) => q.key === 'waterSource')
    expect(waterSource?.options).toEqual([
      { value: 'Borehole', label: 'Borehole', description: 'Groundwater extraction' },
      { value: 'River/Stream', label: 'River/Stream' },
    ])
  })

  test('exposes the registry versions and questionSet view', async () => {
    const { result } = renderQuestionSetHook()
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.structureVersion).toBe(3)
    expect(result.current.contentVersion).toBe(7)
    expect(result.current.error).toBeNull()
    expect(result.current.questionSet).toEqual({
      sections: result.current.sections,
      questions: result.current.questions,
      structureVersion: 3,
      contentVersion: 7,
    })
  })

  test('defaults missing versions to 1', async () => {
    const raw = rawQuestionSet() as Record<string, unknown>
    delete raw.structureVersion
    delete raw.contentVersion
    mockedApiGet.mockResolvedValue({ success: true, data: raw })
    const { result } = renderQuestionSetHook()
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.structureVersion).toBe(1)
    expect(result.current.contentVersion).toBe(1)
  })
})

describe('useQuestionSet — failure paths', () => {
  test('API failure surfaces the server error message', async () => {
    mockedApiGet.mockResolvedValue({ success: false, error: 'Registry unavailable' })
    const { result } = renderQuestionSetHook()
    await waitFor(() => expect(result.current.error).toBe('Registry unavailable'))
    expect(result.current.questionSet).toBeNull()
    expect(result.current.sections).toEqual([])
    expect(result.current.questions).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  test('a payload without sections is rejected', async () => {
    mockedApiGet.mockResolvedValue({ success: true, data: {} })
    const { result } = renderQuestionSetHook()
    await waitFor(() =>
      expect(result.current.error).toBe('Question set response is missing sections')
    )
  })
})
