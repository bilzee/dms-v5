import { readFileSync } from 'fs'
import { resolve } from 'path'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { BASELINE_PASSWORD, BASELINE_USERS } from './baseline-users'

/**
 * Playwright globalSetup for the E2E baseline suite.
 *
 * 1. Forces DATABASE_URL/JWT_SECRET from .env.test (overriding ambient env)
 *    and hard-guards that the URL targets drms_test.
 * 2. Truncates drms_test and seeds roles + one user per golden-journey role.
 *
 * Raw Prisma + bcrypt only — no '@/' aliased app imports (Playwright does not
 * apply tsconfig path aliases inside globalSetup).
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

    console.log(
      `[e2e-baseline] seeded drms_test: ${roleNames.length} roles, ${Object.keys(BASELINE_USERS).length} users`
    )
  } finally {
    await db.$disconnect()
  }
}
