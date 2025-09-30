#!/bin/bash

# NPM 多版本检测脚本
# 用于检测系统中是否存在多个 npm 版本

echo "=========================================="
echo "NPM 多版本检测脚本"
echo "=========================================="
echo

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检测函数
check_npm_versions() {
    echo -e "${BLUE}1. 检查当前使用的 npm 路径和版本:${NC}"
    if command -v npm >/dev/null 2>&1; then
        npm_path=$(which npm)
        npm_version=$(npm --version 2>/dev/null)
        echo -e "   路径: ${GREEN}$npm_path${NC}"
        echo -e "   版本: ${GREEN}$npm_version${NC}"
    else
        echo -e "   ${RED}npm 未找到${NC}"
        return 1
    fi
    echo

    echo -e "${BLUE}2. 检查系统中所有 npm 可执行文件:${NC}"
    npm_paths=()
    
    # 查找所有可能的 npm 路径
    for path in /usr/bin/npm /usr/local/bin/npm /opt/*/bin/npm ~/.nvm/versions/node/*/bin/npm ~/.n/*/bin/npm; do
        if [ -f "$path" ] || [ -L "$path" ]; then
            npm_paths+=("$path")
        fi
    done
    
    # 使用 find 命令查找更多路径
    while IFS= read -r -d '' path; do
        if [[ ! " ${npm_paths[@]} " =~ " ${path} " ]]; then
            npm_paths+=("$path")
        fi
    done < <(find /usr /opt /home -name "npm" -type f -executable 2>/dev/null | head -10 | tr '\n' '\0')
    
    if [ ${#npm_paths[@]} -eq 0 ]; then
        echo -e "   ${YELLOW}未找到其他 npm 路径${NC}"
    else
        echo -e "   找到 ${GREEN}${#npm_paths[@]}${NC} 个 npm 路径:"
        for path in "${npm_paths[@]}"; do
            if [ -L "$path" ]; then
                real_path=$(readlink -f "$path" 2>/dev/null)
                echo -e "   - ${YELLOW}$path${NC} -> $real_path"
            else
                echo -e "   - $path"
            fi
        done
    fi
    echo

    echo -e "${BLUE}3. 检查 Node.js 版本管理工具:${NC}"
    
    # 检查 NVM (NVM 是 shell 函数，需要特殊检测)
    if [ -f ~/.nvm/nvm.sh ] || [ -n "$NVM_DIR" ] || type nvm >/dev/null 2>&1; then
        echo -e "   ${GREEN}NVM 已安装${NC}"
        
        # 加载 NVM 如果尚未加载
        if [ -n "$NVM_DIR" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
            . "$NVM_DIR/nvm.sh"
        fi
        
        nvm_version=$(nvm --version 2>/dev/null || echo "未知版本")
        echo -e "   NVM 版本: $nvm_version"
        echo -e "   NVM 目录: ${NVM_DIR:-~/.nvm}"
        
        # 检查 NVM 管理的 Node.js 版本
        nvm_node_dir="${NVM_DIR:-$HOME/.nvm}/versions/node"
        if [ -d "$nvm_node_dir" ]; then
            nvm_versions=$(ls "$nvm_node_dir" 2>/dev/null | wc -l)
            echo -e "   NVM 管理的 Node.js 版本数量: $nvm_versions"
            if [ $nvm_versions -gt 0 ]; then
                echo -e "   NVM 版本列表:"
                ls "$nvm_node_dir" 2>/dev/null | while read version; do
                    echo -e "     - $version"
                done
                
                # 检查当前使用的版本
                current_node=$(which node 2>/dev/null)
                if [[ "$current_node" == *".nvm"* ]]; then
                    current_version=$(echo "$current_node" | grep -o 'v[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)
                    echo -e "   当前激活版本: ${GREEN}$current_version${NC}"
                fi
            fi
        fi
    else
        echo -e "   ${YELLOW}NVM 未安装${NC}"
    fi
    
    # 检查 n
    if command -v n >/dev/null 2>&1; then
        echo -e "   ${GREEN}n 已安装${NC}"
    else
        echo -e "   ${YELLOW}n 未安装${NC}"
    fi
    
    # 检查 fnm
    if command -v fnm >/dev/null 2>&1; then
        echo -e "   ${GREEN}fnm 已安装${NC}"
    else
        echo -e "   ${YELLOW}fnm 未安装${NC}"
    fi
    echo

    echo -e "${BLUE}4. 检查系统包管理器安装的 Node.js:${NC}"
    
    # 检查 apt 安装的 Node.js
    if command -v dpkg >/dev/null 2>&1; then
        apt_node=$(dpkg -l 2>/dev/null | grep -E '^ii.*nodejs' | awk '{print $2 " " $3}')
        if [ -n "$apt_node" ]; then
            echo -e "   ${GREEN}APT 安装: $apt_node${NC}"
        else
            echo -e "   ${YELLOW}APT 未安装 Node.js${NC}"
        fi
    fi
    
    # 检查 yum 安装的 Node.js
    if command -v rpm >/dev/null 2>&1; then
        yum_node=$(rpm -qa | grep nodejs 2>/dev/null)
        if [ -n "$yum_node" ]; then
            echo -e "   ${GREEN}YUM 安装: $yum_node${NC}"
        else
            echo -e "   ${YELLOW}YUM 未安装 Node.js${NC}"
        fi
    fi
    
    # 检查 pacman 安装的 Node.js
    if command -v pacman >/dev/null 2>&1; then
        pacman_node=$(pacman -Q nodejs 2>/dev/null)
        if [ -n "$pacman_node" ]; then
            echo -e "   ${GREEN}PACMAN 安装: $pacman_node${NC}"
        else
            echo -e "   ${YELLOW}PACMAN 未安装 Node.js${NC}"
        fi
    fi
    echo

    echo -e "${BLUE}5. 检查 PATH 环境变量:${NC}"
    echo -e "   PATH 中的 Node.js 相关路径:"
    echo "$PATH" | tr ':' '\n' | grep -E '(node|npm)' | while read path; do
        if [ -d "$path" ]; then
            echo -e "   - $path"
        fi
    done
    echo

    echo -e "${BLUE}6. 总结:${NC}"
    
    # 计算潜在问题
    issues=0
    
    # 检查是否有多个 npm 路径
    if [ ${#npm_paths[@]} -gt 1 ]; then
        echo -e "   ${YELLOW}⚠️  发现多个 npm 路径，可能存在版本冲突${NC}"
        issues=$((issues + 1))
    fi
    
    # 检查是否有版本管理工具和系统安装并存
    nvm_installed=false
    if [ -f ~/.nvm/nvm.sh ] || [ -n "$NVM_DIR" ] || type nvm >/dev/null 2>&1; then
        nvm_installed=true
    fi
    
    system_nodejs=false
    if dpkg -l 2>/dev/null | grep -q nodejs || rpm -qa 2>/dev/null | grep -q nodejs || pacman -Q nodejs >/dev/null 2>&1; then
        system_nodejs=true
    fi
    
    if [ "$nvm_installed" = true ] && [ "$system_nodejs" = true ]; then
        echo -e "   ${YELLOW}⚠️  同时存在 NVM 和系统包管理器安装的 Node.js${NC}"
        echo -e "   ${YELLOW}   建议：可以考虑让 NVM 完全接管 Node.js 版本管理${NC}"
        issues=$((issues + 1))
    fi
    
    if [ $issues -eq 0 ]; then
        echo -e "   ${GREEN}✅ 未发现明显的版本冲突问题${NC}"
    else
        echo -e "   ${RED}❌ 发现 $issues 个潜在问题${NC}"
    fi
    
    echo
    echo "=========================================="
    echo "检测完成"
    echo "=========================================="
}

# 执行检测
check_npm_versions
