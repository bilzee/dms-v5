import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import {
  CompactAssessmentTile,
} from '@/components/dashboards/situation/executive/CompactAssessmentTile'
import { apiGet } from '@/lib/api'

/**
 * Unit — CompactAssessmentTile (P7 review VG3): pins the severity source the
 * pure gap-summary suites can't see — the executive tile must take each
 * category's worst severity from the aggregated `gapSummary.overallSeverity`
 * (derived by the situation route from stored gaps) and its verified counts
 * from `totalEntities`, never from a local severity table.
 */

jest.mock('@/lib/api', () => ({
  apiGet: jest.fn(),
}))

const mockedApiGet = apiGet as jest.MockedFunction<typeof apiGet>

function renderTile() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <CompactAssessmentTile incidentId="inc-7" />
    </QueryClientProvider>
  )
}

describe('unit — CompactAssessmentTile (P7 severity source)', () => {
  beforeEach(() => {
    mockedApiGet.mockResolvedValue({
      success: true,
      data: {
        aggregatedAssessments: {
          health: {
            totalEntities: 3,
            entitiesWithGaps: 2,
            entitiesWithoutGaps: 1,
            gapSummary: {
              hasGaps: true,
              overallSeverity: 'CRITICAL',
              rows: [],
              totalGapRows: 2,
              hiddenCount: 0,
            },
          },
          wash: {
            totalEntities: 2,
            entitiesWithGaps: 0,
            entitiesWithoutGaps: 2,
            gapSummary: {
              hasGaps: false,
              overallSeverity: 'LOW',
              rows: [],
              totalGapRows: 0,
              hiddenCount: 0,
            },
          },
          // No FOOD assessments → null aggregate ("Assessment Missing").
          food: null,
        },
        entityAssessments: [],
        aggregateMetrics: {},
      },
    })
  })

  afterEach(() => {
    mockedApiGet.mockReset()
  })

  test('badges come from aggregated gapSummary.overallSeverity, counts from totalEntities', async () => {
    renderTile()

    // HEALTH badge renders the summary's worst severity.
    expect(await screen.findByText('CRITICAL')).toBeInTheDocument()

    // WASH (zero gaps → LOW) and the missing FOOD/SHELTER/SECURITY types
    // (null aggregates → LOW fallback) all render LOW badges.
    expect(screen.getAllByText('LOW').length).toBeGreaterThanOrEqual(4)

    // Verified counts come from totalEntities per aggregate.
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    // 5 of 5 verified → 100% overall completion badge.
    expect(screen.getByText('100% complete')).toBeInTheDocument()

    // The tile queries the All-Entities aggregate (entityId=all), the only
    // payload that carries aggregatedAssessments.
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/v1/dashboard/situation?incidentId=inc-7&entityId=all'
    )
  })
})
