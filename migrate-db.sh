#!/bin/bash

# Migration script for Self-Host Serv Agent
set -e

echo "Starting database migration..."

# Get the PostgreSQL password from .env
POSTGRES_PASSWORD=$(grep POSTGRES_PASSWORD .env | cut -d'=' -f2)

# Run the migration command with proper permissions and entrypoint override
docker run --rm \
  --network=selfhost-network \
  --entrypoint "" \
  -u root \
  -e DATABASE_URL="postgresql://selfhost:${POSTGRES_PASSWORD}@selfhost-postgres:5432/selfhost?sslmode=prefer" \
  -v /opt/selfhost-serv-agent/apps/server/prisma:/app/prisma \
  selfhost-serv-agent:local \
  npx prisma db push

echo "Migration completed successfully!"