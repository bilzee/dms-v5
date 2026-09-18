import { exec } from 'child_process'
import { resolve } from 'path'
import type { AssessmentType } from '@prisma/client'
import { analyzeGaps } from '@/lib/questions/gap-engine'
import { testDb, truncateTestDb, disconnectTestDb } from '../helpers/test-db'

/**
 * DQR P9 — pins the seed partition contract (production-safe default vs
 * `--with-sample-data`).
 *
 * The default seed MUST NOT create incidents, assessments, donors,
 * commitments, or demo/E2E users — it is documented as safe to run against a
 * fresh production database. The flag form additionally creates the demo
 * world. This test runs both seed forms as real child processes (exactly what
 * an operator/CI runs) against drms_test and asserts the resulting row
 * partition, so a future seed edit that leaks sample data into the default
 * path fails here instead of in production.
 *
 * Runs in the api suite (maxWorkers: 1, shared drms_test). It truncates the
 * database twice; every other api suite bootstraps its own fixtures from an
 * empty database in beforeAll, so mid-run truncation is the established
 * contract (see jest.api.config.js).
 */

jest.setTimeout(300_000)

const REPO_ROOT = resolve(__dirname, '..', '..')

function runSeed(extraArgs: string[] = []): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    // SEED_WITH_SAMPLE_DATA is pinned off so ambient env cannot flip the
    // default run; the flag run relies on argv alone.
    const env = { ...process.env, SEED_WITH_SAMPLE_DATA: '' }
    exec(
      `npx tsx prisma/seed.ts${extraArgs.length ? ` ${extraArgs.join(' ')}` : ''}`,
      { cwd: REPO_ROOT, env, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(new Error(`Seed failed (${extraArgs.join(' ') || 'default'}): ${error.message}\n${stdout}\n${stderr}`))
          return
        }
        resolvePromise()
      }
    )
  })
}

const registrySettingCount = () =>
  testDb.systemSetting.count({ where: { section: 'QUESTION_REGISTRY' } })

beforeAll(async () => {
  await truncateTestDb()
})

afterAll(async () => {
  // Leave an empty database for whatever suite runs next.
  await truncateTestDb()
  await disconnectTestDb()
})

describe('seed partition (P9 production-safe baseline vs --with-sample-data)', () => {
  test('default seed is production-safe: no incidents/assessments/donors/commitments, no demo users', async () => {
    await runSeed()

    expect(await testDb.incident.count()).toBe(0)
    expect(await testDb.rapidAssessment.count()).toBe(0)
    expect(await testDb.donor.count()).toBe(0)
    expect(await testDb.donorCommitment.count()).toBe(0)

    // Exactly the two operator accounts — no demo/E2E users.
    const userEmails = (await testDb.user.findMany({ select: { email: true } })).map((u) => u.email)
    expect(userEmails).toEqual(
      expect.arrayContaining(['admin@dms.gov.ng', 'coordinator@dms.gov.ng'])
    )
    expect(userEmails).toHaveLength(2)
    expect(userEmails).not.toContain('assessor@test.com')

    // The registry baseline is present in both partitions.
    expect(await testDb.question.count()).toBe(55)
    expect(await testDb.questionSection.count()).toBe(27)
    expect(await registrySettingCount()).toBe(12)
  })

  test('--with-sample-data additionally seeds the demo world', async () => {
    await runSeed(['--with-sample-data'])

    expect(await testDb.incident.count()).toBe(2)
    expect(await testDb.rapidAssessment.count()).toBe(5)
    expect(await testDb.donor.count()).toBe(4)
    expect(await testDb.donorCommitment.count()).toBe(4)
    expect(await testDb.user.count()).toBe(7)

    // Registry untouched by the sample-data branch.
    expect(await testDb.question.count()).toBe(55)
    expect(await registrySettingCount()).toBe(12)

    // P10-1: every seeded assessment's stored gapAnalysis is EXACTLY the
    // engine's derivation from that row's frozen questionSnapshot + answers
    // (severities resolved against the seeded registry rows), and its
    // priority is the derivation's severity. A seed edit that hand-writes or
    // drifts from the engine fails here instead of at read time.
    const seeded = await testDb.rapidAssessment.findMany({
      select: {
        rapidAssessmentType: true,
        questionSnapshot: true,
        answers: true,
        gapAnalysis: true,
        priority: true,
      },
    })
    expect(seeded).toHaveLength(5)
    for (const row of seeded) {
      const registryRows = await testDb.question.findMany({
        where: { assessmentType: row.rapidAssessmentType as AssessmentType },
        select: { questionKey: true, severity: true },
      })
      const derived = analyzeGaps(
        row.questionSnapshot as unknown as Parameters<typeof analyzeGaps>[0],
        (row.answers ?? {}) as Record<string, unknown>,
        registryRows
      )
      expect(row.gapAnalysis).toEqual(derived)
      expect(row.priority).toBe(derived.severity)
    }

    // P10-1 derivation matrix (plan §3 2d): the demo world must exercise both
    // derivation outcomes — gap-fired (MEDIUM) and clean (LOW) — pinned per
    // fixture. NOTE: the plan's parenthetical ("at least one CRITICAL, one
    // HIGH, one MEDIUM") is unachievable against the seeded catalog: every GAP
    // question in QUESTION_CATALOG carries severity MEDIUM (verified
    // 2026-09-18), so no fixture can derive CRITICAL/HIGH; widening the
    // severity spread is Tier A catalog authoring deferred to the P10-5
    // polish pass. Pinning the exact deterministic matrix still catches the
    // failure mode the ledger names (an argument swap in prisma/seed.ts
    // derivation wiring would seed all-LOW or scrambled demo priorities).
    const matrix = Object.fromEntries(
      seeded.map((row) => [row.rapidAssessmentType, row.priority as string])
    )
    expect(matrix).toEqual({
      HEALTH: 'MEDIUM',
      WASH: 'MEDIUM',
      SHELTER: 'LOW',
      FOOD: 'MEDIUM',
      SECURITY: 'MEDIUM',
    })
  })
})
