#!/bin/bash

# MCP Server Docker 构建脚本

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
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

# 显示帮助
show_help() {
    echo "MCP Server Docker 构建脚本"
    echo ""
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --tag TAG         设置镜像标签 (默认: latest)"
    echo "  --no-cache        不使用缓存构建"
    echo "  --push            构建后推送到仓库"
    echo "  --proxy PROXY     设置代理地址 (默认: http://192.168.31.5:7890)"
    echo "  --help            显示帮助"
    echo ""
    echo "示例:"
    echo "  $0                           # 构建 latest 标签"
    echo "  $0 --tag v1.0.0              # 构建 v1.0.0 标签"
    echo "  $0 --no-cache                # 不使用缓存构建"
    echo "  $0 --tag v1.0.0 --push       # 构建并推送"
    echo "  $0 --proxy http://proxy:8080  # 使用自定义代理"
}

# 默认参数
TAG="latest"
NO_CACHE=""
PUSH=false
PROXY="http://192.168.31.5:7890"

# 解析参数
while [[ $# -gt 0 ]]; do
    case $1 in
        --tag)
            TAG="$2"
            shift 2
            ;;
        --no-cache)
            NO_CACHE="--no-cache"
            shift
            ;;
        --push)
            PUSH=true
            shift
            ;;
        --proxy)
            PROXY="$2"
            shift 2
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "未知参数: $1"
            show_help
            exit 1
            ;;
    esac
done

log_info "MCP Server Docker 构建脚本"
log_info "镜像标签: $TAG"
log_info "代理地址: $PROXY"

# 检查Docker
if ! command -v docker &> /dev/null; then
    log_error "Docker 未安装"
    exit 1
fi

# 检查Dockerfile
if [ ! -f "Dockerfile" ]; then
    log_error "Dockerfile 不存在"
    exit 1
fi

# 检查pyproject.toml
if [ ! -f "pyproject.toml" ]; then
    log_error "pyproject.toml 不存在"
    exit 1
fi

# 构建镜像
log_info "开始构建 Docker 镜像..."
IMAGE_NAME="selfhost-mcp-server:$TAG"

if docker build $NO_CACHE \
    --build-arg HTTP_PROXY=$PROXY \
    --build-arg HTTPS_PROXY=$PROXY \
    --build-arg NO_PROXY=localhost,127.0.0.1 \
    -t $IMAGE_NAME .; then
    log_success "Docker 镜像构建成功: $IMAGE_NAME"
else
    log_error "Docker 镜像构建失败"
    exit 1
fi

# 显示镜像信息
log_info "镜像信息:"
docker images | grep selfhost-mcp-server | head -1

# 推送镜像
if [ "$PUSH" = true ]; then
    log_info "推送镜像到仓库..."
    if docker push $IMAGE_NAME; then
        log_success "镜像推送成功"
    else
        log_error "镜像推送失败"
        exit 1
    fi
fi

log_success "构建完成！"
log_info "使用方法:"
log_info "  本地运行: docker run -d --name mcp-server $IMAGE_NAME"
log_info "  Docker Compose: docker compose up -d"
