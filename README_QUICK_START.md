# LLM Performance Testing Portal - 快速开始指南

这是一个完整的 LLM 性能测试平台，集成了网页界面和真实的 Python 测试引擎。

## 📋 系统要求

- **Node.js** 18+ （用于运行网站）
- **Python 3.8+** （用于运行性能测试脚本）
- **MySQL/TiDB** （用于存储测试配置和结果）
- **pnpm** （Node.js 包管理器）

## 🚀 快速启动

### 方式 1：使用启动脚本（推荐）

```bash
cd llm-perf-portal
./start.sh
```

启动脚本会自动：
1. 检查 Node.js 和 Python3
2. 安装 Python 依赖
3. 安装 Node.js 依赖
4. 启动开发服务器

### 方式 2：手动启动

```bash
# 1. 安装 Node 依赖
pnpm install

# 2. 安装 Python 依赖
pip3 install aiohttp numpy pyyaml jinja2

# 3. 启动开发服务器
pnpm dev
```

## 🌐 访问网站

启动后，在浏览器中打开：
```
http://localhost:3000
```

## 📖 使用流程

### 1. 查看文档（文档中心）
- 点击导航栏的"文档"
- 了解性能指标定义（TTFT、TPS、ITL、QPS 等）
- 学习不同的负载模式和 Provider 协议

### 2. 配置测试（配置生成器）
- 点击导航栏的"配置生成器"
- 填写 API 配置：
  - **API URL**: LLM API 的端点（如 `https://api.openai.com/v1/chat/completions`）
  - **API Key**: 你的 API 密钥（安全加密存储）
  - **Model**: 要测试的模型名称（如 `gpt-4o`、`claude-3-opus`）

- 配置测试参数：
  - **Concurrency**: 并发请求数（1-100）
  - **Duration**: 测试持续时间（秒）
  - **Load Mode**: 负载模式（恒定、阶梯、泊松）
  - **Input Type**: 输入类型（文本、图像、JSON）
  - **Input Data**: 测试输入内容

### 3. 执行测试
- 点击"Run Real Test"按钮
- 实时查看测试进度和日志
- 等待测试完成

### 4. 查看结果
- 测试完成后，查看性能指标卡片：
  - **TTFT (Avg)**: 首字节到达时间平均值
  - **P95 Latency**: 95 百分位延迟
  - **TPS**: 每秒生成的 Token 数
  - **QPS**: 每秒查询数

- 点击"Export Results as JSON"导出测试结果

### 5. 查看历史（测试历史）
- 点击"History"标签页
- 查看所有历史测试记录
- 选择多个测试进行对比
- 删除不需要的测试记录

## 📊 性能指标说明

| 指标 | 说明 | 单位 |
|------|------|------|
| **TTFT** | Time To First Token - 首字节到达时间 | ms |
| **TPS** | Tokens Per Second - 每秒生成的 Token 数 | tokens/s |
| **ITL** | Inter-Token Latency - Token 间延迟 | ms |
| **QPS** | Queries Per Second - 每秒查询数 | requests/s |
| **P95** | 95 百分位延迟 - 95% 的请求在此时间内完成 | ms |

## 🔧 配置文件

### 环境变量

创建 `.env` 文件（如果需要自定义配置）：

```env
# 数据库连接
DATABASE_URL=mysql://user:password@localhost:3306/llm_perf_portal

# API 密钥加密密钥
ENCRYPTION_KEY=your-secret-key-here

# OAuth 配置（如果使用 Manus OAuth）
VITE_APP_ID=your-app-id
OAUTH_SERVER_URL=https://api.manus.im
```

### 配置 YAML 格式

网站生成的 `config.yaml` 格式如下：

```yaml
api:
  url: https://api.openai.com/v1/chat/completions
  key: sk-xxx
  model: gpt-4o
  provider: openai

test:
  concurrency: 5
  duration: 60
  stream: true
  load_mode: constant
  input:
    type: text
    data: "Explain quantum computing in simple terms."

report:
  output_format: json
```

## 🐍 直接使用 Python 脚本

如果你想在命令行直接运行测试脚本：

```bash
python3 server/scripts/run_test.py --config config.yaml
```

## 📁 项目结构

```
llm-perf-portal/
├── client/                    # 前端 React 应用
│   ├── src/
│   │   ├── pages/            # 页面组件
│   │   │   ├── Home.tsx       # Landing Page
│   │   │   ├── Docs.tsx       # 文档中心
│   │   │   ├── Generator.tsx  # 配置生成器
│   │   │   ├── Dashboard.tsx  # 结果看板
│   │   │   ├── Compare.tsx    # 多模型对比
│   │   │   └── Diagnosis.tsx  # 专家诊断
│   │   └── ...
│   └── public/
├── server/                    # 后端 Node.js 服务
│   ├── routers/              # tRPC 路由
│   ├── services/             # 业务逻辑
│   │   ├── testExecutor.ts   # 测试执行服务
│   │   └── pythonTestRunner.ts # Python 脚本运行器
│   ├── scripts/              # Python 测试脚本
│   │   ├── run_test.py       # 核心测试引擎
│   │   ├── perf_tester_v2.py # 高级测试工具
│   │   └── analyze_reports.py # 报告分析工具
│   └── ...
├── drizzle/                   # 数据库 Schema
├── start.sh                   # 启动脚本
└── README_QUICK_START.md      # 本文件
```

## 🐛 故障排查

### 问题：Python 脚本找不到
**解决方案**：确保 Python 依赖已安装
```bash
pip3 install aiohttp numpy pyyaml jinja2
```

### 问题：数据库连接失败
**解决方案**：检查 DATABASE_URL 环境变量
```bash
echo $DATABASE_URL
```

### 问题：网站无法访问
**解决方案**：检查开发服务器是否正常运行
```bash
# 查看日志
tail -f .manus-logs/devserver.log
```

### 问题：测试执行失败
**解决方案**：
1. 检查 API Key 是否正确
2. 检查 API URL 是否可访问
3. 查看实时日志了解详细错误信息

## 📝 常见用例

### 用例 1：对比不同模型的性能

1. 使用 GPT-4o 运行一次测试
2. 使用 Claude-3-Opus 运行一次测试
3. 在"History"标签页选择两个测试
4. 点击"Compare Selected"查看对比结果

### 用例 2：测试并发能力

1. 设置 Concurrency 为 10
2. Duration 设置为 60 秒
3. 运行测试
4. 查看 QPS 和 P95 延迟

### 用例 3：导出测试报告

1. 完成测试后，点击"Export Results as JSON"
2. 将 JSON 文件用于进一步分析或报告

## 🔐 安全性

- **API Key 加密**：所有 API Key 使用 AES-256-CBC 加密存储
- **用户隔离**：每个用户只能看到自己的测试配置和结果
- **HTTPS**：生产环境使用 HTTPS

## 📞 支持

如有问题，请：
1. 查看文档中心了解性能指标
2. 检查实时日志了解错误信息
3. 查看专家诊断模块获取优化建议

## 📄 许可证

MIT License

---

**开始测试吧！** 🎉
