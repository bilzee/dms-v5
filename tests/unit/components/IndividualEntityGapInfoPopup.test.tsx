import React from 'react'
import { render, screen } from '@testing-library/react'

import {
  IndividualEntityGapInfoPopup,
} from '@/components/dashboards/situation/components/IndividualEntityGapInfoPopup'
import type { SummaryQuestionMeta } from '@/lib/questions/gap-summary'

/**
 * Unit — IndividualEntityGapInfoPopup (P10-4 5b): pins the registry-driven
 * field grid — GAP questions render label + gapMeaning (gapLabel fallback),
 * CONTEXT questions never render, and missing/empty projections fall back to
 * the neutral registry line. A registry-added GAP question renders with NO
 * code changes (the deleted hardcoded field map would have hidden it).
 */

const HEALTH_META: SummaryQuestionMeta[] = [
  {
    key: 'hasFunctionalClinic',
    label: 'Functional clinic',
    gapLabel: 'No functional clinic',
    gapMeaning: 'No operational clinic at this location',
    category: 'GAP',
    questionType: 'BOOLEAN',
    order: 1,
  },
  {
    key: 'hasEmergencyServices',
    label: 'Emergency services',
    gapLabel: 'No emergency services',
    gapMeaning: null,
    category: 'GAP',
    questionType: 'BOOLEAN',
    order: 2,
  },
  // Registry-added AFTER the popup shipped — must render with no code changes.
  {
    key: 'hasColdChain',
    label: 'Cold chain',
    gapLabel: 'No cold chain',
    gapMeaning: 'Vaccines cannot be kept at required temperatures',
    category: 'GAP',
    questionType: 'BOOLEAN',
    order: 3,
  },
  {
    key: 'estimatedPopulation',
    label: 'Estimated population',
    gapLabel: null,
    gapMeaning: null,
    category: 'CONTEXT',
    questionType: 'NUMBER',
    order: 4,
  },
]

function renderPopup(questions?: SummaryQuestionMeta[]) {
  return render(
    <IndividualEntityGapInfoPopup
      isOpen
      onClose={() => {}}
      assessmentType="health"
      questions={questions}
    />
  )
}

describe('unit — IndividualEntityGapInfoPopup (P10-4 5b registry projection)', () => {
  test('closed popup renders nothing', () => {
    const { container } = render(
      <IndividualEntityGapInfoPopup isOpen={false} onClose={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  test('GAP questions render label + gapMeaning; a registry-added question needs no code change', () => {
    renderPopup(HEALTH_META)

    expect(screen.getByText('Functional clinic')).toBeInTheDocument()
    expect(
      screen.getByText('No operational clinic at this location')
    ).toBeInTheDocument()

    // The post-ship registry addition renders verbatim from the projection.
    expect(screen.getByText('Cold chain')).toBeInTheDocument()
    expect(
      screen.getByText('Vaccines cannot be kept at required temperatures')
    ).toBeInTheDocument()
  })

  test('gapMeaning falls back to gapLabel when null', () => {
    renderPopup(HEALTH_META)

    expect(screen.getByText('Emergency services')).toBeInTheDocument()
    expect(screen.getByText('No emergency services')).toBeInTheDocument()
  })

  test('CONTEXT questions never render in the field grid', () => {
    renderPopup(HEALTH_META)

    expect(screen.queryByText('Estimated population')).not.toBeInTheDocument()
  })

  test('empty or missing projection renders the neutral registry fallback', () => {
    for (const questions of [undefined, []]) {
      const { unmount } = renderPopup(questions as SummaryQuestionMeta[] | undefined)
      expect(
        screen.getByText(
          'Gap indicator definitions are maintained in the question registry; no gap questions are currently published for this assessment type.'
        )
      ).toBeInTheDocument()
      unmount()
    }
  })

  test('static presentation (title) and generic education sections survive', () => {
    renderPopup(HEALTH_META)

    expect(
      screen.getByText('Understanding Health Assessment for Individual Entities')
    ).toBeInTheDocument()
    expect(screen.getByText('Understanding Severity Hierarchy')).toBeInTheDocument()
    expect(screen.getByText('How Gaps Are Identified')).toBeInTheDocument()
  })
})
