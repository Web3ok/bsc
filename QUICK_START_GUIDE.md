# BSC Trading Bot - 5分钟快速开始指南 🚀

这是一个零基础的快速上手指南,帮助你在 5 分钟内启动并运行 BSC 交易机器人。

---

## 📋 准备工作 (2分钟)

### 检查环境

打开终端,运行以下命令检查版本:

```bash
node --version  # 需要 >= 18.0.0
npm --version   # 需要 >= 8.0.0
```

如果版本过低或未安装,请访问 [nodejs.org](https://nodejs.org/) 下载安装。

### 获取项目

```bash
# 进入项目目录
cd /path/to/BNB

# 如果是首次使用,检查文件是否完整
ls -la
# 应该看到: src/, frontend/, package.json, .env.example 等文件
```

---

## 🔧 安装与配置 (2分钟)

### 1. 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd frontend
npm install
cd ..
```

**预期结果**: 看到 "added XXX packages" 消息,无报错。

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 快速配置 (使用默认值即可)
cat > .env << 'EOF'
# RPC 配置
RPC_URL=https://bsc-dataseed1.binance.org/
CHAIN_ID=56

# 安全配置
JWT_SECRET=dev-secret-key-for-testing-only-256bits-long
ENCRYPTION_PASSWORD=test-password-change-in-production

# API 配置
API_PORT=10001
DISABLE_AUTH=true
NODE_ENV=development
EOF
```

**预期结果**: `.env` 文件创建成功。

---

## 🎯 启动服务 (1分钟)

### 方式 1: 两个终端窗口 (推荐)

**终端 1 - 后端服务器**:
```bash
npm run server:dev
```

等待看到:
```
✅ API Server started successfully
   port: 10001
   env: development
```

**终端 2 - 前端服务器**:
```bash
cd frontend
npm run dev
```

等待看到:
```
✓ Ready in 2.6s
- Local:        http://localhost:10002
```

### 方式 2: 后台运行 (可选)

```bash
# 后端在后台运行
npm run server:dev &

# 前端在后台运行
cd frontend && npm run dev &
cd ..
```

---

## ✅ 验证安装

### 1. 测试后端 API

```bash
# 测试 Dashboard API
curl http://localhost:10001/api/dashboard/overview

# 预期输出:
# {
#   "success": true,
#   "data": {
#     "system": { "status": "healthy", ... },
#     ...
#   }
# }
```

### 2. 测试交易报价

```bash
# 获取 BNB to CAKE 的报价
curl -X POST http://localhost:10001/api/trading/quote \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "BNB",
    "tokenOut": "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    "amountIn": "0.1",
    "slippage": 0.5
  }'

# 预期输出: 包含 tokenOut.amount, executionPrice 等信息
```

### 3. 访问 Web 界面

打开浏览器访问: **http://localhost:10002**

你应该看到:
- ✅ Dashboard 页面加载成功
- ✅ 系统状态显示 "✅ Connected"
- ✅ WebSocket 连接状态为 "Connected"
- ✅ 四个状态卡片显示数据

---

## 🎮 快速体验

### 1. 查看 Dashboard

访问 http://localhost:10002

- 查看系统状态
- 观察实时指标
- 检查 WebSocket 连接

### 2. 尝试交易报价

1. 点击 **"Trading"** 标签
2. 选择 **"Single Trade"**
3. 填写:
   - Token In: `BNB`
   - Token Out: `0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82` (CAKE)
   - Amount: `0.1`
   - Slippage: `0.5`
4. 点击 **"Get Quote"**
5. 查看报价详情 (价格影响、最小接收量等)

**注意**: 这只是获取报价,不会执行真实交易!

### 3. 查看监控页面

1. 点击 **"Monitoring"** 标签
2. 查看:
   - 系统健康检查
   - 性能指标图表
   - 组件状态

---

## 📊 界面导航

### Dashboard (首页)
- **位置**: http://localhost:10002
- **功能**: 系统概览、实时指标、24h 统计

### Trading (交易)
- **位置**: http://localhost:10002/trading
- **功能**: 单笔交易、批量操作、交易历史

### Monitoring (监控)
- **位置**: http://localhost:10002/monitoring
- **功能**: 告警管理、性能指标、健康检查

### Wallets (钱包) - Coming Soon
- **位置**: http://localhost:10002/wallets
- **功能**: 钱包管理、余额查询

---

## 🔍 常见问题

### Q1: 端口被占用?

**错误**: `Error: listen EADDRINUSE: address already in use :::10001`

**解决**:
```bash
# 查找占用端口的进程
lsof -i:10001

# 杀死进程 (替换 <PID> 为实际进程ID)
kill -9 <PID>

# 或者修改端口
export API_PORT=10003
npm run server:dev
```

### Q2: 依赖安装失败?

**错误**: `npm ERR! code ENOENT` 或类似错误

**解决**:
```bash
# 清除缓存
npm cache clean --force

# 删除 node_modules
rm -rf node_modules package-lock.json

# 重新安装
npm install
```

### Q3: 前端无法连接后端?

**症状**: Dashboard 显示 "❌ Disconnected"

**检查清单**:
1. 后端是否启动? `curl http://localhost:10001/api/dashboard/overview`
2. 端口是否正确? 检查 `.env` 中的 `API_PORT`
3. 防火墙是否阻止? 临时关闭防火墙测试

**解决**:
```bash
# 确保后端运行
npm run server:dev

# 检查前端环境变量
cat frontend/.env.local
# 应该包含: NEXT_PUBLIC_API_URL=http://localhost:10001
```

### Q4: WebSocket 无法连接?

**症状**: 界面显示 "WebSocket: Disconnected"

**检查**:
```bash
# 使用 wscat 测试 (需先安装)
npm install -g wscat
wscat -c ws://localhost:10001

# 应该看到连接成功消息
```

### Q5: 交易报价返回错误?

**错误**: `"Invalid token address or unknown symbol"`

**原因**: 代币地址格式不正确或不支持

**解决**:
- 确保地址是 42 字符,以 `0x` 开头
- 或使用支持的符号: `BNB`, `WBNB`, `CAKE`, `USDT`, `USDC`
- 检查地址是否在 BSC 主网上有效

---

## 🛠️ 调试技巧

### 查看后端日志

```bash
# 后端日志会实时显示在终端
# 查看最近的错误:
grep -i "error" <(npm run server:dev 2>&1)
```

### 查看前端日志

1. 打开浏览器开发者工具 (F12)
2. 切换到 **Console** 标签
3. 查看错误消息
4. 检查 **Network** 标签中的 API 请求

### 测试 API 端点

```bash
# Dashboard API
curl http://localhost:10001/api/dashboard/overview

# System Status
curl http://localhost:10001/api/dashboard/status

# Trading Quote
curl -X POST http://localhost:10001/api/trading/quote \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"BNB","tokenOut":"0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82","amountIn":"0.1"}'

# Wallet List
curl http://localhost:10001/api/v1/wallets/list
```

---

## 🚨 安全提醒

### ⚠️ 开发环境配置

当前配置仅适用于**开发和测试**,不要在生产环境使用!

**开发配置**:
```bash
NODE_ENV=development
DISABLE_AUTH=true  # 禁用了认证!
JWT_SECRET=dev-secret-key-for-testing-only-256bits-long  # 弱密钥!
```

### 🔒 生产环境必须修改

使用真实资金前,务必:

1. ✅ 修改 `JWT_SECRET` 为强密钥 (32+ 字符)
2. ✅ 修改 `ENCRYPTION_PASSWORD` 为强密码
3. ✅ 设置 `DISABLE_AUTH=false`
4. ✅ 设置 `NODE_ENV=production`
5. ✅ 使用付费/自建 RPC 节点
6. ✅ 配置访问控制和防火墙

---

## 📚 下一步

恭喜!你已经成功启动了 BSC 交易机器人。接下来可以:

### 1. 深入学习
- 阅读 [完整 README](./README.md)
- 查看 [API 文档](./README.md#api-文档)
- 了解 [架构设计](./README.md#项目架构)

### 2. 高级功能
- 配置批量操作
- 设置钱包管理
- 启用实时监控
- 配置告警通知

### 3. 生产部署
- 阅读 [部署指南](./README.md#部署指南)
- 查看 [安全最佳实践](./README.md#安全最佳实践)
- 检查 [生产环境清单](./PRODUCTION_READINESS_CHECKLIST.md)

### 4. 开发定制
- 添加新的交易策略
- 集成更多 DEX
- 定制 UI 界面
- 扩展监控功能

---

## 💬 获取帮助

### 问题排查顺序

1. **检查日志**: 查看终端输出的错误信息
2. **测试 API**: 使用 curl 测试后端是否正常
3. **查看文档**: 搜索本文档的常见问题
4. **重启服务**: 停止并重新启动所有服务
5. **重新安装**: 删除 node_modules 并重新安装

### 报告问题

如果问题仍未解决,请提供:

1. 完整的错误消息
2. 运行的命令
3. 环境信息 (`node --version`, `npm --version`)
4. 日志输出

---

## ✅ 快速检查清单

- [ ] Node.js >= 18.0.0
- [ ] npm >= 8.0.0
- [ ] 后端依赖已安装
- [ ] 前端依赖已安装
- [ ] .env 文件已创建
- [ ] 后端服务器运行中 (端口 10001)
- [ ] 前端服务器运行中 (端口 10002)
- [ ] Dashboard API 测试通过
- [ ] 前端界面可访问
- [ ] WebSocket 连接成功
- [ ] Trading Quote API 测试通过

全部打勾?恭喜,你已准备就绪! 🎉

---

## 🎯 5分钟总结

```bash
# 1. 安装依赖 (1分钟)
npm install
cd frontend && npm install && cd ..

# 2. 配置环境 (30秒)
cp .env.example .env
# 编辑 .env 或使用默认值

# 3. 启动后端 (30秒)
npm run server:dev

# 4. 启动前端 (新终端, 30秒)
cd frontend && npm run dev

# 5. 访问界面 (1分钟)
# 打开浏览器: http://localhost:10002
# 测试报价功能

# 6. 验证功能 (1.5分钟)
curl http://localhost:10001/api/dashboard/overview
curl -X POST http://localhost:10001/api/trading/quote \
  -H "Content-Type: application/json" \
  -d '{"tokenIn":"BNB","tokenOut":"0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82","amountIn":"0.1"}'
```

**总计: 约 5 分钟** ⏱️

---

**祝你使用愉快! Happy Trading! 🚀**

*Last Updated: 2025-10-01*
