"""Basic tests for MCP server."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import httpx
from unittest.mock import AsyncMock, patch, MagicMock
from server.config import ServerConfig
from server.client import InternalAPIClient, APIError


@pytest.mark.asyncio
async def test_server_config():
    """测试服务器配置"""
    config = ServerConfig()
    assert config.server_name == "selfhost-serv-agent"
    assert config.api_base_url == "http://localhost:3001"
    assert config.log_level == "INFO"
    assert config.api_timeout == 30


@pytest.mark.asyncio
async def test_api_client_initialization():
    """测试 API 客户端初始化"""
    config = ServerConfig()
    client = InternalAPIClient(config)

    assert client.config == config
    assert client.connection_pool is not None
    assert client._default_headers == {}

    await client.close()


@pytest.mark.asyncio
async def test_api_client_get_request():
    """测试 API 客户端 GET 请求"""
    config = ServerConfig()
    client = InternalAPIClient(config)

    # Mock 连接池
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.json.return_value = {"data": "test"}
    mock_response.raise_for_status.return_value = None
    mock_client.get.return_value = mock_response

    with patch.object(client.connection_pool, 'get_connection', return_value=mock_client):
        with patch.object(client.connection_pool, 'return_connection'):
            result = await client.get("/api/v1/hosts")
            assert result == {"data": "test"}

    await client.close()


@pytest.mark.asyncio
async def test_api_client_post_request():
    """测试 API 客户端 POST 请求"""
    config = ServerConfig()
    client = InternalAPIClient(config)

    # Mock 连接池
    mock_client = AsyncMock()
    mock_response = MagicMock()
    mock_response.json.return_value = {"success": True}
    mock_response.raise_for_status.return_value = None
    mock_client.post.return_value = mock_response

    with patch.object(client.connection_pool, 'get_connection', return_value=mock_client):
        with patch.object(client.connection_pool, 'return_connection'):
            result = await client.post("/api/v1/hosts/test", json={"test": "data"})
            assert result == {"success": True}

    await client.close()


@pytest.mark.asyncio
async def test_api_client_error_handling():
    """测试 API 客户端错误处理"""
    config = ServerConfig()
    client = InternalAPIClient(config)

    # Mock 连接池
    mock_client = AsyncMock()
    mock_client.get.side_effect = httpx.HTTPError("Network error")

    with patch.object(client.connection_pool, 'get_connection', return_value=mock_client):
        with patch.object(client.connection_pool, 'return_connection'):
            with pytest.raises(APIError):
                await client.get("/api/v1/hosts")

    await client.close()


@pytest.mark.asyncio
async def test_hosts_resource_formatting():
    """测试主机资源格式化"""
    from resources.hosts import format_hosts_list, format_host_detail
    
    # 测试空列表
    empty_result = format_hosts_list({})
    assert empty_result == "No hosts found"
    
    # 测试正常列表
    hosts_data = {
        "items": [
            {
                "id": "host-1",
                "name": "Test Host",
                "status": "online",
                "address": "192.168.1.100",
                "tags": ["test", "production"]
            }
        ]
    }
    result = format_hosts_list(hosts_data)
    assert "Test Host" in result
    assert "host-1" in result
    assert "online" in result
    assert "192.168.1.100" in result
    assert "test, production" in result
    
    # 测试主机详情
    host_detail = {
        "id": "host-1",
        "name": "Test Host",
        "status": "online",
        "address": "192.168.1.100",
        "port": 22,
        "tags": ["test"],
        "last_connection": "2024-01-01T00:00:00Z"
    }
    detail_result = format_host_detail(host_detail)
    assert "Test Host" in detail_result
    assert "host-1" in detail_result
    assert "online" in detail_result
    assert "192.168.1.100" in detail_result
    assert "22" in detail_result
    assert "test" in detail_result
    assert "2024-01-01T00:00:00Z" in detail_result


@pytest.mark.asyncio
async def test_containers_resource_formatting():
    """测试容器资源格式化"""
    from resources.containers import format_containers_list, format_container_detail
    
    # 测试空列表
    empty_result = format_containers_list({})
    assert empty_result == "No containers found"
    
    # 测试正常列表
    containers_data = {
        "items": [
            {
                "id": "container-1",
                "name": "Test Container",
                "status": "running",
                "image": "nginx:latest",
                "host_name": "Test Host"
            }
        ]
    }
    result = format_containers_list(containers_data)
    assert "Test Container" in result
    assert "container-1" in result
    assert "running" in result
    assert "nginx:latest" in result
    assert "Test Host" in result
    
    # 测试容器详情
    container_detail = {
        "id": "container-1",
        "name": "Test Container",
        "status": "running",
        "image": "nginx:latest",
        "host_name": "Test Host",
        "ports": "80:80",
        "created_at": "2024-01-01T00:00:00Z"
    }
    detail_result = format_container_detail(container_detail)
    assert "Test Container" in detail_result
    assert "container-1" in detail_result
    assert "running" in detail_result
    assert "nginx:latest" in detail_result
    assert "Test Host" in detail_result
    assert "80:80" in detail_result
    assert "2024-01-01T00:00:00Z" in detail_result


@pytest.mark.asyncio
async def test_connectivity_tool_formatting():
    """测试连通性工具格式化"""
    from tools.connectivity import format_connectivity_result
    
    # 测试成功结果
    success_result = format_connectivity_result({
        "success": True,
        "message": "Connection successful"
    })
    assert "✅" in success_result
    assert "成功" in success_result
    assert "Connection successful" in success_result
    
    # 测试失败结果
    failure_result = format_connectivity_result({
        "success": False,
        "message": "Connection failed"
    })
    assert "❌" in failure_result
    assert "失败" in failure_result
    assert "Connection failed" in failure_result


@pytest.mark.asyncio
async def test_container_management_tool_formatting():
    """测试容器管理工具格式化"""
    from tools.container_mgmt import format_container_action_result
    
    # 测试成功结果
    success_result = format_container_action_result({
        "success": True,
        "message": "Container started successfully"
    })
    assert "✅" in success_result
    assert "成功" in success_result
    assert "Container started successfully" in success_result
    
    # 测试失败结果
    failure_result = format_container_action_result({
        "success": False,
        "message": "Container start failed"
    })
    assert "❌" in failure_result
    assert "失败" in failure_result
    assert "Container start failed" in failure_result