import {
  ingestOfflineAnswers,
  normalizeAnswerValues,
  snapshotQuestionKeys,
  toAnswerNormalizationFlags,
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

  test('P10-4 (4a): unparseable MULTI_SELECT replays surface in unparsedKeys', () => {
    const flagged = ingestOfflineAnswers(
      type,
      { commonHealthIssues: 'not json', hasFunctionalClinic: true, areOvercrowded: true },
      snapshot,
      registryRows
    )
    expect(flagged.unparsedKeys).toEqual(['commonHealthIssues'])

    const clean = ingestOfflineAnswers(
      type,
      { commonHealthIssues: '["Malaria"]', hasFunctionalClinic: true, areOvercrowded: true },
      snapshot,
      registryRows
    )
    expect(clean.unparsedKeys).toEqual([])
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
      expect(empty).toEqual({ answers: {}, warnings: { added: [], removed: [], unknown: [] }, unparsedKeys: [] })
    }
  })

  test('pure: identical inputs produce identical output', () => {
    const answers = { hasFunctionalClinic: false, deactivatedQuestion: 1, mysteryKey: [], commonHealthIssues: [], areOvercrowded: true }
    expect(JSON.stringify(ingestOfflineAnswers(type, answers, snapshot, registryRows)))
      .toBe(JSON.stringify(ingestOfflineAnswers(type, answers, snapshot, registryRows)))
  })
})

describe('unit — normalizeAnswerValues (P10-4 4a transport boundary)', () => {
  const types = new Map<string, string>([
    ['commonHealthIssues', 'MULTI_SELECT'],
    ['hasFunctionalClinic', 'BOOLEAN'],
  ])

  test('MULTI_SELECT JSON-string replays normalize to clean string arrays', () => {
    const result = normalizeAnswerValues(
      { commonHealthIssues: '["Malaria","Measles"]', hasFunctionalClinic: true },
      types
    )
    expect(result).toEqual({
      answers: { commonHealthIssues: ['Malaria', 'Measles'], hasFunctionalClinic: true },
      unparsedKeys: [],
    })
  })

  test('unparseable / non-string-array MULTI_SELECT stays verbatim + flagged', () => {
    for (const bad of ['not json', '"just a string"', '[1, 2]', '[]ok']) {
      const result = normalizeAnswerValues({ commonHealthIssues: bad }, types)
      expect(result.answers.commonHealthIssues).toBe(bad)
      expect(result.unparsedKeys).toEqual(['commonHealthIssues'])
    }
  })

  test('non-MULTI_SELECT strings and already-array values pass through untouched', () => {
    const result = normalizeAnswerValues(
      { hasFunctionalClinic: 'true', commonHealthIssues: ['Malaria'] },
      types
    )
    expect(result).toEqual({
      answers: { hasFunctionalClinic: 'true', commonHealthIssues: ['Malaria'] },
      unparsedKeys: [],
    })
  })

  test('null/undefined drop; keys outside the type map pass through unflagged; empty input derives empty', () => {
    expect(normalizeAnswerValues({ a: null, b: undefined, c: 0 }, types)).toEqual({
      answers: { c: 0 },
      unparsedKeys: [],
    })
    expect(normalizeAnswerValues(null, types)).toEqual({ answers: {}, unparsedKeys: [] })
    expect(normalizeAnswerValues(undefined, new Map())).toEqual({ answers: {}, unparsedKeys: [] })
    const unknownKey = normalizeAnswerValues({ mystery: '[1]' }, types)
    expect(unknownKey.answers.mystery).toBe('[1]')
    expect(unknownKey.unparsedKeys).toEqual([])
  })

  test('idempotent: normalizing an already-normalized map is a no-op', () => {
    const once = normalizeAnswerValues({ commonHealthIssues: '["Malaria"]' }, types)
    const twice = normalizeAnswerValues(once.answers, types)
    expect(twice).toEqual(once)
  })
})

describe('unit — toAnswerNormalizationFlags (P10-4 4a additive gapAnalysis flags)', () => {
  test('maps unparsed keys to flag rows; empty input derives empty', () => {
    expect(toAnswerNormalizationFlags(['commonHealthIssues'])).toEqual([
      {
        key: 'commonHealthIssues',
        message: expect.stringContaining('commonHealthIssues'),
      },
    ])
    expect(toAnswerNormalizationFlags([])).toEqual([])
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
