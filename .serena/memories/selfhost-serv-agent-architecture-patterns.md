# Self-Host Serv Agent - Architecture Patterns & Key Insights

## System Overview
Single-user, self-hosted cross-VPS control plane for unified monitoring, container management, and batch remote execution. Integrates n8n with AI Agent capabilities using SSH (agentless by default).

## Technology Stack
- **Frontend**: Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, React Query, Cytoscape.js, ECharts, Socket.IO Client
- **Backend**: NestJS (Fastify), TypeScript, BullMQ (Redis), Prisma, PostgreSQL, Socket.IO
- **Monitoring**: VictoriaMetrics (7d), Loki (7d), Grafana, cAdvisor (optional)
- **Automation**: json-rules-engine, BullMQ task scheduling, node-cron

## Key Architecture Patterns

### 1. Task Execution Pattern
- **Fire-and-forget**: Immediate response with async background execution
- **Operation tracking**: Via OperationLog entities with unique opId context
- **Real-time updates**: Socket.IO for streaming logs and status updates
- **Location**: `apps/server/src/tasks/tasks.service.ts`

### 2. SSH Execution Pattern
- **Centralized service**: All SSH operations through `apps/server/src/ssh/ssh.service.ts`
- **Streaming output**: Real-time log streaming via WebSocket
- **Multiple auth methods**: Password, private key, key passphrase support
- **Timeout handling**: Configurable connect and execution timeouts

### 3. Real-time Communication Pattern
- **Socket.IO gateways**: Multiple gateways for different event types
- **Context isolation**: Operation-specific context for log routing
- **Frontend integration**: TaskDrawer component for live monitoring
- **Location**: `apps/server/src/realtime/` gateways

### 4. Container Management Pattern
- **Dual support**: Both Docker CLI containers and Compose projects
- **Update strategies**: CLI vs Compose with backup/rollback capabilities
- **Discovery workflow**: Automatic container discovery and status monitoring
- **Location**: `apps/server/src/containers/`

### 5. Automation Pattern
- **Rule-based**: json-rules-engine for flexible automation
- **Event-driven**: CRON, webhooks, and internal events as triggers
- **Action system**: Modular action framework with notification support
- **Location**: `apps/server/src/automations/`

## Important Code Conventions

### Frontend Patterns
- **shadcn/ui components**: Native Default styling, avoid third-party UI kits
- **Icons**: Prefer `lucide-react` for consistency
- **State management**: React Query for server state, Zustand for client state
- **Error handling**: Proper loading states and error boundaries
- **Toast patterns**: Use `sonner` toast library with consistent messaging

### Backend Patterns
- **NestJS modules**: Domain-driven module structure
- **DTOs**: Class-validator for API validation
- **Services**: Dependency injection and transaction management
- **Error handling**: Try-catch with appropriate HTTP status codes
- **Background jobs**: BullMQ for async processing

### Database Patterns
- **Prisma ORM**: Type-safe database operations
- **Transaction safety**: Use Prisma transactions for complex operations
- **Entity relationships**: Clear foreign key relationships with cascading
- **Schema location**: `apps/server/src/prisma/schema.prisma`

## Development Workflows

### Monorepo Structure
```
├── apps/web/           # Next.js frontend (port 3000)
├── apps/server/        # NestJS backend (port 3001)  
├── packages/shared/    # Shared TypeScript types and utilities
├── infra/             # Observability configs
└── docs/              # Project documentation
```

### Key Commands
- `npm run dev` - Start both frontend and backend
- `npm run build` - Build all packages (shared → server → web)
- `npm run type-check` - Type checking across workspaces
- `npm run lint` - Linting all workspaces

## Common Pitfalls & Solutions

### 1. Async Task Success/Failure Mismatch
**Problem**: Frontend shows success toast before async operations complete
**Solution**: Monitor task status via operation endpoints before showing success
**Location**: SSH command execution flow analysis in ssh-toast-bug-analysis memory

### 2. SSH Connection Management
**Problem**: SSH connection state not properly tracked
**Solution**: Use centralized SSH service with proper timeout handling
**Location**: `apps/server/src/ssh/ssh.service.ts`

### 3. Real-time Event Handling
**Problem**: Socket.IO events not properly routed to correct operation context
**Solution**: Use opId context for event routing and log aggregation
**Location**: `apps/server/src/realtime/` gateway implementations

## Configuration Management

### Environment Variables
- **Database**: PostgreSQL connection configuration
- **SSH**: Default connection timeouts and concurrency settings
- **Monitoring**: VictoriaMetrics/Loki retention and endpoint configuration
- **Authentication**: Local token authentication (single-user design)

### Settings Service
- **Runtime configuration**: Dynamic settings changes without service restart
- **SSH concurrency**: Adjustable concurrency (default: 30, range: 10-100)
- **Command timeout**: Configurable command timeouts (default: 100s, range: 10-900s)
- **Location**: `apps/server/src/settings/`

## Testing Patterns

### Backend Testing
- **Jest + supertest**: Integration testing with test databases
- **Service mocking**: Mock external SSH connections in tests
- **Test isolation**: Use separate test databases
- **Commands**: `npm --workspace apps/server run test`

### Frontend Testing
- **React Query**: Mock API responses for component testing
- **User interaction**: Test user workflows and error states
- **Loading states**: Verify proper loading and error boundary behavior

## Performance Considerations

### SSH Concurrency
- **Default**: 30 concurrent SSH connections
- **Range**: 10-100 connections configurable
- **Memory usage**: Monitor during bulk operations
- **Timeout handling**: Proper cleanup of hung connections

### Database Optimization
- **Connection pooling**: Prisma handles connection management
- **Query optimization**: Use selective field queries where possible
- **Index strategy**: Ensure proper indexes on frequently queried fields

### Frontend Optimization
- **React Query caching**: Effective server state caching
- **Component re-rendering**: Use React.memo and useCallback appropriately
- **Bundle size**: Monitor and optimize for production builds