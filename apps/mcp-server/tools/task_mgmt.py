"""Task management tools for MCP server."""

from mcp.server.fastmcp import FastMCP
from server.client import InternalAPIClient, APIError
from server.errors import handle_api_error, format_error_response


async def register_task_tools(mcp: FastMCP, client: InternalAPIClient):
    """注册任务管理工具"""

    @mcp.tool()
    async def execute_command(command: str, targets: str = "all") -> str:
        """执行命令
        
        在指定目标主机上执行命令。
        
        Args:
            command: 要执行的命令
            targets: 目标主机ID列表，用逗号分隔，或使用"all"表示所有主机
            
        Returns:
            命令执行结果
        """
        try:
            if targets == "all":
                payload = {"command": command, "targets": "all"}
            else:
                payload = {"command": command, "targets": [target.strip() for target in targets.split(",")]}
            
            result = await client.post("/api/v1/tasks/exec", json=payload)
            return format_task_result(result)
        except Exception as e:
            mcp_error = handle_api_error(e, f"execute_command({command})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def get_task_status(task_id: str) -> str:
        """获取任务状态
        
        获取指定任务的执行状态和结果。
        
        Args:
            task_id: 任务ID
            
        Returns:
            任务状态和结果
        """
        try:
            result = await client.get(f"/api/v1/operations/{task_id}")
            return format_task_status(result)
        except Exception as e:
            mcp_error = handle_api_error(e, f"get_task_status({task_id})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def list_active_tasks() -> str:
        """列出活跃任务
        
        获取当前正在执行的任务列表。
        
        Returns:
            活跃任务列表
        """
        try:
            result = await client.get("/api/v1/operations?status=RUNNING")
            return format_task_list(result)
        except Exception as e:
            mcp_error = handle_api_error(e, "list_active_tasks()")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def get_task_history(limit: int = 20) -> str:
        """获取任务历史
        
        获取最近的任务执行历史。
        
        Args:
            limit: 返回任务数量限制，默认20个
            
        Returns:
            任务历史记录
        """
        try:
            result = await client.get(f"/api/v1/operations?limit={limit}")
            return format_task_history(result)
        except Exception as e:
            mcp_error = handle_api_error(e, f"get_task_history({limit})")
            return format_error_response(mcp_error)


def format_task_result(result: dict) -> str:
    """格式化任务执行结果"""
    task_id = result.get("taskId")
    if not task_id:
        return "❌ 任务执行失败：未返回任务ID"
    
    return f"✅ **任务已启动**\n\n**任务ID**: `{task_id}`\n\n请使用任务ID查询执行进度和结果。"


def format_task_status(result: dict) -> str:
    """格式化任务状态"""
    if not result:
        return "❌ 任务状态获取失败：无结果返回"
    
    task_id = result.get("id", "Unknown")
    status = result.get("status", "Unknown")
    started_at = result.get("startedAt", "Unknown")
    finished_at = result.get("finishedAt")
    
    result_text = f"# 📋 任务状态: {task_id}\n\n"
    result_text += f"## 📊 基本信息\n\n"
    result_text += f"- **状态**: {status}\n"
    result_text += f"- **开始时间**: {started_at}\n"
    if finished_at:
        result_text += f"- **结束时间**: {finished_at}\n"
    result_text += "\n"
    
    # 任务条目
    if result.get("entries"):
        result_text += "## 📝 执行日志\n\n"
        for entry in result["entries"]:
            timestamp = entry.get("timestamp", "Unknown")
            stream = entry.get("stream", "unknown")
            content = entry.get("content", "")
            host_id = entry.get("hostId", "")
            
            stream_emoji = {
                "stdout": "📤",
                "stderr": "📥", 
                "system": "⚙️",
                "info": "ℹ️",
                "error": "❌"
            }.get(stream, "📄")
            
            result_text += f"### {stream_emoji} {timestamp}\n"
            if host_id:
                result_text += f"**主机**: `{host_id}`\n"
            result_text += f"```\n{content}\n```\n\n"
    
    return result_text


def format_task_list(result) -> str:
    """格式化任务列表"""
    # 处理列表格式的响应
    if isinstance(result, list):
        if not result:
            return "# 📋 活跃任务\n\n当前没有正在执行的任务"
        
        result_text = "# 📋 活跃任务列表\n\n"
        for task in result:
            task_id = task.get("id", "Unknown")
            status = task.get("status", "Unknown")
            started_at = task.get("startedAt", "Unknown")
            task_type = task.get("type", "Unknown")
            
            status_emoji = "🟢" if status == "RUNNING" else "⚪"
            result_text += f"## {status_emoji} {task_id}\n"
            result_text += f"- **类型**: {task_type}\n"
            result_text += f"- **状态**: {status}\n"
            result_text += f"- **开始时间**: {started_at}\n\n"
        return result_text
    
    # 处理字典格式的响应
    if not result.get("items"):
        return "# 📋 活跃任务\n\n当前没有正在执行的任务"
    
    result_text = "# 📋 活跃任务列表\n\n"
    
    for task in result["items"]:
        task_id = task.get("id", "Unknown")
        status = task.get("status", "Unknown")
        started_at = task.get("startedAt", "Unknown")
        task_type = task.get("type", "Unknown")
        
        status_emoji = "🟢" if status == "RUNNING" else "⚪"
        result_text += f"## {status_emoji} {task_id}\n"
        result_text += f"- **类型**: {task_type}\n"
        result_text += f"- **状态**: {status}\n"
        result_text += f"- **开始时间**: {started_at}\n\n"
    
    return result_text


def format_task_history(result) -> str:
    """格式化任务历史"""
    # 处理列表格式的响应
    if isinstance(result, list):
        if not result:
            return "# 📋 任务历史\n\n暂无任务历史记录"
        
        result_text = "# 📋 任务历史记录\n\n"
        for task in result:
            task_id = task.get("id", "Unknown")
            status = task.get("status", "Unknown")
            started_at = task.get("startedAt", "Unknown")
            finished_at = task.get("finishedAt", "Unknown")
            task_type = task.get("type", "Unknown")
            
            status_emoji = {
                "COMPLETED": "✅",
                "ERROR": "❌",
                "RUNNING": "🟢",
                "PENDING": "⏳"
            }.get(status, "⚪")
            
            result_text += f"## {status_emoji} {task_id}\n"
            result_text += f"- **类型**: {task_type}\n"
            result_text += f"- **状态**: {status}\n"
            result_text += f"- **开始时间**: {started_at}\n"
            if finished_at:
                result_text += f"- **结束时间**: {finished_at}\n"
            result_text += "\n"
        return result_text
    
    # 处理字典格式的响应
    if not result.get("items"):
        return "# 📋 任务历史\n\n暂无任务历史记录"
    
    result_text = "# 📋 任务历史记录\n\n"
    
    for task in result["items"]:
        task_id = task.get("id", "Unknown")
        status = task.get("status", "Unknown")
        started_at = task.get("startedAt", "Unknown")
        finished_at = task.get("finishedAt", "Unknown")
        task_type = task.get("type", "Unknown")
        
        status_emoji = {
            "COMPLETED": "✅",
            "ERROR": "❌",
            "RUNNING": "🟢",
            "PENDING": "⏳"
        }.get(status, "⚪")
        
        result_text += f"## {status_emoji} {task_id}\n"
        result_text += f"- **类型**: {task_type}\n"
        result_text += f"- **状态**: {status}\n"
        result_text += f"- **开始时间**: {started_at}\n"
        if finished_at:
            result_text += f"- **结束时间**: {finished_at}\n"
        result_text += "\n"
    
    return result_text
