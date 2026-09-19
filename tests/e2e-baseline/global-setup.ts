import { readFileSync } from 'fs'
import { resolve } from 'path'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { BASELINE_PASSWORD, BASELINE_USERS, E2E_FIXTURES } from './baseline-users'
import { seedQuestions } from '../../prisma/seed-questions'
import { seedCrossFieldRules } from '../../prisma/seed-rules'

/**
 * Playwright globalSetup for the E2E baseline suite.
 *
 * 1. Forces DATABASE_URL/JWT_SECRET from .env.test (overriding ambient env),
 *    then applies E2E_DATABASE_URL when set (P10-5: dedicated drms_e2e
 *    database, enabling concurrent runs with the api suite on drms_test),
 *    and hard-guards that the URL targets drms_test or drms_e2e.
 * 2. Truncates the target database and seeds roles + one user per golden-journey role
 *    (including ADMIN for the registry-editor surface), the question
 *    registry + the 15 seeded cross-field rules (the rules-admin-authoring
 *    spec edits a seeded rule through the real admin UI), one entity, one
 *    ACTIVE incident, and the assessor→entity assignment that submission
 *    authorization requires.
 *
 * Raw Prisma + bcrypt only — no '@/' aliased app imports (Playwright does not
 * apply tsconfig path aliases inside globalSetup). prisma/seed-questions.ts
 * is kept relative-import-only for exactly this reason.
 */

function forceEnvTestFile(): void {
  const envPath = resolve(__dirname, '..', '..', '.env.test')
  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/)
    if (match) {
      process.env[match[1]] = match[2]
    }
  }
}

export default async function globalSetup(): Promise<void> {
  forceEnvTestFile()

  // E2E_DATABASE_URL wins over .env.test so the suite can be pointed at the
  // dedicated drms_e2e database (webServer env in playwright.baseline.config.ts
  // applies the same selection for the dev server it spawns).
  if (process.env.E2E_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.E2E_DATABASE_URL
  }

  const databaseUrl = process.env.DATABASE_URL || ''
  if (!/(drms_test|drms_e2e)(\?|$)/.test(databaseUrl)) {
    throw new Error(
      `Refusing to run E2E baseline: DATABASE_URL must target drms_test or drms_e2e (got: "${databaseUrl}"). `
    )
  }

  const db = new PrismaClient()

  try {
    await db.$executeRawUnsafe(`
      DO $$ DECLARE r RECORD; BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE';
        END LOOP;
      END $$;
    `)

    const roleNames = ['ADMIN', 'COORDINATOR', 'ASSESSOR', 'RESPONDER', 'DONOR'] as const
    const roles: Record<string, { id: string }> = {}
    for (const name of roleNames) {
      const role = await db.role.upsert({
        where: { name },
        create: { name, description: `${name} role (E2E baseline)` },
        update: { description: `${name} role (E2E baseline)` },
      })
      roles[name] = role
    }

    const passwordHash = await bcrypt.hash(BASELINE_PASSWORD, 10)

    for (const [key, user] of Object.entries(BASELINE_USERS)) {
      const roleName = key.toUpperCase() as (typeof roleNames)[number]
      const created = await db.user.create({
        data: {
          email: user.email,
          username: `e2e_${key}_${Date.now()}`,
          passwordHash,
          name: user.name,
        },
      })
      await db.userRole.create({
        data: {
          userId: created.id,
          roleId: roles[roleName].id,
          assignedBy: created.id,
        },
      })
    }

    // Keep each user's id for the fixture wiring below (assignment + incident
    // createdBy must reference real rows).
    const seededUsers = await db.user.findMany({
      where: { email: { in: Object.values(BASELINE_USERS).map((u) => u.email) } },
      select: { id: true, email: true },
    })
    const assessor = seededUsers.find((u) => u.email === BASELINE_USERS.assessor.email)!
    const coordinator = seededUsers.find((u) => u.email === BASELINE_USERS.coordinator.email)!

    // Registry-driven assessment world: the live question catalog (all
    // severities at their seeded MEDIUM), one entity, one ACTIVE incident,
    // and the assessor→entity assignment. The fixture question's CRITICAL
    // severity is deliberately NOT pre-pinned here — the bottom-up spec's
    // admin leg sets it through the real editor so the whole chain (edit →
    // content bump → derived priority → rollup → notification) is exercised
    // against governance, not fixture surgery.
    await seedQuestions(db)
    // The seeded cross-field rules — same contract as the dev seeders
    // (deterministic ids, idempotent upserts, no version bumps). MUST run
    // after seedQuestions: the pre-write assertions resolve every rule's
    // referenceKeys against the ACTIVE questions of its type.
    await seedCrossFieldRules(db)

    await db.entity.create({
      data: {
        id: E2E_FIXTURES.entityId,
        name: 'P9 Registry Fixture Entity',
        type: 'COMMUNITY',
        location: 'E2E Baseline Location',
        coordinates: { latitude: 11.83, longitude: 13.15 },
      },
    })
    await db.incident.create({
      data: {
        id: E2E_FIXTURES.incidentId,
        name: 'P9 Registry Fixture Incident',
        type: 'FLOOD',
        description: 'ACTIVE incident backing registry-driven E2E submissions',
        location: 'E2E Baseline Location',
        severity: 'MEDIUM',
        status: 'ACTIVE',
        createdBy: coordinator.id,
      },
    })
    await db.entityAssignment.create({
      data: {
        userId: assessor.id,
        entityId: E2E_FIXTURES.entityId,
        assignedBy: coordinator.id,
      },
    })

    console.log(
      `[e2e-baseline] seeded ${databaseUrl.match(/drms_[a-z0-9]+/)?.[0] ?? databaseUrl}: ${roleNames.length} roles, ${Object.keys(BASELINE_USERS).length} users, question registry + 15 cross-field rules, 1 entity, 1 ACTIVE incident`
    )
  } finally {
    await db.$disconnect()
  }
}
