"""Log management tools for MCP server."""

from mcp.server.fastmcp import FastMCP
from server.client import InternalAPIClient, APIError
from server.errors import handle_api_error, format_error_response


async def register_log_tools(mcp: FastMCP, client: InternalAPIClient):
    """注册日志管理工具"""

    @mcp.tool()
    async def get_application_logs(limit: int = 200) -> str:
        """获取应用程序日志
        
        获取应用程序的日志记录。
        
        Args:
            limit: 返回日志行数限制，默认200行
            
        Returns:
            应用程序日志
        """
        try:
            result = await client.get(f"/api/v1/logs/application?limit={limit}")
            return format_logs(result, "应用程序日志")
        except Exception as e:
            mcp_error = handle_api_error(e, f"get_application_logs({limit})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def get_system_logs(lines: int = 100) -> str:
        """获取系统日志
        
        获取系统日志记录。
        
        Args:
            lines: 返回日志行数，默认100行
            
        Returns:
            系统日志
        """
        try:
            result = await client.get(f"/api/v1/logs/system?lines={lines}")
            return format_logs(result, "系统日志")
        except Exception as e:
            mcp_error = handle_api_error(e, f"get_system_logs({lines})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def get_docker_logs(lines: int = 100) -> str:
        """获取Docker日志
        
        获取Docker服务的日志记录。
        
        Args:
            lines: 返回日志行数，默认100行
            
        Returns:
            Docker日志
        """
        try:
            result = await client.get(f"/api/v1/logs/docker?lines={lines}")
            return format_logs(result, "Docker日志")
        except Exception as e:
            mcp_error = handle_api_error(e, f"get_docker_logs({lines})")
            return format_error_response(mcp_error)

    @mcp.tool()
    async def get_recent_errors(limit: int = 50) -> str:
        """获取最近的错误日志
        
        获取最近的错误日志记录。
        
        Args:
            limit: 返回错误日志数量限制，默认50条
            
        Returns:
            最近的错误日志
        """
        try:
            result = await client.get(f"/api/v1/logs/application?limit={limit}")
            return format_error_logs(result)
        except Exception as e:
            mcp_error = handle_api_error(e, f"get_recent_errors({limit})")
            return format_error_response(mcp_error)


def format_logs(result, log_type: str) -> str:
    """格式化日志数据"""
    if not result:
        return f"# 📄 {log_type}\n\n暂无日志数据"
    
    result_text = f"# 📄 {log_type}\n\n"
    
    # 处理字典格式的响应（包含logs字段）
    if isinstance(result, dict) and "logs" in result:
        logs = result["logs"]
        if isinstance(logs, list):
            for log_entry in logs:
                if isinstance(log_entry, str):
                    # 处理字符串格式的日志条目
                    result_text += f"```\n{log_entry}\n```\n\n"
                else:
                    # 处理对象格式的日志条目
                    timestamp = log_entry.get("timestamp", "Unknown")
                    level = log_entry.get("level", "INFO")
                    message = log_entry.get("message", "")
                    source = log_entry.get("source", "")
                    
                    level_emoji = {
                        "ERROR": "❌",
                        "WARN": "⚠️",
                        "INFO": "ℹ️",
                        "DEBUG": "🐛"
                    }.get(level, "📄")
                    
                    result_text += f"## {level_emoji} {timestamp}\n"
                    if source:
                        result_text += f"**来源**: {source}\n"
                    result_text += f"**级别**: {level}\n"
                    result_text += f"```\n{message}\n```\n\n"
        else:
            result_text += f"```\n{logs}\n```\n"
    elif isinstance(result, list):
        for log_entry in result:
            timestamp = log_entry.get("timestamp", "Unknown")
            level = log_entry.get("level", "INFO")
            message = log_entry.get("message", "")
            source = log_entry.get("source", "")
            
            level_emoji = {
                "ERROR": "❌",
                "WARN": "⚠️",
                "INFO": "ℹ️",
                "DEBUG": "🐛"
            }.get(level, "📄")
            
            result_text += f"## {level_emoji} {timestamp}\n"
            if source:
                result_text += f"**来源**: {source}\n"
            result_text += f"**级别**: {level}\n"
            result_text += f"```\n{message}\n```\n\n"
    else:
        result_text += f"```\n{result}\n```\n"
    
    return result_text


def format_error_logs(result) -> str:
    """格式化错误日志"""
    if not result:
        return "# ❌ 错误日志\n\n暂无错误日志"
    
    result_text = "# ❌ 最近的错误日志\n\n"
    
    # 处理字典格式的响应（包含logs字段）
    if isinstance(result, dict) and "logs" in result:
        logs = result["logs"]
        if isinstance(logs, list):
            error_count = 0
            for log_entry in logs:
                if isinstance(log_entry, str):
                    # 检查字符串中是否包含ERROR
                    if "ERROR" in log_entry.upper():
                        error_count += 1
                        result_text += f"## ❌ {log_entry[:50]}...\n"
                        result_text += f"```\n{log_entry}\n```\n\n"
                else:
                    level = log_entry.get("level", "").upper()
                    if level == "ERROR":
                        error_count += 1
                        timestamp = log_entry.get("timestamp", "Unknown")
                        message = log_entry.get("message", "")
                        source = log_entry.get("source", "")
                        
                        result_text += f"## ❌ {timestamp}\n"
                        if source:
                            result_text += f"**来源**: {source}\n"
                        result_text += f"```\n{message}\n```\n\n"
            
            if error_count == 0:
                result_text += "🎉 最近没有发现错误日志！\n"
        else:
            result_text += f"```\n{logs}\n```\n"
    elif isinstance(result, list):
        error_count = 0
        for log_entry in result:
            level = log_entry.get("level", "").upper()
            if level == "ERROR":
                error_count += 1
                timestamp = log_entry.get("timestamp", "Unknown")
                message = log_entry.get("message", "")
                source = log_entry.get("source", "")
                
                result_text += f"## ❌ {timestamp}\n"
                if source:
                    result_text += f"**来源**: {source}\n"
                result_text += f"```\n{message}\n```\n\n"
        
        if error_count == 0:
            result_text += "🎉 最近没有发现错误日志！\n"
    else:
        result_text += f"```\n{result}\n```\n"
    
    return result_text
