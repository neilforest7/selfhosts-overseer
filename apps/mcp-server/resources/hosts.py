"""Host resources for MCP server."""

from mcp.server.fastmcp import FastMCP
from server.client import InternalAPIClient, APIError
from server.errors import handle_api_error, format_error_response, MCPResourceNotFoundError


async def register_hosts_resources(mcp: FastMCP, client: InternalAPIClient):
    """注册主机相关资源"""

    @mcp.resource("selfhost://hosts/overview")
    async def get_hosts_overview() -> str:
        """获取主机概览仪表板"""
        try:
            hosts = await client.get("/api/v1/hosts")
            return format_hosts_overview(hosts)
        except Exception as e:
            mcp_error = handle_api_error(e, "selfhost://hosts/overview")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://hosts/summary")
    async def get_hosts_summary() -> str:
        """获取主机汇总统计"""
        try:
            hosts = await client.get("/api/v1/hosts")
            return format_hosts_summary(hosts)
        except Exception as e:
            mcp_error = handle_api_error(e, "selfhost://hosts/summary")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://hosts/{host_id}/details")
    async def get_host_details(host_id: str) -> str:
        """获取特定主机详情"""
        try:
            host = await client.get(f"/api/v1/hosts/{host_id}")
            return format_host_details(host)
        except Exception as e:
            mcp_error = handle_api_error(e, f"selfhost://hosts/{host_id}/details")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://hosts/{host_id}/connectivity")
    async def get_host_connectivity(host_id: str) -> str:
        """获取主机连接历史"""
        try:
            connectivity = await client.get(f"/api/v1/hosts/{host_id}/connectivity")
            return format_connectivity_data(connectivity)
        except Exception as e:
            mcp_error = handle_api_error(e, f"selfhost://hosts/{host_id}/connectivity")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://hosts/by-status/{status}")
    async def get_hosts_by_status(status: str) -> str:
        """按状态获取主机"""
        try:
            hosts = await client.get("/api/v1/hosts")
            filtered_hosts = {
                "items": [h for h in hosts.get("items", []) if h.get("status", "").upper() == status.upper()]
            }
            return format_hosts_overview(filtered_hosts)
        except Exception as e:
            mcp_error = handle_api_error(e, f"selfhost://hosts/by-status/{status}")
            return format_error_response(mcp_error)

    @mcp.resource("selfhost://hosts/by-tag/{tag}")
    async def get_hosts_by_tag(tag: str) -> str:
        """按标签获取主机"""
        try:
            hosts = await client.get(f"/api/v1/hosts?tag={tag}")
            return format_hosts_overview(hosts)
        except Exception as e:
            mcp_error = handle_api_error(e, f"selfhost://hosts/by-tag/{tag}")
            return format_error_response(mcp_error)


def format_hosts_overview(hosts: dict) -> str:
    """格式化主机概览 - Markdown格式"""
    if not hosts.get("items"):
        return "# 🖥️ 主机概览\n\n暂无主机数据"
    
    result = "# 🖥️ 主机概览\n\n"
    
    # 统计信息
    total = len(hosts["items"])
    online = len([h for h in hosts["items"] if h.get("status") == "ONLINE"])
    offline = total - online
    
    result += "## 📊 统计信息\n\n"
    result += f"- **总数**: {total}\n"
    result += f"- **在线**: {online} 🟢\n"
    result += f"- **离线**: {offline} 🔴\n\n"
    
    # 主机列表
    result += "## 🖥️ 主机列表\n\n"
    for host in hosts["items"]:
        status_emoji = "🟢" if host.get("status") == "ONLINE" else "🔴"
        result += f"### {status_emoji} {host['name']}\n"
        result += f"- **ID**: `{host['id']}`\n"
        result += f"- **地址**: {host.get('address', 'N/A')}\n"
        result += f"- **状态**: {host.get('status', 'unknown')}\n"
        result += f"- **端口**: {host.get('port', 22)}\n"
        result += f"- **角色**: {host.get('role', 'unknown')}\n"
        result += f"- **标签**: {', '.join(host.get('tags', [])) or '无'}\n"
        if host.get('lastConnectivityCheck'):
            result += f"- **最后检查**: {host['lastConnectivityCheck']}\n"
        result += "\n"
    
    return result


def format_hosts_summary(hosts: dict) -> str:
    """格式化主机汇总统计 - JSON格式"""
    if not hosts.get("items"):
        return '{"total": 0, "online": 0, "offline": 0, "hosts": []}'
    
    total = len(hosts["items"])
    online = len([h for h in hosts["items"] if h.get("status") == "ONLINE"])
    offline = total - online
    
    summary = {
        "total": total,
        "online": online,
        "offline": offline,
        "online_percentage": round((online / total * 100) if total > 0 else 0, 2),
        "hosts": [
            {
                "id": host["id"],
                "name": host["name"],
                "address": host.get("address"),
                "status": host.get("status"),
                "role": host.get("role"),
                "tags": host.get("tags", []),
                "lastConnectivityCheck": host.get("lastConnectivityCheck")
            }
            for host in hosts["items"]
        ]
    }
    
    import json
    return json.dumps(summary, indent=2, ensure_ascii=False)


def format_host_details(host: dict) -> str:
    """格式化主机详情 - Markdown格式"""
    result = f"# 🖥️ {host['name']} - 主机详情\n\n"
    
    result += "## 📋 基本信息\n\n"
    result += f"- **ID**: `{host['id']}`\n"
    result += f"- **名称**: {host['name']}\n"
    result += f"- **地址**: {host.get('address', 'N/A')}\n"
    result += f"- **端口**: {host.get('port', 22)}\n"
    result += f"- **SSH用户**: {host.get('sshUser', 'N/A')}\n"
    result += f"- **角色**: {host.get('role', 'unknown')}\n"
    result += f"- **状态**: {host.get('status', 'unknown')}\n"
    result += f"- **标签**: {', '.join(host.get('tags', [])) or '无'}\n\n"
    
    # 连接信息
    if host.get('lastConnectivityCheck'):
        result += "## 🔗 连接信息\n\n"
        result += f"- **最后连接检查**: {host['lastConnectivityCheck']}\n"
        if host.get('lastOnlineAt'):
            result += f"- **最后在线时间**: {host['lastOnlineAt']}\n"
        if host.get('lastOfflineAt'):
            result += f"- **最后离线时间**: {host['lastOfflineAt']}\n"
        result += "\n"
    
    # 认证信息
    result += "## 🔐 认证信息\n\n"
    result += f"- **认证方法**: {host.get('sshAuthMethod', 'N/A')}\n"
    result += f"- **有密码**: {'是' if host.get('hasPassword') else '否'}\n"
    result += f"- **有私钥**: {'是' if host.get('hasPrivateKey') else '否'}\n\n"
    
    return result


def format_connectivity_data(connectivity: dict) -> str:
    """格式化连接历史数据 - JSON格式"""
    import json
    return json.dumps(connectivity, indent=2, ensure_ascii=False)
