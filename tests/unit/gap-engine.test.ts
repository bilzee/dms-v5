import {
  analyzeGaps,
  normalizeGapSeverity,
  type GapEngineRegistryRow,
  type GapEngineSnapshotStructure,
} from '@/lib/questions/gap-engine'

/**
 * Unit — the P3 pure gap engine (no I/O, no mocks).
 *
 * Pins the derivation contract from the spec's I/O matrix:
 * - gap condition is STRICTLY `inverted ? answers[key] === true : answers[key] === false`
 * - missing answers (undefined/null) are flagged `unanswered`, never gaps
 * - assessment severity = MAX over gapped fields (LOW when none)
 * - severity ladder: registry row (isActive-agnostic) → snapshot severity → MEDIUM
 * - POPULATION-like structures (zero GAP questions) derive LOW via the same rule
 * - gap surfaces ordered severity DESC then presentation order ASC
 * - output is a pure, byte-identical function of its inputs
 *
 * P5 unknown rows (offline drift): answered keys absent from the snapshot
 * SELF-DERIVE source-'unknown' informational rows — never in gapFields,
 * severity, fieldSeverityMap or recommendations (intersection only), so
 * re-derivation passes reproduce them byte-for-byte.
 */

const structure: GapEngineSnapshotStructure = {
  sections: [
    {
      order: 1,
      questions: [
        {
          key: 'hasFunctionalClinic',
          label: 'Functional health clinic',
          category: 'GAP',
          inverted: false,
          gapLabel: 'No functional clinic',
          recommendation: 'Deploy mobile clinic',
          order: 1,
        },
        {
          key: 'hasOpenDefecationConcerns',
          label: 'Open defecation concerns',
          category: 'GAP',
          inverted: true,
          gapLabel: 'Open defecation concerns',
          recommendation: 'Construct emergency latrines',
          order: 2,
        },
        {
          key: 'areOvercrowded',
          label: 'Overcrowding',
          category: 'GAP',
          inverted: true,
          gapLabel: 'Site overcrowded',
          recommendation: null,
          order: 3,
        },
        { key: 'numberHealthFacilities', label: '# facilities', category: 'CONTEXT', order: 4 },
      ],
    },
    {
      order: 2,
      questions: [
        {
          key: 'isWaterSufficient',
          label: 'Sufficient water',
          category: 'GAP',
          inverted: false,
          gapLabel: 'Insufficient water',
          recommendation: 'Truck potable water',
          order: 1,
        },
      ],
    },
  ],
}

const registryRows: GapEngineRegistryRow[] = [
  { questionKey: 'hasFunctionalClinic', severity: 'CRITICAL' },
  { questionKey: 'hasOpenDefecationConcerns', severity: 'MEDIUM' },
  { questionKey: 'areOvercrowded', severity: 'MEDIUM' },
  { questionKey: 'isWaterSufficient', severity: 'HIGH' },
  // Deliberately NO row for keys used in the unmapped tests below.
]

describe('unit — pure gap engine (analyzeGaps)', () => {
  test('non-inverted question answered false is a gap; answered true is not', () => {
    const gap = analyzeGaps(structure, { hasFunctionalClinic: false }, registryRows)
    expect(gap.hasGap).toBe(true)
    expect(gap.gapFields).toEqual(['hasFunctionalClinic'])
    expect(gap.severity).toBe('CRITICAL')

    const noGap = analyzeGaps(structure, { hasFunctionalClinic: true }, registryRows)
    expect(noGap.hasGap).toBe(false)
    expect(noGap.gapFields).toEqual([])
    expect(noGap.severity).toBe('LOW')
  })

  test('inverted questions gap on true, not false', () => {
    const gap = analyzeGaps(structure, { hasOpenDefecationConcerns: true }, registryRows)
    expect(gap.gapFields).toEqual(['hasOpenDefecationConcerns'])

    const noGap = analyzeGaps(structure, { hasOpenDefecationConcerns: false }, registryRows)
    expect(noGap.gapFields).toEqual([])
  })

  test('non-boolean answers are never gaps (strict boolean comparison)', () => {
    const result = analyzeGaps(
      structure,
      { hasFunctionalClinic: 'false', isWaterSufficient: 0, hasOpenDefecationConcerns: 'true' },
      registryRows
    )
    expect(result.hasGap).toBe(false)
    expect(result.gapFields).toEqual([])
    // the three non-boolean answers count as ANSWERED (not null/undefined);
    // only the never-provided key is flagged unanswered
    expect(result.unanswered).toEqual(['areOvercrowded'])
  })

  test('missing answers are flagged unanswered, never scored as gaps', () => {
    for (const missing of [undefined, null]) {
      const result = analyzeGaps(structure, { hasFunctionalClinic: missing }, registryRows)
      expect(result.hasGap).toBe(false)
      expect(result.severity).toBe('LOW')
      expect(result.gapFields).toEqual([])
      expect(result.unanswered).toEqual([
        'hasFunctionalClinic',
        'hasOpenDefecationConcerns',
        'areOvercrowded',
        'isWaterSufficient',
      ])
      const clinicRow = result.rows.find((row) => row.key === 'hasFunctionalClinic')
      expect(clinicRow?.unanswered).toBe(true)
      expect(clinicRow?.severity).toBe('CRITICAL') // ladder still resolves
    }
  })

  test('empty answers → hasGap false, severity LOW, all GAP rows unanswered', () => {
    const result = analyzeGaps(structure, {}, registryRows)
    expect(result.hasGap).toBe(false)
    expect(result.severity).toBe('LOW')
    expect(result.gapFields).toEqual([])
    expect(result.recommendations).toEqual([])
    expect(result.unanswered).toEqual([
      'hasFunctionalClinic',
      'hasOpenDefecationConcerns',
      'areOvercrowded',
      'isWaterSufficient',
    ])
    expect(result.rows).toHaveLength(4) // CONTEXT question excluded
    expect(result.rows.every((row) => row.unanswered)).toBe(true)
  })

  test('assessment severity is the MAX of gapped fields', () => {
    const allGapped = analyzeGaps(
      structure,
      { hasFunctionalClinic: false, hasOpenDefecationConcerns: true, areOvercrowded: true, isWaterSufficient: false },
      registryRows
    )
    expect(allGapped.severity).toBe('CRITICAL')
    expect(allGapped.fieldSeverityMap).toEqual({
      hasFunctionalClinic: 'CRITICAL',
      isWaterSufficient: 'HIGH',
      hasOpenDefecationConcerns: 'MEDIUM',
      areOvercrowded: 'MEDIUM',
    })

    const mediumOnly = analyzeGaps(structure, { areOvercrowded: true }, registryRows)
    expect(mediumOnly.severity).toBe('MEDIUM')
  })

  test('gaps are ordered severity DESC, then presentation order ASC (section → question order)', () => {
    const result = analyzeGaps(
      structure,
      { hasOpenDefecationConcerns: true, areOvercrowded: true, isWaterSufficient: false, hasFunctionalClinic: false },
      registryRows
    )
    expect(result.gapFields).toEqual([
      'hasFunctionalClinic', // CRITICAL
      'isWaterSufficient', // HIGH (section 2)
      'hasOpenDefecationConcerns', // MEDIUM, section 1 order 2
      'areOvercrowded', // MEDIUM, section 1 order 3
    ])
    // recommendations follow the same order, null recommendations dropped
    expect(result.recommendations).toEqual([
      'Deploy mobile clinic',
      'Truck potable water',
      'Construct emergency latrines',
    ])
  })

  test('severity ladder: live registry row wins (isActive-agnostic), snapshot severity is the dormant rung, unmapped floors at MEDIUM', () => {
    // 1. registry row (severity CRITICAL) beats a snapshot severity of LOW
    const fromRegistry = analyzeGaps(
      {
        sections: [
          {
            questions: [
              { key: 'k', category: 'GAP', inverted: false, severity: 'LOW', order: 1 },
            ],
          },
        ],
      },
      { k: false },
      [{ questionKey: 'k', severity: 'CRITICAL' }]
    )
    expect(fromRegistry.severity).toBe('CRITICAL')
    expect(fromRegistry.rows[0].source).toBe('registry')

    // 2. no registry row → snapshot severity (dormant rung, future snapshots)
    const fromSnapshot = analyzeGaps(
      {
        sections: [
          {
            questions: [
              { key: 'k', category: 'GAP', inverted: false, severity: 'HIGH', order: 1 },
            ],
          },
        ],
      },
      { k: false },
      []
    )
    expect(fromSnapshot.severity).toBe('HIGH')
    expect(fromSnapshot.rows[0].source).toBe('snapshot')

    // 3. neither → unmapped with MEDIUM
    const unmapped = analyzeGaps(
      {
        sections: [
          {
            questions: [{ key: 'k', category: 'GAP', inverted: false, order: 1 }],
          },
        ],
      },
      { k: false },
      [{ questionKey: 'other' }]
    )
    expect(unmapped.severity).toBe('MEDIUM')
    expect(unmapped.rows[0].source).toBe('unmapped')
  })

  test('an unmatched registry row is ignored (intersection semantics)', () => {
    const result = analyzeGaps(
      structure,
      { hasFunctionalClinic: false },
      [...registryRows, { questionKey: 'ghostKey', severity: 'CRITICAL' }]
    )
    expect(result.gapFields).toEqual(['hasFunctionalClinic'])
    expect(result.rows).toHaveLength(4) // no fabricated ghost row
  })

  test('registry rows with unknown severities floor at MEDIUM, never LOW', () => {
    const result = analyzeGaps(
      structure,
      { hasFunctionalClinic: false },
      [{ questionKey: 'hasFunctionalClinic', severity: 'UNCLASSIFIED' }]
    )
    expect(result.severity).toBe('MEDIUM')
    expect(result.rows[0].severity).toBe('MEDIUM')
    expect(normalizeGapSeverity(undefined)).toBe('MEDIUM')
    expect(normalizeGapSeverity('LOW')).toBe('LOW')
  })

  test('a structure with zero GAP questions derives LOW through the same rule (POPULATION)', () => {
    const populationStructure: GapEngineSnapshotStructure = {
      sections: [
        {
          order: 1,
          questions: [
            { key: 'totalPopulation', label: 'Population', category: 'CONTEXT', order: 1 },
            { key: 'numberLivesLost', label: 'Lives lost', category: 'CONTEXT', order: 2 },
          ],
        },
      ],
    }
    const result = analyzeGaps(populationStructure, { totalPopulation: 5000, numberLivesLost: 3 }, [
      { questionKey: 'totalPopulation', severity: 'CRITICAL' },
    ])
    expect(result.hasGap).toBe(false)
    expect(result.gapFields).toEqual([])
    expect(result.severity).toBe('LOW')
    expect(result.rows).toEqual([])
    expect(result.unanswered).toEqual([])
  })

  test('rows carry the exact spec shape and fall back to key as label', () => {
    const result = analyzeGaps(structure, { hasFunctionalClinic: false }, registryRows)
    const row = result.rows.find((r) => r.key === 'hasFunctionalClinic')
    expect(row).toBeDefined()
    expect(Object.keys(row!).sort()).toEqual(
      ['gapLabel', 'key', 'label', 'recommendation', 'severity', 'source', 'unanswered'].sort()
    )
    expect(row).toMatchObject({
      key: 'hasFunctionalClinic',
      label: 'Functional health clinic',
      gapLabel: 'No functional clinic',
      severity: 'CRITICAL',
      source: 'registry',
      recommendation: 'Deploy mobile clinic',
      unanswered: false,
    })

    const noLabel = analyzeGaps(
      { sections: [{ questions: [{ key: 'bare', category: 'GAP', inverted: false, order: 1 }] }] },
      { bare: false },
      []
    )
    expect(noLabel.rows[0].label).toBe('bare')
  })

  test('degenerate structures (null/undefined/empty) derive LOW without throwing', () => {
    for (const degenerate of [null, undefined, {}, { sections: [] }, { sections: [{ questions: [] }] }]) {
      const result = analyzeGaps(degenerate as GapEngineSnapshotStructure, { any: false }, registryRows)
      expect(result.hasGap).toBe(false)
      expect(result.severity).toBe('LOW')
      // no structure → the answered key self-derives one informational row
      expect(result.rows.map((row) => row.key)).toEqual(['any'])
      expect(result.rows[0].source).toBe('unknown')
      expect(result.rows[0].severity).toBe('MEDIUM') // no registry row for 'any'
    }
  })

  test('pure: identical inputs produce byte-identical output', () => {
    const answers = {
      hasFunctionalClinic: false,
      hasOpenDefecationConcerns: true,
      areOvercrowded: true,
      isWaterSufficient: false,
    }
    const first = analyzeGaps(structure, answers, registryRows)
    const second = analyzeGaps(structure, answers, registryRows)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })
})

describe('unit — pure gap engine unknown-source rows (P5 offline ingestion)', () => {
  test('answered keys absent from the snapshot self-derive unknown rows that are NEVER scored', () => {
    const result = analyzeGaps(
      structure,
      { hasFunctionalClinic: true, mysteryKey: false, anotherKey: true },
      registryRows
    )
    // intersection only — unknowns never gap, never score, never recommend
    expect(result.gapFields).toEqual([])
    expect(result.hasGap).toBe(false)
    expect(result.severity).toBe('LOW')
    expect(result.fieldSeverityMap).toEqual({})
    expect(result.recommendations).toEqual([])
    const row = result.rows.find((r) => r.key === 'mysteryKey')
    expect(row).toMatchObject({
      key: 'mysteryKey',
      label: 'mysteryKey',
      gapLabel: null,
      severity: 'MEDIUM', // no registry row → MEDIUM floor
      source: 'unknown',
      recommendation: null,
      unanswered: false,
    })
    // unknown rows append AFTER the mapped rows, in answers order
    expect(result.rows.map((r) => r.key)).toEqual([
      'hasFunctionalClinic',
      'hasOpenDefecationConcerns',
      'areOvercrowded',
      'isWaterSufficient',
      'mysteryKey',
      'anotherKey',
    ])
    // unknown rows are never flagged unanswered; only never-answered GAP keys are
    expect(result.unanswered).toEqual([
      'hasOpenDefecationConcerns',
      'areOvercrowded',
      'isWaterSufficient',
    ])
  })

  test('unknown rows resolve severity from a registry row when one exists (else MEDIUM)', () => {
    const result = analyzeGaps(
      structure,
      { mysteryKey: false },
      [...registryRows, { questionKey: 'mysteryKey', severity: 'HIGH' }]
    )
    const row = result.rows.find((r) => r.key === 'mysteryKey')
    expect(row?.source).toBe('unknown')
    expect(row?.severity).toBe('HIGH')
    // severity on the row is informational only — scoring stays intersection-only
    expect(result.gapFields).toEqual([])
    expect(result.severity).toBe('LOW')
    expect(result.fieldSeverityMap).toEqual({})
  })

  test('snapshot-present keys (any category) and null/undefined/empty answers never derive unknown rows', () => {
    const result = analyzeGaps(
      structure,
      { numberHealthFacilities: 5, ghostA: null, ghostB: undefined, '': 'x', hasFunctionalClinic: true },
      registryRows
    )
    expect(result.rows.filter((r) => r.source === 'unknown')).toEqual([])
    expect(result.rows).toHaveLength(4) // the four mapped GAP rows only
  })

  test('real gaps and unknown rows coexist without unknowns affecting order or severity', () => {
    const answers = { hasFunctionalClinic: false, mysteryKey: true, areOvercrowded: true }
    const result = analyzeGaps(structure, answers, registryRows)
    expect(result.gapFields).toEqual(['hasFunctionalClinic', 'areOvercrowded'])
    expect(result.severity).toBe('CRITICAL') // max over gapped intersection only
    expect(result.rows.slice(-1)[0]).toMatchObject({ key: 'mysteryKey', source: 'unknown' })
    // self-derived (not caller-reported): re-derivation is byte-identical, so
    // recompute passes (triggerGapAnalysis, severity recompute) reproduce them
    expect(JSON.stringify(analyzeGaps(structure, answers, registryRows))).toBe(JSON.stringify(result))
  })
})
