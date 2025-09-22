"""MCP服务器错误处理模块"""

from typing import Optional, Dict, Any
import json


class MCPResourceError(Exception):
    """MCP资源错误"""
    
    def __init__(self, message: str, uri: Optional[str] = None, code: int = -32603, data: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.uri = uri
        self.code = code
        self.data = data or {}
    
    def to_json_rpc_error(self) -> Dict[str, Any]:
        """转换为JSON-RPC错误格式"""
        error = {
            "code": self.code,
            "message": self.message,
            "data": {
                "uri": self.uri,
                **self.data
            }
        }
        return error


class MCPResourceNotFoundError(MCPResourceError):
    """资源未找到错误"""
    
    def __init__(self, uri: str, resource_type: str = "resource"):
        super().__init__(
            message=f"{resource_type} not found",
            uri=uri,
            code=-32002,
            data={"resource_type": resource_type}
        )


class MCPResourceAccessError(MCPResourceError):
    """资源访问错误"""
    
    def __init__(self, uri: str, reason: str = "Access denied"):
        super().__init__(
            message=f"Resource access error: {reason}",
            uri=uri,
            code=-32003,
            data={"reason": reason}
        )


class MCPResourceValidationError(MCPResourceError):
    """资源验证错误"""
    
    def __init__(self, uri: str, field: str, value: Any, reason: str = "Invalid value"):
        super().__init__(
            message=f"Resource validation error: {reason}",
            uri=uri,
            code=-32602,
            data={"field": field, "value": str(value), "reason": reason}
        )


class MCPResourceTimeoutError(MCPResourceError):
    """资源超时错误"""
    
    def __init__(self, uri: str, timeout: int = 30):
        super().__init__(
            message=f"Resource request timeout after {timeout} seconds",
            uri=uri,
            code=-32603,
            data={"timeout": timeout}
        )


def handle_api_error(error: Exception, uri: str) -> MCPResourceError:
    """处理API错误并转换为MCP资源错误"""
    from .client import APIError
    
    if isinstance(error, APIError):
        if error.status_code == 404:
            return MCPResourceNotFoundError(uri, "API endpoint")
        elif error.status_code == 401:
            return MCPResourceAccessError(uri, "Authentication required")
        elif error.status_code == 403:
            return MCPResourceAccessError(uri, "Access forbidden")
        elif error.status_code == 422:
            return MCPResourceValidationError(uri, "request", "invalid", "Validation failed")
        elif error.status_code == 500:
            return MCPResourceError(f"Internal server error: {error}", uri, -32603)
        else:
            return MCPResourceError(f"API error: {error}", uri, -32603)
    else:
        return MCPResourceError(f"Unexpected error: {error}", uri, -32603)


def format_error_response(error: MCPResourceError) -> str:
    """格式化错误响应"""
    if error.code == -32002:  # Resource not found
        return f"❌ 资源未找到\n\n**URI**: `{error.uri}`\n**错误**: {error.message}"
    elif error.code == -32003:  # Access error
        return f"🔒 访问错误\n\n**URI**: `{error.uri}`\n**错误**: {error.message}"
    elif error.code == -32602:  # Validation error
        return f"⚠️ 验证错误\n\n**URI**: `{error.uri}`\n**错误**: {error.message}"
    else:  # Internal error
        return f"💥 内部错误\n\n**URI**: `{error.uri}`\n**错误**: {error.message}"
