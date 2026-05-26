# LLM Performance Testing Portal - 部署指南

本指南说明如何将 LLM 性能测试平台部署到生产环境。

## 📦 打包项目

### 1. 构建前端和后端

```bash
# 构建生产版本
pnpm build

# 输出目录：
# - dist/index.js - 后端服务器
# - client/dist - 前端静态文件
```

### 2. 创建部署包

```bash
# 创建部署目录
mkdir -p llm-perf-portal-release
cd llm-perf-portal-release

# 复制必要文件
cp -r ../dist ./
cp -r ../client/dist ./public
cp -r ../server/scripts ./scripts
cp -r ../drizzle ./
cp package.json ./
cp .env.example .env  # 配置环境变量

# 创建启动脚本
cat > start.sh << 'EOF'
#!/bin/bash
export NODE_ENV=production
node dist/index.js
EOF
chmod +x start.sh
```

## 🚀 部署到云平台

### 部署到 Railway

```bash
# 1. 安装 Railway CLI
npm i -g @railway/cli

# 2. 登录
railway login

# 3. 初始化项目
railway init

# 4. 配置环境变量
railway variables set DATABASE_URL="mysql://..."
railway variables set ENCRYPTION_KEY="your-secret-key"

# 5. 部署
railway up
```

### 部署到 Render

```bash
# 1. 连接 GitHub 仓库
# 2. 在 Render Dashboard 创建新的 Web Service
# 3. 配置以下设置：
#    - Build Command: pnpm build
#    - Start Command: node dist/index.js
#    - Environment: Node
#    - Node Version: 18+

# 4. 添加环境变量
#    - DATABASE_URL
#    - ENCRYPTION_KEY
#    - VITE_APP_ID
#    - OAUTH_SERVER_URL
```

### 部署到 Docker

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# 安装 Python（用于运行测试脚本）
RUN apk add --no-cache python3 py3-pip

# 安装 Python 依赖
RUN pip3 install aiohttp numpy pyyaml jinja2

# 复制项目文件
COPY package.json pnpm-lock.yaml ./
COPY . .

# 安装 Node 依赖
RUN npm i -g pnpm && pnpm install

# 构建
RUN pnpm build

# 暴露端口
EXPOSE 3000

# 启动
CMD ["node", "dist/index.js"]
```

构建和运行：
```bash
docker build -t llm-perf-portal .
docker run -p 3000:3000 \
  -e DATABASE_URL="mysql://..." \
  -e ENCRYPTION_KEY="your-secret-key" \
  llm-perf-portal
```

## 🗄️ 数据库配置

### MySQL 初始化

```bash
# 1. 创建数据库
mysql -u root -p -e "CREATE DATABASE llm_perf_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2. 运行迁移
pnpm drizzle-kit migrate

# 3. 验证表
mysql -u root -p llm_perf_portal -e "SHOW TABLES;"
```

### 环境变量示例

```env
# .env.production
NODE_ENV=production
DATABASE_URL=mysql://user:password@db.example.com:3306/llm_perf_portal
ENCRYPTION_KEY=your-production-secret-key-min-32-chars

# OAuth 配置
VITE_APP_ID=your-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://auth.manus.im

# 可选：自定义域名
VITE_APP_TITLE=LLM Performance Testing Portal
VITE_APP_LOGO=https://your-domain.com/logo.png
```

## 📊 性能优化

### 1. 启用缓存

```typescript
// server/_core/index.ts
app.use((req, res, next) => {
  // 缓存静态资源
  if (req.url.startsWith('/static/')) {
    res.set('Cache-Control', 'public, max-age=31536000');
  }
  next();
});
```

### 2. 数据库连接池

```typescript
// server/db.ts
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});
```

### 3. 测试脚本超时配置

在 `server/services/pythonTestRunner.ts` 中调整：

```typescript
const pythonProcess = spawn('python3', [scriptPath, '--config', configPath], {
  cwd: __dirname,
  timeout: 600000, // 10 分钟
});
```

## 🔒 安全建议

### 1. API Key 加密

确保使用强加密密钥：

```bash
# 生成 32 字符的加密密钥
openssl rand -base64 32
```

### 2. 环境变量管理

- **不要**在代码中硬编码敏感信息
- 使用环境变量或密钥管理服务
- 定期轮换密钥

### 3. HTTPS 和 CORS

```typescript
// server/_core/index.ts
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(','),
  credentials: true,
}));

// 使用 HTTPS
const https = require('https');
const fs = require('fs');
const options = {
  key: fs.readFileSync('path/to/key.pem'),
  cert: fs.readFileSync('path/to/cert.pem'),
};
https.createServer(options, app).listen(3000);
```

## 📈 监控和日志

### 1. 日志收集

```typescript
// server/_core/index.ts
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
```

### 2. 性能监控

```typescript
// 添加性能指标收集
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
  });
  next();
});
```

## 🧪 测试部署

### 本地测试

```bash
# 1. 构建
pnpm build

# 2. 启动生产服务器
NODE_ENV=production node dist/index.js

# 3. 测试 API
curl http://localhost:3000/api/trpc/auth.me
```

### 健康检查

```bash
# 添加健康检查端点
curl http://your-domain.com/health
```

## 📋 部署检查清单

- [ ] 数据库已初始化
- [ ] 环境变量已配置
- [ ] ENCRYPTION_KEY 已设置
- [ ] 前端构建成功
- [ ] 后端构建成功
- [ ] Python 依赖已安装
- [ ] HTTPS 已配置
- [ ] CORS 已正确配置
- [ ] 日志收集已启用
- [ ] 监控已配置
- [ ] 备份策略已制定
- [ ] 灾难恢复计划已准备

## 🆘 故障排查

### 问题：502 Bad Gateway

**原因**：后端服务崩溃或无响应

**解决方案**：
```bash
# 检查日志
tail -f error.log

# 重启服务
systemctl restart llm-perf-portal
```

### 问题：数据库连接超时

**原因**：数据库不可达或连接池已满

**解决方案**：
```bash
# 检查数据库连接
mysql -u user -p -h db.example.com -e "SELECT 1;"

# 增加连接池大小
# 在 server/db.ts 中修改 connectionLimit
```

### 问题：Python 脚本执行失败

**原因**：Python 依赖缺失或脚本权限问题

**解决方案**：
```bash
# 检查 Python 依赖
python3 -c "import aiohttp, numpy, yaml"

# 检查脚本权限
chmod +x server/scripts/*.py
```

## 📞 获取帮助

- 查看日志文件了解详细错误
- 检查环境变量配置
- 参考快速开始指南
