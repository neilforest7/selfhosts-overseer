"""MCP Server configuration management."""
import os
from pathlib import Path
from pydantic import BaseModel, ConfigDict


class ServerConfig(BaseModel):
    """MCP 服务器配置"""
    model_config = ConfigDict(env_file="/opt/selfhost-serv-agent/.env")

    api_base_url: str = os.getenv("API_BASE_URL", "http://localhost:3001")
    server_name: str = os.getenv("MCP_SERVER_NAME", "selfhost-serv-agent")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    api_timeout: int = int(os.getenv("API_TIMEOUT", "30"))
    server_port: int = int(os.getenv("MCP_SERVER_PORT", "3002"))
    
    # 认证配置
    username: str = os.getenv("USERNAME", "admin")
    password: str = os.getenv("PASSWORD", "secure_admin_password_123")