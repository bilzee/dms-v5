/**
 * DQR P10-5 round-trip proof — verifies that a FRESH seed from the folded
 * QUESTION_CATALOG reproduces the governed polish: the 8 polished labels are
 * present and every type's version counters are 1/1 (fresh-seed baseline, i.e.
 * the polish is now the catalog, not a runtime edit).
 *
 * Usage:
 *   npx cross-env DATABASE_URL=postgresql://...drms_e2e... node dqr-p10-5-roundtrip-check.mjs
 */
import { PrismaClient } from '@prisma/client'

const url = process.env.DATABASE_URL || ''
if (!/drms_[a-z0-9]+(\?|$)/.test(url)) {
  console.error(`Refusing: DATABASE_URL must target a drms_* database (got "${url}")`)
  process.exit(1)
}

const EXPECTED_LABELS = {
  'FOOD:isFoodSufficient': 'Sufficient Food',
  'FOOD:hasInfantNutrition': 'Available Infant Nutrition',
  'WASH:isWaterSufficient': 'Sufficient Water',
  'WASH:areLatrinesSufficient': 'Sufficient Latrines',
  'WASH:hasHandwashingFacilities': 'Available Handwashing Facilities',
  'SHELTER:areSheltersSufficient': 'Sufficient Shelters',
  'SECURITY:vulnerableGroupsHaveAccess': 'Vulnerable Groups Access',
}

const TYPES = ['HEALTH', 'FOOD', 'WASH', 'SHELTER', 'SECURITY', 'POPULATION']
const REGISTRY_VERSION_SECTION = 'QUESTION_REGISTRY'

const db = new PrismaClient()
let failures = 0

try {
  console.log(`=== DQR P10-5 round-trip check against ${url.match(/drms_[a-z0-9]+/)?.[0] ?? url} ===`)

  for (const [id, expected] of Object.entries(EXPECTED_LABELS)) {
    const q = await db.question.findUnique({ where: { id }, select: { label: true } })
    const ok = q?.label === expected
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} label = "${q?.label}" (expected "${expected}")`)
    if (!ok) failures += 1
  }

  const waterSource = await db.question.findUnique({
    where: { id: 'WASH:waterSource' },
    select: { options: true },
  })
  const river = (waterSource?.options ?? []).find((o) => o?.value === 'River/Stream')
  const riverOk = river?.label === 'River / Stream'
  console.log(
    `${riverOk ? 'PASS' : 'FAIL'} WASH:waterSource option value "River/Stream" frozen, label "${river?.label}" (expected "River / Stream")`
  )
  if (!riverOk) failures += 1

  for (const type of TYPES) {
    const [s, c] = await Promise.all([
      db.systemSetting.findUnique({
        where: { section_key: { section: REGISTRY_VERSION_SECTION, key: `structureVersion/${type}` } },
        select: { value: true },
      }),
      db.systemSetting.findUnique({
        where: { section_key: { section: REGISTRY_VERSION_SECTION, key: `contentVersion/${type}` } },
        select: { value: true },
      }),
    ])
    const ok = s?.value === 1 && c?.value === 1
    console.log(`${ok ? 'PASS' : 'FAIL'} ${type} versions = ${s?.value}/${c?.value} (expected 1/1 fresh-seed baseline)`)
    if (!ok) failures += 1
  }

  console.log(failures === 0 ? '=== ROUND-TRIP GREEN ===' : `=== ${failures} CHECK(S) FAILED ===`)
  process.exitCode = failures === 0 ? 0 : 1
} finally {
  await db.$disconnect()
}
