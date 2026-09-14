import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Setup file for the API integration suite (jest.api.config.js).
 * Loaded via `setupFiles` so it runs BEFORE any test module (and therefore
 * before any PrismaClient is constructed from process.env.DATABASE_URL).
 *
 * 1. Loads .env.test without adding a dependency.
 * 2. Hard-guards that DATABASE_URL targets drms_test — the suite must never
 *    run against drms_dev or any real database.
 */

function loadEnvTestFile(): void {
  const envPath = resolve(__dirname, '..', '.env.test');
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf-8');
  } catch {
    return; // .env.test missing — fall through to the guard below, which will fail loudly
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

loadEnvTestFile();

const databaseUrl = process.env.DATABASE_URL || '';
if (!databaseUrl.includes('drms_test')) {
  throw new Error(
    `Refusing to run the API test suite: DATABASE_URL must target drms_test (got: "${databaseUrl}"). ` +
      'Check .env.test / tests/setup-api.ts.'
  );
}

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-suite-jwt-secret';
}
