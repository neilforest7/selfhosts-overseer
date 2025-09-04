# Developer Onboarding Guide

Welcome to the Self-Host Serv Agent development team! This guide will help you get up to speed with our codebase, architecture, and development practices.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture Overview](#architecture-overview)
3. [Development Environment Setup](#development-environment-setup)
4. [Codebase Structure](#codebase-structure)
5. [Coding Standards](#coding-standards)
6. [Development Workflow](#development-workflow)
7. [Testing Guidelines](#testing-guidelines)
8. [Common Patterns](#common-patterns)
9. [Debugging Tips](#debugging-tips)
10. [Contributing Guidelines](#contributing-guidelines)

## Project Overview

Self-Host Serv Agent is a single-user, self-hosted cross-VPS control plane for unified monitoring and management of distributed services and containers. The system uses an SSH-based (Agentless) architecture with intelligent automation powered by json-rules-engine.

### Key Technologies
- **Frontend**: Next.js 15 + App Router + TypeScript + shadcn/ui + React Query
- **Backend**: NestJS + Fastify + TypeScript + BullMQ + Prisma + PostgreSQL
- **Real-time**: Socket.IO for WebSocket communication
- **Automation**: json-rules-engine for intelligent rule processing
- **Monitoring**: Prometheus + VictoriaMetrics + Loki + Grafana

## Architecture Overview

### Monorepo Structure
```
selfhost-serv-agent/
├── apps/
│   ├── web/                 # Next.js frontend application
│   └── server/              # NestJS backend application
├── packages/
│   └── shared/              # Shared types and utilities
├── infra/
│   └── observability/       # Monitoring stack configuration
├── docs/                    # Project documentation
└── .cursor/rules/           # Development rules and conventions
```

### Backend Architecture (NestJS)
- **Modular Design**: Each feature is organized into modules (hosts, containers, automations, etc.)
- **Layered Architecture**: Controllers → Services → Repositories (Prisma)
- **Task Queue**: BullMQ for background job processing
- **Real-time**: Socket.IO gateways for WebSocket communication
- **Database**: PostgreSQL with Prisma ORM

### Frontend Architecture (Next.js)
- **App Router**: Using Next.js 13+ App Router pattern
- **Component Structure**: Organized by feature with shared components
- **State Management**: React Query for server state, React hooks for local state
- **UI Framework**: shadcn/ui components with Tailwind CSS
- **Real-time**: Socket.IO client for live updates

## Development Environment Setup

### Prerequisites
- Node.js >= 18.17.0
- Docker and Docker Compose
- Git

### Initial Setup
```bash
# 1. Clone the repository
git clone <repository-url>
cd selfhost-serv-agent

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp apps/server/.env.example apps/server/.env
# Edit the .env file with your configuration

# 4. Start the development environment
npm run dev
```

### Environment Variables
Key environment variables to configure:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/selfhost_serv_agent"

# Redis (for BullMQ)
REDIS_URL="redis://localhost:6379"

# Optional: External services
INTERNAL_API_URL="http://localhost:3001"
```

### Development Commands
```bash
# Start all services
npm run dev                  # Frontend + Backend concurrently

# Individual services
npm run dev:web             # Frontend only (port 3000)
npm run dev:server          # Backend only (port 3001)

# Build commands
npm run build               # Build all packages (shared → server → web)
npm run build:web           # Build frontend only
npm run build:server        # Build backend only
npm run build:shared        # Build shared package only

# Database operations
npm run db:generate         # Generate Prisma client
npm run db:push            # Push schema to database
npm run db:migrate         # Create migration

# Code quality
npm run lint               # Run ESLint on all packages
npm run type-check         # TypeScript type checking on all packages

# Testing (backend)
npm --workspace apps/server run test              # Run tests
npm --workspace apps/server run test:watch        # Run tests in watch mode
npm --workspace apps/server run test:coverage     # Run tests with coverage
```

## Codebase Structure

### Backend Structure (`apps/server/src/`)
```
src/
├── app.module.ts           # Main application module
├── main.ts                 # Application entry point
├── hosts/                  # Host management module
├── containers/             # Container management module
├── automations/            # Automation rules engine
├── tasks/                  # Task execution module
├── operation-log/          # Operation logging
├── logs/                   # System logging
├── realtime/               # WebSocket gateways
├── settings/               # Application settings
├── topology/               # Network topology
├── dns/                    # DNS management
└── prisma/                 # Database schema and migrations
```

### Frontend Structure (`apps/web/`)
```
app/
├── layout.tsx              # Root layout
├── page.tsx                # Home page
├── providers.tsx           # React Query provider
├── app-shell.tsx           # Main application shell
├── sections/               # Feature sections
├── components/             # Reusable components
├── hooks/                  # Custom React hooks
├── lib/                    # Utility functions
└── globals.css             # Global styles
```

### Shared Package (`packages/shared/`)
```
src/
├── index.ts                # Main exports (Prisma client re-exports)
├── types/                  # Shared TypeScript types
└── utils/                  # Shared utility functions
```

**Note**: The shared package primarily re-exports Prisma client types and provides common utilities used across frontend and backend.

## Coding Standards

### TypeScript Guidelines
- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Use proper typing for all function parameters and return values
- Avoid `any` type - use `unknown` or proper typing

### Backend Patterns (NestJS)
```typescript
// Controller example
@Controller('/api/v1/hosts')
export class HostsController {
  constructor(private readonly hostsService: HostsService) {}

  @Get()
  async findAll(): Promise<Host[]> {
    return this.hostsService.findAll();
  }

  @Post()
  async create(@Body() createHostDto: CreateHostDto): Promise<Host> {
    return this.hostsService.create(createHostDto);
  }
}

// Service example
@Injectable()
export class HostsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Host[]> {
    return this.prisma.host.findMany();
  }

  async create(data: CreateHostDto): Promise<Host> {
    return this.prisma.host.create({ data });
  }
}
```

### Frontend Patterns (React)
```typescript
// Component example
interface HostListProps {
  hosts: Host[];
  onHostSelect: (host: Host) => void;
}

export function HostList({ hosts, onHostSelect }: HostListProps) {
  return (
    <div className="space-y-2">
      {hosts.map((host) => (
        <HostCard 
          key={host.id} 
          host={host} 
          onClick={() => onHostSelect(host)} 
        />
      ))}
    </div>
  );
}

// Hook example
export function useHosts() {
  return useQuery({
    queryKey: ['hosts'],
    queryFn: async () => {
      const response = await fetch('/api/v1/hosts');
      if (!response.ok) throw new Error('Failed to fetch hosts');
      return response.json();
    }
  });
}
```

### UI Component Guidelines
- Use shadcn/ui components as the foundation
- Follow the established design system
- Use Tailwind CSS for styling
- Prefer composition over inheritance
- Keep components small and focused

### Error Handling
```typescript
// Backend error handling
try {
  const result = await this.someOperation();
  return result;
} catch (error) {
  this.logger.error('Operation failed', error.stack);
  throw new HttpException('Operation failed', HttpStatus.INTERNAL_SERVER_ERROR);
}

// Frontend error handling
const { data, error, isLoading } = useQuery({
  queryKey: ['data'],
  queryFn: fetchData,
  onError: (error) => {
    toast.error(`Failed to load data: ${error.message}`);
  }
});
```

## Development Workflow

### Git Workflow
1. Create feature branch from `main`
2. Make changes following coding standards
3. Write/update tests
4. Run linting and type checking
5. Commit with descriptive messages
6. Create Pull Request

### Commit Message Format
```
type(scope): description

feat(hosts): add SSH key authentication support
fix(containers): resolve container discovery race condition
docs(api): update endpoint documentation
refactor(automation): simplify rule engine logic
```

### Branch Naming
- `feat/feature-name` - New features
- `fix/bug-description` - Bug fixes
- `docs/documentation-update` - Documentation changes
- `refactor/component-name` - Code refactoring

## Testing Guidelines

### Backend Testing
```typescript
// Unit test example
describe('HostsService', () => {
  let service: HostsService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [HostsService, PrismaService],
    }).compile();

    service = module.get<HostsService>(HostsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should create a host', async () => {
    const hostData = { name: 'test-host', address: '192.168.1.1' };
    const result = await service.create(hostData);
    expect(result).toMatchObject(hostData);
  });
});
```

### Frontend Testing
```typescript
// Component test example
import { render, screen } from '@testing-library/react';
import { HostCard } from './HostCard';

describe('HostCard', () => {
  it('renders host information', () => {
    const host = { id: '1', name: 'test-host', address: '192.168.1.1' };
    render(<HostCard host={host} />);
    
    expect(screen.getByText('test-host')).toBeInTheDocument();
    expect(screen.getByText('192.168.1.1')).toBeInTheDocument();
  });
});
```

### Test Commands
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test -- HostsService.spec.ts
```

## Common Patterns

### WebSocket Communication
```typescript
// Backend gateway
@WebSocketGateway()
export class TaskGateway {
  @SubscribeMessage('joinTask')
  handleJoinTask(client: Socket, payload: { taskId: string }) {
    client.join(`task:${payload.taskId}`);
  }

  broadcastTaskUpdate(taskId: string, data: any) {
    this.server.to(`task:${taskId}`).emit('task:update', data);
  }
}

// Frontend hook
export function useTaskSocket(taskId: string) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const newSocket = io();
    newSocket.emit('joinTask', { taskId });
    
    newSocket.on('task:update', (data) => {
      // Handle task update
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, [taskId]);

  return socket;
}
```

### Database Operations with Prisma
```typescript
// Complex query example
async findHostsWithContainers(filters: HostFilters) {
  return this.prisma.host.findMany({
    where: {
      name: { contains: filters.search },
      status: filters.status,
    },
    include: {
      containers: {
        where: { state: 'running' },
        select: { id: true, name: true, state: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}
```

### Automation Rules
```typescript
// Rule definition
const rule = {
  conditions: {
    all: [
      {
        fact: 'containerStatus',
        operator: 'equal',
        value: 'exited',
        params: { containerName: 'my-app' }
      }
    ]
  },
  event: {
    type: 'restart-container',
    params: { containerId: 'container-id' }
  }
};

// Rule execution
const engine = new Engine();
engine.addRule(rule);
const results = await engine.run(facts);
```

## Debugging Tips

### Backend Debugging
```bash
# Enable debug logging
DEBUG=* npm run dev:server

# Database query logging
# Add to .env
DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public&logging=true"

# View logs
docker compose logs server -f
```

### Frontend Debugging
```bash
# React Query DevTools (already included)
# Open browser dev tools and look for React Query tab

# Network debugging
# Use browser Network tab to inspect API calls

# Component debugging
console.log('Component props:', props);
```

### Common Issues
1. **Port conflicts**: Check if ports 3000, 3001, 5432, 6379 are available
2. **Database connection**: Verify PostgreSQL is running and accessible
3. **WebSocket issues**: Check CORS configuration and port accessibility
4. **Type errors**: Run `npm run type-check` to identify TypeScript issues

## Contributing Guidelines

### Before Contributing
1. Read this onboarding guide thoroughly
2. Set up your development environment
3. Familiarize yourself with the codebase structure
4. Review existing code patterns and conventions

### Pull Request Process
1. Ensure all tests pass (`npm run test`)
2. Run linting and type checking (`npm run lint && npm run type-check`)
3. Update documentation if needed
4. Follow the established coding standards
5. Write clear commit messages
6. Request review from team members

### Code Review Checklist
- [ ] Code follows established patterns
- [ ] Tests are included and passing
- [ ] Linting and type checking pass
- [ ] Documentation is updated
- [ ] No console.log statements in production code
- [ ] Error handling is appropriate
- [ ] TypeScript types are properly defined
- [ ] Dependencies are in correct package.json sections
- [ ] API endpoints are documented if new ones are added

## Resources

### Documentation
- [Project Specification](PROJECT_SPEC.md)
- [API Documentation](API_DOCUMENTATION.md)
- [Architecture Rules](.cursor/rules/)

### External Resources
- [NestJS Documentation](https://docs.nestjs.com/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [shadcn/ui Components](https://ui.shadcn.com/)
- [React Query Documentation](https://tanstack.com/query/latest)

### Getting Help
- Check existing documentation first
- Search through existing issues and PRs
- Ask questions in team chat
- Create detailed bug reports with reproduction steps

Welcome to the team! 🚀
