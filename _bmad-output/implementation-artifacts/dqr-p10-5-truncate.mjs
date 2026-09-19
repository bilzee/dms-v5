/**
 * DQR P10-5 helper — truncate every public table of the database named by
 * DATABASE_URL (guarded: must be a drms_* disposable database). Used to give
 * the governed catalog-polish exercise a pristine baseline before
 * `prisma db seed` (guaranteed structureVersion/contentVersion = 1/1).
 *
 * Usage:
 *   npx cross-env DATABASE_URL=postgresql://...drms_test... node dqr-p10-5-truncate.mjs
 */
import { PrismaClient } from '@prisma/client'

const url = process.env.DATABASE_URL || ''
if (!/drms_[a-z0-9]+(\?|$)/.test(url)) {
  console.error(`Refusing to truncate: DATABASE_URL must target a drms_* database (got "${url}")`)
  process.exit(1)
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
  console.log(`TRUNCATED ${url.match(/drms_[a-z0-9]+/)?.[0] ?? url} (all public tables)`)
} finally {
  await db.$disconnect()
}
