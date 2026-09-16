import {
  buildQuestionSnapshot,
  RegistryQuestionRow,
  QuestionSnapshot,
} from '@/lib/questions/question-snapshot'
import type { RegistryVersions } from '@/lib/questions/registry-versions'
import {
  QUESTION_CATALOG,
  ASSESSMENT_TYPES,
  deriveQuestionId,
  deriveSectionId,
  CatalogAssessmentType,
  QuestionDef,
} from '@/lib/questions/registry-validation'

/**
 * Unit — question snapshot projection (spec: "snapshot projection (severity
 * absent; all 6 types)").
 *
 * `buildQuestionSnapshot` receives the structural subset of registry Question
 * rows (with their section relation) and must freeze a structure-only copy:
 * every presentation + gap-metadata field projected, `severity` deliberately
 * excluded (severity is a live registry derivation, never frozen). Rows are
 * derived from the real QUESTION_CATALOG so expectations track the catalog.
 */

/** Distinct non-1 values so echoing is provable, not coincidental. */
const VERSIONS: RegistryVersions = { structureVersion: 3, contentVersion: 7 }

function catalogEntry(assessmentType: CatalogAssessmentType) {
  return QUESTION_CATALOG.find((c) => c.assessmentType === assessmentType)!
}

/** Builds registry Question-row-shaped fixtures from the real catalog. */
function rowsForType(assessmentType: CatalogAssessmentType): RegistryQuestionRow[] {
  const rows: RegistryQuestionRow[] = []
  for (const section of catalogEntry(assessmentType).sections) {
    section.questions.forEach((question, index) => {
      rows.push({
        id: deriveQuestionId(assessmentType, question.questionKey),
        questionKey: question.questionKey,
        questionType: question.questionType,
        label: question.label,
        helperText: question.helperText ?? null,
        required: question.required,
        options: question.options ?? null,
        category: question.category,
        inverted: question.inverted ?? false,
        gapLabel: question.gapLabel ?? null,
        gapMeaning: question.gapMeaning ?? null,
        recommendation: question.recommendation ?? null,
        severity: question.severity ?? 'LOW',
        numberMin: question.numberMin ?? null,
        numberMax: question.numberMax ?? null,
        order: index + 1,
        sectionId: deriveSectionId(assessmentType, section.sectionKey),
        section: {
          sectionKey: section.sectionKey,
          title: section.title,
          description: section.description ?? null,
          category: section.category,
          order: section.order,
        },
      })
    })
  }
  return rows
}

function snapshotFor(assessmentType: CatalogAssessmentType): QuestionSnapshot {
  return buildQuestionSnapshot(rowsForType(assessmentType), VERSIONS)
}

function allSnapshotQuestions(snapshot: QuestionSnapshot) {
  return snapshot.sections.flatMap((section) => section.questions)
}

function findCatalogQuestion(
  assessmentType: CatalogAssessmentType,
  questionKey: string
): QuestionDef {
  for (const section of catalogEntry(assessmentType).sections) {
    const question = section.questions.find((q) => q.questionKey === questionKey)
    if (question) return question
  }
  throw new Error(`${assessmentType}/${questionKey} not found in catalog`)
}

describe('unit — question snapshot projection (all six assessment types)', () => {
  ASSESSMENT_TYPES.forEach((assessmentType) => {
    describe(`${assessmentType} snapshot`, () => {
      const entry = catalogEntry(assessmentType)
      const snapshot = snapshotFor(assessmentType)

      test('envelope echoes the registry versions and stamps generatedAt', () => {
        expect(snapshot.structureVersion).toBe(3)
        expect(snapshot.contentVersion).toBe(7)
        expect(Number.isNaN(Date.parse(snapshot.generatedAt))).toBe(false)
      })

      test('one snapshot section per catalog section, ordered by section order', () => {
        expect(snapshot.sections).toHaveLength(entry.sections.length)
        const orders = snapshot.sections.map((s) => s.order)
        expect(orders).toEqual([...orders].sort((a, b) => a - b))
        expect(snapshot.sections.map((s) => s.key)).toEqual(
          entry.sections.map((s) => s.sectionKey)
        )
        expect(snapshot.sections.map((s) => s.id)).toEqual(
          entry.sections.map((s) => deriveSectionId(assessmentType, s.sectionKey))
        )
      })

      test('questions follow catalog presentation order within each section', () => {
        snapshot.sections.forEach((section, index) => {
          const catalogKeys = entry.sections[index].questions.map((q) => q.questionKey)
          expect(section.questions.map((q) => q.key)).toEqual(catalogKeys)
          const orders = section.questions.map((q) => q.order)
          expect(orders).toEqual([...orders].sort((a, b) => a - b))
        })
      })

      test('structure fields are projected verbatim (id/key/label/type/required/options/…)', () => {
        const byKey = new Map(allSnapshotQuestions(snapshot).map((q) => [q.key, q]))
        for (const section of entry.sections) {
          for (const catalogQuestion of section.questions) {
            const projected = byKey.get(catalogQuestion.questionKey)!
            expect(projected.id).toBe(deriveQuestionId(assessmentType, catalogQuestion.questionKey))
            expect(projected.label).toBe(catalogQuestion.label)
            expect(projected.helperText).toBe(catalogQuestion.helperText ?? null)
            expect(projected.type).toBe(catalogQuestion.questionType)
            expect(projected.required).toBe(catalogQuestion.required)
            expect(projected.options).toEqual(catalogQuestion.options ?? null)
            expect(projected.category).toBe(catalogQuestion.category)
            expect(projected.inverted).toBe(catalogQuestion.inverted ?? false)
            expect(projected.gapLabel).toBe(catalogQuestion.gapLabel ?? null)
            expect(projected.gapMeaning).toBe(catalogQuestion.gapMeaning ?? null)
            expect(projected.recommendation).toBe(catalogQuestion.recommendation ?? null)
            expect(projected.numberMin).toBe(catalogQuestion.numberMin ?? null)
            expect(projected.numberMax).toBe(catalogQuestion.numberMax ?? null)
          }
        }
      })

      test('severity is absent from every projected question', () => {
        for (const section of snapshot.sections) {
          for (const question of section.questions) {
            expect(Object.keys(question)).not.toContain('severity')
          }
        }
        // Belt and braces: severity must not leak anywhere in the serialized snapshot
        expect(JSON.stringify(snapshot)).not.toMatch(/"severity"/)
      })

      test('GAP questions freeze their gap metadata; CONTEXT questions project nulls', () => {
        for (const section of snapshot.sections) {
          for (const question of section.questions) {
            if (question.category === 'GAP') {
              expect(question.gapLabel).toEqual(expect.any(String))
              expect(question.gapMeaning).toEqual(expect.any(String))
              expect(question.recommendation).toEqual(expect.any(String))
            } else {
              expect(question.gapLabel).toBeNull()
              expect(question.gapMeaning).toBeNull()
              expect(question.recommendation).toBeNull()
            }
          }
        }
      })
    })
  })

  test('the three inverted catalog questions keep inverted=true in their snapshots', () => {
    const inverted: Array<[CatalogAssessmentType, string]> = [
      ['WASH', 'hasOpenDefecationConcerns'],
      ['SHELTER', 'areOvercrowded'],
      ['SECURITY', 'gbvCasesReported'],
    ]
    for (const [type, key] of inverted) {
      const question = allSnapshotQuestions(snapshotFor(type)).find((q) => q.key === key)!
      expect(question.inverted).toBe(true)
    }
    // …and no non-inverted catalog question flips to true
    for (const type of ASSESSMENT_TYPES) {
      for (const question of allSnapshotQuestions(snapshotFor(type))) {
        const catalogQuestion = findCatalogQuestion(type, question.key)
        if (!(catalogQuestion.inverted ?? false)) {
          expect(question.inverted).toBe(false)
        }
      }
    }
  })

  describe('ordering is imposed by the projection, not inherited from input', () => {
    test('reversed row input still yields an ordered snapshot', () => {
      const rows = rowsForType('HEALTH').reverse()
      const snapshot = buildQuestionSnapshot(rows, VERSIONS)
      expect(snapshot.sections.map((s) => s.key)).toEqual(
        catalogEntry('HEALTH').sections.map((s) => s.sectionKey)
      )
      snapshot.sections.forEach((section) => {
        const orders = section.questions.map((q) => q.order)
        expect(orders).toEqual([...orders].sort((a, b) => a - b))
      })
    })

    test('rows without a section relation fall back to a synthetic section keyed by sectionId', () => {
      const rows = rowsForType('HEALTH').map((row) => ({ ...row, section: null }))
      const snapshot = buildQuestionSnapshot(rows, VERSIONS)
      expect(snapshot.sections).toHaveLength(catalogEntry('HEALTH').sections.length)
      snapshot.sections.forEach((section, index) => {
        expect(section.id).toBe(deriveSectionId('HEALTH', catalogEntry('HEALTH').sections[index].sectionKey))
        // Fallback titles degrade to the sectionId but grouping is preserved
        expect(section.title).toBe(section.id)
        expect(section.questions.length).toBe(catalogEntry('HEALTH').sections[index].questions.length)
      })
    })

    test('an orphan sectionId collects into one trailing synthetic section', () => {
      const rows = rowsForType('FOOD')
      const orphan: RegistryQuestionRow = {
        ...rows[0],
        id: 'FOOD:orphanQuestion',
        questionKey: 'orphanQuestion',
        sectionId: 'FOOD:orphan-section',
        section: null,
        order: 1,
      }
      const snapshot = buildQuestionSnapshot([orphan, ...rows], VERSIONS)
      const last = snapshot.sections[snapshot.sections.length - 1]
      expect(last.id).toBe('FOOD:orphan-section')
      expect(last.title).toBe('FOOD:orphan-section')
      expect(last.questions).toHaveLength(1)
      expect(last.questions[0].key).toBe('orphanQuestion')
      // The real sections still lead, in order
      expect(snapshot.sections[0].key).toBe(catalogEntry('FOOD').sections[0].sectionKey)
    })
  })
})
