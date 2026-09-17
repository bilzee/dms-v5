import { readFileSync } from 'fs'
import { resolve } from 'path'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { BASELINE_PASSWORD, BASELINE_USERS, E2E_FIXTURES } from './baseline-users'
import { seedQuestions } from '../../prisma/seed-questions'

/**
 * Playwright globalSetup for the E2E baseline suite.
 *
 * 1. Forces DATABASE_URL/JWT_SECRET from .env.test (overriding ambient env)
 *    and hard-guards that the URL targets drms_test.
 * 2. Truncates drms_test and seeds roles + one user per golden-journey role
 *    (including ADMIN for the registry-editor surface), the question
 *    registry, one entity, one ACTIVE incident, and the assessor→entity
 *    assignment that submission authorization requires.
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

  const databaseUrl = process.env.DATABASE_URL || ''
  if (!databaseUrl.includes('drms_test')) {
    throw new Error(
      `Refusing to run E2E baseline: DATABASE_URL must target drms_test (got: "${databaseUrl}").`
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
      `[e2e-baseline] seeded drms_test: ${roleNames.length} roles, ${Object.keys(BASELINE_USERS).length} users, question registry, 1 entity, 1 ACTIVE incident`
    )
  } finally {
    await db.$disconnect()
  }
}
