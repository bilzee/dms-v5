# Disaster Response Management System - Development Guide

This document provides everything needed to set up, develop, test, and deploy the Disaster Response Management System (DMS).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation](#2-installation)
3. [Environment Setup](#3-environment-setup)
4. [Database Setup](#4-database-setup)
5. [Development Commands](#5-development-commands)
6. [Testing](#6-testing)
7. [Project Structure Conventions](#7-project-structure-conventions)
8. [Key Development Patterns](#8-key-development-patterns)
9. [Adding New Features](#9-adding-new-features)
10. [Build and Deployment](#10-build-and-deployment)

---

## 1. Prerequisites

Before starting development, ensure the following tools are installed:

- **Node.js 18+** -- The project uses ES2015+ features throughout the codebase.
- **npm** -- The package manager used for all dependency management (a `package-lock.json` is present).
- **PostgreSQL** -- Required as the primary database. Ensure a PostgreSQL instance is running and accessible.
- **Git** -- For version control.

Verify installations:

```bash
node --version
npm --version
psql --version
git --version
```

---

## 2. Installation

Clone the repository and install dependencies:

```bash
git clone <repo-url>
cd dms-v4-bmad-v6
npm install
```

This installs all runtime and development dependencies, including Next.js 14, Prisma, Zustand, React Hook Form, Zod, Playwright, Jest, and other project dependencies.

---

## 3. Environment Setup

Create a `.env` file in the project root with the following variables:

```
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database>
NEXTAUTH_SECRET=<your-secret-key>
NEXTAUTH_URL=http://localhost:3000
NODE_ENV=development
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by Prisma to connect to the database. |
| `NEXTAUTH_SECRET` | Secret key used for JWT signing and session encryption. Generate with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | Base URL of the application. Use `http://localhost:3000` for local development. |
| `NODE_ENV` | Set to `development` for local work or `production` for deployed builds. |

Additional environment variables may be required depending on the feature area. Check `.env.example` if present.

---

## 4. Database Setup

After configuring the environment variables, initialize the database:

```bash
npx prisma generate
npx prisma migrate dev
```

Seed the database:

```bash
npx prisma db seed
```

The seed is split into a production-safe baseline and an opt-in sample world
(DQR P9):

- **Default** (`npx prisma db seed`, which runs `tsx prisma/seed.ts`): permissions, roles + grants,
  admin (`admin@dms.gov.ng / admin123!`) and coordinator
  (`coordinator@dms.gov.ng / coordinator123!`) accounts, the reference
  entities, and the full question registry (55 questions across the six
  assessment types + per-type version settings). **No** incidents,
  assessments, donors/commitments, demo users, or E2E users — safe against a
  fresh production database.
- **`--with-sample-data`** (or `SEED_WITH_SAMPLE_DATA=1`): additionally seeds
  the demo world — two sample incidents, five sample assessments, donors +
  commitments, the multirole/responder/assessor/donor demo users, and the
  E2E test users. For local development and demos only.

```bash
# Production-safe baseline (also the fresh-production-deploy default)
npx prisma db seed

# Local development with demo data — argv form (cross-platform)
npx prisma db seed -- --with-sample-data
# or run the script directly
npx tsx prisma/seed.ts --with-sample-data
# env-var form (POSIX shells); Windows: $env:SEED_WITH_SAMPLE_DATA="1" in
# PowerShell before running `npx prisma db seed`
SEED_WITH_SAMPLE_DATA=1 npx prisma db seed
```

Alternatively, use the essential-only seed script for a minimal dataset:

```bash
node prisma/seed-essential.ts
```

All seed scripts are idempotent, **but idempotent means "converges to the
seed's catalog"**: on a database where ADMINs edited questions at runtime,
re-running the seed OVERWRITES those edits back to the seeded values (bumping
`contentVersion` and writing audit rows). On any environment with runtime
registry edits, export the registry first (`/admin/settings/questions` →
Export) and treat that export — not the seed — as the source of truth; see the
reconciliation policy in `docs/question-authoring-guide.md`. Use
`prisma/seed-questions.ts` when you only need to refresh the registry on a
pristine database (the E2E baseline suite does exactly this from its global
setup).

---

## 5. Development Commands

### Core Development

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js development server on port 3000. |
| `npm run dev:pwa` | Start the development server with PWA testing enabled (`PWA_TESTING=true`). |
| `npm run build` | Create a production build. |
| `npm run start` | Start the production server after a build. |
| `npm run lint` | Run ESLint to check for code quality issues. |
| `npm run type-check` | Run TypeScript type checking with `tsc --noEmit`. |

### Validation and Quality

| Command | Purpose |
|---|---|
| `npm run validate:schema` | Validate Prisma schema usage across the codebase. |
| `npm run validate:pre-story` | Run pre-story validation checks before starting new work. |
| `npm run build:validated` | Run schema validation, build, and smoke tests in sequence. |

---

## 6. Testing

The project uses a multi-layer testing strategy with Playwright for end-to-end tests and Jest for unit tests.

### End-to-End Tests (Playwright)

| Command | Purpose |
|---|---|
| `npm test` | Run all Playwright tests. |
| `npm run test:e2e` | Run E2E tests from `tests/e2e/`. |
| `npm run test:headed` | Run Playwright tests with the browser visible. |
| `npm run test:e2e:headed` | Run E2E tests with the browser visible. |
| `npm run test:smoke` | Run smoke tests using `playwright-smoke.config.ts`. |
| `npm run test:smoke:headed` | Run smoke tests with the browser visible. |
| `npm run test:pwa` | Run PWA-specific tests with `PWA_TESTING=true`. |

### Unit Tests (Jest)

| Command | Purpose |
|---|---|
| `npm run test:unit` | Run all Jest unit tests. |
| `npm run test:unit:watch` | Run Jest in watch mode during development. |
| `npm run test:unit:coverage` | Run Jest with code coverage reporting. |
| `npm run test:integration` | Run integration tests from `tests/integration/`. |

### Specialized Tests

| Command | Purpose |
|---|---|
| `npm run test:response-planning` | Run the full response planning test suite (unit, integration, E2E). |
| `npm run test:smoke:story-5.1` | Run smoke tests for the donor registration story. |
| `npm run verify:baseline` | Verify regression test baselines. |
| `npm run regression:create` | Create new regression tests. |
| `npm run regression:analyze` | Analyze feature impact for regression prevention. |

### Test Directory Structure

```
tests/
  e2e/              # Playwright end-to-end tests
  e2e-baseline/     # Registry-driven baseline E2E suite (own database, see below)
  smoke/            # Smoke tests for critical paths
  unit/             # Jest unit tests
    services/       # Service layer unit tests
    components/     # Component unit tests
  integration/      # Integration tests
  schema-validation.test.ts  # Schema validation tests
```

### Test Database Separation and Concurrent Runs (DQR P10-5)

The Jest API suite (`npm run test:api`) and the Playwright baseline E2E suite
(`npm run test:baseline:e2e`) each truncate and reseed their database in
setup, so they historically had to run sequentially against the shared
`drms_test` database. The E2E suite can now be pointed at a dedicated
database via `E2E_DATABASE_URL`:

```bash
# One-time provisioning of the dedicated e2e database (same postgres instance,
# localhost:5435 — creates drms_e2e if missing):
npm run db:push:e2e

# Run the API suite (drms_test) and the baseline E2E suite (drms_e2e)
# CONCURRENTLY — neither truncates the other's data:
E2E_DATABASE_URL="postgresql://dms_dev:dev_password_change_in_prod@localhost:5435/drms_e2e?schema=public" \
  npm run test:baseline:e2e &
npm run test:api
wait
```

Behavior and rollback safety:

- With `E2E_DATABASE_URL` set, both the Playwright `webServer` (the spawned
  `next dev`) and the global setup seed/truncate target that URL. The
  global-setup guard accepts `drms_test` or `drms_e2e` and refuses anything
  else.
- With `E2E_DATABASE_URL` unset, the E2E suite targets `drms_test` exactly as
  before — all sequential scripts (`npm run test:baseline:all`, the gate
  chain) keep working unchanged.
- The API suite's guard (`tests/setup-api.ts`) still hard-requires
  `drms_test`; the two suites can never be pointed at the same database by
  accident.

---

## 7. Project Structure Conventions

The project follows Next.js App Router conventions with a consistent organizational pattern.

### Top-Level Source Layout

```
src/
  app/              # Next.js App Router pages and API routes
  components/       # React components organized by category
  hooks/            # Custom React hooks
  lib/              # Core libraries, services, and utilities
  providers/        # React context providers
  stores/           # Zustand state stores
  types/            # TypeScript type definitions
  utils/            # Shared utility functions
  middleware.ts     # Next.js middleware (auth, routing)
```

### Pages

Pages follow the Next.js App Router pattern with role-based route groups:

```
src/app/(auth)/<role>/<feature>/page.tsx
```

Current role directories under `src/app/(auth)/`:

- `admin/` -- System administration pages
- `assessor/` -- Assessment creation and management
- `coordinator/` -- Response coordination and oversight
- `dashboard/` -- Shared dashboard views
- `donor/` -- Donor portal and commitment management
- `responder/` -- Response delivery pages
- `roles/` -- Role switching interface
- `system/` -- System-level pages

### API Routes

All API routes are versioned under the `/api/v1/` prefix:

```
src/app/api/v1/<resource>/route.ts
```

Each route file exports named handler functions (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`).

### Components

Components are organized by functional category:

```
src/components/
  auth/             # Authentication components
  coordinator/      # Coordinator-specific components
  dashboards/       # Dashboard widgets and layouts
  delivery/         # Delivery tracking components
  donor/            # Donor portal components
  forms/            # Form components (React Hook Form)
  layouts/          # Layout components
  offline/          # Offline mode components
  providers/        # Component-level providers
  pwa/              # Progressive Web App components
  reports/          # Report generation components
  response/         # Response management components
  settings/         # Settings and configuration components
  shared/           # Unified design system component layer
                    StatCard, StatusBadge, FormCard, FormActionBar,
                    FilterPanel, FilterBar, ContentSkeleton, ErrorAlert,
                    ProgressBar, DataTable, DataCardList, DataCardGrid,
                    SafeDataLoader, EmptyState, RoleBasedRoute, AppShell
  testing/          # Test utility components
  ui/               # Base UI primitives (Radix-based)
  verification/     # Verification workflow components
```

### Stores (Zustand)

State management stores follow a domain-based naming convention:

```
src/stores/<domain>.store.ts
```

Examples: `auth.store.ts`, `offline.store.ts`, `sync.store.ts`, `incident.store.ts`, `entity.store.ts`.

### Hooks

Custom hooks use the `use` prefix:

```
src/hooks/use<Feature>.ts
```

Examples: `useAuth.ts`, `useOffline.ts`, `useSync.ts`, `useIncidents.ts`, `useDonor.ts`.

### Services

Server-side business logic lives in service classes:

```
src/lib/services/<domain>.service.ts
```

Examples: `incident.service.ts`, `entity.service.ts`, `commitment.service.ts`, `verification-broadcast.service.ts`.

### Types

TypeScript type definitions are organized by domain:

```
src/types/<domain>.ts
```

Examples: `incidents.ts`, `donor.ts`, `commitment.ts`, `response.ts`, `auth.ts`.

### Validation

Zod validation schemas are co-located by domain:

```
src/lib/validation/<domain>.ts
```

Examples: `incidents.ts`, `donor.ts`, `commitment.ts`, `rapid-assessment.ts`.

---

## 8. Key Development Patterns

### Role-Based Routing

Pages requiring authentication are placed inside the `(auth)` route group. Access control is enforced using the `RoleBasedRoute` component from `src/components/shared/RoleBasedRoute.tsx`.

```tsx
import { RoleBasedRoute } from '@/components/shared/RoleBasedRoute'

export default function AssessorPage() {
  return (
    <RoleBasedRoute allowedRoles={['ASSESSOR', 'ADMIN']}>
      <AssessmentContent />
    </RoleBasedRoute>
  )
}
```

The route group layout at `src/app/(auth)/layout.tsx` provides shared authentication context for all pages within the group.

### API Route Handlers

API routes export named functions corresponding to HTTP methods. Protected routes use the `withAuth` wrapper from `@/lib/auth/middleware`.

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { SomeService } from '@/lib/services/example.service'
import { CreateSchema } from '@/lib/validation/example'

export const GET = withAuth(async (request, context) => {
  const data = await SomeService.findAll()
  return NextResponse.json({ data })
})

export const POST = withAuth(async (request, context) => {
  const body = await request.json()
  const validated = CreateSchema.parse(body)
  const result = await SomeService.create(validated)
  return NextResponse.json({ data: result }, { status: 201 })
})
```

Unauthenticated endpoints (such as registration) export handler functions directly without the `withAuth` wrapper.

All API responses include a `meta` object with `timestamp`, `version`, and `requestId` fields.

### State Management

The project uses a split state management strategy:

- **Zustand** for client-side state that is local to the browser session (auth state, UI state, offline queue).
- **React Query** (`@tanstack/react-query`) for server state that is fetched from and synchronized with the backend.
- **Custom hooks** serve as the public interface to all state, whether Zustand or React Query based.

```tsx
import { useIncidents } from '@/hooks/useIncidents'

function IncidentList() {
  const { incidents, isLoading, error } = useIncidents()

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage error={error} />

  return (
    <ul>
      {incidents.map(incident => (
        <li key={incident.id}>{incident.name}</li>
      ))}
    </ul>
  )
}
```

### Forms

Forms use React Hook Form combined with Zod for validation. Form components are placed in `src/components/forms/`.

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const FormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email'),
})

type FormData = z.infer<typeof FormSchema>

function ExampleForm() {
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(FormSchema),
  })

  const onSubmit = (data: FormData) => {
    console.log(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} />
      {errors.name && <span>{errors.name.message}</span>}
      <input {...register('email')} />
      {errors.email && <span>{errors.email.message}</span>}
      <button type="submit">Submit</button>
    </form>
  )
}
```

### Offline Support

The application provides offline-first capabilities through dedicated hooks and services:

- `useOffline()` -- Detects network status and manages offline mode transitions.
- `useSync()` -- Handles synchronization of locally queued changes when connectivity returns.
- Records created while offline are marked with `isOfflineCreated: true`.
- Offline data is stored using Dexie (IndexedDB) via services like `delivery-offline.service.ts` and `response-offline.service.ts`.
- The sync store (`src/stores/sync.store.ts`) manages the synchronization queue and conflict resolution.

### Design System Patterns

The application uses a unified design system layer in `src/components/shared/`. When building new features, prefer these components over creating ad-hoc solutions:

**Forms**: Use `FormCard` + `FormActionBar` instead of raw Card + Button combos.
```tsx
<FormCard title="Create Entity" variant="default" columns={2}>
  <form onSubmit={handleSubmit(onSubmit)}>
    <FormCard.Section title="Details">...</FormCard.Section>
    <FormActionBar submitLabel="Create" loading={isSubmitting} onCancel={() => reset()} />
  </form>
</FormCard>
```

**Metrics**: Use `StatCard` + `StatCardGrid` instead of custom metric cards.
```tsx
<StatCardGrid>
  <StatCard title="Total Users" value={42} variant="default" trend={{ value: 12, direction: 'up' }} />
  <StatCard title="Errors" value={3} variant="danger" />
</StatCardGrid>
```

**Status Indicators**: Use `StatusBadge` with domain-aware colors from `status-colors.ts`.
```tsx
<StatusBadge domain="verification" status="VERIFIED" />
<StatusBadge domain="commitment" status="COMPLETE" />
```

**Loading States**: Use `ContentSkeleton` instead of `animate-pulse` divs.
```tsx
{isLoading ? <ContentSkeleton variant="table" rows={5} /> : <MyTable data={data} />}
```

**Error States**: Use `ErrorAlert` instead of custom error divs.
```tsx
{error && <ErrorAlert title="Failed to load" message={error.message} onRetry={refetch} />}
```

**Charts**: Use `chart-config.ts` for colors (not hardcoded RGB) and `chart-registration.ts` for Chart.js setup.
```tsx
import { CHART_COLORS, getChartColor, getDefaultChartOptions } from '@/lib/utils/chart-config'
import '@/lib/utils/chart-registration'
// Use: getChartColor(CHART_COLORS.blue) instead of 'rgba(59, 130, 246, 0.8)'
```

**Toast Notifications**: Use Sonner (not Radix Toast).
```tsx
import { toast } from 'sonner'
toast.success('Saved successfully')
toast.error('Failed to save')
```

**Progress Bars**: Use `ProgressBar` instead of custom CSS.
```tsx
<ProgressBar value={75} variant="success" showLabel />
```

---

## 9. Adding New Features

Follow this step-by-step process to add a new feature to the system.

### Step 1: Define the Data Model

Edit `prisma/schema.prisma` to add or modify the data model:

```prisma
model ExampleResource {
  id          String   @id @default(uuid())
  name        String
  description String?
  status      Status   @default(ACTIVE)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("example_resources")
}
```

After modifying the schema, generate and apply the migration:

```bash
npx prisma migrate dev --name add_example_resource
```

### Step 2: Create TypeScript Types

Define the TypeScript interfaces in `src/types/`:

```typescript
export interface ExampleResource {
  id: string
  name: string
  description?: string
  status: 'ACTIVE' | 'INACTIVE'
  createdAt: string
  updatedAt: string
}

export interface CreateExampleResourceRequest {
  name: string
  description?: string
}

export interface ExampleResourceListResponse {
  data: ExampleResource[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  meta: {
    timestamp: string
    version: string
    requestId: string
  }
}
```

### Step 3: Create Validation Schemas

Define Zod schemas in `src/lib/validation/`:

```typescript
import { z } from 'zod'

export const CreateExampleResourceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
})

export const QueryExampleResourceSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
})
```

### Step 4: Create the Service Layer

Implement business logic in `src/lib/services/`:

```typescript
import { prisma } from '@/lib/db/client'
import { CreateExampleResourceSchema } from '@/lib/validation/example'

export const ExampleService = {
  async findAll(query: { page: number; limit: number; search?: string }) {
    const where = query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : {}

    const [items, total] = await Promise.all([
      prisma.exampleResource.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.exampleResource.count({ where }),
    ])

    return {
      items,
      total,
      totalPages: Math.ceil(total / query.limit),
    }
  },

  async create(data: z.infer<typeof CreateExampleResourceSchema>) {
    return prisma.exampleResource.create({ data })
  },
}
```

### Step 5: Create API Routes

Add route handlers in `src/app/api/v1/<resource>/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/middleware'
import { ExampleService } from '@/lib/services/example.service'
import { CreateExampleResourceSchema } from '@/lib/validation/example'

export const GET = withAuth(async (request) => {
  const url = new URL(request.url)
  const searchParams = Object.fromEntries(url.searchParams)
  const result = await ExampleService.findAll(searchParams)
  return NextResponse.json({ data: result })
})

export const POST = withAuth(async (request) => {
  const body = await request.json()
  const validated = CreateExampleResourceSchema.parse(body)
  const item = await ExampleService.create(validated)
  return NextResponse.json({ data: item }, { status: 201 })
})
```

### Step 6: Create Custom Hooks

Expose data fetching and mutations through hooks in `src/hooks/`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useExampleResources(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['example-resources', page, limit],
    queryFn: () => api.get(`/api/v1/example-resources?page=${page}&limit=${limit}`),
  })
}

export function useCreateExampleResource() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      api.post('/api/v1/example-resources', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['example-resources'] })
    },
  })
}
```

### Step 7: Create UI Components

Build the page and form components:

- Place pages in the appropriate role directory under `src/app/(auth)/<role>/<feature>/page.tsx`.
- Place reusable components in `src/components/<category>/`.
- Place form components in `src/components/forms/`.

### Step 8: Write Tests

Add tests at the appropriate level:

- **Unit tests** in `tests/unit/` for services and utility functions.
- **Component tests** in `tests/unit/components/` for React components.
- **E2E tests** in `tests/e2e/` for full workflow coverage.
- **Smoke tests** in `tests/smoke/` for critical path validation.

### Step 9: Validate and Verify

Run the full validation suite before submitting:

```bash
npm run type-check
npm run lint
npm run validate:schema
npm run test:unit
npm run test:smoke
```

---

## 10. Build and Deployment

### Production Build

The standard production build process:

```bash
npm run build:production
```

This runs `next build` with `NODE_ENV=production`, producing an optimized standalone output.

### Pre-Deployment Setup

Before deploying a new environment:

```bash
npm run prepare:production
```

This runs `scripts/prepare-production.js` which handles pre-deployment configuration tasks.

For environment-specific configuration:

```bash
npm run setup:production
```

This runs `scripts/setup-production-env.js` which sets up environment variables and configuration.

### Docker Deployment

The project provides Docker-based deployment:

- **Dockerfile**: `Dockerfile.production` -- Multi-stage build producing a minimal production image.
- **Docker Compose**: `docker-compose.production.yml` -- Orchestrates the application with its dependencies.

Build and run with Docker Compose:

```bash
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
```

### Build Pipeline Summary

The recommended build pipeline executes in this order:

1. **TypeScript compilation check** -- `npm run type-check` verifies types without emitting files.
2. **Linting** -- `npm run lint` runs ESLint checks.
3. **Schema validation** -- `npm run validate:schema` ensures Prisma schema usage is consistent.
4. **Unit tests** -- `npm run test:unit` runs the Jest test suite.
5. **Production build** -- `npm run build:production` creates the optimized Next.js bundle.
6. **Smoke tests** -- `npm run test:smoke` validates critical paths against the built application.

For convenience, `npm run build:validated` runs schema validation, build, and smoke tests in sequence.

### Fresh Production Deploy Runbook (DQR P9)

The exact sequence for standing the application up against an empty
production database — no sample data, registry guaranteed present:

1. **Push the schema** (on an empty database it only creates the missing
   tables; on schema drift `prisma db push` applies destructive diffs — use
   `npx prisma migrate deploy` in a managed pipeline instead):

   ```bash
   npx prisma db push
   ```

   (In a migration-managed pipeline use `npx prisma migrate deploy` instead.)

2. **Seed the production-safe baseline** — roles/permissions, admin +
   coordinator accounts, reference entities, and the question registry
   (catalog + per-type version settings):

   ```bash
   npx prisma db seed
   ```

   Do NOT pass `--with-sample-data` in production.

3. **Verify the registry** — the assessor read surface must return all six
   types with versions (`structureVersion`/`contentVersion` = 1/1 on a fresh
   seed):

   ```bash
   # $TOKEN = the JWT from POST /api/v1/auth/login with the (pre-rotation)
   # admin credentials; alternatively check the version badges on
   # /admin/settings/questions in the browser.
   curl -H "Authorization: Bearer $TOKEN" \
     "$BASE_URL/api/v1/questions?assessmentType=HEALTH"
   ```

4. **Rotate the seeded admin credentials immediately** (`admin@dms.gov.ng` /
   `admin123!`) and create real operator accounts.

5. **Confirm submission behavior** — create a first incident (any type,
   status `ACTIVE`) before assessors go to the field; assessments require an
   ACTIVE incident and are rejected with 404/409 otherwise.

6. **Run the deployment gates** — `npm run build:validated` (schema
   validation + build + smoke tests) before cutting traffic over.

### Environment Considerations

- The application uses Next.js standalone output mode for Docker deployments, which produces a minimal server bundle.
- Ensure `DATABASE_URL` points to the production PostgreSQL instance.
- Set `NEXTAUTH_URL` to the public-facing URL of the deployment.
- Generate a strong `NEXTAUTH_SECRET` for production environments.
- Set `NODE_ENV=production` to enable production optimizations.
