import {
  ingestOfflineAnswers,
  snapshotQuestionKeys,
  toOfflineSyncWarnings,
  type OfflineRegistryRow,
} from '@/lib/questions/offline-answers'
import type { RapidAssessmentType } from '@/lib/questions/answers'

/**
 * Unit — P5 offline answer ingestion (pure, no I/O, no mocks).
 *
 * Never-reject semantics (spec): every non-null answer persists verbatim;
 * drift is classified into warnings —
 * - added   = active registry keys absent from answers
 * - removed = answered keys whose registry row is inactive
 * - unknown = answered keys with no registry row at all
 * MULTI_SELECT JSON-string replays normalize to arrays; anything not safely
 * coercible is kept verbatim.
 */

const type = 'HEALTH' as RapidAssessmentType

const snapshot = {
  sections: [
    {
      order: 1,
      questions: [
        { key: 'hasFunctionalClinic', type: 'BOOLEAN' },
        { key: 'commonHealthIssues', type: 'MULTI_SELECT' },
      ],
    },
    {
      order: 2,
      questions: [{ key: 'areOvercrowded', type: 'BOOLEAN' }],
    },
  ],
}

const registryRows: OfflineRegistryRow[] = [
  { questionKey: 'hasFunctionalClinic', isActive: true },
  { questionKey: 'commonHealthIssues', isActive: true },
  { questionKey: 'areOvercrowded', isActive: true },
  { questionKey: 'deactivatedQuestion', isActive: false },
]

describe('unit — snapshotQuestionKeys', () => {
  test('extracts question keys in presentation order and tolerates degenerate shapes', () => {
    expect(snapshotQuestionKeys(snapshot)).toEqual([
      'hasFunctionalClinic',
      'commonHealthIssues',
      'areOvercrowded',
    ])
    for (const degenerate of [null, undefined, {}, { sections: [] }, { sections: [{ questions: [] }] }]) {
      expect(snapshotQuestionKeys(degenerate as never)).toEqual([])
    }
  })
})

describe('unit — ingestOfflineAnswers', () => {
  test('answered active keys pass through verbatim with no warnings', () => {
    const result = ingestOfflineAnswers(
      type,
      { hasFunctionalClinic: false, commonHealthIssues: ['Malaria'], areOvercrowded: true },
      snapshot,
      registryRows
    )
    expect(result.answers).toEqual({
      hasFunctionalClinic: false,
      commonHealthIssues: ['Malaria'],
      areOvercrowded: true,
    })
    expect(result.warnings).toEqual({ added: [], removed: [], unknown: [] })
  })

  test('MULTI_SELECT JSON-string replays normalize to arrays; garbage stays verbatim', () => {
    const result = ingestOfflineAnswers(
      type,
      {
        commonHealthIssues: '["Malaria","Measles"]',
        hasFunctionalClinic: true,
        areOvercrowded: true,
      },
      snapshot,
      registryRows
    )
    expect(result.answers.commonHealthIssues).toEqual(['Malaria', 'Measles'])

    const unparseable = ingestOfflineAnswers(
      type,
      { commonHealthIssues: 'not json', hasFunctionalClinic: true, areOvercrowded: true },
      snapshot,
      registryRows
    )
    expect(unparseable.answers.commonHealthIssues).toBe('not json')

    const nonArray = ingestOfflineAnswers(
      type,
      { commonHealthIssues: '"just a string"', hasFunctionalClinic: true, areOvercrowded: true },
      snapshot,
      registryRows
    )
    expect(nonArray.answers.commonHealthIssues).toBe('"just a string"')

    // A parseable-but-non-string array is NOT safely coercible — filtering it
    // in place would silently discard captured values, so it stays verbatim.
    const numericArray = ingestOfflineAnswers(
      type,
      { commonHealthIssues: '[1, 2]', hasFunctionalClinic: true, areOvercrowded: true },
      snapshot,
      registryRows
    )
    expect(numericArray.answers.commonHealthIssues).toBe('[1, 2]')
  })

  test('removed: answered keys with an inactive registry row are retained + warned', () => {
    const result = ingestOfflineAnswers(
      type,
      { hasFunctionalClinic: false, deactivatedQuestion: 'yes', commonHealthIssues: [], areOvercrowded: true },
      snapshot,
      registryRows
    )
    // Verbatim retention — never discarded (ruling 7).
    expect(result.answers).toEqual({
      hasFunctionalClinic: false,
      deactivatedQuestion: 'yes',
      commonHealthIssues: [],
      areOvercrowded: true,
    })
    expect(result.warnings.removed).toEqual(['deactivatedQuestion'])
    expect(result.warnings.unknown).toEqual([])
  })

  test('unknown: answered keys with no registry row are retained + warned', () => {
    const result = ingestOfflineAnswers(
      type,
      { hasFunctionalClinic: false, mysteryKey: 42, commonHealthIssues: [], areOvercrowded: true },
      snapshot,
      registryRows
    )
    expect(result.answers).toEqual({
      hasFunctionalClinic: false,
      mysteryKey: 42,
      commonHealthIssues: [],
      areOvercrowded: true,
    })
    expect(result.warnings.unknown).toEqual(['mysteryKey'])
    expect(result.warnings.removed).toEqual([])
  })

  test('added: active registry keys absent from answers are warned (documented proxy)', () => {
    const result = ingestOfflineAnswers(
      type,
      { hasFunctionalClinic: false, commonHealthIssues: [] },
      snapshot,
      registryRows
    )
    expect(result.answers).toEqual({ hasFunctionalClinic: false, commonHealthIssues: [] })
    expect(result.warnings.added).toEqual(['areOvercrowded'])
    expect(result.warnings.removed).toEqual([])
    expect(result.warnings.unknown).toEqual([])
  })

  test('null/undefined values are never materialized; degenerate inputs derive empty', () => {
    const result = ingestOfflineAnswers(
      type,
      { hasFunctionalClinic: null, commonHealthIssues: undefined },
      snapshot,
      registryRows
    )
    expect(result.answers).toEqual({})
    expect(result.warnings).toEqual({ added: ['hasFunctionalClinic', 'commonHealthIssues', 'areOvercrowded'], removed: [], unknown: [] })

    for (const degenerate of [null, undefined]) {
      const empty = ingestOfflineAnswers(type, degenerate, degenerate, degenerate)
      expect(empty).toEqual({ answers: {}, warnings: { added: [], removed: [], unknown: [] } })
    }
  })

  test('pure: identical inputs produce identical output', () => {
    const answers = { hasFunctionalClinic: false, deactivatedQuestion: 1, mysteryKey: [], commonHealthIssues: [], areOvercrowded: true }
    expect(JSON.stringify(ingestOfflineAnswers(type, answers, snapshot, registryRows)))
      .toBe(JSON.stringify(ingestOfflineAnswers(type, answers, snapshot, registryRows)))
  })
})

describe('unit — toOfflineSyncWarnings', () => {
  test('maps the three buckets to warning records', () => {
    const records = toOfflineSyncWarnings('assessment-1', type, {
      added: ['isWaterSufficient'],
      removed: ['legacyQuestion'],
      unknown: ['mysteryKey'],
    })
    expect(records).toEqual([
      {
        assessmentId: 'assessment-1',
        key: 'isWaterSufficient',
        type: 'added',
        message: expect.stringContaining('isWaterSufficient'),
      },
      {
        assessmentId: 'assessment-1',
        key: 'legacyQuestion',
        type: 'removed',
        message: expect.stringContaining('legacyQuestion'),
      },
      {
        assessmentId: 'assessment-1',
        key: 'mysteryKey',
        type: 'unknown',
        message: expect.stringContaining('mysteryKey'),
      },
    ])
    expect(records.every((record) => record.message.includes('HEALTH'))).toBe(true)
  })
})
