"""Performance monitoring and optimization utilities."""

import time
import asyncio
import logging
from functools import wraps
from typing import Callable, Any, Dict
from dataclasses import dataclass
from collections import defaultdict, deque
import statistics

logger = logging.getLogger(__name__)


@dataclass
class PerformanceMetrics:
    """性能指标"""

    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    response_times: deque = None
    error_rate: float = 0.0
    avg_response_time: float = 0.0
    p95_response_time: float = 0.0

    def __post_init__(self):
        if self.response_times is None:
            self.response_times = deque(maxlen=1000)  # 保留最近1000次请求


class PerformanceMonitor:
    """性能监控器"""

    def __init__(self):
        self.metrics = PerformanceMetrics()
        self._lock = asyncio.Lock()

    async def record_request(self, response_time: float, success: bool):
        """记录请求指标"""
        async with self._lock:
            self.metrics.total_requests += 1
            self.metrics.response_times.append(response_time)

            if success:
                self.metrics.successful_requests += 1
            else:
                self.metrics.failed_requests += 1

            # 计算指标
            self._update_metrics()

    def _update_metrics(self):
        """更新性能指标"""
        if self.metrics.total_requests > 0:
            self.metrics.error_rate = (
                self.metrics.failed_requests / self.metrics.total_requests
            ) * 100

        if self.metrics.response_times:
            times = list(self.metrics.response_times)
            self.metrics.avg_response_time = statistics.mean(times)
            if len(times) >= 20:  # 至少20个样本才计算P95
                self.metrics.p95_response_time = statistics.quantiles(times, n=20)[
                    18
                ]  # P95

    def get_metrics(self) -> Dict[str, Any]:
        """获取性能指标"""
        return {
            "total_requests": self.metrics.total_requests,
            "successful_requests": self.metrics.successful_requests,
            "failed_requests": self.metrics.failed_requests,
            "error_rate": round(self.metrics.error_rate, 2),
            "avg_response_time": round(self.metrics.avg_response_time, 3),
            "p95_response_time": round(self.metrics.p95_response_time, 3),
            "meets_performance_target": (
                self.metrics.p95_response_time < 1.0 and self.metrics.error_rate < 5.0
            ),
        }

    def reset_metrics(self):
        """重置指标"""
        self.metrics = PerformanceMetrics()


# 全局性能监控器
performance_monitor = PerformanceMonitor()


def monitor_performance(func: Callable) -> Callable:
    """性能监控装饰器"""

    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        start_time = time.time()
        success = True

        try:
            result = await func(*args, **kwargs)
            return result
        except Exception as e:
            success = False
            logger.error(f"Function {func.__name__} failed: {e}")
            raise
        finally:
            response_time = time.time() - start_time
            await performance_monitor.record_request(response_time, success)

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        start_time = time.time()
        success = True

        try:
            result = func(*args, **kwargs)
            return result
        except Exception as e:
            success = False
            logger.error(f"Function {func.__name__} failed: {e}")
            raise
        finally:
            response_time = time.time() - start_time
            # 对于同步函数，我们需要在事件循环中记录
            try:
                loop = asyncio.get_event_loop()
                loop.create_task(
                    performance_monitor.record_request(response_time, success)
                )
            except RuntimeError:
                # 如果没有事件循环，跳过记录
                pass

    return async_wrapper if asyncio.iscoroutinefunction(func) else sync_wrapper


class ConnectionPool:
    """连接池优化"""

    def __init__(self, max_connections: int = 10, base_url: str = None):
        self.max_connections = max_connections
        self.base_url = base_url
        self._pool = asyncio.Queue(maxsize=max_connections)
        self._created_connections = 0
        self._lock = asyncio.Lock()

    async def get_connection(self):
        """获取连接"""
        try:
            return self._pool.get_nowait()
        except asyncio.QueueEmpty:
            async with self._lock:
                if self._created_connections < self.max_connections:
                    # 创建新连接
                    import httpx

                    client = httpx.AsyncClient(
                        timeout=30.0,
                        base_url=self.base_url
                    )
                    self._created_connections += 1
                    return client
                else:
                    # 等待可用连接
                    return await self._pool.get()

    async def return_connection(self, client):
        """归还连接"""
        try:
            self._pool.put_nowait(client)
        except asyncio.QueueFull:
            # 连接池已满，关闭连接
            await client.aclose()
            async with self._lock:
                self._created_connections -= 1

    async def close_all(self):
        """关闭所有连接"""
        while not self._pool.empty():
            try:
                client = self._pool.get_nowait()
                await client.aclose()
            except asyncio.QueueEmpty:
                break
        self._created_connections = 0


def log_performance_summary():
    """记录性能摘要"""
    metrics = performance_monitor.get_metrics()
    logger.info(f"性能摘要: {metrics}")

    if metrics["meets_performance_target"]:
        logger.info("✅ 性能目标达成")
    else:
        logger.warning("⚠️ 性能目标未达成")
        if metrics["p95_response_time"] >= 1.0:
            logger.warning(f"P95响应时间 {metrics['p95_response_time']}s >= 1.0s")
        if metrics["error_rate"] >= 5.0:
            logger.warning(f"错误率 {metrics['error_rate']}% >= 5%")
