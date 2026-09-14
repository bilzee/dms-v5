import { PrismaClient } from '@prisma/client'

/**
 * Shared Prisma client for the API integration suite.
 *
 * DATABASE_URL is guaranteed to target drms_test by tests/setup-api.ts
 * (setupFiles — runs before this module can be imported). The singleton is
 * cached on globalThis so every test file in the run shares one connection
 * pool (matches the pattern of src/lib/db/client.ts).
 */
const globalForTestPrisma = globalThis as unknown as {
  __testPrisma: PrismaClient | undefined
}

export const testDb: PrismaClient = globalForTestPrisma.__testPrisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForTestPrisma.__testPrisma = testDb
}

/**
 * Truncate every table in the public schema (CASCADE).
 * Only safe because the suite runs in-band (maxWorkers: 1) against drms_test.
 */
export async function truncateTestDb(): Promise<void> {
  await testDb.$executeRawUnsafe(`
    DO $$ DECLARE r RECORD; BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE';
      END LOOP;
    END $$;
  `)
}

export async function disconnectTestDb(): Promise<void> {
  await testDb.$disconnect()
}
