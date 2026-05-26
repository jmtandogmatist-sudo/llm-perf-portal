# LLM Performance Testing Portal - 项目交付说明

## 📦 项目包内容

你已获得完整的 **LLM 性能测试平台**项目包，包含以下内容：

### 核心组件

| 组件 | 说明 | 位置 |
|------|------|------|
| **Web 门户** | React 19 + Tailwind 4 前端界面 | `client/src/` |
| **后端服务** | Express + tRPC 后端 API | `server/` |
| **Python 引擎** | 真实的性能测试脚本 | `server/scripts/` |
| **数据库** | MySQL/TiDB 数据存储 | `drizzle/` |
| **文档** | 完整的使用和部署指南 | `*.md` 文件 |

### 功能模块

1. **Landing Page** - 平台介绍和快速入门
2. **文档中心** - 性能指标、协议、负载模式详解
3. **配置生成器** - 可视化配置测试参数
4. **测试执行** - 真实的性能测试运行
5. **结果看板** - 性能指标展示和分析
6. **多模型对比** - 不同模型性能对比
7. **专家诊断** - 性能问题诊断和优化建议
8. **测试历史** - 历史记录管理和对比

## 🚀 快速开始（3 步）

### 第 1 步：解压项目

```bash
unzip llm-perf-portal-complete.zip
cd llm-perf-portal
```

### 第 2 步：启动项目

```bash
# 使用启动脚本（推荐）
./start.sh

# 或手动启动
pnpm install
pnpm dev
```

### 第 3 步：打开浏览器

```
http://localhost:3000
```

## 📋 系统要求

- **Node.js** 18+ 
- **Python 3.8+**
- **MySQL 5.7+** 或 **TiDB**
- **pnpm** 或 **npm**

## 📖 文档指南

| 文档 | 用途 |
|------|------|
| **README_QUICK_START.md** | 快速开始和基本使用 |
| **DEPLOYMENT.md** | 生产环境部署指南 |
| **todo.md** | 项目功能清单 |

## 🔑 关键特性

### ✅ 已实现

- [x] 优雅的 Web 界面
- [x] 真实的 Python 测试引擎集成
- [x] API Key 加密存储
- [x] 实时测试执行和日志
- [x] 性能指标收集和分析
- [x] 测试历史管理
- [x] 多模型对比
- [x] 专家诊断建议

### 🎯 核心指标支持

- **TTFT** - Time To First Token
- **TPS** - Tokens Per Second
- **ITL** - Inter-Token Latency
- **QPS** - Queries Per Second
- **P95/P99** - 百分位延迟

## 🔧 配置说明

### 环境变量

创建 `.env` 文件（可选，使用默认值即可启动）：

```env
# 数据库
DATABASE_URL=mysql://user:password@localhost:3306/llm_perf_portal

# 加密密钥（用于 API Key 加密）
ENCRYPTION_KEY=your-secret-key-here

# OAuth（可选）
VITE_APP_ID=your-app-id
OAUTH_SERVER_URL=https://api.manus.im
```

### 数据库初始化

```bash
# 自动迁移
pnpm drizzle-kit migrate

# 或手动执行 SQL
mysql -u root -p < drizzle/0000_true_richard_fisk.sql
mysql -u root -p < drizzle/0001_spotty_masked_marvel.sql
```

## 📊 使用流程

### 场景 1：测试 OpenAI GPT-4o

1. 打开 http://localhost:3000
2. 点击"配置生成器"
3. 填写配置：
   - API URL: `https://api.openai.com/v1/chat/completions`
   - API Key: `sk-xxx`
   - Model: `gpt-4o`
   - Concurrency: `5`
   - Duration: `60`
4. 点击"Run Real Test"
5. 等待测试完成，查看结果

### 场景 2：对比多个模型

1. 分别测试 GPT-4o、Claude-3、Gemini
2. 进入"结果看板" → "History"
3. 选择多个测试
4. 点击"Compare Selected"
5. 查看性能对比

### 场景 3：导出测试报告

1. 完成测试后
2. 点击"Export Results as JSON"
3. 获得包含完整数据的 JSON 文件
4. 用于进一步分析或报告

## 🐍 Python 脚本使用

如果需要在命令行直接运行测试：

```bash
# 1. 生成配置文件
cat > config.yaml << 'EOF'
api:
  url: https://api.openai.com/v1/chat/completions
  key: sk-xxx
  model: gpt-4o
test:
  concurrency: 5
  duration: 60
  stream: true
  input:
    type: text
    data: "Explain quantum computing..."
EOF

# 2. 运行测试
python3 server/scripts/run_test.py --config config.yaml
```

## 🔐 安全性

- **API Key 加密**：使用 AES-256-CBC 加密
- **用户隔离**：每个用户只能访问自己的数据
- **HTTPS 支持**：生产环境建议使用 HTTPS
- **环境变量**：敏感信息通过环境变量管理

## 📁 项目结构

```
llm-perf-portal/
├── client/                 # React 前端
│   ├── src/pages/         # 页面组件
│   ├── src/components/    # UI 组件
│   └── src/lib/           # 工具函数
├── server/                # Express 后端
│   ├── routers/           # tRPC 路由
│   ├── services/          # 业务逻辑
│   ├── scripts/           # Python 测试脚本
│   └── _core/             # 框架代码
├── drizzle/               # 数据库 Schema
├── start.sh               # 启动脚本
├── README_QUICK_START.md  # 快速开始
├── DEPLOYMENT.md          # 部署指南
└── todo.md                # 功能清单
```

## 🛠️ 常见问题

### Q: 如何修改默认端口？

A: 在启动前设置环境变量：
```bash
PORT=8080 pnpm dev
```

### Q: 如何连接远程数据库？

A: 设置 DATABASE_URL：
```bash
DATABASE_URL=mysql://user:pass@remote-host:3306/db pnpm dev
```

### Q: 测试脚本执行失败怎么办？

A: 检查 Python 依赖：
```bash
pip3 install aiohttp numpy pyyaml jinja2
```

### Q: 如何在生产环境部署？

A: 参考 `DEPLOYMENT.md` 文件，支持 Railway、Render、Docker 等多种部署方式。

## 📞 技术支持

### 遇到问题时：

1. **查看日志**：
   ```bash
   tail -f .manus-logs/devserver.log
   ```

2. **检查数据库**：
   ```bash
   mysql -u root -p llm_perf_portal -e "SELECT * FROM test_results LIMIT 5;"
   ```

3. **查看文档**：
   - README_QUICK_START.md - 基本使用
   - DEPLOYMENT.md - 部署问题
   - 网站内的"文档"模块 - 性能指标说明

## 🎓 学习资源

### 性能测试基础

- **TTFT (Time To First Token)**：衡量模型响应速度，越低越好
- **TPS (Tokens Per Second)**：衡量生成速度，越高越好
- **QPS (Queries Per Second)**：衡量吞吐量，越高越好
- **P95 Latency**：95% 请求的响应时间，用于评估稳定性

### 优化建议

- 增加并发数以测试模型的负载能力
- 使用不同的输入类型（文本、图像）测试多模态能力
- 对比不同模型找到性价比最优的选择
- 基于诊断建议进行优化

## 📈 后续扩展建议

1. **实时可视化**：添加实时图表展示测试过程
2. **高级分析**：增加火焰图、详细分布分析
3. **自动化测试**：集成 CI/CD 流程
4. **成本分析**：计算每个模型的成本效益
5. **性能基准**：建立行业基准对标

## ✨ 项目亮点

- **开箱即用**：无需复杂配置，一键启动
- **真实测试**：集成真实的 Python 测试引擎
- **专业界面**：优雅精致的 Web 设计
- **完整文档**：详细的使用和部署指南
- **生产就绪**：支持多种云平台部署

## 🎉 开始使用

```bash
# 1. 解压
unzip llm-perf-portal-complete.zip
cd llm-perf-portal

# 2. 启动
./start.sh

# 3. 打开浏览器
# http://localhost:3000

# 4. 开始测试！
```

---

**祝你使用愉快！** 🚀

如有任何问题，请参考项目文档或查看实时日志。
