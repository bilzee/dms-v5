const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.{js,jsx,ts,tsx}',
    '<rootDir>/tests/integration/**/*.test.{js,jsx,ts,tsx}',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/*.stories.tsx',
    '!src/**/index.ts',
    '!src/app/layout.tsx',
    '!src/app/page.tsx',
    '!src/app/(auth)/responder/responses/[id]/deliver/page.tsx',
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',
  testPathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/node_modules/',
    '<rootDir>/coverage/',
    '<rootDir>/tests/e2e/',
    '<rootDir>/tests/legacy-backup/',
  ],
  collectCoverage: true,
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
const createBaseConfig = createJestConfig(customJestConfig)

// next/jest force-prepends `/node_modules/` to transformIgnorePatterns and only
// APPENDS custom entries, so an allowlist for ESM-only packages (uuid@13 etc.)
// can never take effect through the normal option. Overwrite it after the
// config resolves. The pattern is separator-agnostic so it works on Windows.
module.exports = async () => {
  const config = await createBaseConfig()
  config.transformIgnorePatterns = [
    'node_modules[\\/](?!(uuid|@uuid|jose|openid-client|next-auth|@prisma|prisma|exceljs|pdfkit|chart\\.js)[\\/])',
  ]
  return config
}