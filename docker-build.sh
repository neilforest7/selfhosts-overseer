#!/bin/bash

# Self-Host Serv Agent - Optimized Docker Build and Deployment Script
# With separated build/runtime configuration system

set -euo pipefail

# ===== CONFIGURATION =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="selfhost-serv-agent"
REGISTRY="${DOCKER_REGISTRY:-docker.io}"
NAMESPACE="${DOCKER_NAMESPACE:-}"
ENVIRONMENT="${ENVIRONMENT:-production}"

# ===== COLOR OUTPUT =====
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ===== HELPER FUNCTIONS =====
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

# ===== VALIDATION FUNCTIONS =====
validate_dependencies() {
    log_info "Validating dependencies..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Check Docker Buildx
    if ! docker buildx version &> /dev/null; then
        log_error "Docker Buildx is not available"
        exit 1
    fi
    
    # Check for environment files based on environment type
    if [[ "$ENVIRONMENT" == "development" ]]; then
        if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
            log_warning "No environment file found. Creating from template..."
            cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
            log_warning "Please update .env file with your configuration before building"
            exit 1
        fi
    else
        # For production and other environments, check for build config file
        if [[ ! -f "$SCRIPT_DIR/.env.build" ]]; then
            log_error "Missing build configuration file: .env.build"
            exit 1
        fi
        if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
            log_warning "No runtime environment file found. Creating from template..."
            cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
            log_warning "Please update .env file with your configuration before building"
        fi
    fi
    
    log_success "Dependencies validated"
}

validate_environment() {
    log_info "Validating environment configuration..."
    
    # Source environment files based on environment type
    if [[ "$ENVIRONMENT" == "development" ]]; then
        if [[ -f "$SCRIPT_DIR/.env" ]]; then
            source "$SCRIPT_DIR/.env"
        fi
    else
        # Source build and runtime configuration for production
        source "$SCRIPT_DIR/.env.build"
        source "$SCRIPT_DIR/.env"
    fi
    
    # Check required variables
    required_vars=(
        "POSTGRES_PASSWORD"
        "REDIS_PASSWORD" 
        "JWT_SECRET"
        "ENCRYPTION_KEY"
        "USERNAME"
        "PASSWORD"
    )
    
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            log_error "Required environment variable $var is not set"
            exit 1
        fi
    done
    
    # Check for default passwords
    if [[ "$POSTGRES_PASSWORD" == "your_secure_postgres_password_change_this" ]]; then
        log_error "Please change the default POSTGRES_PASSWORD in .env"
        exit 1
    fi
    
    if [[ "$REDIS_PASSWORD" == "your_secure_redis_password_change_this" ]]; then
        log_error "Please change the default REDIS_PASSWORD in .env"
        exit 1
    fi
    
    log_success "Environment configuration validated"
}

# ===== BUILD FUNCTIONS =====
build_image() {
    local platform="$1"
    local tag="$2"
    
    log_info "Building image for platform: $platform with tag: $tag"
    
    # Source build configuration for build arguments
    if [[ -f "$SCRIPT_DIR/.env.build" ]]; then
        source "$SCRIPT_DIR/.env.build"
    fi
    
    # Determine Dockerfile (now only production)
    local dockerfile="$SCRIPT_DIR/Dockerfile"
    
    # Build with Buildx for multi-platform support
    if [[ -n "$platform" ]]; then
        docker buildx build \
            --platform "$platform" \
            --tag "$tag" \
            --file "$dockerfile" \
            --build-arg HTTP_PROXY="${HTTP_PROXY:-}" \
            --build-arg HTTPS_PROXY="${HTTPS_PROXY:-}" \
            --build-arg NO_PROXY="${NO_PROXY:-localhost,127.0.0.1}" \
            --build-arg BUILD_DATE="${BUILD_DATE:-$(date -u +'%Y-%m-%dT%H:%M:%SZ')}" \
            --build-arg BUILD_VERSION="${BUILD_VERSION:-latest}" \
            --build-arg BUILD_COMMIT="${BUILD_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")}" \
            --push \
            "$SCRIPT_DIR"
    else
        docker build \
            --tag "$tag" \
            --file "$dockerfile" \
            --build-arg HTTP_PROXY="${HTTP_PROXY:-}" \
            --build-arg HTTPS_PROXY="${HTTPS_PROXY:-}" \
            --build-arg NO_PROXY="${NO_PROXY:-localhost,127.0.0.1}" \
            --build-arg BUILD_DATE="${BUILD_DATE:-$(date -u +'%Y-%m-%dT%H:%M:%SZ')}" \
            --build-arg BUILD_VERSION="${BUILD_VERSION:-latest}" \
            --build-arg BUILD_COMMIT="${BUILD_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")}" \
            "$SCRIPT_DIR"
    fi
    
    if [[ $? -eq 0 ]]; then
        log_success "Image built successfully: $tag"
    else
        log_error "Failed to build image: $tag"
        exit 1
    fi
}

# ===== PUBLICATION FUNCTIONS =====
publish_image() {
    local local_tag="$1"
    local remote_tag="$2"
    
    log_info "Publishing image: $local_tag -> $remote_tag"
    
    # Tag for remote registry
    docker tag "$local_tag" "$remote_tag"
    
    # Push to registry
    docker push "$remote_tag"
    
    if [[ $? -eq 0 ]]; then
        log_success "Image published successfully: $remote_tag"
    else
        log_error "Failed to publish image: $remote_tag"
        exit 1
    fi
}

# ===== MAIN FUNCTIONS =====
build_local() {
    log_info "Starting local build..."
    
    validate_dependencies
    validate_environment
    
    source "$SCRIPT_DIR/.env"
    
    local local_tag="$PROJECT_NAME:local"
    
    build_image "" "$local_tag"
    
    log_success "Local build completed: $local_tag"
}

build_and_publish() {
    log_info "Starting build and publish process..."
    
    validate_dependencies
    validate_environment
    
    source "$SCRIPT_DIR/.env"
    
    # Determine image name
    if [[ -n "$NAMESPACE" ]]; then
        local base_image="$REGISTRY/$NAMESPACE/$PROJECT_NAME"
    else
        local base_image="$REGISTRY/$PROJECT_NAME"
    fi
    
    # Get version from package.json or environment
    local version="${IMAGE_TAG:-$(jq -r '.version' package.json 2>/dev/null || echo 'latest')}"
    
    # Build for multiple platforms
    local platforms=("linux/amd64" "linux/arm64" "linux/arm/v7")
    
    for platform in "${platforms[@]}"; do
        log_info "Building for platform: $platform"
        
        # Platform-specific tag
        local platform_tag="${base_image}:${version}-${platform//\//-}"
        
        docker buildx build \
            --platform "$platform" \
            --tag "$platform_tag" \
            --file "$SCRIPT_DIR/Dockerfile" \
            --build-arg HTTP_PROXY="${HTTP_PROXY:-}" \
            --build-arg HTTPS_PROXY="${HTTPS_PROXY:-}" \
            --build-arg NO_PROXY="${NO_PROXY:-localhost,127.0.0.1}" \
            --push \
            "$SCRIPT_DIR"
    done
    
    # Create and push manifest
    local manifest_tag="$base_image:$version"
    log_info "Creating manifest: $manifest_tag"
    
    docker manifest create "$manifest_tag" \
        "${base_image}:${version}-linuxamd64" \
        "${base_image}:${version}-linuxarm64" \
        "${base_image}:${version}-linuxarmv7"
    
    docker manifest push "$manifest_tag"
    
    # Tag and push 'latest' if this is the current version
    if [[ "$version" != "latest" ]]; then
        local latest_tag="$base_image:latest"
        docker manifest create "$latest_tag" \
            "${base_image}:${version}-linuxamd64" \
            "${base_image}:${version}-linuxarm64" \
            "${base_image}:${version}-linuxarmv7"
        
        docker manifest push "$latest_tag"
        log_success "Latest tag updated: $latest_tag"
    fi
    
    log_success "Multi-platform build and publish completed"
}

build_single_platform() {
    log_info "Starting single-platform build..."
    
    validate_dependencies
    validate_environment
    
    source "$SCRIPT_DIR/.env"
    
    local platform="${1:-linux/amd64}"
    local version="${IMAGE_TAG:-$(jq -r '.version' package.json 2>/dev/null || echo 'latest')}"
    
    if [[ -n "$NAMESPACE" ]]; then
        local image_name="$REGISTRY/$NAMESPACE/$PROJECT_NAME:$version"
    else
        local image_name="$REGISTRY/$PROJECT_NAME:$version"
    fi
    
    build_image "$platform" "$image_name"
    
    log_success "Single-platform build completed: $image_name"
}

# ===== CLEANUP FUNCTIONS =====
cleanup_images() {
    log_info "Cleaning up unused Docker images..."
    
    # Remove dangling images
    docker image prune -f
    
    # Remove build cache
    docker builder prune -f
    
    log_success "Cleanup completed"
}

show_help() {
    cat << EOF
Self-Host Serv Agent - Docker Build Script

USAGE:
    $0 [COMMAND] [OPTIONS]

COMMANDS:
    local                 Build local image for testing
    publish               Build and publish multi-platform image to Docker Hub
    single [PLATFORM]     Build single platform image (default: linux/amd64)
    start                 Start application using optimized docker-compose configuration
    cleanup               Clean up unused Docker images and build cache
    help                  Show this help message

PLATFORMS:
    linux/amd64           x86_64 architecture (default)
    linux/arm64           ARM 64-bit architecture  
    linux/arm/v7          ARM 32-bit architecture

ENVIRONMENT VARIABLES:
    DOCKER_REGISTRY        Docker registry (default: docker.io)
    DOCKER_NAMESPACE      Docker Hub namespace/organization

EXAMPLES:
    $0 local                              # Build for local testing
    $0 publish                           # Build and publish to Docker Hub
    $0 single linux/arm64                # Build for ARM64 only
    $0 single linux/amd64                # Build for x86_64 only
    DOCKER_NAMESPACE=myorg $0 publish    # Publish to myorg namespace

NOTES:
    - For production builds: Ensure .env.build and .env are configured
    - For development: Use ENVIRONMENT=development or ensure .env is configured  
    - The script uses simplified docker-compose files for application startup
    - For Docker Hub publication, ensure you're logged in: docker login
    - The script supports multi-platform builds for better compatibility

EOF
}

# ===== APPLICATION STARTUP FUNCTIONS =====
start_application() {
    log_info "Starting application with $ENVIRONMENT configuration..."
    
    # Determine compose file (now only production)
    local compose_file="$SCRIPT_DIR/docker-compose.yml"
    
    # Check if compose file exists
    if [[ ! -f "$compose_file" ]]; then
        log_error "Compose file not found: $compose_file"
        exit 1
    fi
    
    # Source environment configuration
    if [[ -f "$SCRIPT_DIR/.env.build" ]]; then
        source "$SCRIPT_DIR/.env.build"
    fi
    
    if [[ -f "$SCRIPT_DIR/.env" ]]; then
        source "$SCRIPT_DIR/.env"
    fi
    
    # Start application with docker-compose
    log_info "Starting application using: $compose_file"
    docker-compose -f "$compose_file" up -d
    
    if [[ $? -eq 0 ]]; then
        log_success "Application started successfully"
        log_info "Use 'docker-compose -f \"$compose_file\" logs' to view logs"
        log_info "Use 'docker-compose -f \"$compose_file\" down' to stop"
    else
        log_error "Failed to start application"
        exit 1
    fi
}

# ===== MAIN SCRIPT =====
main() {
    case "${1:-help}" in
        "local")
            build_local
            ;;
        "publish")
            build_and_publish
            ;;
        "single")
            build_single_platform "${2:-linux/amd64}"
            ;;
        "start")
            start_application
            ;;
        "cleanup")
            cleanup_images
            ;;
        "help"|*)
            show_help
            ;;
    esac
}

# Run main function
main "$@"