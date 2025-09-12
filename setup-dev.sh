#!/bin/bash

# Development Environment Setup Script
# Sets up local development environment with Docker Compose

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Create development docker-compose override
cat > docker-compose.override.yml << EOF
version: '3.8'

services:
  # Development database with exposed ports
  postgres:
    ports:
      - "5432:5432"
    volumes:
      - postgres_dev_data:/var/lib/postgresql/data
      - ./infra/dev/postgres-init:/docker-entrypoint-initdb.d:ro

  # Development Redis with exposed ports
  redis:
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_dev_data:/data

  # Database management UI
  pgweb:
    image: sosedoff/pgweb:0.16.1
    container_name: selfhost-pgweb-dev
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://selfhost:secret@postgres:5432/selfhost?sslmode=disable
    ports:
      - "8081:8081"
    depends_on:
      - postgres
    networks:
      - selfhost-network

  # Redis management UI
  redis-commander:
    image: rediscommander/redis-commander:latest
    container_name: selfhost-redis-commander
    restart: unless-stopped
    environment:
      REDIS_HOSTS: local:redis:6379:0:secret
    ports:
      - "8082:8081"
    depends_on:
      - redis
    networks:
      - selfhost-network

volumes:
  postgres_dev_data:
  redis_dev_data:
EOF

# Create development environment file
cat > .env.development << EOF
# Development Environment Variables
NODE_ENV=development

# Database
DATABASE_URL=postgresql://selfhost:secret@localhost:5432/selfhost

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Authentication
USERNAME=devuser
PASSWORD=devpassword
JWT_SECRET=dev-jwt-secret-key-change-in-production
ENCRYPTION_KEY=dev-encryption-key-change-in-production

# Next.js
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-nextauth-secret
EOF

# Create init script for development
mkdir -p infra/dev/postgres-init
cat > infra/dev/postgres-init/01-init-database.sql << EOF
-- Development database initialization
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Insert development admin user if not exists
INSERT INTO users (id, username, "passwordHash", "isActive", "createdAt", "updatedAt")
VALUES (
  'dev-user-id',
  'devuser',
  '$2a$10$devpasswordhash',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (username) DO NOTHING;
EOF

log_info "Development environment setup complete!"
log_success "Created:"
echo "  - docker-compose.override.yml (development overrides)"
echo "  - .env.development (development environment)"
echo "  - infra/dev/postgres-init/01-init-database.sql"

echo
log_info "To start development environment:"
echo "  docker-compose --profile dev up -d"

echo
log_info "Development URLs:"
echo "  Frontend: http://localhost:3000"
echo "  Backend: http://localhost:3001"
echo "  PostgreSQL: localhost:5432"
echo "  Redis: localhost:6379"
echo "  PgWeb: http://localhost:8081"
echo "  Redis Commander: http://localhost:8082"