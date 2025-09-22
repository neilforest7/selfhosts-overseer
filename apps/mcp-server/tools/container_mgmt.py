"""Container management tools for MCP server."""

from mcp.server.fastmcp import FastMCP
from server.client import InternalAPIClient, APIError
from server.errors import handle_api_error, format_error_response


async def register_container_tools(mcp: FastMCP, client: InternalAPIClient):
    """注册容器管理工具"""

    @mcp.tool()
    async def start_container(container_id: str, wait_for_healthy: bool = False, timeout: int = 60) -> str:
        """启动容器
        
        启动指定的容器，可选择等待容器变为健康状态。
        
        Args:
            container_id: 容器ID
            wait_for_healthy: 是否等待容器变为健康状态
            timeout: 超时时间（秒），默认60秒
            
        Returns:
            容器启动结果
        """
        try:
            # 首先获取容器信息以获取hostId
            containers = await client.get("/api/v1/containers")
            container = None
            for c in containers.get("items", []):
                if c.get("id") == container_id:
                    container = c
                    break
            
            if not container:
                return f"❌ **容器启动失败**\n\n**错误**: 容器 {container_id} 不存在"
            
            host_id = container.get("hostId")
            if not host_id:
                return f"❌ **容器启动失败**\n\n**错误**: 容器 {container_id} 没有关联的主机"
            
            payload = {
                "host": {"id": host_id},
                "waitForHealthy": wait_for_healthy,
                "timeout": timeout
            }
            result = await client.post(f"/api/v1/containers/{container_id}/start", json=payload)
            return format_container_action_result(result, "启动")
        except Exception as e:
            mcp_error = handle_api_error(e, f"start_container({container_id})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def stop_container(container_id: str, timeout: int = 30) -> str:
        """停止容器
        
        停止指定的容器。
        
        Args:
            container_id: 容器ID
            timeout: 超时时间（秒），默认30秒
            
        Returns:
            容器停止结果
        """
        try:
            # 首先获取容器信息以获取hostId
            containers = await client.get("/api/v1/containers")
            container = None
            for c in containers.get("items", []):
                if c.get("id") == container_id:
                    container = c
                    break
            
            if not container:
                return f"❌ **容器停止失败**\n\n**错误**: 容器 {container_id} 不存在"
            
            host_id = container.get("hostId")
            if not host_id:
                return f"❌ **容器停止失败**\n\n**错误**: 容器 {container_id} 没有关联的主机"
            
            payload = {
                "host": {"id": host_id},
                "timeout": timeout
            }
            result = await client.post(f"/api/v1/containers/{container_id}/stop", json=payload)
            return format_container_action_result(result, "停止")
        except Exception as e:
            mcp_error = handle_api_error(e, f"stop_container({container_id})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def restart_container(container_id: str, wait_for_healthy: bool = False, timeout: int = 60) -> str:
        """重启容器
        
        重启指定的容器，可选择等待容器变为健康状态。
        
        Args:
            container_id: 容器ID
            wait_for_healthy: 是否等待容器变为健康状态
            timeout: 超时时间（秒），默认60秒
            
        Returns:
            容器重启结果
        """
        try:
            # 首先获取容器信息以获取hostId
            containers = await client.get("/api/v1/containers")
            container = None
            for c in containers.get("items", []):
                if c.get("id") == container_id:
                    container = c
                    break
            
            if not container:
                return f"❌ **容器重启失败**\n\n**错误**: 容器 {container_id} 不存在"
            
            host_id = container.get("hostId")
            if not host_id:
                return f"❌ **容器重启失败**\n\n**错误**: 容器 {container_id} 没有关联的主机"
            
            payload = {
                "host": {"id": host_id},
                "waitForHealthy": wait_for_healthy,
                "timeout": timeout
            }
            result = await client.post(f"/api/v1/containers/{container_id}/restart", json=payload)
            return format_container_action_result(result, "重启")
        except Exception as e:
            mcp_error = handle_api_error(e, f"restart_container({container_id})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def update_container(container_id: str, pull_image: bool = True, recreate: bool = True) -> str:
        """更新容器
        
        更新容器到最新版本，包括拉取镜像和重新创建容器。
        
        Args:
            container_id: 容器ID
            pull_image: 是否拉取最新镜像
            recreate: 是否重新创建容器
            
        Returns:
            容器更新结果
        """
        try:
            # 首先获取容器信息以获取hostId
            containers = await client.get("/api/v1/containers")
            container = None
            for c in containers.get("items", []):
                if c.get("id") == container_id:
                    container = c
                    break
            
            if not container:
                return f"❌ **容器更新失败**\n\n**错误**: 容器 {container_id} 不存在"
            
            host_id = container.get("hostId")
            if not host_id:
                return f"❌ **容器更新失败**\n\n**错误**: 容器 {container_id} 没有关联的主机"
            
            payload = {
                "host": {"id": host_id},
                "pullImage": pull_image,
                "recreate": recreate
            }
            result = await client.post(f"/api/v1/containers/{container_id}/update", json=payload)
            return format_container_action_result(result, "更新")
        except Exception as e:
            mcp_error = handle_api_error(e, f"update_container({container_id})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def check_container_update(container_id: str) -> str:
        """检查容器更新
        
        检查指定容器是否有可用更新。
        
        Args:
            container_id: 容器ID
            
        Returns:
            容器更新检查结果
        """
        try:
            result = await client.post(f"/api/v1/containers/{container_id}/check-update")
            return format_update_check_result(result)
        except Exception as e:
            mcp_error = handle_api_error(e, f"check_container_update({container_id})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def discover_containers(host_ids: str = "all") -> str:
        """发现容器
        
        在指定主机上发现新的容器。
        
        Args:
            host_ids: 主机ID列表，用逗号分隔，或使用"all"表示所有主机
            
        Returns:
            容器发现结果
        """
        try:
            if host_ids == "all":
                # 获取所有主机ID
                hosts = await client.get("/api/v1/hosts")
                host_id_list = [host["id"] for host in hosts.get("items", [])]
                payload = {"hostIds": host_id_list}
            else:
                payload = {"hostIds": [host_id.strip() for host_id in host_ids.split(",")]}
            
            result = await client.post("/api/v1/containers/discover", json=payload)
            return format_discovery_result(result)
        except Exception as e:
            mcp_error = handle_api_error(e, f"discover_containers({host_ids})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def check_all_updates() -> str:
        """检查所有容器更新
        
        检查所有容器是否有可用更新。
        
        Returns:
            所有容器的更新检查结果
        """
        try:
            result = await client.post("/api/v1/containers/check-updates")
            return format_bulk_update_result(result)
        except Exception as e:
            mcp_error = handle_api_error(e, "check_all_updates()")
            return format_error_response(mcp_error)


def format_container_action_result(result: dict, action: str) -> str:
    """格式化容器操作结果"""
    # 检查是否返回了任务ID（异步操作）
    task_id = result.get("taskId")
    if task_id:
        return f"✅ **容器{action}任务已启动**\n\n**任务ID**: `{task_id}`\n\n请使用任务ID查询操作进度和结果。"
    
    # 检查直接的成功/失败结果
    success = result.get("success", False)
    message = result.get("message", "Unknown")

    if success:
        result_text = f"✅ **容器{action}成功**\n\n"
        result_text += f"**状态**: {message}\n"
        if task_id:
            result_text += f"**任务ID**: `{task_id}`\n"
        return result_text
    else:
        return f"❌ **容器{action}失败**\n\n**错误**: {message}"


def format_update_check_result(result: dict) -> str:
    """格式化更新检查结果"""
    if not result:
        return "❌ 更新检查失败：无结果返回"
    
    result_text = "# 🔄 容器更新检查结果\n\n"
    
    # 统计信息
    total = result.get("total", 0)
    updates_available = result.get("updatesAvailable", 0)
    checked = result.get("checked", 0)
    
    result_text += f"## 📊 检查统计\n\n"
    result_text += f"- **总数**: {total}\n"
    result_text += f"- **已检查**: {checked}\n"
    result_text += f"- **有更新**: {updates_available} 🔄\n"
    result_text += f"- **更新率**: {round((updates_available/total*100) if total > 0 else 0, 1)}%\n\n"
    
    # 详细结果
    if result.get("results"):
        result_text += "## 📋 详细结果\n\n"
        for container_result in result["results"]:
            container_name = container_result.get("containerName", "Unknown")
            update_available = container_result.get("updateAvailable", False)
            status_emoji = "🔄" if update_available else "✅"
            result_text += f"### {status_emoji} {container_name}\n"
            result_text += f"- **当前版本**: {container_result.get('currentTag', 'N/A')}\n"
            result_text += f"- **最新版本**: {container_result.get('latestTag', 'N/A')}\n"
            result_text += f"- **更新可用**: {'是' if update_available else '否'}\n\n"
    
    return result_text


def format_discovery_result(result: dict) -> str:
    """格式化容器发现结果"""
    if not result:
        return "❌ 容器发现失败：无结果返回"
    
    # 根据API文档，discover返回任务ID
    task_id = result.get("taskId")
    if task_id:
        return f"✅ **容器发现任务已启动**\n\n**任务ID**: `{task_id}`\n\n请使用任务ID查询发现进度和结果。"
    
    return "❌ 容器发现失败：未返回任务ID"


def format_bulk_update_result(result: dict) -> str:
    """格式化批量更新检查结果"""
    if not result:
        return "❌ 批量更新检查失败：无结果返回"
    
    result_text = "# 🔄 批量更新检查结果\n\n"
    
    # 统计信息
    total = result.get("total", 0)
    updates_available = result.get("updatesAvailable", 0)
    checked = result.get("checked", 0)
    
    result_text += f"## 📊 检查统计\n\n"
    result_text += f"- **总数**: {total}\n"
    result_text += f"- **已检查**: {checked}\n"
    result_text += f"- **有更新**: {updates_available} 🔄\n"
    result_text += f"- **更新率**: {round((updates_available/total*100) if total > 0 else 0, 1)}%\n\n"
    
    # 按主机分组的结果
    if result.get("byHost"):
        result_text += "## 🖥️ 按主机分组\n\n"
        for host_result in result["byHost"]:
            host_name = host_result.get("hostName", "Unknown")
            host_total = host_result.get("total", 0)
            host_updates = host_result.get("updatesAvailable", 0)
            result_text += f"### 🖥️ {host_name}\n"
            result_text += f"- **总数**: {host_total}\n"
            result_text += f"- **有更新**: {host_updates}\n\n"
    
    return result_text
