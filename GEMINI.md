# Project Overview

This is a monorepo for a self-hosted control plane for managing multiple VPSs. It provides a unified interface for monitoring, container management, and bulk remote execution. The project is built with a modern tech stack, including Next.js for the frontend, NestJS for the backend, and various tools for observability.

**Key Technologies:**

*   **Frontend:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, React Query, React Flow, ECharts
*   **Backend:** NestJS (with Fastify), TypeScript, BullMQ (Redis), Prisma, PostgreSQL
*   **Observability:** Prometheus, VictoriaMetrics, Loki, Grafana
*   **Monorepo Management:** npm Workspaces

**Architecture:**

The project is structured as a monorepo with the following packages:

*   `apps/web`: The Next.js frontend application.
*   `apps/server`: The NestJS backend application.
*   `packages/shared`: A shared package for types and other common code.

# Building and Running

**Prerequisites:**

*   Node.js >= 18.17.0
*   Docker and Docker Compose
*   An SSH private key

**Development:**

To run the project in development mode, use the following command:

```bash
npm run dev
```

This will start both the frontend and backend applications in watch mode.
Usually the frontend and backend applications are already running in background.
Use context7 MCP server any time you need documentation for external services.

**Building:**

To build the project for production, use the following command:

```bash
npm run build
```

This will build all the workspaces.

**Production:**

To run the project in production, use the following command:

```bash
npm run start
```

This will start the backend server. The frontend needs to be served separately, for example with a static web server.

# Development Conventions

*   **Coding Style:** The project uses TypeScript and follows the conventions of the respective frameworks (Next.js and NestJS).
*   **UI:** The frontend uses shadcn/ui with the default style.
*   **API:** The API is documented in `docs/PROJECT_SPEC.md` and `.cursor/rules/api-overview.mdc`.
