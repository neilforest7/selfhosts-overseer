FROM python:3.12-slim

WORKDIR /app

# 设置代理
ARG HTTP_PROXY=http://192.168.31.5:7890
ARG HTTPS_PROXY=http://192.168.31.5:7890
ARG NO_PROXY=localhost,127.0.0.1
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV NO_PROXY=${NO_PROXY}

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    curl \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 安装 uv
RUN pip install uv

# 复制依赖文件
COPY pyproject.toml uv.lock ./

# 安装 Python 依赖
RUN uv sync --frozen

# 复制应用代码
COPY . .

# 创建非 root 用户
RUN useradd -m -u 1000 mcpuser && chown -R mcpuser:mcpuser /app
USER mcpuser

# 启动命令
CMD ["uv", "run", "python", "main.py"]