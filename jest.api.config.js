const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

/**
 * Jest config for the API integration suite (tests/api/**).
 *
 * - Runs against a REAL PostgreSQL test database (drms_test) — no Prisma mocks.
 * - tests/setup-api.ts (setupFiles, runs before module imports) loads .env.test
 *   and hard-guards that DATABASE_URL targets drms_test.
 * - Deliberately does NOT use tests/setup.ts (the jsdom/global-mock setup):
 *   route handlers and services must run with real modules here.
 * - runInBand: suites share one physical database; truncation and
 *   cross-suite state must not race.
 * - transformIgnorePatterns is OVERWRITTEN after next/jest builds the config:
 *   next/jest force-prepends `/node_modules/` and only appends custom entries,
 *   so an allowlist for ESM packages (uuid@13 etc.) can never take effect
 *   through the normal option. The pattern is separator-agnostic (Windows).
 */
// next/jest returns a function that resolves to the final config;
// wrap it so we can override transformIgnorePatterns (see note above).
const createBaseConfig = createJestConfig({
  displayName: 'api',
  setupFiles: ['<rootDir>/tests/setup-api.ts'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '<rootDir>/tests/api/**/*.test.ts',
    '<rootDir>/tests/services/**/*.test.ts',
  ],
  testPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/node_modules/'],
  // Single worker: shared physical DB, deterministic ordering
  maxWorkers: 1,
})

module.exports = async () => {
  const config = await createBaseConfig()
  config.transformIgnorePatterns = [
    'node_modules[\\\\/](?!(uuid|@uuid|jose|openid-client|next-auth|@prisma|prisma|exceljs|pdfkit|chart\\.js)[\\\\/])',
  ]
  return config
}
