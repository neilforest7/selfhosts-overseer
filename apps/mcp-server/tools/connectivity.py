"""Connectivity testing tools for MCP server."""

from mcp.server.fastmcp import FastMCP
from server.client import InternalAPIClient, APIError
from server.errors import handle_api_error, format_error_response


async def register_connectivity_tools(mcp: FastMCP, client: InternalAPIClient):
    """注册连通性测试工具"""

    @mcp.tool()
    async def test_host_connectivity(host_id: str) -> str:
        """测试指定主机的连通性
        
        执行SSH连接测试，检查主机是否可达并测量延迟。
        
        Args:
            host_id: 主机ID，要测试连通性的主机标识符
            
        Returns:
            连通性测试结果，包含成功状态、消息和延迟信息
        """
        try:
            result = await client.post(f"/api/v1/hosts/{host_id}/test-connection")
            return format_connectivity_result(result)
        except Exception as e:
            mcp_error = handle_api_error(e, f"test_host_connectivity({host_id})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def test_all_hosts_connectivity() -> str:
        """测试所有主机的连通性
        
        批量测试所有注册主机的连通性状态。
        
        Returns:
            所有主机的连通性测试结果汇总
        """
        try:
            result = await client.post("/api/v1/hosts/check-all-connectivity")
            return format_bulk_connectivity_result(result)
        except Exception as e:
            mcp_error = handle_api_error(e, "test_all_hosts_connectivity()")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def get_connectivity_stats() -> str:
        """获取连通性统计信息
        
        获取所有主机的连通性统计数据和历史记录。
        
        Returns:
            JSON格式的连通性统计数据
        """
        try:
            result = await client.get("/api/v1/hosts/connectivity/stats")
            return format_connectivity_stats(result)
        except Exception as e:
            mcp_error = handle_api_error(e, "get_connectivity_stats()")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def get_host_connectivity_history(host_id: str, limit: int = 50) -> str:
        """获取主机连通性历史记录
        
        获取指定主机的连通性历史记录。
        
        Args:
            host_id: 主机ID
            limit: 返回记录数量限制，默认50条
            
        Returns:
            主机连通性历史记录
        """
        try:
            result = await client.get(f"/api/v1/hosts/{host_id}/connectivity?limit={limit}")
            return format_connectivity_history(result)
        except Exception as e:
            mcp_error = handle_api_error(e, f"get_host_connectivity_history({host_id})")
            return format_error_response(mcp_error)


def format_connectivity_result(result: dict) -> str:
    """格式化连通性测试结果"""
    # 处理新的API响应格式
    if "ok" in result:
        success = result.get("ok", False)
        code = result.get("code", -1)
        stdout = result.get("stdout", "").strip()
        stderr = result.get("stderr", "").strip()
        
        if success and code == 0:
            result_text = f"✅ **连通性测试成功**\n\n"
            result_text += f"**状态**: {stdout if stdout else '连接成功'}\n"
            if stderr:
                result_text += f"**输出**: {stderr}\n"
            return result_text
        else:
            error_msg = stderr if stderr else stdout if stdout else f"退出码: {code}"
            return f"❌ **连通性测试失败**\n\n**错误**: {error_msg}"
    
    # 处理旧的API响应格式（兼容性）
    success = result.get("success", False)
    message = result.get("message", "Unknown")
    latency = result.get("latency")

    if success:
        result_text = f"✅ **连通性测试成功**\n\n"
        result_text += f"**状态**: {message}\n"
        if latency:
            result_text += f"**延迟**: {latency}ms\n"
        return result_text
    else:
        return f"❌ **连通性测试失败**\n\n**错误**: {message}"


def format_bulk_connectivity_result(result) -> str:
    """格式化批量连通性测试结果"""
    if not result:
        return "❌ 批量连通性测试失败：无结果返回"
    
    # 处理列表格式的响应
    if isinstance(result, list):
        if not result:
            return "❌ 批量连通性测试失败：无结果返回"
        
        result_text = "# 🔗 批量连通性测试结果\n\n"
        result_text += f"## 📊 测试统计\n\n"
        result_text += f"- **总数**: {len(result)}\n"
        
        # 处理新的API响应格式
        if result and "hostId" in result[0]:
            online_count = sum(1 for r in result if r.get("status") == "ONLINE")
            offline_count = len(result) - online_count
            
            result_text += f"- **在线**: {online_count} 🟢\n"
            result_text += f"- **离线**: {offline_count} 🔴\n"
            result_text += f"- **在线率**: {round((online_count/len(result)*100) if len(result) > 0 else 0, 1)}%\n\n"
            
            result_text += "## 📋 详细结果\n\n"
            for host_result in result:
                host_id = host_result.get("hostId", "Unknown")
                status = host_result.get("status", "UNKNOWN")
                response_time = host_result.get("responseTime", 0)
                checked_at = host_result.get("checkedAt", "")
                
                status_emoji = "🟢" if status == "ONLINE" else "🔴"
                result_text += f"### {status_emoji} {host_id}\n"
                result_text += f"- **状态**: {status}\n"
                result_text += f"- **响应时间**: {response_time}ms\n"
                if checked_at:
                    result_text += f"- **检查时间**: {checked_at}\n"
                result_text += "\n"
        else:
            # 处理旧的API响应格式（兼容性）
            successful = sum(1 for r in result if r.get("success", False))
            failed = len(result) - successful
            
            result_text += f"- **成功**: {successful} 🟢\n"
            result_text += f"- **失败**: {failed} 🔴\n"
            result_text += f"- **成功率**: {round((successful/len(result)*100) if len(result) > 0 else 0, 1)}%\n\n"
            
            result_text += "## 📋 详细结果\n\n"
            for host_result in result:
                host_name = host_result.get("hostName", "Unknown")
                success = host_result.get("success", False)
                status_emoji = "🟢" if success else "🔴"
                result_text += f"### {status_emoji} {host_name}\n"
                result_text += f"- **状态**: {host_result.get('message', 'Unknown')}\n"
                if host_result.get("latency"):
                    result_text += f"- **延迟**: {host_result['latency']}ms\n"
                result_text += "\n"
        
        return result_text
    
    # 处理字典格式的响应
    if isinstance(result, dict):
        # 根据API文档，check-all-connectivity返回任务ID
        task_id = result.get("taskId")
        if task_id:
            return f"✅ **批量连通性测试任务已启动**\n\n**任务ID**: `{task_id}`\n\n请使用任务ID查询测试进度和结果。"
        
        # 如果返回的是直接结果（兼容性处理）
        result_text = "# 🔗 批量连通性测试结果\n\n"
        
        # 统计信息
        total = result.get("total", 0)
        successful = result.get("successful", 0)
        failed = result.get("failed", 0)
        
        result_text += f"## 📊 测试统计\n\n"
        result_text += f"- **总数**: {total}\n"
        result_text += f"- **成功**: {successful} 🟢\n"
        result_text += f"- **失败**: {failed} 🔴\n"
        result_text += f"- **成功率**: {round((successful/total*100) if total > 0 else 0, 1)}%\n\n"
        
        # 详细结果
        if result.get("results"):
            result_text += "## 📋 详细结果\n\n"
            for host_result in result["results"]:
                host_name = host_result.get("hostName", "Unknown")
                success = host_result.get("success", False)
                status_emoji = "🟢" if success else "🔴"
                result_text += f"### {status_emoji} {host_name}\n"
                result_text += f"- **状态**: {host_result.get('message', 'Unknown')}\n"
                if host_result.get("latency"):
                    result_text += f"- **延迟**: {host_result['latency']}ms\n"
                result_text += "\n"
        
        return result_text
    
    # 处理其他格式
    return f"❌ 批量连通性测试失败：未知的响应格式\n\n**响应**: {str(result)[:200]}..."


def format_connectivity_stats(result: dict) -> str:
    """格式化连通性统计数据"""
    import json
    return json.dumps(result, indent=2, ensure_ascii=False)


def format_connectivity_history(result) -> str:
    """格式化连通性历史记录"""
    # 处理列表格式的响应
    if isinstance(result, list):
        if not result:
            return "# 📈 连通性历史\n\n暂无历史记录"
        
        result_text = "# 📈 连通性历史记录\n\n"
        for record in result:
            timestamp = record.get("timestamp", "Unknown")
            status = record.get("status", "Unknown")
            latency = record.get("latency")
            
            status_emoji = "🟢" if status == "ONLINE" else "🔴"
            result_text += f"## {status_emoji} {timestamp}\n"
            result_text += f"- **状态**: {status}\n"
            if latency:
                result_text += f"- **延迟**: {latency}ms\n"
            result_text += "\n"
        return result_text
    
    # 处理字典格式的响应
    if not result.get("items"):
        return "# 📈 连通性历史\n\n暂无历史记录"
    
    result_text = "# 📈 连通性历史记录\n\n"
    
    for record in result["items"]:
        timestamp = record.get("timestamp", "Unknown")
        status = record.get("status", "Unknown")
        latency = record.get("latency")
        
        status_emoji = "🟢" if status == "ONLINE" else "🔴"
        result_text += f"## {status_emoji} {timestamp}\n"
        result_text += f"- **状态**: {status}\n"
        if latency:
            result_text += f"- **延迟**: {latency}ms\n"
        result_text += "\n"
    
    return result_text
