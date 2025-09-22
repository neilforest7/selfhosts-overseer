#!/bin/bash

# Self-Host Serv Agent MCP Server 启动脚本
# 支持开发和生产环境

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

# 检查环境
check_environment() {
    log_info "检查环境..."
    
    # 检查 Python 版本
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 未安装"
        exit 1
    fi
    
    # 检查 uv
    if ! command -v uv &> /dev/null; then
        log_error "uv 未安装"
        exit 1
    fi
    
    log_success "环境检查通过"
}

# 安装依赖
install_dependencies() {
    log_info "安装依赖..."
    uv sync --extra dev
    log_success "依赖安装完成"
}

# 验证配置
validate_config() {
    log_info "验证配置..."
    uv run python validate_config.py
    if [ $? -eq 0 ]; then
        log_success "配置验证通过"
    else
        log_error "配置验证失败"
        exit 1
    fi
}

# 运行测试
run_tests() {
    if [ "$1" = "--skip-tests" ]; then
        log_warning "跳过测试"
        return
    fi
    
    log_info "运行测试..."
    uv run pytest tests/ -v
    if [ $? -eq 0 ]; then
        log_success "测试通过"
    else
        log_error "测试失败"
        exit 1
    fi
}

# 启动服务器
start_server() {
    local mode=$1
    
    log_info "启动 MCP 服务器 (模式: $mode)..."
    
    case $mode in
        "dev")
            log_info "开发模式启动"
            uv run python main.py
            ;;
        "prod")
            log_info "生产模式启动"
            # 设置生产环境变量
            export LOG_LEVEL=WARNING
            export MCP_SERVER_NAME=selfhost-serv-agent-prod
            
            # 启动服务器
            uv run python main.py &
            SERVER_PID=$!
            
            # 等待服务器启动
            sleep 2
            
            # 检查服务器是否运行
            if ps -p $SERVER_PID > /dev/null; then
                log_success "服务器启动成功 (PID: $SERVER_PID)"
                
                # 启动健康监控
                log_info "启动健康监控..."
                uv run python production_monitor.py monitor &
                MONITOR_PID=$!
                
                log_success "监控启动成功 (PID: $MONITOR_PID)"
                
                # 等待中断信号
                trap 'log_info "正在关闭服务器..."; kill $SERVER_PID $MONITOR_PID 2>/dev/null; exit 0' INT TERM
                
                # 保持运行
                wait
            else
                log_error "服务器启动失败"
                exit 1
            fi
            ;;
        *)
            log_error "未知模式: $mode"
            exit 1
            ;;
    esac
}

# 显示帮助
show_help() {
    echo "Self-Host Serv Agent MCP Server 启动脚本"
    echo ""
    echo "用法: $0 [选项] [模式]"
    echo ""
    echo "模式:"
    echo "  dev     开发模式"
    echo "  prod    生产模式"
    echo ""
    echo "选项:"
    echo "  --skip-tests    跳过测试"
    echo "  --help          显示帮助"
    echo ""
    echo "示例:"
    echo "  $0 dev                    # 开发模式启动"
    echo "  $0 prod                   # 生产模式启动"
    echo "  $0 dev --skip-tests       # 开发模式启动，跳过测试"
}

# 主函数
main() {
    local mode="dev"
    local skip_tests=false
    
    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            dev|prod)
                mode=$1
                shift
                ;;
            --skip-tests)
                skip_tests=true
                shift
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
    
    log_info "Self-Host Serv Agent MCP Server 启动脚本"
    log_info "模式: $mode"
    
    # 执行步骤
    check_environment
    install_dependencies
    validate_config
    
    if [ "$skip_tests" = false ]; then
        run_tests
    else
        run_tests --skip-tests
    fi
    
    start_server $mode
}

# 运行主函数
main "$@"