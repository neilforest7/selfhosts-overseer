"""Container resources for MCP server."""

from mcp.server.fastmcp import FastMCP
from server.client import InternalAPIClient, APIError
from server.errors import handle_api_error, format_error_response


async def register_containers_resources(mcp: FastMCP, client: InternalAPIClient):
    """注册容器相关资源"""

    @mcp.resource("selfhost://containers/overview")
    async def get_containers_overview() -> str:
        """获取容器概览仪表板"""
        try:
            containers = await client.get("/api/v1/containers")
            return format_containers_overview(containers)
        except Exception as e:
            mcp_error = handle_api_error(e, "selfhost://containers/overview")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://containers/summary")
    async def get_containers_summary() -> str:
        """获取容器汇总统计"""
        try:
            containers = await client.get("/api/v1/containers")
            return format_containers_summary(containers)
        except Exception as e:
            mcp_error = handle_api_error(e, "selfhost://containers/summary")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://containers/{container_id}/details")
    async def get_container_details(container_id: str) -> str:
        """获取特定容器详情"""
        try:
            container = await client.get(f"/api/v1/containers/{container_id}")
            return format_container_details(container)
        except Exception as e:
            mcp_error = handle_api_error(e, f"selfhost://containers/{container_id}/details")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://containers/by-host/{host_id}")
    async def get_containers_by_host(host_id: str) -> str:
        """获取特定主机的容器"""
        try:
            containers = await client.get(f"/api/v1/containers?hostId={host_id}")
            return format_containers_overview(containers)
        except Exception as e:
            mcp_error = handle_api_error(e, f"selfhost://containers/by-host/{host_id}")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://containers/by-status/{status}")
    async def get_containers_by_status(status: str) -> str:
        """按状态获取容器"""
        try:
            containers = await client.get("/api/v1/containers")
            filtered_containers = {
                "items": [c for c in containers.get("items", []) if c.get("status", "").upper() == status.upper()]
            }
            return format_containers_overview(filtered_containers)
        except Exception as e:
            mcp_error = handle_api_error(e, f"selfhost://containers/by-status/{status}")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://containers/update-status")
    async def get_containers_update_status() -> str:
        """获取容器更新状态"""
        try:
            containers = await client.get("/api/v1/containers")
            return format_update_status(containers)
        except Exception as e:
            mcp_error = handle_api_error(e, "selfhost://containers/update-status")
            return format_error_response(mcp_error)


def format_containers_overview(containers: dict) -> str:
    """格式化容器概览 - Markdown格式"""
    if not containers.get("items"):
        return "# 📦 容器概览\n\n暂无容器数据"
    
    result = "# 📦 容器概览\n\n"
    
    # 统计信息
    total = len(containers["items"])
    running = len([c for c in containers["items"] if c.get("status") == "running"])
    stopped = len([c for c in containers["items"] if c.get("status") == "exited"])
    other = total - running - stopped
    
    result += "## 📊 统计信息\n\n"
    result += f"- **总数**: {total}\n"
    result += f"- **运行中**: {running} 🟢\n"
    result += f"- **已停止**: {stopped} 🔴\n"
    result += f"- **其他状态**: {other} ⚪\n\n"
    
    # 容器列表
    result += "## 📦 容器列表\n\n"
    for container in containers["items"]:
        status_emoji = "🟢" if container.get("status") == "running" else "🔴"
        result += f"### {status_emoji} {container['name']}\n"
        result += f"- **ID**: `{container['id']}`\n"
        result += f"- **状态**: {container.get('status', 'unknown')}\n"
        result += f"- **镜像**: {container.get('imageName', 'N/A')}:{container.get('imageTag', 'N/A')}\n"
        result += f"- **主机**: {container.get('hostId', 'N/A')}\n"
        result += f"- **重启次数**: {container.get('restartCount', 0)}\n"
        if container.get('updateAvailable'):
            result += f"- **更新状态**: 🔄 有可用更新\n"
        result += "\n"
    
    return result


def format_containers_summary(containers: dict) -> str:
    """格式化容器汇总统计 - JSON格式"""
    if not containers.get("items"):
        return '{"total": 0, "running": 0, "stopped": 0, "containers": []}'
    
    total = len(containers["items"])
    running = len([c for c in containers["items"] if c.get("status") == "running"])
    stopped = len([c for c in containers["items"] if c.get("status") == "exited"])
    
    summary = {
        "total": total,
        "running": running,
        "stopped": stopped,
        "running_percentage": round((running / total * 100) if total > 0 else 0, 2),
        "containers": [
            {
                "id": container["id"],
                "name": container["name"],
                "status": container.get("status"),
                "imageName": container.get("imageName"),
                "imageTag": container.get("imageTag"),
                "hostId": container.get("hostId"),
                "restartCount": container.get("restartCount", 0),
                "updateAvailable": container.get("updateAvailable", False)
            }
            for container in containers["items"]
        ]
    }
    
    import json
    return json.dumps(summary, indent=2, ensure_ascii=False)


def format_container_details(container: dict) -> str:
    """格式化容器详情 - Markdown格式"""
    result = f"# 📦 {container['name']} - 容器详情\n\n"
    
    result += "## 📋 基本信息\n\n"
    result += f"- **ID**: `{container['id']}`\n"
    result += f"- **名称**: {container['name']}\n"
    result += f"- **状态**: {container.get('status', 'unknown')}\n"
    result += f"- **镜像**: {container.get('imageName', 'N/A')}:{container.get('imageTag', 'N/A')}\n"
    result += f"- **主机ID**: `{container.get('hostId', 'N/A')}`\n"
    result += f"- **重启次数**: {container.get('restartCount', 0)}\n\n"
    
    # 镜像信息
    if container.get('imageName'):
        result += "## 🐳 镜像信息\n\n"
        result += f"- **镜像名称**: {container.get('imageName', 'N/A')}\n"
        result += f"- **镜像标签**: {container.get('imageTag', 'N/A')}\n"
        result += f"- **更新可用**: {'是' if container.get('updateAvailable') else '否'}\n"
        if container.get('updateCheckedAt'):
            result += f"- **更新检查时间**: {container['updateCheckedAt']}\n"
        result += "\n"
    
    # 端口和挂载
    if container.get('ports'):
        result += "## 🔗 端口映射\n\n"
        for port, mapping in container['ports'].items():
            result += f"- **{port}**: {mapping}\n"
        result += "\n"
    
    if container.get('mounts'):
        result += "## 💾 挂载信息\n\n"
        for mount, info in container['mounts'].items():
            result += f"- **{mount}**: {info}\n"
        result += "\n"
    
    # Compose信息
    if container.get('isComposeManaged'):
        result += "## 🐙 Compose信息\n\n"
        result += f"- **Compose项目**: {container.get('composeProject', 'N/A')}\n"
        result += f"- **Compose服务**: {container.get('composeService', 'N/A')}\n"
        result += f"- **工作目录**: {container.get('composeWorkingDir', 'N/A')}\n\n"
    
    return result


def format_update_status(containers: dict) -> str:
    """格式化更新状态 - JSON格式"""
    if not containers.get("items"):
        return '{"total": 0, "updates_available": 0, "containers": []}'
    
    total = len(containers["items"])
    updates_available = len([c for c in containers["items"] if c.get("updateAvailable")])
    
    update_status = {
        "total": total,
        "updates_available": updates_available,
        "update_percentage": round((updates_available / total * 100) if total > 0 else 0, 2),
        "containers": [
            {
                "id": container["id"],
                "name": container["name"],
                "imageName": container.get("imageName"),
                "imageTag": container.get("imageTag"),
                "updateAvailable": container.get("updateAvailable", False),
                "updateCheckedAt": container.get("updateCheckedAt")
            }
            for container in containers["items"]
            if container.get("updateAvailable")
        ]
    }
    
    import json
    return json.dumps(update_status, indent=2, ensure_ascii=False)
