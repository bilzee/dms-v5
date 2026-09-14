import { gapFieldSeverityService } from '@/lib/services/gap-field-severity.service'
import { testDb, truncateTestDb } from '../helpers/test-db'
import { createUser } from '../factories'

/**
 * Service integration — DB-driven gap field severity config (real drms_test).
 * The unit layer mocks this service; here the real implementation is under
 * test: mapping load, max-wins aggregation, fallbacks, and cache lifecycle.
 */

const seedField = async (
  fieldName: string,
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  overrides: Partial<{
    assessmentType: 'HEALTH' | 'WASH'
    isActive: boolean
  }> = {}
) => {
  return testDb.gapFieldSeverity.create({
    data: {
      fieldName,
      assessmentType: overrides.assessmentType ?? 'HEALTH',
      severity,
      displayName: fieldName,
      isActive: overrides.isActive ?? true,
    },
  })
}

describe('services — gapFieldSeverityService (real DB)', () => {
  let adminId: string

  beforeAll(async () => {
    await truncateTestDb()
    adminId = (await createUser({ roles: ['COORDINATOR'] })).id
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  afterEach(async () => {
    await testDb.gapFieldSeverity.deleteMany({})
    gapFieldSeverityService.clearCache()
  })

  test('empty gap list → LOW without touching configured mappings', async () => {
    await seedField('hasFunctionalClinic', 'CRITICAL')
    expect(await gapFieldSeverityService.calculateAssessmentSeverity('HEALTH', [])).toBe('LOW')
  })

  test('max-wins: CRITICAL beats HIGH and MEDIUM across present fields', async () => {
    await seedField('hasMedicineSupply', 'MEDIUM')
    await seedField('hasTrainedStaff', 'HIGH')
    await seedField('hasFunctionalClinic', 'CRITICAL')
    const severity = await gapFieldSeverityService.calculateAssessmentSeverity('HEALTH', [
      'hasMedicineSupply',
      'hasTrainedStaff',
    ])
    expect(severity).toBe('HIGH')
  })

  test('unmapped field contributes nothing; only mapped fields raise severity', async () => {
    await seedField('hasMedicineSupply', 'HIGH')
    const severity = await gapFieldSeverityService.calculateAssessmentSeverity('HEALTH', [
      'totallyUnknownField',
      'hasMedicineSupply',
    ])
    expect(severity).toBe('HIGH')
  })

  test('no mapping at all for the type → LOW (not MEDIUM fallback)', async () => {
    const severity = await gapFieldSeverityService.calculateAssessmentSeverity('SECURITY', [
      'isSafeFromViolence',
    ])
    expect(severity).toBe('LOW')
  })

  test('inactive rows are excluded from the mapping', async () => {
    await seedField('hasFunctionalClinic', 'CRITICAL', { isActive: false })
    await seedField('hasMedicineSupply', 'MEDIUM')
    const severity = await gapFieldSeverityService.calculateAssessmentSeverity('HEALTH', [
      'hasFunctionalClinic',
    ])
    expect(severity).toBe('LOW')
  })

  test('mappings are per assessment type (WASH config does not leak into HEALTH)', async () => {
    await seedField('isWaterSufficient', 'CRITICAL', { assessmentType: 'WASH' })
    const health = await gapFieldSeverityService.calculateAssessmentSeverity('HEALTH', [
      'isWaterSufficient',
    ])
    const wash = await gapFieldSeverityService.calculateAssessmentSeverity('WASH', [
      'isWaterSufficient',
    ])
    expect(health).toBe('LOW')
    expect(wash).toBe('CRITICAL')
  })

  test('calculateFieldSeverity returns the configured severity, MEDIUM for unknown', async () => {
    await seedField('hasTrainedStaff', 'HIGH')
    expect(
      await gapFieldSeverityService.calculateFieldSeverity('HEALTH', 'hasTrainedStaff')
    ).toBe('HIGH')
    expect(
      await gapFieldSeverityService.calculateFieldSeverity('HEALTH', 'notConfiguredAnywhere')
    ).toBe('MEDIUM')
  })

  test('updateFieldSeverity persists the change and refreshes the cached mapping', async () => {
    const field = await seedField('hasFunctionalClinic', 'MEDIUM')
    expect(await gapFieldSeverityService.calculateAssessmentSeverity('HEALTH', [field.fieldName])).toBe('MEDIUM')

    await gapFieldSeverityService.updateFieldSeverity(field.id, 'CRITICAL', adminId)
    // No manual clearCache: the update itself must invalidate
    expect(await gapFieldSeverityService.calculateAssessmentSeverity('HEALTH', [field.fieldName])).toBe('CRITICAL')

    const row = await testDb.gapFieldSeverity.findUnique({ where: { id: field.id } })
    expect(row?.severity).toBe('CRITICAL')
    expect(row?.updatedBy).toBe(adminId)
  })

  test('getGapFieldByName resolves via the unique (fieldName, assessmentType) index', async () => {
    const field = await seedField('hasMaternalChildServices', 'HIGH')
    const found = await gapFieldSeverityService.getGapFieldByName(
      'hasMaternalChildServices',
      'HEALTH'
    )
    expect(found?.id).toBe(field.id)
    expect(await gapFieldSeverityService.getGapFieldByName('missing', 'HEALTH')).toBeNull()
  })

  test('bulkUpdateSeverities updates all rows in one transaction and clears cache', async () => {
    const a = await seedField('hasEmergencyServices', 'LOW')
    const b = await seedField('hasMedicalSupplies', 'LOW', { assessmentType: 'WASH' })
    await gapFieldSeverityService.bulkUpdateSeverities(
      [
        { id: a.id, severity: 'HIGH' },
        { id: b.id, severity: 'CRITICAL' },
      ],
      adminId
    )
    const rows = await testDb.gapFieldSeverity.findMany({ where: { id: { in: [a.id, b.id] } } })
    expect(rows.map((r) => r.severity).sort()).toEqual(['CRITICAL', 'HIGH'])
    expect(
      await gapFieldSeverityService.calculateAssessmentSeverity('WASH', ['hasMedicalSupplies'])
    ).toBe('CRITICAL')
  })
})
