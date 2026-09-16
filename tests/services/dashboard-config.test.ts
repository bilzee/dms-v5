import {
  clearDashboardConfigCache,
  getGapRowsPerCategory,
} from '@/lib/services/dashboard-config.service'
import { testDb, truncateTestDb } from '../helpers/test-db'

/**
 * Service integration — DASHBOARD.gapRowsPerCategory reader (real drms_test).
 * Pure clamp rules are covered in tests/unit/gap-summary.test.ts; this suite
 * pins the DB round-trip: defaults, seeded values, clamping, garbage values,
 * and the TTL cache (P7 review VG4/BH10).
 */

const cleanSetting = () =>
  testDb.systemSetting.deleteMany({
    where: { section: 'DASHBOARD', key: 'gapRowsPerCategory' },
  })

describe('services — dashboard-config gapRowsPerCategory (real DB)', () => {
  beforeAll(async () => {
    await truncateTestDb()
  })

  afterAll(async () => {
    await truncateTestDb()
    await testDb.$disconnect()
  })

  afterEach(async () => {
    await cleanSetting()
    clearDashboardConfigCache()
  })

  test('no persisted row → §2.7 default 5', async () => {
    await expect(getGapRowsPerCategory()).resolves.toBe(5)
  })

  test('persisted number 3 is served', async () => {
    await testDb.systemSetting.create({
      data: { section: 'DASHBOARD', key: 'gapRowsPerCategory', value: 3 },
    })
    await expect(getGapRowsPerCategory()).resolves.toBe(3)
  })

  test('garbage value resolves to the default instead of throwing', async () => {
    await testDb.systemSetting.create({
      data: { section: 'DASHBOARD', key: 'gapRowsPerCategory', value: 'banana' },
    })
    await expect(getGapRowsPerCategory()).resolves.toBe(5)
  })

  test('values above the ceiling are clamped to 7', async () => {
    await testDb.systemSetting.create({
      data: { section: 'DASHBOARD', key: 'gapRowsPerCategory', value: 42 },
    })
    await expect(getGapRowsPerCategory()).resolves.toBe(7)
  })

  test('TTL cache serves the stale value until explicitly cleared', async () => {
    await testDb.systemSetting.create({
      data: { section: 'DASHBOARD', key: 'gapRowsPerCategory', value: 3 },
    })
    await expect(getGapRowsPerCategory()).resolves.toBe(3) // primes the cache

    await testDb.systemSetting.updateMany({
      where: { section: 'DASHBOARD', key: 'gapRowsPerCategory' },
      data: { value: 6 },
    })
    await expect(getGapRowsPerCategory()).resolves.toBe(3) // still cached

    clearDashboardConfigCache()
    await expect(getGapRowsPerCategory()).resolves.toBe(6)
  })
})
