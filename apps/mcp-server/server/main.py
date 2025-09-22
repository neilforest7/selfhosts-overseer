"""MCP Server for Self-Host Serv Agent using Streamable HTTP transport."""

import argparse
import logging
import sys
from pathlib import Path

# Add the parent directory to Python path
current_dir = Path(__file__).parent
parent_dir = current_dir.parent
sys.path.insert(0, str(parent_dir))

from mcp.server.fastmcp import FastMCP

from server.config import ServerConfig
from server.client import InternalAPIClient

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastMCP server for Self-Host Serv Agent.
# Using Streamable HTTP transport for both development and production
mcp = FastMCP(name="selfhost-serv-agent", json_response=False, stateless_http=False, port=3002, host="0.0.0.0")

# Initialize configuration and API client
config = ServerConfig()
api_client = InternalAPIClient(config)

# Server information and capabilities
SERVER_INFO = {
    "name": "selfhost-serv-agent",
    "version": "1.0.0",
    "description": "Self-Host Serv Agent MCP Server - 提供分布式VPS基础设施管理功能",
    "capabilities": {
        "resources": {
            "subscribe": True,
            "listChanged": True
        },
        "tools": {
            "listChanged": True
        }
    }
}

# Register resources and tools synchronously
from resources.hosts import register_hosts_resources
from resources.containers import register_containers_resources
from tools.connectivity import register_connectivity_tools
from tools.container_mgmt import register_container_tools
from tools.task_mgmt import register_task_tools
from tools.log_mgmt import register_log_tools

# Register resources and tools (synchronous for MCP Inspector compatibility)
import asyncio

async def register_all():
    await register_hosts_resources(mcp, api_client)
    await register_containers_resources(mcp, api_client)
    await register_connectivity_tools(mcp, api_client)
    await register_container_tools(mcp, api_client)
    await register_task_tools(mcp, api_client)
    await register_log_tools(mcp, api_client)
    logger.info("All resources and tools registered successfully")

# Run registration only if not in test environment
if not hasattr(sys, '_pytest_loaded'):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # If asyncio is already running, create a task
            loop.create_task(register_all())
        else:
            asyncio.run(register_all())
    except RuntimeError:
        # If asyncio is already running, skip registration
        # This happens in test environments
        pass

if __name__ == "__main__":
    
    parser = argparse.ArgumentParser(description="Run MCP Streamable HTTP based server")
    parser.add_argument("--port", type=int, default=3002, help="Port to listen on")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to")
    args = parser.parse_args()

    # Start the server with Streamable HTTP transport
    mcp.run(transport="streamable-http")


