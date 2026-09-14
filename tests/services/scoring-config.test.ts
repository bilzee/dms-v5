import {
  getScoringConfig,
  saveScoringConfig,
  getDefaultConfig,
  invalidateScoringConfigCache,
} from '@/lib/services/scoring-config.service'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * Service integration — scoring config persistence (real drms_test).
 * Pure validation rules are covered in tests/unit/scoring-config.test.ts;
 * this suite pins the DB round-trip: defaults, overrides, and cache.
 */

const cleanSection = () => testDb.systemSetting.deleteMany({ where: { section: 'scoring' } })

describe('services — scoring-config persistence (real DB)', () => {
  beforeAll(async () => {
    await truncateTestDb()
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  afterEach(async () => {
    await cleanSection()
    invalidateScoringConfigCache()
  })

  test('no persisted rows → defaults are returned', async () => {
    const config = await getScoringConfig()
    expect(config).toEqual(getDefaultConfig())
  })

  test('saveScoringConfig persists every key and getScoringConfig serves the overrides', async () => {
    const custom = {
      ...getDefaultConfig(),
      deliveryWeight: 40,
      speedWeight: 30,
      valueWeight: 20,
      consistencyWeight: 10,
      speedZeroScoreHours: 48,
      valueCurrency: 'USD',
    }
    await saveScoringConfig(custom, 'admin-user')

    const rows = await testDb.systemSetting.findMany({ where: { section: 'scoring' } })
    expect(rows).toHaveLength(9) // every config key persisted

    // saveScoringConfig invalidates its own cache — read-through must see new values
    const loaded = await getScoringConfig()
    expect(loaded.deliveryWeight).toBe(40)
    expect(loaded.speedZeroScoreHours).toBe(48)
    expect(loaded.valueCurrency).toBe('USD')
  })

  test('saving a config twice upserts instead of duplicating rows', async () => {
    const config = getDefaultConfig()
    await saveScoringConfig(config, 'admin-user')
    await saveScoringConfig({ ...config, speedPenaltyRate: 50 }, 'admin-user')
    const rows = await testDb.systemSetting.findMany({ where: { section: 'scoring' } })
    expect(rows).toHaveLength(9)
    expect((await getScoringConfig()).speedPenaltyRate).toBe(50)
  })

  test('invalid config is rejected before anything is persisted', async () => {
    const before = await testDb.systemSetting.count({ where: { section: 'scoring' } })
    await expect(
      saveScoringConfig({ ...getDefaultConfig(), deliveryWeight: 200 }, 'admin-user')
    ).rejects.toThrow(/Delivery weight|sum to 100/)
    const after = await testDb.systemSetting.count({ where: { section: 'scoring' } })
    expect(after).toBe(before)
  })

  test('garbage DB values are ignored in favor of defaults', async () => {
    await testDb.systemSetting.create({
      data: { section: 'scoring', key: 'deliveryWeight', value: 'not-a-number' },
    })
    await testDb.systemSetting.create({
      data: { section: 'scoring', key: 'valueCurrency', value: 'WAY_TOO_LONG_CURRENCY_CODE' },
    })
    const config = await getScoringConfig()
    expect(config.deliveryWeight).toBe(60)
    expect(config.valueCurrency).toBe('NGN')
  })

  test('string numbers from the DB are coerced into real numbers', async () => {
    await testDb.systemSetting.create({
      data: { section: 'scoring', key: 'valueCap', value: '5' },
    })
    const config = await getScoringConfig()
    expect(config.valueCap).toBe(5)
  })
})
