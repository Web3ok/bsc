# BianDEX 独立部署指南

## 🎯 目标

将 BianDEX 从 BSC Bot 平台中独立部署，用于应对监管要求或业务需求。

---

## 📋 前置条件检查

### 代码准备
- [ ] 模块化重构完成
- [ ] 接口定义清晰
- [ ] 配置系统就绪

### 基础设施准备
- [ ] 独立服务器/容器
- [ ] 独立域名 (例如: dex.example.com)
- [ ] SSL 证书
- [ ] 数据库实例

### 合约准备
- [ ] BianDEX 合约已部署
- [ ] 合约地址已记录
- [ ] 合约验证完成

---

## 🚀 快速分离步骤

### Step 1: 环境配置

```bash
# 创建 BianDEX 独立环境配置
cp .env.example .env.biandex

# 编辑 .env.biandex
cat > .env.biandex << EOF
# === 核心服务 ===
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@dex-db:5432/biandex

# === 模块开关 - 只启用 BianDEX ===
ENABLE_TRADING_BOT=false
ENABLE_BIANDEX=true
ENABLE_MONITORING=true

# === BianDEX 合约地址 ===
BIANDEX_FACTORY_ADDRESS=0x...
BIANDEX_ROUTER_ADDRESS=0x...
BIANDEX_LP_MINING_ADDRESS=0x...
BIANDEX_GOVERNANCE_ADDRESS=0x...

# === RPC 配置 ===
RPC_URL=https://bsc-dataseed1.binance.org/
RPC_FALLBACK_URLS=https://bsc-dataseed2.binance.org/,https://bsc-dataseed3.binance.org/

# === 共享服务 (可选) ===
# 如果需要连接共享的钱包服务
# SHARED_WALLET_API=https://wallets.example.com
# WALLET_API_KEY=your-api-key

EOF
```

### Step 2: 数据库迁移

```bash
# 导出 BianDEX 相关表
pg_dump -h localhost -U postgres -t 'wallets' -t 'dex_*' bot_db > biandex_data.sql

# 创建新数据库
createdb biandex_db

# 导入数据
psql -h dex-db-host -U postgres biandex_db < biandex_data.sql

# 运行 BianDEX 专用迁移
npx knex migrate:latest --env biandex
```

### Step 3: Docker 部署

```dockerfile
# Dockerfile.biandex
FROM node:18-alpine

WORKDIR /app

# 只复制 BianDEX 必需的文件
COPY package*.json ./
COPY src/core ./src/core
COPY src/biandex ./src/biandex
COPY src/utils ./src/utils
COPY src/persistence ./src/persistence

RUN npm ci --only=production

EXPOSE 3000

# 使用 BianDEX 配置启动
ENV ENABLE_TRADING_BOT=false
ENV ENABLE_BIANDEX=true

CMD ["npm", "run", "start:biandex"]
```

```yaml
# docker-compose.biandex.yml
version: '3.8'

services:
  biandex-app:
    build:
      context: .
      dockerfile: Dockerfile.biandex
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - ENABLE_BIANDEX=true
      - ENABLE_TRADING_BOT=false
      - DATABASE_URL=postgresql://postgres:password@biandex-db:5432/biandex
    depends_on:
      - biandex-db
    restart: unless-stopped

  biandex-db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=biandex
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=your-secure-password
    volumes:
      - biandex-db-data:/var/lib/postgresql/data
    restart: unless-stopped

  biandex-nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/biandex.conf:/etc/nginx/conf.d/default.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - biandex-app
    restart: unless-stopped

volumes:
  biandex-db-data:
```

### Step 4: 前端独立部署

```bash
# 创建 BianDEX 专用前端
cd frontend

# 构建 BianDEX 独立版本
NEXT_PUBLIC_API_URL=https://api.dex.example.com \
NEXT_PUBLIC_ENABLE_TRADING=false \
npm run build:biandex

# 或者使用单独的前端项目
cd contracts-project/frontend-dex
npm install
npm run build
```

### Step 5: Nginx 配置

```nginx
# nginx/biandex.conf
server {
    listen 80;
    server_name dex.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name dex.example.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    # API 代理
    location /api/ {
        proxy_pass http://biandex-app:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # 前端静态文件
    location / {
        root /var/www/biandex;
        try_files $uri $uri/ /index.html;
    }
}
```

### Step 6: 启动服务

```bash
# 使用 Docker Compose 启动
docker-compose -f docker-compose.biandex.yml up -d

# 检查日志
docker-compose -f docker-compose.biandex.yml logs -f

# 验证服务
curl https://dex.example.com/api/health
```

---

## 🔄 共享服务集成

如果需要保持与主平台的钱包共享：

### Option 1: 共享数据库

```bash
# BianDEX 连接到主数据库的只读副本
DATABASE_URL=postgresql://readonly@main-db:5432/bot_db
DATABASE_READONLY=true
```

### Option 2: API 调用

```typescript
// src/biandex/services/shared-wallet.ts
export class SharedWalletClient {
  private apiUrl: string;
  private apiKey: string;

  constructor() {
    this.apiUrl = process.env.SHARED_WALLET_API || '';
    this.apiKey = process.env.WALLET_API_KEY || '';
  }

  async getWallet(address: string): Promise<Wallet> {
    const response = await fetch(`${this.apiUrl}/wallets/${address}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });
    return response.json();
  }

  async signTransaction(tx: Transaction): Promise<SignedTx> {
    const response = await fetch(`${this.apiUrl}/wallets/sign`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tx),
    });
    return response.json();
  }
}
```

---

## 📊 监控和运维

### 健康检查

```bash
# 添加健康检查端点
curl https://dex.example.com/api/health

# 响应示例
{
  "status": "healthy",
  "modules": {
    "biandex": "enabled",
    "tradingBot": "disabled",
    "database": "connected",
    "rpc": "connected"
  },
  "contracts": {
    "factory": "0x...",
    "router": "0x...",
    "deployed": true
  }
}
```

### 监控指标

```bash
# Prometheus metrics
curl https://dex.example.com/metrics

# 关键指标
- biandex_swaps_total
- biandex_liquidity_usd
- biandex_active_users
- biandex_transaction_count
```

---

## 🔒 安全检查清单

部署前必须完成：

- [ ] SSL/TLS 证书有效
- [ ] API 密钥轮换机制
- [ ] 数据库访问限制
- [ ] 防火墙规则配置
- [ ] DDoS 防护启用
- [ ] 日志监控配置
- [ ] 备份策略实施
- [ ] 灾难恢复计划
- [ ] 合约权限检查
- [ ] 审计日志启用

---

## 🎯 验证步骤

### 1. 功能测试

```bash
# 测试 DEX 核心功能
curl -X POST https://dex.example.com/api/dex/quote \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"0x...","tokenOut":"0x...","amountIn":"1000000"}'

# 测试交换
curl -X POST https://dex.example.com/api/dex/swap \
  -H "Content-Type: application/json" \
  -d '{"from":"0x...","tokenIn":"0x...","tokenOut":"0x...","amount":"1000000"}'
```

### 2. 性能测试

```bash
# 使用 ab 进行压力测试
ab -n 1000 -c 10 https://dex.example.com/api/health

# 使用 k6 进行负载测试
k6 run load-test.js
```

### 3. 监控验证

```bash
# 检查日志
docker-compose logs -f biandex-app

# 检查数据库连接
docker-compose exec biandex-db psql -U postgres -d biandex
```

---

## 📞 故障排除

### 问题：无法连接数据库

```bash
# 检查数据库服务
docker-compose ps biandex-db

# 查看数据库日志
docker-compose logs biandex-db

# 测试连接
docker-compose exec biandex-app nc -zv biandex-db 5432
```

### 问题：合约交互失败

```bash
# 检查 RPC 连接
curl https://bsc-dataseed1.binance.org/

# 验证合约地址
# 在 BSCScan 上查看合约是否已部署

# 检查钱包余额
# 确保有足够的 BNB 支付 gas
```

### 问题：前端无法访问 API

```bash
# 检查 CORS 配置
# src/server.ts 中确保允许前端域名

# 检查 Nginx 配置
docker-compose exec biandex-nginx nginx -t

# 重新加载 Nginx
docker-compose exec biandex-nginx nginx -s reload
```

---

## 📚 相关文档

- [架构设计文档](./ARCHITECTURE.md)
- [BianDEX 合约文档](./contracts-project/README.md)
- [API 接口文档](./docs/API.md)
- [部署指南](./contracts-project/docs/DEPLOYMENT.md)

---

## ⚠️ 重要提示

1. **测试环境先行**: 始终先在测试网部署和测试
2. **备份数据**: 分离前完整备份所有数据
3. **灰度发布**: 使用流量切换逐步迁移用户
4. **监控告警**: 设置完整的监控和告警系统
5. **回滚计划**: 准备好快速回滚到集成模式的方案

---

更新时间: 2025-10-02
维护者: BNB Team
