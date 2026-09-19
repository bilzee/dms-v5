import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { EntityAssessmentPanel } from '@/components/dashboards/situation/EntityAssessmentPanel'

/**
 * Unit — EntityAssessmentPanel → IndividualEntityGapInfoPopup wiring
 * (P10-4 5b, review G5): the panel must feed the popup the LIVE registry
 * projection from the dashboard payload. A dropped/mistyped `questions` prop
 * would silently regress the popup to the neutral fallback — the exact
 * staleness class 5b removed.
 */

jest.mock('@/lib/api', () => ({
  apiGet: jest.fn(async (url: string) => {
    if (String(url).includes('dashboard/situation')) {
      return {
        success: true,
        data: {
          entityAssessments: [
            { id: 'entity-1', name: 'Entity One', latestAssessments: {} },
          ],
          aggregatedAssessments: null,
          questionMetadata: {
            HEALTH: {
              questions: [
                {
                  key: 'panelWiringGapProbe',
                  label: 'Panel wiring probe question',
                  gapLabel: null,
                  gapMeaning: 'Registry fields flow through the panel into the popup',
                  category: 'GAP',
                  questionType: 'BOOLEAN',
                  order: 1,
                },
              ],
            },
          },
        },
      }
    }
    return { success: true, data: [] }
  }),
}))
jest.mock('@/stores/dashboardLayout.store', () => ({
  useIncidentSelection: () => ({ selectedIncidentId: 'incident-1' }),
  useEntitySelection: () => ({ selectedEntityId: 'entity-1', includeAllEntities: false }),
}))
jest.mock('@/components/dashboards/situation/components/EntitySelector', () => ({
  EntitySelector: () => <div data-testid="entity-selector-mock" />,
}))

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <EntityAssessmentPanel incidentId="incident-1" />
    </QueryClientProvider>
  )
}

describe('unit — EntityAssessmentPanel gap popup wiring (5b/G5)', () => {
  test('popup opened from the panel renders the registry GAP question, not the neutral fallback', async () => {
    renderPanel()

    // Individual-entity view: the green info button is present once loaded.
    const infoButton = await screen.findByTitle(
      'Learn about individual entity gap assessment'
    )
    fireEvent.click(infoButton)

    // The live registry projection reaches the popup field grid.
    expect(await screen.findByText('Panel wiring probe question')).toBeInTheDocument()
    expect(
      screen.getByText('Registry fields flow through the panel into the popup')
    ).toBeInTheDocument()

    // The neutral fallback must NOT render while metadata is present.
    expect(
      screen.queryByText(/no gap questions are currently published/i)
    ).not.toBeInTheDocument()
  })
})
