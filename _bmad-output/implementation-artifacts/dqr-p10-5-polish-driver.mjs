/**
 * DQR P10-5 — governed Tier A catalog polish through the production admin API
 * (NOT a seed edit). Run against a dev server whose DATABASE_URL targets a
 * freshly baseline-seeded drms_* database.
 *
 * Sequence: login as seeded admin → snapshot versions for the 4 touched types
 * → 8 governed PUTs (7 question labels + 1 option-label copy edit with the
 * option VALUE frozen) → snapshot again → assert contentVersion bumped only
 * for the touched types, structureVersion untouched everywhere, labels landed.
 *
 * Usage: node dqr-p10-5-polish-driver.mjs [baseUrl=http://localhost:3101]
 */
const BASE = process.argv[2] || 'http://localhost:3101'

const REASON = 'DQR P10-5 catalog polish: normalize label to the Appendix A noun-phrase register (question-authoring-guide)'

const WATER_SOURCES = [
  { value: 'Borehole', label: 'Borehole', description: 'Groundwater extraction through borehole' },
  { value: 'River/Stream', label: 'River / Stream', description: 'Surface water from rivers or streams' },
  { value: 'Water trucks', label: 'Water Trucks', description: 'Trucked water supply' },
  { value: 'Tap water', label: 'Tap Water', description: 'Piped water supply system' },
  { value: 'Sachet water', label: 'Sachet Water', description: 'Commercially packaged water' },
  { value: 'Other', label: 'Other', description: 'Other water sources' },
]

const EDITS = [
  { type: 'FOOD', id: 'FOOD:isFoodSufficient', payload: { label: 'Sufficient Food', reason: REASON } },
  { type: 'FOOD', id: 'FOOD:hasInfantNutrition', payload: { label: 'Available Infant Nutrition', reason: REASON } },
  { type: 'WASH', id: 'WASH:isWaterSufficient', payload: { label: 'Sufficient Water', reason: REASON } },
  { type: 'WASH', id: 'WASH:areLatrinesSufficient', payload: { label: 'Sufficient Latrines', reason: REASON } },
  { type: 'WASH', id: 'WASH:hasHandwashingFacilities', payload: { label: 'Available Handwashing Facilities', reason: REASON } },
  { type: 'SHELTER', id: 'SHELTER:areSheltersSufficient', payload: { label: 'Sufficient Shelters', reason: REASON } },
  { type: 'SECURITY', id: 'SECURITY:vulnerableGroupsHaveAccess', payload: { label: 'Vulnerable Groups Access', reason: REASON } },
  {
    type: 'WASH',
    id: 'WASH:waterSource',
    payload: {
      options: WATER_SOURCES,
      reason: 'DQR P10-5 catalog polish: normalize River/Stream option display label (value frozen for stored-answer compatibility)',
    },
  },
]

const TOUCHED_TYPES = ['FOOD', 'WASH', 'SHELTER', 'SECURITY']
const UNTOUCHED_TYPES = ['HEALTH', 'POPULATION']

const EXPECTED_LABELS = {
  'FOOD:isFoodSufficient': 'Sufficient Food',
  'FOOD:hasInfantNutrition': 'Available Infant Nutrition',
  'WASH:isWaterSufficient': 'Sufficient Water',
  'WASH:areLatrinesSufficient': 'Sufficient Latrines',
  'WASH:hasHandwashingFacilities': 'Available Handwashing Facilities',
  'SHELTER:areSheltersSufficient': 'Sufficient Shelters',
  'SECURITY:vulnerableGroupsHaveAccess': 'Vulnerable Groups Access',
}

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

function questionsById(payload) {
  const map = new Map()
  for (const section of payload.sections || []) {
    for (const q of section.questions || []) map.set(q.id, q)
  }
  return map
}

async function readType(token, type) {
  const { status, json } = await api('GET', `/api/v1/questions?assessmentType=${type}`, token)
  if (status !== 200) throw new Error(`GET ${type} failed: ${status} ${JSON.stringify(json)}`)
  return json.data
}

async function waitForServer() {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@dms.gov.ng', password: 'admin123!' }),
      })
      if (res.status !== 0 && (res.ok || res.status === 400 || res.status === 401 || res.status === 429)) {
        return // server responding (any HTTP answer means it's up)
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 3_000))
  }
  throw new Error(`server at ${BASE} did not come up within 180s`)
}

async function main() {
  console.log(`=== DQR P10-5 governed catalog polish against ${BASE} ===`)
  await waitForServer()
  console.log('server responding')
  const login = await api('POST', '/api/v1/auth/login', null, {
    email: 'admin@dms.gov.ng',
    password: 'admin123!',
  })
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.json)}`)
  const token = login.json.data.token
  console.log(`login OK (admin@dms.gov.ng)`)

  const before = {}
  for (const type of [...TOUCHED_TYPES, ...UNTOUCHED_TYPES]) {
    const data = await readType(token, type)
    before[type] = { s: data.structureVersion, c: data.contentVersion }
  }
  console.log('versions BEFORE:', JSON.stringify(before))

  for (const edit of EDITS) {
    const { status, json } = await api('PUT', `/api/v1/admin/questions/${encodeURIComponent(edit.id)}`, token, edit.payload)
    const label = json?.data?.label
    const version = json?.data?.version
    const optLabel = json?.data?.options?.find((o) => o.value === 'River/Stream')?.label
    console.log(
      `PUT ${edit.id} -> ${status} label="${label}" version=${version}${optLabel ? ` option[River/Stream].label="${optLabel}"` : ''}`
    )
    if (status !== 200) throw new Error(`governed edit failed for ${edit.id}: ${JSON.stringify(json)}`)
  }

  let failures = 0
  const after = {}
  for (const type of [...TOUCHED_TYPES, ...UNTOUCHED_TYPES]) {
    const data = await readType(token, type)
    after[type] = { s: data.structureVersion, c: data.contentVersion }
  }
  console.log('versions AFTER: ', JSON.stringify(after))

  const editsPerType = EDITS.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1
    return acc
  }, {})

  for (const type of TOUCHED_TYPES) {
    const delta = editsPerType[type] || 0
    const ok = after[type].c === before[type].c + delta && after[type].s === before[type].s
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${type}: contentVersion ${before[type].c} -> ${after[type].c} (expected +${delta}: one bump per governed edit), structureVersion ${before[type].s} -> ${after[type].s} (expected unchanged)`
    )
    if (!ok) failures += 1
  }
  for (const type of UNTOUCHED_TYPES) {
    const ok = after[type].c === before[type].c && after[type].s === before[type].s
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${type} (untouched): ${before[type].c}/${before[type].s} -> ${after[type].c}/${after[type].s} (expected unchanged)`
    )
    if (!ok) failures += 1
  }

  const wash = await readType(token, 'WASH')
  const washMap = questionsById(wash)
  const river = washMap.get('WASH:waterSource')?.options?.find((o) => o.value === 'River/Stream')
  const riverOk = river?.label === 'River / Stream' && river?.value === 'River/Stream'
  console.log(`${riverOk ? 'PASS' : 'FAIL'} WASH:waterSource option value "River/Stream" frozen, label "${river?.label}"`)
  if (!riverOk) failures += 1

  for (const [id, expected] of Object.entries(EXPECTED_LABELS)) {
    const data = await readType(token, id.split(':')[0])
    const actual = questionsById(data).get(id)?.label
    const ok = actual === expected
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} label = "${actual}" (expected "${expected}")`)
    if (!ok) failures += 1
  }

  console.log(failures === 0 ? '=== POLISH EXERCISE GREEN ===' : `=== ${failures} CHECK(S) FAILED ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('FATAL:', err.message)
  process.exit(1)
})
