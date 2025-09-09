# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo for "Self-Host Serv Agent" - a single-user, self-hosted cross-VPS control plane for unified monitoring, container management, and batch remote execution. It integrates n8n with AI Agent capabilities. It uses SSH (agentless) by default with optional lightweight agent support.

**Key Technologies:**
- Frontend: Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, React Query, Cytoscape.js, ECharts, Socket.IO Client
- Backend: NestJS (Fastify), TypeScript, BullMQ (Redis), Prisma, PostgreSQL, Socket.IO
- Monitoring: VictoriaMetrics (7d retention), Loki (7d retention), Grafana, optional cAdvisor
- Automation: json-rules-engine, BullMQ task scheduling, node-cron

## Workspace Structure

This is a npm workspaces monorepo with three main packages:

```
├── apps/web/           # Next.js frontend (port 3000)
├── apps/server/        # NestJS backend (port 3001)  
├── packages/shared/    # Shared TypeScript types and utilities
├── infra/             # Observability configs (Grafana, Prometheus)
└── docs/              # Project documentation
```

## Development Commands

### Core Development Commands
```bash
# Start both frontend and backend
npm run dev

# Start individually  
npm run dev:web      # Frontend only (port 3000)
npm run dev:server   # Backend only (port 3001)

# Build all packages (shared -> server -> web)
npm run build
npm run build:web    # Frontend only
npm run build:server # Backend only  
npm run build:shared # Shared package only

# Production start
npm start            # Start production server
```

### Code Quality & Testing
```bash
# Lint all workspaces
npm run lint

# Type checking all workspaces  
npm run type-check

# Backend tests
npm --workspace apps/server run test
npm --workspace apps/server run test:coverage
npm --workspace apps/server run test:watch
```

### Database Operations
```bash
# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Create database migration
npm run db:migrate

# Open Prisma Studio
npm --workspace apps/server run prisma:studio
```

### FRP Management Scripts
```bash
# Run FRP relationship migration
npm --workspace apps/server run migrate:frp-relationships
npm --workspace apps/server run migrate:frp-relationships:dry-run

# Validate FRP topology
npm --workspace apps/server run validate:frp-topology

# Debug FRP state
npm --workspace apps/server run debug:frp-state
npm --workspace apps/server run debug:frp-state:test-resolution

# Test FRP discovery order
npm --workspace apps/server run test:frp-discovery-order
```

## Architecture Patterns

### Backend Architecture (NestJS)
- **Modular Structure**: Each domain has its own module (hosts, containers, tasks, automations, etc.)
- **Task Queue**: BullMQ with Redis for background job processing
- **Real-time Communication**: Socket.IO gateways for live updates (`exec.gateway.ts`, `connectivity.gateway.ts`, `logs.gateway.ts`)
- **SSH Execution**: Centralized SSH service (`ssh.service.ts`) with real-time output streaming
- **Database**: Prisma ORM with PostgreSQL, located in `apps/server/src/prisma/`
- **Background Jobs**: Processors for connectivity checks, container updates, DNS monitoring

### Frontend Architecture (Next.js)
- **App Router**: Uses Next.js 15 App Router architecture
- **UI Components**: shadcn/ui with native Default styling (avoid third-party UI kits)
- **State Management**: React Query for server state, Zustand for client state
- **Real-time**: Socket.IO client for live updates
- **Visualization**: Cytoscape.js for network topology, ECharts for charts
- **Icons**: Prefer `lucide-react` for consistency

### Key Services & Controllers
- **Hosts**: Host management, connectivity checks (`hosts.controller.ts`, `connectivity.service.ts`)
- **Containers**: Docker container lifecycle, updates (`containers/`, `docker.service.ts`)
- **Tasks**: Remote command execution (`tasks.controller.ts`, `exec.gateway.ts`)
- **Automations**: Event-driven automation rules (`automations/`)
- **Topology**: Network topology generation (`topology.service.ts`)
- **Reverse Proxy**: NPM integration for routing discovery (`reverse-proxy.service.ts`)
- **FRP**: Fast Reverse Proxy management and topology (`frp/`)
- **DNS**: DNS provider management and monitoring (`dns/`)

### Automation System
- **Triggers**: CRON schedules, webhooks, internal events
- **Actions**: Remote commands, container discovery, health checks, webhook calls
- **Notifications**: Email, Slack, webhooks based on success/failure conditions
- **Engine**: Uses `json-rules-engine` for flexible rule evaluation

## Development Guidelines

### Code Style
- Use TypeScript strict mode
- Follow existing patterns in each workspace
- Use Prisma for database operations
- Implement proper error handling with try-catch
- Use dependency injection (NestJS) in backend services
- Follow REST principles for API design

### Frontend Guidelines  
- Use shadcn/ui components with native Default styling
- Prefer `lucide-react` icons
- Use React Query for server state management
- Implement proper loading states and error boundaries
- Follow Next.js App Router conventions

### Backend Guidelines
- Use NestJS decorators and modules properly
- Implement DTOs with class-validator for API validation
- Use BullMQ for background tasks
- Implement proper WebSocket gateways for real-time features
- Use Prisma transactions for complex database operations
- Follow the established service/controller/module pattern

### SSH & Remote Execution
- All SSH operations go through `ssh.service.ts`
- Use StrictHostKeyChecking for security
- Implement proper timeout handling
- Stream real-time output via WebSocket
- Support both CLI containers and Compose projects
- Handle container backup/rollback for updates

### Container Management
- Support both Docker CLI containers and Docker Compose projects
- Implement backup/rollback strategy for CLI container updates  
- Use "Compose first" update strategy
- Parse and display original `docker run` commands
- Handle port mapping and volume discovery

### Testing Strategy
- Backend: Jest with supertest for integration tests
- Focus on service logic and API endpoints
- Use test databases for integration tests
- Mock external SSH connections in tests

## Key Configuration Files

- `package.json` (root): Workspace configuration and main scripts
- `apps/server/.env`: Backend environment variables
- `apps/server/prisma/schema.prisma`: Database schema
- `infra/observability/grafana/`: Pre-configured Grafana dashboards
- Node.js requirement: >= 18.17.0

## Important Notes

- Default SSH concurrency: 30 (range 10-100)  
- Default command timeout: 100s (range 10-900s)
- Container update check: Daily at 00:45 (configurable)
- Data retention: 7 days for both metrics (VictoriaMetrics) and logs (Loki)
- The system is designed for single-user scenarios with local token authentication
- All settings changes take effect immediately without service restart