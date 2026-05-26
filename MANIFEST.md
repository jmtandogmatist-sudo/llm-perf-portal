# LLM Performance Testing Portal - 项目清单

## 📦 包含的文件和目录

### 核心应用文件

```
client/                          # React 前端应用
├── src/
│   ├── pages/                  # 页面组件
│   │   ├── Home.tsx            # Landing Page
│   │   ├── Docs.tsx            # 文档中心
│   │   ├── Generator.tsx       # 配置生成器
│   │   ├── Dashboard.tsx       # 结果看板
│   │   ├── Comparison.tsx      # 多模型对比
│   │   └── Diagnosis.tsx       # 专家诊断
│   ├── components/             # 可复用组件
│   ├── contexts/               # React 上下文
│   ├── hooks/                  # 自定义 Hook
│   ├── lib/                    # 工具函数
│   ├── App.tsx                 # 主应用组件
│   ├── main.tsx                # 入口文件
│   └── index.css               # 全局样式
├── public/                     # 静态资源
├── index.html                  # HTML 模板
└── vite.config.ts              # Vite 配置

server/                          # Express 后端服务
├── _core/                      # 框架核心
│   ├── index.ts                # 服务器入口
│   ├── context.ts              # tRPC 上下文
│   ├── trpc.ts                 # tRPC 配置
│   ├── oauth.ts                # OAuth 认证
│   ├── llm.ts                  # LLM API 集成
│   └── ...其他核心模块
├── routers/                    # tRPC 路由
│   ├── test.ts                 # 测试执行路由
│   └── test.test.ts            # 单元测试
├── services/                   # 业务逻辑服务
│   ├── testExecutor.ts         # 测试执行服务
│   └── pythonTestRunner.ts     # Python 脚本运行器
├── scripts/                    # Python 测试脚本
│   ├── run_test.py             # 核心测试引擎 ⭐
│   ├── perf_tester_v2.py       # 高级测试工具
│   ├── perf_tester.py          # 基础版本
│   └── analyze_reports.py      # 报告分析工具
├── db.ts                       # 数据库查询
├── routers.ts                  # 主路由
├── storage.ts                  # 文件存储
└── auth.logout.test.ts         # 认证测试

drizzle/                         # 数据库 Schema
├── schema.ts                   # 表定义
├── 0000_*.sql                  # 初始迁移
├── 0001_*.sql                  # 测试表迁移
└── drizzle.config.ts           # Drizzle 配置

shared/                          # 共享代码
├── const.ts                    # 常量定义
├── types.ts                    # 类型定义
└── _core/                      # 共享工具

配置文件:
├── package.json                # 项目依赖
├── pnpm-lock.yaml              # 依赖锁定
├── tsconfig.json               # TypeScript 配置
├── vite.config.ts              # Vite 配置
├── vitest.config.ts            # 测试配置
├── drizzle.config.ts           # 数据库配置
├── components.json             # shadcn/ui 配置
└── .env.example                # 环境变量示例
```

### 文档文件

| 文件 | 说明 |
|------|------|
| **README_QUICK_START.md** | 快速开始指南（推荐首先阅读）|
| **DEPLOYMENT.md** | 生产环境部署指南 |
| **PROJECT_DELIVERY.md** | 项目交付说明 |
| **MANIFEST.md** | 本文件 - 项目清单 |
| **todo.md** | 功能实现清单 |

### 启动脚本

| 文件 | 说明 |
|------|------|
| **start.sh** | 一键启动脚本（Linux/Mac）|

## 🎯 关键文件说明

### ⭐ 最重要的文件

1. **server/scripts/run_test.py** - 核心性能测试引擎
   - 支持多协议、深度指标收集
   - 异步并发测试
   - 自动诊断分析

2. **client/src/pages/Generator.tsx** - 配置生成器
   - 可视化配置界面
   - 真实测试执行
   - 结果导出功能

3. **server/routers/test.ts** - 后端测试 API
   - tRPC 测试路由
   - Python 脚本集成
   - 结果存储

4. **drizzle/schema.ts** - 数据库 Schema
   - 测试配置表
   - 测试结果表
   - 用户表

## 📊 数据库表

### testConfigs 表
存储用户的测试配置

```sql
CREATE TABLE testConfigs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  userId INT NOT NULL,
  apiProvider VARCHAR(50),
  apiUrl VARCHAR(255),
  apiKey TEXT,  -- 加密存储
  model VARCHAR(100),
  concurrency INT,
  duration INT,
  loadMode VARCHAR(50),
  inputType VARCHAR(50),
  inputData TEXT,
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP
);
```

### testResults 表
存储测试执行结果

```sql
CREATE TABLE testResults (
  id INT PRIMARY KEY AUTO_INCREMENT,
  configId INT,
  userId INT NOT NULL,
  totalRequests INT,
  successfulRequests INT,
  ttftAvg DECIMAL(10,2),
  ttftP95 DECIMAL(10,2),
  tpsAvg DECIMAL(10,2),
  itlAvg DECIMAL(10,2),
  qps DECIMAL(10,2),
  analysis TEXT,
  createdAt TIMESTAMP
);
```

## 🔧 依赖项

### Node.js 主要依赖

- **React 19** - UI 框架
- **Tailwind CSS 4** - 样式框架
- **Express 4** - 后端框架
- **tRPC 11** - RPC 框架
- **Drizzle ORM** - 数据库 ORM
- **Zod** - 数据验证

### Python 主要依赖

- **aiohttp** - 异步 HTTP 客户端
- **numpy** - 数值计算
- **pyyaml** - YAML 解析
- **jinja2** - 模板引擎

## 🚀 启动流程

1. **安装依赖**
   ```bash
   pnpm install
   pip3 install aiohttp numpy pyyaml jinja2
   ```

2. **初始化数据库**
   ```bash
   pnpm drizzle-kit migrate
   ```

3. **启动开发服务器**
   ```bash
   pnpm dev
   ```

4. **访问应用**
   ```
   http://localhost:3000
   ```

## 📈 项目统计

- **前端代码行数**：~3000 行
- **后端代码行数**：~2000 行
- **Python 脚本行数**：~500 行
- **总代码行数**：~5500 行
- **支持的性能指标**：8+ 种
- **支持的 LLM 协议**：3+ 种

## ✅ 功能完成度

- [x] Web 界面设计和实现
- [x] 配置生成器
- [x] 真实测试执行
- [x] 结果展示和分析
- [x] 多模型对比
- [x] 专家诊断
- [x] 测试历史管理
- [x] API Key 加密存储
- [x] 完整文档
- [x] 部署指南

## 🔐 安全特性

- API Key 使用 AES-256-CBC 加密
- 用户认证和授权
- 环境变量管理敏感信息
- HTTPS 支持
- CORS 配置

## 📱 浏览器支持

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- 移动浏览器（iOS Safari, Chrome Mobile）

## 🎓 学习资源

- 查看 README_QUICK_START.md 了解基本使用
- 查看 DEPLOYMENT.md 了解部署方式
- 查看网站内的"文档"模块了解性能指标
- 查看源代码注释了解实现细节

---

**项目完整性：100%** ✅

所有核心功能已实现，可以直接使用。
