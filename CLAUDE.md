# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## High-Level Architecture

This is a monorepo containing a self-hosted control plane for managing multiple VPSs. The architecture consists of:

-   **`apps/server`**: A NestJS backend using Fastify. It handles all the core logic, including SSH connections, remote execution, container management, and API endpoints. It uses Prisma for database access to a PostgreSQL database and BullMQ with Redis for background task processing.
-   **`apps/web`**: A Next.js frontend with a React-based UI using shadcn/ui and Tailwind CSS. It communicates with the backend via a REST API and WebSockets for real-time updates.
-   **`packages/shared`**: A shared package for common types and utilities between the frontend and backend.
-   **`infra`**: Contains Docker Compose configuration for running the entire stack, including the application, database, and observability tools.
-   **Observability**: The stack includes Prometheus, VictoriaMetrics, Loki, and Grafana for monitoring and logging, with pre-configured dashboards.

The core functionality is agentless, relying on SSH for remote management, but a lightweight agent is a future possibility.

## Common Commands

### Development

-   **Run all services (web and server) in development mode:**
    ```bash
    npm run dev
    ```

### Building

-   **Build all applications and packages:**
    ```bash
    npm run build
    ```

### Production

-   **Start the server in production mode (after building):**
    ```bash
    npm run start
    ```
-   **Run the entire stack using Docker Compose:**
    ```bash
    docker compose up -d
    ```

### Database (Prisma)

These commands are typically run in the `apps/server` workspace.

-   **Generate Prisma Client:**
    ```bash
    npm --workspace apps/server run prisma:generate
    ```
-   **Create a new database migration:**
    ```bash
    npm --workspace apps/server run prisma:migrate
    ```
-   **Apply database migrations:**
    ```bash
    docker compose exec server npx prisma migrate deploy
    ```
