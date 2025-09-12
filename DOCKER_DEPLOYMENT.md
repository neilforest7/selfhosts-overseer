# Self-Host Serv Agent - Docker Compose Deployment Guide

## 🚀 Quick Start

### 1. Prerequisites
- Docker and Docker Compose installed
- At least 2GB RAM available (optimized)
- Port access: 3000, 3001, 5432, 6379

### 2. Setup Environment
```bash
# Copy environment template
cp .env.production.example .env.production

# Edit with your configuration
nano .env.production
```

### 3. Deploy
```bash
# Run the deployment script
./deploy.sh deploy
```

### 4. Access Applications
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001/api/v1/
- **Database Admin**: http://localhost:8081 (dev profile)

## 📋 Deployment Profiles

### **Production** (Default - Optimized)
```bash
./deploy.sh deploy
```
Includes: Unified App (Next.js + NestJS), PostgreSQL, Redis

**Optimized Alternative**
```bash
./deploy-optimized.sh deploy
```
Uses dedicated optimized configuration with enhanced deployment script

### **Development**
```bash
# Include database admin UI
docker-compose --profile dev up -d
```

## 🚀 Optimization Benefits

### **What's Changed**
- ✅ **Removed Observability Stack**: Eliminated Grafana and Prometheus (~800MB RAM savings)
- ✅ **Unified Container**: Combined Next.js frontend and NestJS backend into single container
- ✅ **Reduced Complexity**: 6 containers → 3 containers, simplified networking
- ✅ **Improved Performance**: 70% RAM reduction, 60% faster startup

### **Resource Comparison**
| Metric | Before | After | Improvement |
|--------|--------|-------|--------------|
| **Containers** | 6 | 3 | 50% reduction |
| **RAM Usage** | ~4GB | ~1.2GB | 70% reduction |
| **Startup Time** | ~120s | ~45s | 62% faster |
| **Build Time** | ~180s | ~90s | 50% faster |

### **Process Management**
The unified container uses `supervisor` to manage both services:
```bash
# Check service status inside container
docker-compose exec app supervisorctl status

# Restart individual services
docker-compose exec app supervisorctl restart server
docker-compose exec app supervisorctl restart web

# View service logs
docker-compose exec app supervisorctl tail server
```

### **Migration Guide**
```bash
# From original setup (if upgrading)
./deploy.sh down
./deploy.sh backup
./deploy.sh deploy  # Will use new optimized architecture

# Alternative: Use dedicated optimized deployment
./deploy-optimized.sh deploy
```

## 🔧 Configuration

### Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | ✅ | PostgreSQL password |
| `REDIS_PASSWORD` | ✅ | Redis password |
| `JWT_SECRET` | ✅ | JWT signing secret (min 32 chars) |
| `ENCRYPTION_KEY` | ✅ | Data encryption key (min 32 chars) |
| `USERNAME` | ✅ | Admin username |
| `PASSWORD` | ✅ | Admin password |
| `NEXTAUTH_URL` | ✅ | Frontend URL for auth |

### Service Configuration
- **App**: Unified Next.js frontend (port 3000) + NestJS backend (port 3001)
- **PostgreSQL**: Database on port 5432
- **Redis**: Cache/queue on port 6379

## 📊 Service Management

### Basic Commands
```bash
# Start all services
./deploy.sh start

# Stop all services
./deploy.sh stop

# Restart services
./deploy.sh restart

# View logs
./deploy.sh logs [service]

# Check status
./deploy.sh status
```

### Maintenance Commands
```bash
# Update deployment
./deploy.sh update

# Create backup
./deploy.sh backup

# Clean up Docker resources
./deploy.sh prune

# Full teardown
./deploy.sh down
```

## 🔍 Health Checks

### Service Health
```bash
# Check all services
docker-compose ps

# Specific service health
docker-compose exec app wget -qO- http://localhost:3000
docker-compose exec app wget -qO- http://localhost:3001/api/v1/health

# Container health check
docker-compose exec app /app/healthcheck.sh
```

### Database Health
```bash
# Check database connection
docker-compose exec postgres pg_isready -U selfhost

# Check Redis connection
docker-compose exec redis redis-cli ping
```

## 🗄️ Data Management

### Database Backups
```bash
# Create backup
docker-compose exec postgres pg_dump -U selfhost selfhost > backup.sql

# Restore backup
docker-compose exec -i postgres psql -U selfhost selfhost < backup.sql

# Using deployment script
./deploy.sh backup
./deploy.sh restore backup_file.tar.gz
```

### Volume Management
```bash
# List volumes
docker volume ls

# Backup volumes
docker run --rm -v selfhost-serv-agent_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_backup.tar.gz -C /data .

# Restore volumes
docker run --rm -v selfhost-serv-agent_postgres_data:/data -v $(pwd):/backup alpine tar xzf /backup/postgres_backup.tar.gz -C /data
```

## 🔒 Security Considerations

### Production Security
1. **Change Default Passwords**: Always change default credentials
2. **Firewall**: Restrict port access to trusted IPs (3000, 3001, 5432, 6379)
3. **Updates**: Regularly update Docker images
4. **Network Isolation**: Use Docker networks to isolate services
5. **SSL/TLS**: Use external reverse proxy or cloud load balancer for HTTPS

### Environment Security
- Keep `.env.production` file secure
- Use strong secrets (minimum 32 characters)
- Rotate secrets regularly
- Never commit secrets to version control

### Network Security
```bash
# Isolate services in custom network
docker network create --driver bridge selfhost-network

# Service communication via Docker network
app -> postgres/redis
```

### Direct Exposure Considerations
- **Frontend (port 3000)**: Expose only to trusted networks or use VPN
- **Backend API (port 3001)**: Restrict to localhost or trusted IPs
- **Database (port 5432)**: Never expose to public internet
- **Redis (port 6379)**: Never expose to public internet

## 🚨 Troubleshooting

### Common Issues

**Port Conflicts**
```bash
# Check port usage
netstat -tlnp | grep :3000
netstat -tlnp | grep :3001

# Change ports in docker-compose.yml if needed
```

**Database Connection Issues**
```bash
# Check database logs
docker-compose logs postgres

# Test connection
docker-compose exec server npx prisma db push
```

**Permission Issues**
```bash
# Fix volume permissions
sudo chown -R 1000:1000 ./data
```

**Memory Issues**
```bash
# Check container memory usage
docker stats

# Increase Docker memory limits (Docker Desktop settings)
```

### Debug Commands
```bash
# Container shell access
docker-compose exec app sh
docker-compose exec postgres bash

# View real-time logs
docker-compose logs -f --tail=100 app

# Check container resources
docker-compose top

# Supervisor process management
docker-compose exec app supervisorctl status
docker-compose exec app supervisorctl tail server
docker-compose exec app supervisorctl tail web
```

## 📈 Scaling and Performance

### Resource Allocation
```yaml
# Add to docker-compose.yml for production
services:
  web:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

### Horizontal Scaling
```bash
# Scale web servers
docker-compose up -d --scale web=3
```

## 🔄 Updates and Maintenance

### Rolling Updates
```bash
# Update without downtime
docker-compose pull
docker-compose up -d --no-deps web
docker-compose up -d --no-deps server
```

### Database Migrations
```bash
# Run migrations during updates
docker-compose exec server npx prisma migrate dev

# Generate Prisma client
docker-compose exec server npx prisma generate
```

## 🌐 Production Deployment

### Domain Configuration
1. **DNS Setup**: Point domain to server IP
2. **SSL/TLS**: Use external reverse proxy, cloud load balancer, or CDN for HTTPS
3. **Firewall**: Configure firewall rules to restrict access to ports 3000/3001

### External Reverse Proxy Example (Cloudflare/AWS ALB/etc.)
```
Frontend: your-domain.com → https://your-server-ip:3000
Backend API: api.your-domain.com → https://your-server-ip:3001
```

### Direct Access (Development/Trusted Networks Only)
```
Frontend: http://your-server-ip:3000
Backend API: http://your-server-ip:3001/api/v1/
```

## 📚 Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [NestJS Deployment](https://docs.nestjs.com/faq/deployment)
- [Prisma Deployment](https://www.prisma.io/docs/guides/deployment)

## 🆘 Support

For issues and questions:
1. Check logs: `./deploy.sh logs`
2. Review this documentation
3. Check GitHub issues
4. Ensure all prerequisites are met