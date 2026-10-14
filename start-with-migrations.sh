#!/bin/sh

echo "=== Starting DRMS Application ==="
echo "Date: $(date)"
echo "User: $(whoami)"
echo "Node: $(node --version)"
echo "Working directory: $(pwd)"
echo "Database: ${DATABASE_URL:+configured}"

# Check if Prisma client exists, generate if needed
echo ""
echo "=== Checking Prisma Client ==="
if [ ! -d "node_modules/.pnpm/@prisma+client" ]; then
    echo "⚠️  Prisma client not found, generating..."
    npx prisma generate || echo "❌ Prisma client generation failed"
else
    echo "✅ Prisma client found"
fi

# Run database migrations
echo ""
echo "=== Running Database Migrations ==="
if ! npx prisma migrate deploy; then
    echo "❌ Migrations failed - aborting startup (schema left untouched)"
    exit 1
fi
echo "✅ Migrations completed successfully"

# Seed question registry / baseline rules (idempotent)
echo ""
echo "=== Seeding Question Registry ==="
if ! npx prisma db seed; then
    echo "❌ Registry seeding failed - aborting startup"
    exit 1
fi
echo "✅ Registry seed completed"

# Optional full simulation world (users, incidents, assessments, responses,
# commitments, deliveries, signals, notifications) — UI-flow parity.
if [ "$SEED_SIMULATION" = "1" ]; then
    echo ""
    echo "=== Seeding Simulation World ==="
    if ! npx tsx prisma/seed-simulation.ts; then
        echo "❌ Simulation seeding failed - aborting startup"
        exit 1
    fi
    echo "✅ Simulation world seeded"
fi

# Start the application
echo ""
echo "=== Starting Next.js Server ==="
exec node server.js
