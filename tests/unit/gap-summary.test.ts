import {
  buildCategoryGapSummary,
  buildIndividualGapSummary,
  GAP_ROWS_PER_CATEGORY_CEILING,
  GAP_ROWS_PER_CATEGORY_DEFAULT,
  rankGapRows,
  resolveGapRowLimit,
  type CategoryGapRow,
  type StoredAssessmentLike,
  type SummaryQuestionMeta,
} from '@/lib/questions/gap-summary'

/**
 * Unit — the P7 pure ranked-summary module (no I/O, no mocks, no clock).
 *
 * Pins the §2.7 contract:
 * - resolveGapRowLimit: 1..7 pass through, ceiling 7, default 5 on
 *   missing/non-number/zero/invalid
 * - ranking: severity DESC → spread DESC → registry order ASC → key ASC
 * - row severity = MAX stored fieldSeverityMap value across reporting
 *   entities; spread = reporting-entity count; total = assessment count
 * - label/meaning/order from the live metadata projection; the ladder falls
 *   back to the stored row's gapLabel → label → the key itself, with
 *   meaning null and order +Infinity
 * - zero-gap summaries collapse (hasGaps false, overallSeverity LOW)
 * - overflow: hiddenCount/hint carry every overflow row, hint = highest
 *   hidden severity + count at that severity
 * - individual summaries: spread locked to 1, no stamp
 */

const meta = (overrides: Partial<SummaryQuestionMeta>): SummaryQuestionMeta => ({
  key: 'unknown',
  label: 'label',
  gapLabel: null,
  gapMeaning: null,
  category: 'GAP',
  questionType: 'boolean',
  order: 99,
  ...overrides,
})

const assessmentWith = (
  gapFields: string[],
  fieldSeverityMap: Record<string, string>,
  rows: Array<{ key: string; label?: string; gapLabel?: string }> = []
): StoredAssessmentLike => ({
  gapAnalysis: {
    hasGap: gapFields.length > 0,
    gapFields,
    severity: 'HIGH',
    recommendations: [],
    fieldSeverityMap,
    rows: rows.map((row) => ({ key: row.key, label: row.label, gapLabel: row.gapLabel, severity: 'MEDIUM', source: 'registry' })),
    unanswered: [],
  },
})

describe('unit — resolveGapRowLimit (§2.7 setting clamp)', () => {
  test('values 1..7 pass through', () => {
    for (const value of [1, 2, 3, 4, 5, 6, 7]) {
      expect(resolveGapRowLimit(value)).toBe(value)
    }
  })

  test('ceiling clamps to 7; floor clamps to 1', () => {
    expect(resolveGapRowLimit(8)).toBe(GAP_ROWS_PER_CATEGORY_CEILING)
    expect(resolveGapRowLimit(99)).toBe(GAP_ROWS_PER_CATEGORY_CEILING)
    expect(resolveGapRowLimit(0.5)).toBe(1)
  })

  test('zero / negative / missing / non-number / invalid resolve to the default 5', () => {
    expect(resolveGapRowLimit(0)).toBe(GAP_ROWS_PER_CATEGORY_DEFAULT)
    expect(resolveGapRowLimit(-3)).toBe(GAP_ROWS_PER_CATEGORY_DEFAULT)
    expect(resolveGapRowLimit(undefined)).toBe(GAP_ROWS_PER_CATEGORY_DEFAULT)
    expect(resolveGapRowLimit(null)).toBe(GAP_ROWS_PER_CATEGORY_DEFAULT)
    expect(resolveGapRowLimit('5')).toBe(GAP_ROWS_PER_CATEGORY_DEFAULT)
    expect(resolveGapRowLimit(NaN)).toBe(GAP_ROWS_PER_CATEGORY_DEFAULT)
    expect(resolveGapRowLimit(Infinity)).toBe(GAP_ROWS_PER_CATEGORY_DEFAULT)
  })
})

describe('unit — rankGapRows', () => {
  const row = (overrides: Partial<CategoryGapRow>): CategoryGapRow => ({
    key: 'k',
    label: 'Label',
    meaning: null,
    severity: 'LOW',
    spread: 1,
    total: 1,
    order: 1,
    ...overrides,
  })

  test('severity DESC dominates', () => {
    const ranked = rankGapRows([
      row({ key: 'low', severity: 'LOW' }),
      row({ key: 'critical', severity: 'CRITICAL' }),
      row({ key: 'medium', severity: 'MEDIUM' }),
    ])
    expect(ranked.map((r) => r.key)).toEqual(['critical', 'medium', 'low'])
  })

  test('equal severity breaks on spread DESC', () => {
    const ranked = rankGapRows([
      row({ key: 'narrow', severity: 'HIGH', spread: 1 }),
      row({ key: 'wide', severity: 'HIGH', spread: 3 }),
    ])
    expect(ranked.map((r) => r.key)).toEqual(['wide', 'narrow'])
  })

  test('equal severity and spread breaks on registry order ASC', () => {
    const ranked = rankGapRows([
      row({ key: 'late', severity: 'HIGH', spread: 2, order: 9 }),
      row({ key: 'early', severity: 'HIGH', spread: 2, order: 2 }),
    ])
    expect(ranked.map((r) => r.key)).toEqual(['early', 'late'])
  })

  test('full tie breaks on key ASC and does not mutate the input', () => {
    const input = [
      row({ key: 'b', severity: 'MEDIUM', spread: 1, order: 5 }),
      row({ key: 'a', severity: 'MEDIUM', spread: 1, order: 5 }),
    ]
    const ranked = rankGapRows(input)
    expect(ranked.map((r) => r.key)).toEqual(['a', 'b'])
    expect(input.map((r) => r.key)).toEqual(['b', 'a'])
  })
})

describe('unit — buildCategoryGapSummary (aggregated)', () => {
  const metadata: SummaryQuestionMeta[] = [
    meta({ key: 'isWaterSufficient', label: 'Sufficient water', gapLabel: 'Insufficient water', gapMeaning: 'Truck potable water', order: 1 }),
    meta({ key: 'hasFunctionalClinic', label: 'Functional clinic', gapLabel: 'No functional clinic', gapMeaning: 'Deploy mobile clinic', order: 2 }),
  ]

  test('spread counts reporting entities; severity is the MAX stored per-field severity', () => {
    const summary = buildCategoryGapSummary({
      assessments: [
        assessmentWith(['isWaterSufficient'], { isWaterSufficient: 'MEDIUM' }),
        assessmentWith(['isWaterSufficient', 'hasFunctionalClinic'], { isWaterSufficient: 'CRITICAL', hasFunctionalClinic: 'HIGH' }),
        assessmentWith([], {}),
      ],
      metadata,
      limit: 5,
      contentVersion: 7,
      computedAt: '2026-09-16T00:00:00.000Z',
    })

    const water = summary.rows.find((r) => r.key === 'isWaterSufficient')!
    const clinic = summary.rows.find((r) => r.key === 'hasFunctionalClinic')!
    expect(water.spread).toBe(2)
    expect(water.total).toBe(3) // reporting denominator includes the no-gap entity
    expect(water.severity).toBe('CRITICAL') // max(MEDIUM, CRITICAL)
    expect(clinic.spread).toBe(1)
    expect(clinic.severity).toBe('HIGH')
    expect(summary.totalGapRows).toBe(2)
    expect(summary.hasGaps).toBe(true)
    expect(summary.overallSeverity).toBe('CRITICAL') // max over rows
    expect(summary.stamp).toEqual({ contentVersion: 7, computedAt: '2026-09-16T00:00:00.000Z' })
  })

  test('label/meaning come from live metadata (gapLabel wins over label)', () => {
    const summary = buildCategoryGapSummary({
      assessments: [assessmentWith(['isWaterSufficient'], { isWaterSufficient: 'LOW' })],
      metadata,
      limit: 5,
    })
    const water = summary.rows[0]
    expect(water.label).toBe('Insufficient water')
    expect(water.meaning).toBe('Truck potable water')
    expect(water.order).toBe(1)
  })

  test('registry rename is reflected immediately (metadata beats the stored row label)', () => {
    const summary = buildCategoryGapSummary({
      assessments: [
        assessmentWith(['isWaterSufficient'], { isWaterSufficient: 'LOW' }, [
          { key: 'isWaterSufficient', gapLabel: 'Old stored label' },
        ]),
      ],
      metadata: [meta({ key: 'isWaterSufficient', label: 'Sufficient water', gapLabel: 'Renamed gap label', order: 1 })],
      limit: 5,
    })
    expect(summary.rows[0].label).toBe('Renamed gap label')
  })

  test('keys absent from the live set fall back: stored gapLabel → stored label → key; meaning null; order +Infinity', () => {
    const summary = buildCategoryGapSummary({
      assessments: [
        assessmentWith(
          ['deactivatedKey', 'labelOnlyKey', 'orphanKey'],
          { deactivatedKey: 'HIGH', labelOnlyKey: 'MEDIUM', orphanKey: 'LOW' },
          [
            { key: 'deactivatedKey', gapLabel: 'Stored gap label', label: 'Stored plain label' },
            { key: 'labelOnlyKey', label: 'Stored plain label' },
            { key: 'orphanKey' }, // stored row without any label
          ]
        ),
      ],
      metadata: [], // registry projection has none of these keys anymore
      limit: 5,
    })

    const byKey = new Map(summary.rows.map((r) => [r.key, r]))
    expect(byKey.get('deactivatedKey')!.label).toBe('Stored gap label')
    expect(byKey.get('labelOnlyKey')!.label).toBe('Stored plain label')
    expect(byKey.get('orphanKey')!.label).toBe('orphanKey')
    for (const row of summary.rows) {
      expect(row.meaning).toBeNull()
      expect(row.order).toBe(Number.POSITIVE_INFINITY)
    }
    // all three share order +Infinity and severity ranks decide the order
    expect(summary.rows.map((r) => r.key)).toEqual(['deactivatedKey', 'labelOnlyKey', 'orphanKey'])
  })

  test('zero-gap summary collapses: hasGaps false, overallSeverity LOW, no hidden rows or hint', () => {
    const summary = buildCategoryGapSummary({
      assessments: [assessmentWith([], {}), assessmentWith([], {})],
      metadata,
      limit: 5,
      contentVersion: 3,
      computedAt: '2026-09-16T00:00:00.000Z',
    })
    expect(summary.rows).toEqual([])
    expect(summary.totalGapRows).toBe(0)
    expect(summary.hiddenCount).toBe(0)
    expect(summary.hiddenSeverityHint).toBeNull()
    expect(summary.hasGaps).toBe(false)
    expect(summary.overallSeverity).toBe('LOW')
  })

  test('overflow rows are carried; hint = highest hidden severity + count at that severity', () => {
    // 7 gapped keys: 2 CRITICAL (orders 1,2), 3 HIGH (orders 3,4,5), 2 MEDIUM (orders 6,7)
    const keys = [
      ['c1', 'CRITICAL', 1], ['c2', 'CRITICAL', 2],
      ['h3', 'HIGH', 3], ['h4', 'HIGH', 4], ['h5', 'HIGH', 5],
      ['m6', 'MEDIUM', 6], ['m7', 'MEDIUM', 7],
    ] as const
    const metadata: SummaryQuestionMeta[] = keys.map(([key, , order]) =>
      meta({ key, label: key, gapLabel: key, order })
    )
    const severityMap = Object.fromEntries(keys.map(([key, severity]) => [key, severity]))

    const summary = buildCategoryGapSummary({
      assessments: [assessmentWith(keys.map(([key]) => key), severityMap)],
      metadata,
      limit: 5,
    })

    expect(summary.rows).toHaveLength(7) // every overflow row is carried
    expect(summary.totalGapRows).toBe(7)
    expect(summary.hiddenCount).toBe(2)
    expect(summary.hiddenSeverityHint).toEqual({ severity: 'MEDIUM', count: 2 })
    expect(summary.rows.slice(0, 5).map((r) => r.key)).toEqual(['c1', 'c2', 'h3', 'h4', 'h5'])
    expect(summary.rows.slice(5).map((r) => r.key)).toEqual(['m6', 'm7'])
  })

  test('limit is itself clamped (99 stored rows still slice at the 7-row ceiling)', () => {
    const keys = Array.from({ length: 99 }, (_, i) => `key${String(i).padStart(2, '0')}`)
    const summary = buildCategoryGapSummary({
      assessments: [assessmentWith(keys, Object.fromEntries(keys.map((key) => [key, 'HIGH'])))],
      metadata: keys.map((key, index) => meta({ key, label: key, gapLabel: key, order: index + 1 })),
      limit: 99, // resolved to the ceiling of 7
    })
    expect(summary.hiddenCount).toBe(92)
    expect(summary.hiddenSeverityHint).toEqual({ severity: 'HIGH', count: 92 })
  })

  test('missing/invalid stored shapes never throw and contribute no gaps', () => {
    const summary = buildCategoryGapSummary({
      assessments: [{ gapAnalysis: null }, { gapAnalysis: undefined }, {}, { gapAnalysis: { gapFields: null } }],
      metadata,
      limit: 5,
    })
    expect(summary.hasGaps).toBe(false)
    expect(summary.rows).toEqual([])
  })
})

describe('unit — buildIndividualGapSummary (individual-entity cards)', () => {
  const metadata: SummaryQuestionMeta[] = [
    meta({ key: 'hasMedicineSupply', label: 'Medicine supply', gapLabel: 'No medicine supply', gapMeaning: 'Restock essential medicines', order: 4 }),
    meta({ key: 'isWaterSufficient', label: 'Sufficient water', gapLabel: 'Insufficient water', gapMeaning: 'Truck potable water', order: 1 }),
    meta({ key: 'hasLighting', label: 'Lighting', gapLabel: 'No lighting', gapMeaning: 'Install solar lighting', order: 9 }),
  ]

  test('spread is constant 1 and ranking degrades to severity × order', () => {
    const summary = buildIndividualGapSummary(
      {
        hasGap: true,
        gapFields: ['hasMedicineSupply', 'isWaterSufficient', 'hasLighting'],
        severity: 'CRITICAL',
        recommendations: [],
        fieldSeverityMap: { hasMedicineSupply: 'CRITICAL', isWaterSufficient: 'CRITICAL', hasLighting: 'MEDIUM' },
        rows: [],
        unanswered: [],
      },
      metadata,
      5
    )

    expect(summary.rows.map((r) => r.key)).toEqual(['isWaterSufficient', 'hasMedicineSupply', 'hasLighting'])
    for (const row of summary.rows) {
      expect(row.spread).toBe(1)
      expect(row.total).toBe(1)
    }
    expect(summary.overallSeverity).toBe('CRITICAL')
  })

  test('no stamp on individual summaries', () => {
    const summary = buildIndividualGapSummary(
      { hasGap: true, gapFields: ['hasLighting'], severity: 'MEDIUM', recommendations: [], fieldSeverityMap: { hasLighting: 'MEDIUM' }, rows: [], unanswered: [] },
      metadata,
      5
    )
    expect(summary.stamp).toBeUndefined()
  })

  test('same limit/chip contract as aggregates', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const summary = buildIndividualGapSummary(
      {
        hasGap: true,
        gapFields: keys,
        severity: 'HIGH',
        recommendations: [],
        fieldSeverityMap: Object.fromEntries(keys.map((key) => [key, 'HIGH'])),
        rows: [],
        unanswered: [],
      },
      keys.map((key, index) => meta({ key, label: key, gapLabel: key, order: index + 1 })),
      5
    )
    expect(summary.hiddenCount).toBe(3)
    expect(summary.hiddenSeverityHint).toEqual({ severity: 'HIGH', count: 3 })
  })

  test('null/undefined stored gapAnalysis collapses to a zero-gap summary', () => {
    for (const gapAnalysis of [null, undefined]) {
      const summary = buildIndividualGapSummary(gapAnalysis, metadata, 5)
      expect(summary.hasGaps).toBe(false)
      expect(summary.overallSeverity).toBe('LOW')
    }
  })
})
