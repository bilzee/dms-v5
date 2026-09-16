import {
  applyDraftMigration,
  restoreOfflineDraft,
  DRAFTS_STORAGE_KEY,
  type NormalizedDraftData,
} from '@/lib/questions/draft-migration'
import { questionKeysForType } from '@/lib/questions/answers'
import type { RapidAssessmentType } from '@/lib/questions/answers'

/**
 * Unit — P5 offline draft migration (restoreOfflineDraft is pure/DOM-free;
 * applyDraftMigration's default writer targets the drafts-hook localStorage).
 *
 * Two stored shapes:
 * - LEGACY (typed forms, pre-p1): `data` IS the answers map (flat fields,
 *   meta keys excluded), no answers wrapper → legacy: true
 * - REGISTRY: `data.answers` wrapper, optional structureVersion/questionKeys
 *
 * Keys map BY QUESTION KEY against the CURRENT snapshot; snapshot-absent
 * keys are UNMAPPED — never hydrated, but KEPT under unmappedAnswers
 * (never dropped, values preserved). structureVersion defaults to 1 and
 * questionKeys falls back to questionKeysForType for legacy drafts.
 */

const type = 'HEALTH' as RapidAssessmentType

const snapshot = {
  sections: [
    {
      order: 1,
      questions: [
        { key: 'hasFunctionalClinic' },
        { key: 'isWaterSufficient' },
        { key: 'numberHealthFacilities' },
      ],
    },
  ],
}

describe('unit — restoreOfflineDraft (pure)', () => {
  test('legacy flat draft: data is the answers map, meta keys excluded, defaults applied', () => {
    const restored = restoreOfflineDraft(type, snapshot, {
      id: 'draft_1',
      assessmentType: 'HEALTH',
      data: {
        hasFunctionalClinic: false,
        goneQuestion: 'kept verbatim',
        assessorName: 'Field Officer',
        rapidAssessmentDate: '2026-01-01',
        photos: ['a.jpg'],
        gpsLocation: { latitude: 1 },
        answers: 'not-a-wrapper',
      } as Record<string, unknown>,
    })
    expect(restored.legacy).toBe(true)
    expect(restored.structureVersion).toBe(1)
    expect(restored.questionKeys).toEqual(questionKeysForType(type))
    expect(restored.answers).toEqual({ hasFunctionalClinic: false })
    // unmapped answers keep their values — never dropped, never hydrated
    expect(restored.unmappedAnswers).toEqual([{ key: 'goneQuestion', value: 'kept verbatim' }])
    expect(restored.carried).toBe(1)
  })

  test('registry-era draft passes structureVersion/questionKeys through and maps by key', () => {
    const restored = restoreOfflineDraft(type, snapshot, {
      id: 'draft_2',
      assessmentType: 'HEALTH',
      data: {
        answers: { isWaterSufficient: false, laterRemoved: 42 },
        structureVersion: 7,
        questionKeys: ['isWaterSufficient', 'laterRemoved'],
      },
    })
    expect(restored.legacy).toBe(false)
    expect(restored.structureVersion).toBe(7)
    expect(restored.questionKeys).toEqual(['isWaterSufficient', 'laterRemoved'])
    expect(restored.answers).toEqual({ isWaterSufficient: false })
    expect(restored.unmappedAnswers).toEqual([{ key: 'laterRemoved', value: 42 }])
    expect(restored.carried).toBe(1)
  })

  test('null/undefined answer values never hydrate and never report unmapped', () => {
    const restored = restoreOfflineDraft(type, snapshot, {
      id: 'draft_3',
      assessmentType: 'HEALTH',
      data: { answers: { hasFunctionalClinic: null, isWaterSufficient: undefined, numberHealthFacilities: 3 } },
    })
    expect(restored.answers).toEqual({ numberHealthFacilities: 3 })
    expect(restored.unmappedAnswers).toEqual([])
    expect(restored.carried).toBe(1)

    for (const degenerate of [null, undefined, { id: 'x', data: null }, { id: 'x', data: { answers: 'nope' } }]) {
      const empty = restoreOfflineDraft(type, snapshot, degenerate as never)
      expect(empty.answers).toEqual({})
      expect(empty.unmappedAnswers).toEqual([])
      expect(empty.carried).toBe(0)
      expect(empty.structureVersion).toBe(1)
    }
  })

  test('re-migrating an already-migrated draft keeps the stored unmapped answers (idempotent)', () => {
    // First migration splits a registry draft into mapped + unmapped.
    const first = restoreOfflineDraft(type, snapshot, {
      id: 'draft_re',
      assessmentType: 'HEALTH',
      data: { answers: { isWaterSufficient: false, laterRemoved: 42 } },
    })
    expect(first.unmappedAnswers).toEqual([{ key: 'laterRemoved', value: 42 }])

    // The persisted normalized draft (data.answers already filtered; unmapped
    // stored separately) — what a reload-before-submit re-migrates.
    const second = restoreOfflineDraft(type, snapshot, {
      id: 'draft_re',
      assessmentType: 'HEALTH',
      data: {
        answers: first.answers,
        unmappedAnswers: first.unmappedAnswers,
        structureVersion: 1,
        questionKeys: ['isWaterSufficient', 'laterRemoved'],
      },
    })
    expect(second.answers).toEqual({ isWaterSufficient: false })
    // The previously stored unmapped answer SURVIVES the second migration —
    // never dropped (reload-before-submit is an everyday flow).
    expect(second.unmappedAnswers).toEqual([{ key: 'laterRemoved', value: 42 }])
    expect(second.carried).toBe(1)

    // Newly unmapped keys append to (not replace) the stored ones.
    const third = restoreOfflineDraft(type, snapshot, {
      id: 'draft_re',
      assessmentType: 'HEALTH',
      data: {
        answers: { isWaterSufficient: false, anotherGone: 'new' },
        unmappedAnswers: [{ key: 'laterRemoved', value: 42 }],
        structureVersion: 1,
        questionKeys: ['isWaterSufficient'],
      },
    })
    expect(third.unmappedAnswers).toEqual([
      { key: 'laterRemoved', value: 42 },
      { key: 'anotherGone', value: 'new' },
    ])
  })

  test('pure: identical inputs produce identical output', () => {
    const draft = {
      id: 'draft_4',
      assessmentType: 'HEALTH',
      data: { hasFunctionalClinic: false, gone: 'x', structureVersion: 2, questionKeys: ['a'] },
    }
    expect(JSON.stringify(restoreOfflineDraft(type, snapshot, draft)))
      .toBe(JSON.stringify(restoreOfflineDraft(type, snapshot, draft)))
  })
})

// tests/setup.ts mocks localStorage as bare jest.fn()s — back them with an
// in-memory map for the default-writer tests in this file.
function backLocalStorage() {
  const backing = new Map<string, string>()
  ;(window.localStorage.getItem as jest.Mock).mockImplementation((key: string) => backing.get(key) ?? null)
  ;(window.localStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => {
    backing.set(key, value)
  })
  ;(window.localStorage.removeItem as jest.Mock).mockImplementation((key: string) => backing.delete(key))
  return backing
}

describe('unit — applyDraftMigration', () => {
  test('custom migrate writer receives the normalized payload (unmapped KEPT, never dropped)', () => {
    const seen: NormalizedDraftData[] = []
    const restored = applyDraftMigration(
      { id: 'draft_5', assessmentType: 'HEALTH', data: { answers: { hasFunctionalClinic: false, gone: 1 } } },
      {
        assessmentType: type,
        snapshot,
        migrate: (normalized) => seen.push(normalized),
      }
    )
    expect(seen).toEqual([
      {
        answers: { hasFunctionalClinic: false },
        structureVersion: 1,
        questionKeys: questionKeysForType(type),
        unmappedAnswers: [{ key: 'gone', value: 1 }],
      },
    ])
    expect(restored.unmappedAnswers).toEqual([{ key: 'gone', value: 1 }])
  })

  test('default writer normalizes the draft inside the localStorage store (other data fields preserved)', () => {
    backLocalStorage()
    const draft = {
      id: 'draft_6',
      assessmentType: 'HEALTH',
      entityId: 'entity-1',
      incidentId: 'incident-1',
      timestamp: 123,
      autoSaved: true,
      data: { answers: { hasFunctionalClinic: false, goneQuestion: 'legacy' }, assessorName: 'Field Officer' },
    }
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify([draft]))

    const restored = applyDraftMigration(draft, { assessmentType: type, snapshot })

    expect(restored.unmappedAnswers).toEqual([{ key: 'goneQuestion', value: 'legacy' }])
    const stored = JSON.parse(window.localStorage.getItem(DRAFTS_STORAGE_KEY)!) as typeof draft[]
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe('draft_6')
    expect(stored[0].data).toEqual({
      assessorName: 'Field Officer',
      answers: { hasFunctionalClinic: false },
      structureVersion: 1,
      questionKeys: questionKeysForType(type),
      unmappedAnswers: [{ key: 'goneQuestion', value: 'legacy' }],
    })
    window.localStorage.removeItem(DRAFTS_STORAGE_KEY)
  })

  test('default writer tolerates a corrupted store and a missing draft record', () => {
    backLocalStorage()
    window.localStorage.setItem(DRAFTS_STORAGE_KEY, '{not json')
    expect(() =>
      applyDraftMigration(
        { id: 'draft_7', assessmentType: 'HEALTH', data: { answers: { hasFunctionalClinic: false } } },
        { assessmentType: type, snapshot }
      )
    ).not.toThrow()
    // corrupted store left untouched
    expect(window.localStorage.getItem(DRAFTS_STORAGE_KEY)).toBe('{not json')

    window.localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify([{ id: 'someone-else' }]))
    expect(() =>
      applyDraftMigration(
        { id: 'draft_8', assessmentType: 'HEALTH', data: { answers: { hasFunctionalClinic: false } } },
        { assessmentType: type, snapshot }
      )
    ).not.toThrow()
    // store untouched when the draft record is absent
    expect(JSON.parse(window.localStorage.getItem(DRAFTS_STORAGE_KEY)!)).toEqual([{ id: 'someone-else' }])
    window.localStorage.removeItem(DRAFTS_STORAGE_KEY)
  })
})
