# 部署配置说明

## 🚀 快速开始

### 方案 1: 完整平台部署（推荐）

```bash
# 1. 克隆代码
git clone <repository>
cd BNB

# 2. 安装依赖
npm install
cd frontend && npm install && cd ..

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入必要配置

# 4. 初始化数据库
npm run migrate

# 5. 启动服务
npm run server:dev          # 后端 (Port 10001)
cd frontend && npm run dev  # 前端 (Port 10004)
```

访问: http://localhost:10004

---

## 📦 独立模块部署

### 只部署交易机器人

```bash
# 启动只包含 Bot 功能的服务
npm run dev:bot

# 或生产环境
npm run build
npm run start:bot
```

### 只部署 BianDEX

```bash
# 启动只包含 DEX 功能的服务
npm run dev:dex

# 或生产环境
npm run build
npm run start:dex
```

---

## 🐳 Docker 部署

### 完整平台

```bash
docker-compose up -d
```

### 只部署 BianDEX

```bash
docker-compose -f docker-compose.biandex.yml up -d
```

详细步骤见: [SEPARATION_GUIDE.md](./SEPARATION_GUIDE.md)

---

## 🔧 配置说明

### 关键环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ENABLE_TRADING_BOT` | 启用交易机器人 | `true` |
| `ENABLE_BIANDEX` | 启用 BianDEX | `true` |
| `ENABLE_MONITORING` | 启用监控 | `true` |
| `PORT` | 后端端口 | `10001` |
| `RPC_URL` | BSC RPC 地址 | BSC mainnet |

### BianDEX 合约地址

部署 BianDEX 合约后，需要更新 `.env` 中的地址：

```bash
BIANDEX_FACTORY_ADDRESS=0x...
BIANDEX_ROUTER_ADDRESS=0x...
BIANDEX_LP_MINING_ADDRESS=0x...
```

合约部署指南: [contracts-project/docs/DEPLOYMENT.md](./contracts-project/docs/DEPLOYMENT.md)

---

## 📊 NPM 脚本说明

| 命令 | 说明 |
|------|------|
| `npm run server:dev` | 开发模式启动完整平台 |
| `npm run dev:bot` | 开发模式只启动 Bot |
| `npm run dev:dex` | 开发模式只启动 DEX |
| `npm run start:full` | 生产模式完整平台 |
| `npm run start:bot` | 生产模式只启动 Bot |
| `npm run start:dex` | 生产模式只启动 DEX |

---

## 🔒 生产部署检查清单

部署到生产环境前，确保完成：

- [ ] 更新 `.env` 中的 `NODE_ENV=production`
- [ ] 设置强密码 `JWT_SECRET` 和 `ENCRYPTION_PASSWORD`
- [ ] 配置正确的 RPC URL（建议使用付费节点）
- [ ] 更新 `CORS_ORIGINS` 为实际域名
- [ ] 启用 HTTPS/SSL
- [ ] 配置防火墙规则
- [ ] 设置日志监控
- [ ] 配置数据库备份
- [ ] 部署合约并更新地址
- [ ] 禁用 `DISABLE_AUTH=false`
- [ ] 降低日志级别 `LOG_LEVEL=warn`

---

## 📚 相关文档

- [架构设计](./ARCHITECTURE.md) - 系统架构和模块化设计
- [分离部署指南](./SEPARATION_GUIDE.md) - 独立部署 BianDEX
- [合约文档](./contracts-project/README.md) - BianDEX 智能合约
- [API 文档](./docs/API.md) - API 接口说明

---

## 🆘 故障排除

### 问题: 无法连接 RPC

```bash
# 测试 RPC 连接
curl -X POST https://bsc-dataseed1.binance.org/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### 问题: 数据库连接失败

```bash
# 检查数据库文件权限
ls -la data/bot.db

# 重新初始化
rm data/bot.db
npm run migrate
```

### 问题: 前端无法访问后端

检查 CORS 配置和端口号，确保：
- 后端运行在 `PORT=10001`
- 前端 `.env.local` 中 `NEXT_PUBLIC_API_URL=http://localhost:10001`

---

更新时间: 2025-10-02
