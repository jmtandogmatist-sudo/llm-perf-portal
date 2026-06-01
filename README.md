# ⚡ LLM Performance Testing Portal (LLM 性能测试平台)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node: >=18](https://img.shields.io/badge/Node->=18-green.svg)](https://nodejs.org/)
[![Python: >=3.8](https://img.shields.io/badge/Python->=3.8-yellow.svg)](https://www.python.org/)
[![ORM: Drizzle](https://img.shields.io/badge/ORM-Drizzle-orange.svg)](https://orm.drizzle.team/)
[![Framework: React 19](https://img.shields.io/badge/React-19.0-blue.svg)](https://react.dev/)

**LLM Performance Testing Portal** 是一个专业级的大语言模型（LLM）及通用 REST API 性能测试与评估平台。它集成了极简精致的 Web 界面和高效的异步 Python 测试引擎，旨在精确捕捉亚毫秒级的延迟指标，模拟复杂的真实业务负载，并提供基于硅谷性能工程标准的智能专家诊断建议。

---

## 🌟 核心特性

### 1. 多协议 & 多模型支持 (Multi-Protocol Engine)
* **LLM 协议兼容**：支持 OpenAI、Anthropic、Google Gemini 等主流 API 格式协议，支持流式 (Stream) 响应解析。
* **通用 REST API 测试**：可测试标准的 HTTP 接口，自定义 HTTP 方法（GET、POST、PUT、DELETE 等）、请求头 (Headers)、查询参数 (Query Params) 和 Body 内容。

### 2. 真实测试引擎与自适应负载 (Adaptive Load Modes)
底层由高并发 Python 异步引擎驱动，支持四种符合实际生产环境的负载模拟模式：
* **恒定模式 (Constant)**：维持固定的并发协程数量执行测试。
* **阶梯模式 (Ramp-up)**：从初始并发逐步递增到目标并发，测试系统承载极限与拐点。
* **波动模式 (Fluctuate)**：并发量呈正弦曲线周期性波动，模拟高低峰交替的真实流量。
* **突刺模式 (Spike)**：在基线流量中瞬间注入极高并发，测试系统在突发流量冲击下的弹性和恢复速度。

### 3. 全方位亚毫秒级指标遥测 (Sub-millisecond Metrics)
收集和展示丰富的多维度性能数据：
* **首字延迟 (TTFT, Time To First Token)**：衡量模型的首字响应速度，平均值及 P95/P99 分位数。
* **生成速率 (TPS, Tokens Per Second)**：衡量模型每秒生成的 Token 数量。
* **Token 间隔延迟 (ITL, Inter-Token Latency)**：评估大模型输出流的平滑度和阅读流畅度。
* **吞吐量 (QPS, Queries Per Second)**：每秒完成的请求总数。
* **延迟分布**：请求的总延迟（Average、P95、P99 Latency）。
* **HTTP 状态统计**：各类 HTTP 响应状态码分布和去重后的错误异常样本输出。

### 4. 智能专家诊断 (Expert Intelligent Diagnosis)
* **自动化性能审计**：自动识别首包延迟过高（Prefill 瓶颈）、并发排队竞争、服务容量受限等问题。
* **AI 诊断报告**：内置大模型分析器，支持使用本地部署的 **Qwen 3.7 Max** 专家模型（或自定义兼容 OpenAI 协议的 API），一键对多次测试运行进行交叉比对，自动输出深度优化建议报告。

### 5. 极佳的 UI/UX 与配置管理
* **实时测试流反馈**：测试运行时，前端通过 Websocket-like 轮询机制流式展示 Python 引擎输出的执行日志和瞬时遥测折线。
* **配置克隆与历史管理**：提供“一键克隆配置”闭环，在看板中可快速克隆历史测试配置；支持多记录对比。
* **安全凭证加密**：所有 API Key 使用 `AES-256-CBC` 进行高强度加密存储。

---

## 🛠️ 技术栈架构

项目采用前后端分离及跨语言引擎架构：

```mermaid
graph TD
    Client[React 19 Frontend] <-->|tRPC over HTTP/JSON| Server[Node.js Express Server]
    Server <-->|Drizzle ORM| DB[(MySQL / TiDB)]
    Server -->|Spawn Async Child Process| PythonEngine[Python 3.8 Asyncio Engine]
    PythonEngine -->|API Requests| TargetAPI[Target LLM / REST API]
```

### 1. 前端 (Client)
* **核心框架**：React 19 (TypeScript)
* **路由管理**：Wouter
* **数据获取**：tRPC Client & React Query (TanStack Query)
* **样式框架**：Tailwind CSS v4 (配合 `@radix-ui` 精致组件库)
* **图表库**：Recharts
* **动画效果**：Framer Motion
* **国际化**：i18next

### 2. 后端 (Server)
* **核心框架**：Express 4 (Node.js)
* **接口通信**：tRPC v11 (实现完全类型安全的客户端/服务端数据同步)
* **数据库 ORM**：Drizzle ORM
* **构建/运行工具**：esbuild, tsx watch (开发环境)

### 3. 测试引擎 (Engine)
* **语言**：Python 3.8+
* **异步并发**：asyncio, aiohttp
* **数学计算**：numpy
* **配置格式**：PyYAML

---

## 📂 项目目录结构说明

为了方便日常开发和维护，以下是平台的核心文件和目录布局：

* 📂 **前端模块 (`client/`)**
  * 📄 [client/src/App.tsx](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/client/src/App.tsx) — 前端主路由及上下文注入入口
  * 📂 **页面路由 (`client/src/pages/`)**
    * 📄 [Home.tsx](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/client/src/pages/Home.tsx) — 平台介绍及快速上手导流页
    * 📄 [Generator.tsx](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/client/src/pages/Generator.tsx) — 可视化测试配置生成器（支持克隆填充、日志流式监听及执行启动）
    * 📄 [Dashboard.tsx](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/client/src/pages/Dashboard.tsx) — 性能指标看板与历史运行记录列表
    * 📄 [Comparison.tsx](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/client/src/pages/Comparison.tsx) — 多模型/多批次压测数据横向比对视图
    * 📄 [Diagnosis.tsx](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/client/src/pages/Diagnosis.tsx) — 基于 AI 专家的诊断调优建议页面
    * 📄 [Docs.tsx](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/client/src/pages/Docs.tsx) — 性能指标解释及负载模式使用文档
* 📂 **后端模块 (`server/`)**
  * 📄 [server/_core/index.ts](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/_core/index.ts) — 后端 Express 服务与 tRPC 适配器启动入口
  * 📂 **路由处理器 (`server/routers/`)**
    * 📄 [test.ts](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/routers/test.ts) — 测试配置保存、测试执行拉起、状态查询、AI 智能比对等核心路由
    * 📄 [test.test.ts](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/routers/test.test.ts) — 路由层的单元测试文件
  * 📂 **逻辑服务 (`server/services/`)**
    * 📄 [pythonTestRunner.ts](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/services/pythonTestRunner.ts) — 执行 Python 测试脚本并实时捕获日志输出的核心桥接类
    * 📄 [taskQueue.ts](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/services/taskQueue.ts) — 异步任务队列管理器，调度待压测任务防止并发冲突
    * 📄 [keyManager.ts](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/services/keyManager.ts) — API 密钥的生命周期与安全存储管理器
  * 📂 **测试引擎核心 (`server/scripts/`)**
    * 📄 [run_test.py](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/scripts/run_test.py) — 引擎主入口，执行负载动态控制与遥测数据统计
    * 📂 **协议层适配插件 (`server/scripts/protocols/`)**
      * 📄 [protocol_interface.py](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/scripts/protocols/protocol_interface.py) — 统一的请求发送规范接口
      * 📄 [llm_protocol.py](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/scripts/protocols/llm_protocol.py) — LLM 流式响应、多模态输入及 Token 统计的实现类
      * 📄 [http_protocol.py](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/server/scripts/protocols/http_protocol.py) — 兼容任意 REST 接口的通用请求适配器
* 📂 **数据库 Schema 与迁移 (`drizzle/`)**
  * 📄 [drizzle/schema.ts](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/drizzle/schema.ts) — Drizzle 数据库实体表映射（`users`、`test_configs`、`test_results`、`environments` 等）
* 📂 **项目级配置文件**
  * 📄 [package.json](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/package.json) — Node.js 项目依赖及运行指令
  * 📄 [vite.config.ts](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/vite.config.ts) — Vite 编译选项（集成 Tailwind v4 编译插件）
  * 📄 [vitest.config.ts](file:///Users/tanjm_sr/Desktop/GOLDWIND/AI-platform-performance-test/LLM-perf-test/llm-perf-portal-3/vitest.config.ts) — 后端单元测试框架配置

---

## 🚀 快速启动指南

### 1. 配置准备

在项目根目录下创建 `.env` 环境配置文件，定义数据库及加密密钥：

```env
# 数据库连接 (MySQL 5.7+ / TiDB)
DATABASE_URL=mysql://username:password@localhost:3306/llm_perf_portal

# API 密钥加密密钥 (必须为 32 字节的随机字符串)
ENCRYPTION_KEY=your-32-byte-secret-key-goes-here

# 端口配置
PORT=3000
```

### 2. 安装项目依赖

支持使用一键启动脚本 `./start.sh`，或者按照以下步骤手动初始化：

```bash
# 安装 Node.js 依赖
pnpm install

# 安装 Python 3 压测脚本相关依赖
pip3 install aiohttp numpy pyyaml jinja2
```

### 3. 初始化数据库表结构

利用 Drizzle-Kit 同步表结构至你的 MySQL / TiDB 实例中：

```bash
pnpm db:push
```

### 4. 启动开发服务器

执行以下命令后，将同时启动 Express API 后端以及 Vite 前端开发热重载服务器：

```bash
pnpm dev
```
启动成功后，可在浏览器中访问：`http://localhost:3000`

---

## 🧪 自动化测试与质量保障

项目配套了基于 Vitest 的 API 及逻辑路由层测试。

```bash
# 运行单元测试
pnpm test

# 静态类型检查
pnpm check
```

---

## 📈 未来规划与迭代

* **多 Key 轮询机制**：扩展 API 密钥池，支持多 Key 轮询调度（Round-Robin Strategy）以绕过模型服务商的单 Key Rate Limit。
* **微服务系统状态遥测**：与 Prometheus/Grafana 集成，在压测过程中实时拉取被测服务器的 GPU 显存使用率和 CPU 消耗，与 TTFT/Latency 进行交叉时序分析。
* **单次测试成本计算**：自动根据模型的 Prompt & Completion Token 计费标准估算每次性能压测的经济成本。
