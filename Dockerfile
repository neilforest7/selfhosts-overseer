# Multi-stage build for unified Self-Host Serv Agent (Next.js frontend + NestJS backend)
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy workspace package files
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

# Install root dependencies
RUN npm ci

# Install workspace dependencies
RUN npm --workspace apps/web ci
RUN npm --workspace apps/server ci
RUN npm --workspace packages/shared ci

# Build shared package first
FROM base AS shared-builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

COPY packages/shared ./packages/shared
RUN npm --workspace packages/shared run build

# Build backend (NestJS)
FROM base AS server-builder
WORKDIR /app
COPY --from=shared-builder /app/node_modules ./node_modules
COPY --from=shared-builder /app/packages/shared ./packages/shared
COPY --from=shared-builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=shared-builder /app/apps/server/node_modules ./apps/server/node_modules

COPY apps/server ./apps/server
COPY apps/server/prisma ./apps/server/prisma

# Generate Prisma client
RUN npm --workspace apps/server run prisma:generate

# Build TypeScript
RUN npm --workspace apps/server run build

# Build frontend (Next.js)
FROM base AS web-builder
WORKDIR /app
COPY --from=shared-builder /app/node_modules ./node_modules
COPY --from=shared-builder /app/packages/shared ./packages/shared
COPY --from=shared-builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=shared-builder /app/apps/server/node_modules ./apps/server/node_modules

COPY apps/web ./apps/web

# Build Next.js application
RUN npm --workspace apps/web run build

# Production image with process manager
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Install process manager and utilities
RUN apk add --no-cache supervisor

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built applications
COPY --from=shared-builder /app/packages/shared ./packages/shared
COPY --from=server-builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=server-builder /app/apps/server/dist ./apps/server/dist
COPY --from=server-builder /app/apps/server/prisma ./apps/server/prisma
COPY --from=server-builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=server-builder /app/apps/server/package-lock.json ./apps/server/package-lock.json

COPY --from=web-builder /app/apps/web/.next ./apps/web/.next
COPY --from=web-builder /app/apps/web/public ./apps/web/public
COPY --from=web-builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=web-builder /app/apps/web/package-lock.json ./apps/web/package-lock.json

# Copy root package files
COPY package.json package-lock.json* ./

# Create supervisor configuration
RUN mkdir -p /etc/supervisor/conf.d
COPY <<EOF /etc/supervisor/conf.d/supervisord.conf
[supervisord]
nodaemon=true
user=root
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid

[program:server]
directory=/app/apps/server
command=node dist/main
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/server.log
stderr_logfile=/var/log/supervisor/server.error.log
user=nextjs
environment=NODE_ENV="production",PORT="3001"

[program:web]
directory=/app/apps/web
command=node server.js
autostart=true
autorestart=true
stdout_logfile=/var/log/supervisor/web.log
stderr_logfile=/var/log/supervisor/web.error.log
user=nextjs
environment=NODE_ENV="production",PORT="3000",HOSTNAME="0.0.0.0"

[unix_http_server]
file=/var/run/supervisor.sock
chmod=0700

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface
EOF

# Create log directory
RUN mkdir -p /var/log/supervisor && chown -R nextjs:nodejs /var/log/supervisor

# Create health check script
COPY <<EOF /app/healthcheck.sh
#!/bin/sh
# Health check script for unified container

# Check if both services are running
if supervisorctl status server | grep -q RUNNING && supervisorctl status web | grep -q RUNNING; then
    exit 0
else
    exit 1
fi
EOF

RUN chmod +x /app/healthcheck.sh

# Expose both ports
EXPOSE 3000 3001

# Set correct permissions
USER nextjs

# Start both services using supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD ["/app/healthcheck.sh"]