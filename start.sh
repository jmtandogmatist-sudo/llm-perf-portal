#!/bin/bash

# LLM Performance Testing Portal - Startup Script
# 一键启动脚本

set -e

echo "🚀 LLM Performance Testing Portal - Starting..."
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# 检查 Python3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 is not installed. Please install Python3 first."
    exit 1
fi

# 检查必要的 Python 依赖
echo "📦 Checking Python dependencies..."
python3 -c "import aiohttp, numpy, yaml, jinja2" 2>/dev/null || {
    echo "⚠️  Installing required Python packages..."
    pip3 install aiohttp numpy pyyaml jinja2 -q
}

# 安装 Node 依赖
if [ ! -d "node_modules" ]; then
    echo "📦 Installing Node.js dependencies..."
    pnpm install
fi

# 创建必要的目录
mkdir -p server/scripts
mkdir -p /tmp/llm-perf-tests

echo ""
echo "✅ All dependencies installed successfully!"
echo ""
echo "🌐 Starting development server..."
echo ""
echo "📝 Configuration:"
echo "   - Frontend: http://localhost:3000"
echo "   - API: http://localhost:3000/api/trpc"
echo "   - Database: MySQL (configured via DATABASE_URL)"
echo ""
echo "📚 Documentation:"
echo "   - Visit http://localhost:3000 to access the web portal"
echo "   - Go to '文档' tab to read the performance testing guide"
echo "   - Use '配置生成器' tab to create and run tests"
echo ""
echo "⏹️  Press Ctrl+C to stop the server"
echo ""

# 启动开发服务器
pnpm dev
