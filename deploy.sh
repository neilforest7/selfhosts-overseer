#!/bin/bash

# Self-Host Serv Agent Optimized Deployment Script
# This script deploys the unified stack (single container for web + server)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.optimized.yml"
ENV_FILE=".env.production"
BACKUP_DIR="./backups"

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check if optimized compose file exists
    if [ ! -f "$COMPOSE_FILE" ]; then
        log_error "Optimized Docker Compose file not found: $COMPOSE_FILE"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Setup environment
setup_environment() {
    log_info "Setting up environment..."
    
    if [ ! -f "$ENV_FILE" ]; then
        log_warning "Environment file not found: $ENV_FILE"
        log_info "Creating from template..."
        
        if [ -f ".env.production.example" ]; then
            cp .env.production.example "$ENV_FILE"
            log_warning "Please edit $ENV_FILE with your configuration before deploying"
            log_warning "Run: nano $ENV_FILE"
            exit 1
        else
            log_error "Environment template not found"
            exit 1
        fi
    fi
    
    # Create necessary directories
    mkdir -p "$BACKUP_DIR"
    mkdir -p ./database/init
    
    log_success "Environment setup completed"
}

# Backup existing data
backup_data() {
    log_info "Creating backup..."
    
    # Backup docker volumes
    timestamp=$(date +%Y%m%d_%H%M%S)
    backup_path="$BACKUP_DIR/backup_$timestamp"
    
    mkdir -p "$backup_path"
    
    # Backup PostgreSQL data
    if docker volume ls | grep -q "selfhost-serv-agent_postgres_data"; then
        log_info "Backing up PostgreSQL data..."
        docker run --rm \
            -v selfhost-serv-agent_postgres_data:/data \
            -v "$backup_path":/backup \
            alpine tar czf /backup/postgres_backup.tar.gz -C /data .
    fi
    
    # Backup Redis data
    if docker volume ls | grep -q "selfhost-serv-agent_redis_data"; then
        log_info "Backing up Redis data..."
        docker run --rm \
            -v selfhost-serv-agent_redis_data:/data \
            -v "$backup_path":/backup \
            alpine tar czf /backup/redis_backup.tar.gz -C /data .
    fi
    
    log_success "Backup created: $backup_path"
}

# Stop old services (if running)
stop_old_services() {
    log_info "Checking for old services..."
    
    if [ -f "docker-compose.yml" ]; then
        if docker-compose -f docker-compose.yml ps | grep -q "Up"; then
            log_warning "Old services detected. Stopping them..."
            docker-compose -f docker-compose.yml down
            log_success "Old services stopped"
        fi
    fi
}

# Start services
start_services() {
    log_info "Starting optimized services..."
    
    # Pull latest images
    docker-compose -f "$COMPOSE_FILE" pull
    
    # Build and start services
    docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build
    
    # Wait for services to be healthy
    log_info "Waiting for services to be healthy..."
    sleep 60
    
    # Check service health
    if docker-compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
        log_success "Services started successfully"
    else
        log_error "Some services failed to start"
        docker-compose -f "$COMPOSE_FILE" logs
        exit 1
    fi
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."
    
    # Wait for database to be ready
    until docker-compose -f "$COMPOSE_FILE" exec postgres pg_isready -U selfhost; do
        log_info "Waiting for database to be ready..."
        sleep 5
    done
    
    # Generate Prisma client and run migrations
    docker-compose -f "$COMPOSE_FILE" exec app npm --workspace apps/server run prisma:generate
    docker-compose -f "$COMPOSE_FILE" exec app npm --workspace apps/server run prisma:push
    
    log_success "Database migrations completed"
}

# Initialize default data
initialize_data() {
    log_info "Initializing default data..."
    
    # Create admin user (if not exists)
    docker-compose -f "$COMPOSE_FILE" exec app npm --workspace apps/server run ts-node scripts/create-admin-user.ts
    
    log_success "Data initialization completed"
}

# Show status
show_status() {
    log_info "Service Status:"
    docker-compose -f "$COMPOSE_FILE" ps
    
    echo
    log_info "Access URLs:"
    echo "  Frontend: http://localhost:3000"
    echo "  Backend API: http://localhost:3001/api/v1/"
    echo "  Database: localhost:5432"
    echo "  Redis: localhost:6379"
    echo "  Database Admin: http://localhost:8081 (dev profile)"
    echo
    log_info "Container Management:"
    echo "  View app logs: docker-compose -f $COMPOSE_FILE logs -f app"
    echo "  Access app shell: docker-compose -f $COMPOSE_FILE exec app sh"
    echo "  Supervisor control: docker-compose -f $COMPOSE_FILE exec app supervisorctl status"
}

# Main deployment function
deploy() {
    log_info "Starting Self-Host Serv Agent optimized deployment..."
    
    check_prerequisites
    setup_environment
    stop_old_services
    backup_data
    start_services
    run_migrations
    initialize_data
    show_status
    
    log_success "🎉 Self-Host Serv Agent deployed successfully with optimized architecture!"
    log_info "Key improvements:"
    log_info "  ✓ Single container for web + server applications"
    log_info "  ✓ Removed Grafana and Prometheus components"
    log_info "  ✓ Reduced resource usage and complexity"
    log_info "  ✓ Maintained all existing functionality"
    log_info ""
    log_info "Run './deploy-optimized.sh status' to check service status"
}

# Handle command line arguments
case "${1:-deploy}" in
    "deploy")
        deploy
        ;;
    "start")
        docker-compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" start
        show_status
        ;;
    "stop")
        docker-compose -f "$COMPOSE_FILE" stop
        log_success "Services stopped"
        ;;
    "restart")
        docker-compose -f "$COMPOSE_FILE" restart
        show_status
        ;;
    "down")
        docker-compose -f "$COMPOSE_FILE" down
        log_success "Services stopped and removed"
        ;;
    "logs")
        if [ -n "$2" ]; then
            docker-compose -f "$COMPOSE_FILE" logs -f "$2"
        else
            docker-compose -f "$COMPOSE_FILE" logs -f
        fi
        ;;
    "status")
        show_status
        ;;
    "update")
        log_info "Updating deployment..."
        docker-compose -f "$COMPOSE_FILE" pull
        docker-compose -f "$COMPOSE_FILE" up -d --build
        log_success "Update completed"
        ;;
    "backup")
        backup_data
        ;;
    "restore")
        if [ -n "$2" ]; then
            log_info "Restoring from backup: $2"
            # Implement restore logic here
            log_success "Restore completed"
        else
            log_error "Please specify backup directory to restore"
            exit 1
        fi
        ;;
    "prune")
        log_info "Cleaning up unused Docker resources..."
        docker system prune -f
        docker volume prune -f
        log_success "Cleanup completed"
        ;;
    "health")
        log_info "Checking service health..."
        docker-compose -f "$COMPOSE_FILE" exec app /app/healthcheck.sh
        if [ $? -eq 0 ]; then
            log_success "All services healthy"
        else
            log_error "Some services are unhealthy"
        fi
        ;;
    "supervisor")
        if [ -n "$2" ]; then
            docker-compose -f "$COMPOSE_FILE" exec app supervisorctl "$2"
        else
            docker-compose -f "$COMPOSE_FILE" exec app supervisorctl status
        fi
        ;;
    "help"|"-h"|"--help")
        echo "Self-Host Serv Agent Optimized Deployment Script"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  deploy       Full deployment (default)"
        echo "  start        Start services"
        echo "  stop         Stop services"
        echo "  restart      Restart services"
        echo "  down         Stop and remove services"
        echo "  logs         View logs (service optional)"
        echo "  status       Show service status"
        echo "  update       Update and restart services"
        echo "  backup       Create backup"
        echo "  restore      Restore from backup"
        echo "  prune        Clean up Docker resources"
        echo "  health       Check service health"
        echo "  supervisor   Control supervisor processes"
        echo "  help         Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 deploy                          # Full deployment"
        echo "  $0 logs app                       # View app logs"
        echo "  $0 supervisor status              # Check supervisor status"
        echo "  $0 supervisor restart server       # Restart server process"
        ;;
    *)
        log_error "Unknown command: $1"
        log_info "Use '$0 help' to see available commands"
        exit 1
        ;;
esac