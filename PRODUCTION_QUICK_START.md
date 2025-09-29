# 🚀 BSC Trading Bot - Production Quick Start Guide

## 系统架构概览

```
🏗️ Enterprise Production Architecture
├── 🖥️  API Server (Port 3010)     - Express + JWT Auth + Rate Limiting
├── 📊 Monitor Service (Port 3001)  - Prometheus Metrics + Health Checks  
├── 🌐 Frontend (Port 3000)         - Next.js + NextUI + WebSocket
├── 📈 Grafana (Port 3002)          - Dashboards + Alerts
└── 🔍 Prometheus (Port 9090)       - Metrics Collection
```

## 快速部署选择

### 方案一：PM2 部署 (推荐)
```bash
# 1. 配置环境变量
cp .env.production.template .env
# 编辑 .env 填入真实配置

# 2. 构建项目
npm install
npm run build

# 3. 一键部署
npm run deploy:pm2

# 4. 验证服务
curl http://localhost:3010/health
curl http://localhost:3001/health
```

### 方案二：systemd 部署
```bash
# 1. 以root用户运行部署
sudo ./scripts/deploy-production.sh --method=systemd

# 2. 验证服务状态
sudo systemctl status bsc-bot-api bsc-bot-monitor

# 3. 查看日志
sudo journalctl -u bsc-bot-api -f
```

## 生产环境配置要点

### 🔐 安全配置
```bash
# .env 中必须配置的安全项
JWT_SECRET=生成32位以上随机字符串
API_SECRET_KEY=内部服务通信密钥
METRICS_AUTH_TOKEN=监控接口访问令牌
```

### 🌍 CORS与域名
```typescript
// server.ts 中的生产域名配置
origin: process.env.NODE_ENV === 'production' 
  ? ['https://yourdomain.com', 'https://admin.yourdomain.com']
  : ['http://localhost:3000', 'http://127.0.0.1:3000']
```

### 🛡️ 统一认证中间件
所有 `/api/v1/*` 路由已启用统一JWT认证：
```typescript
// 支持角色：admin, trader, viewer
const authMiddleware = createAuthMiddleware(['admin', 'trader', 'viewer']);
apiV1.use(authMiddleware);
```

## 核心功能验证

### 1. 多DEX交易测试
```bash
# 获取支持的DEX列表
curl -H "Authorization: Bearer <token>" \
  http://localhost:3010/api/v1/dex/supported

# 获取最优报价
curl -X POST -H "Authorization: Bearer <token>" \
  http://localhost:3010/api/v1/dex/quote \
  -d '{"tokenIn":"0xbb4CdB...","tokenOut":"0x55d398...","amountIn":"1.0"}'
```

### 2. 批量钱包管理
```bash
# 批量生成钱包
curl -X POST -H "Authorization: Bearer <token>" \
  http://localhost:3010/api/v1/wallets/generate \
  -d '{"count":5,"tier":"hot","aliasPrefix":"prod"}'

# 导出钱包(CSV格式)
curl -H "Authorization: Bearer <token>" \
  http://localhost:3010/api/v1/wallets/export
```

### 3. 批量交易执行
```bash
# 批量交易
curl -X POST -H "Authorization: Bearer <token>" \
  http://localhost:3010/api/v1/batch/trades \
  -d '{"walletAddress":"0x...","trades":[...]}'

# 批量限价单
curl -X POST -H "Authorization: Bearer <token>" \
  http://localhost:3010/api/v1/batch/limit-orders \
  -d '{"walletAddress":"0x...","orders":[...]}'
```

## 监控与运维

### Grafana仪表板验证
```bash
# 使用PromQL校验清单验证所有指标
cat monitoring/grafana-promql-validation.md

# 测试关键指标
curl http://localhost:3001/metrics | grep -E "(up|websocket_connected|strategy_.*)"
```

### 常用运维命令

**PM2管理：**
```bash
pm2 status                    # 查看所有服务状态
pm2 logs                      # 查看实时日志  
pm2 restart all              # 重启所有服务
pm2 reload all               # 零停机重载
pm2 monit                     # 实时监控面板
```

**systemd管理：**
```bash
systemctl status bsc-bot-api        # 查看API服务状态
systemctl restart bsc-bot-api       # 重启API服务
journalctl -u bsc-bot-api -f        # 实时日志
systemctl enable bsc-bot-api        # 设置开机自启
```

### 性能调优建议

1. **并发优化**：
   - API Server使用cluster模式 (PM2 `instances: 'max'`)
   - 数据库连接池：`DB_POOL_MAX=20`

2. **内存管理**：
   - API Server内存限制：1GB
   - Monitor Service内存限制：512MB
   - 自动重启：`max_memory_restart: '1G'`

3. **日志轮转**：
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 100M
   pm2 set pm2-logrotate:retain 30
   ```

## 服务端点总览

| 服务 | 端口 | 端点 | 用途 |
|------|------|------|------|
| API | 3010 | `/api/v1/*` | 核心交易API |
| API | 3010 | `/health` | 健康检查 |
| API | 3010 | `/ws` | WebSocket实时数据 |
| Monitor | 3001 | `/metrics` | Prometheus指标 |
| Monitor | 3001 | `/health` | 监控服务状态 |
| Frontend | 3000 | `/` | Web管理界面 |
| Grafana | 3002 | `/` | 监控仪表板 |
| Prometheus | 9090 | `/` | 指标收集 |

## 故障排查

### 常见问题

1. **认证失败**：
   - 检查JWT_SECRET配置
   - 验证token格式和有效期

2. **CORS错误**：
   - 确认生产域名已加入白名单
   - 检查NEXT_PUBLIC_API_URL配置

3. **数据库连接**：
   - 确认DATABASE_URL路径正确
   - 运行`npm run migrate`执行迁移

4. **WebSocket连接失败**：
   - 检查防火墙端口开放
   - 验证WS_HEARTBEAT_INTERVAL配置

### 应急处理

**紧急停机：**
```bash
pm2 stop all                 # PM2方式
systemctl stop bsc-bot-*     # systemd方式
```

**快速恢复：**
```bash
npm run deploy:quick         # 跳过migration快速部署
```

**数据备份：**
```bash
mkdir -p backups/$(date +%Y%m%d)
cp data/production.db backups/$(date +%Y%m%d)/
```

## 上线检查清单

- [ ] 环境变量配置完成(.env)
- [ ] 数据库迁移执行(npm run migrate)
- [ ] JWT密钥配置(JWT_SECRET)
- [ ] CORS域名配置(生产域名)
- [ ] 防火墙端口开放(3000,3001,3010)
- [ ] SSL证书配置(反向代理)
- [ ] 监控仪表板配置(Grafana)
- [ ] 备份策略设置
- [ ] 应急预案准备

**🎉 配置完成后，您的企业级BSC多DEX交易平台即可稳定运行！**

---

*Generated by BSC Trading Bot v2.0 - Enterprise Production Ready* 🚀