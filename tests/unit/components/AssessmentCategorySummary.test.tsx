import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  AssessmentCategorySummary,
} from '@/components/dashboards/situation/components/AssessmentCategorySummary'
import {
  buildCategoryGapSummary,
  buildIndividualGapSummary,
  type CategoryGapSummary,
  type SummaryQuestionMeta,
} from '@/lib/questions/gap-summary'

/**
 * Unit — AssessmentCategorySummary (P7 review VG2): pins the rendering
 * contract the pure gap-summary tests can't see — ranked registry-labeled
 * rows, "N of M" spread chips, the expandable "+N more · {n} {SEV}" overflow
 * chip, the collapsed zero-gap variant, and the registry stamp.
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
  {
    key: 'hasTrainedStaff',
    label: 'Trained staff',
    gapLabel: 'No trained staff',
    gapMeaning: null,
    category: 'GAP',
    questionType: 'BOOLEAN',
    order: 3,
  },
]

const AGGREGATED_ASSESSMENT = {
  totalEntities: 2,
  rapidAssessmentDate: new Date('2026-01-01T00:00:00Z').toISOString(),
  assessorName: 'P7 Assessor',
  verificationStatus: 'VERIFIED',
}

function buildAggregatedSummary(limit: number): CategoryGapSummary {
  return buildCategoryGapSummary({
    assessments: [
      {
        gapAnalysis: {
          hasGap: true,
          gapFields: ['hasFunctionalClinic', 'hasEmergencyServices', 'hasTrainedStaff'],
          severity: 'CRITICAL',
          recommendations: [],
          fieldSeverityMap: {
            hasFunctionalClinic: 'CRITICAL',
            hasEmergencyServices: 'HIGH',
            hasTrainedStaff: 'MEDIUM',
          },
          rows: [],
          unanswered: [],
        },
      },
      {
        gapAnalysis: {
          hasGap: true,
          gapFields: ['hasFunctionalClinic'],
          severity: 'HIGH',
          recommendations: [],
          fieldSeverityMap: { hasFunctionalClinic: 'HIGH' },
          rows: [],
          unanswered: [],
        },
      },
    ],
    metadata: HEALTH_META,
    limit,
    contentVersion: 3,
    computedAt: '2026-01-02T03:04:05.000Z',
  })
}

function renderAggregated(summary: CategoryGapSummary) {
  return render(
    <AssessmentCategorySummary
      category="health"
      assessment={AGGREGATED_ASSESSMENT}
      gapSummary={summary}
      questions={HEALTH_META}
      layout="full"
      isAggregated={true}
    />
  )
}

describe('unit — AssessmentCategorySummary (P7 rendering contract)', () => {
  test('aggregated card renders ranked registry labels with spread chips and the overflow chip', () => {
    renderAggregated(buildAggregatedSummary(2))

    // Ranked rows (severity DESC, spread DESC) labeled from the registry gapLabel.
    expect(screen.getByText('No functional clinic')).toBeInTheDocument()
    expect(screen.getByText('No emergency services')).toBeInTheDocument()
    // Hidden at limit 2 — the overflow row must NOT render collapsed.
    expect(screen.queryByText('No trained staff')).not.toBeInTheDocument()

    // Spread chips: "2 of 2" (top row, both entities) and "1 of 2".
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()

    // Chip copy per plan §5: "+N more · {count} {SEV}".
    expect(screen.getByRole('button', { name: '+1 more · 1 MEDIUM' })).toBeInTheDocument()

    // Meaning line from gapMeaning renders under the top row.
    expect(
      screen.getByText('No operational clinic at this location')
    ).toBeInTheDocument()

    // Stamp: registry contentVersion + computation timestamp.
    expect(screen.getByTestId('gap-summary-stamp')).toHaveTextContent(
      'Severities as of registry v3'
    )
  })

  test('overflow chip expands all carried rows and collapses back', async () => {
    const user = userEvent.setup()
    renderAggregated(buildAggregatedSummary(2))

    const chip = screen.getByRole('button', { name: '+1 more · 1 MEDIUM' })
    await user.click(chip)

    // All overflow rows are carried in the payload — no refetch needed.
    expect(screen.getByText('No trained staff')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByText('No trained staff')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+1 more · 1 MEDIUM' })).toBeInTheDocument()
  })

  test('zero-gap category renders the collapsed variant with no rows or chip', () => {
    render(
      <AssessmentCategorySummary
        category="wash"
        assessment={{ ...AGGREGATED_ASSESSMENT, totalEntities: 1 }}
        gapSummary={buildCategoryGapSummary({ assessments: [{ gapAnalysis: null }] })}
        layout="full"
        isAggregated={true}
      />
    )

    expect(screen.getByText('No gaps across all entities')).toBeInTheDocument()
    expect(screen.queryByText(/more ·/)).not.toBeInTheDocument()
    // Collapsed variant: no gap rows render at all.
    expect(screen.queryByText('No functional clinic')).not.toBeInTheDocument()
  })

  test('individual card renders ranked rows without a stamp', () => {
    render(
      <AssessmentCategorySummary
        category="health"
        assessment={{
          rapidAssessmentId: 'ra-1',
          ...AGGREGATED_ASSESSMENT,
          totalEntities: undefined,
        }}
        gapAnalysis={{ hasGap: true, severity: 'CRITICAL' }}
        gapSummary={buildIndividualGapSummary(
          {
            hasGap: true,
            gapFields: ['hasFunctionalClinic'],
            severity: 'CRITICAL',
            recommendations: [],
            fieldSeverityMap: { hasFunctionalClinic: 'CRITICAL' },
            rows: [],
            unanswered: [],
          },
          HEALTH_META,
          5
        )}
        questions={HEALTH_META}
        layout="split"
      />
    )

    expect(screen.getByText('No functional clinic')).toBeInTheDocument()
    // CRITICAL appears in the header severity badge AND the ranked row chip.
    expect(screen.getAllByText('CRITICAL').length).toBeGreaterThanOrEqual(2)
    // Stamps are aggregate-only (individual cards are unstamped).
    expect(screen.queryByTestId('gap-summary-stamp')).not.toBeInTheDocument()
  })
})
