# BSC Bot & BianDEX 模块化架构

## 📐 架构设计原则

### 1. 模块独立性
- 每个模块可以独立运行
- 最小化模块间依赖
- 清晰的接口定义

### 2. 配置驱动
- 环境变量控制模块启用/禁用
- 独立的配置文件
- 运行时可切换

### 3. 数据隔离
- 独立的数据库表/schema
- 独立的合约部署
- 可选的数据共享

---

## 🏗️ 当前架构

```
BSC Trading Bot Platform
│
├── Core Services (共享)
│   ├── Wallet Management      # 钱包管理
│   ├── RPC Manager            # RPC 连接池
│   ├── Database               # SQLite/PostgreSQL
│   ├── Monitoring & Logs      # 监控和日志
│   └── Authentication         # 认证系统
│
├── Bot Module (可独立)
│   ├── Trading Strategies     # 交易策略
│   ├── Batch Trading          # 批量交易
│   ├── Risk Management        # 风险管理
│   └── PancakeSwap API        # PancakeSwap 集成
│
└── BianDEX Module (可独立)
    ├── Smart Contracts        # 智能合约
    ├── Swap Interface         # 交换界面
    ├── Liquidity Pools        # 流动性池
    ├── LP Mining              # LP 挖矿
    └── Governance             # DAO 治理
```

---

## 🔧 模块配置

### 环境变量配置

```bash
# .env 配置文件

# === 核心服务 ===
NODE_ENV=development
PORT=10001
DATABASE_URL=sqlite:./data/bot.db
RPC_URL=https://bsc-dataseed1.binance.org/
JWT_SECRET=your-secret-key

# === 功能模块开关 ===
ENABLE_TRADING_BOT=true      # 启用交易机器人
ENABLE_BIANDEX=true          # 启用 BianDEX
ENABLE_MONITORING=true       # 启用监控

# === BianDEX 独立配置 ===
BIANDEX_FACTORY_ADDRESS=0x...
BIANDEX_ROUTER_ADDRESS=0x...
BIANDEX_LP_MINING_ADDRESS=0x...
BIANDEX_GOVERNANCE_ADDRESS=0x...

# === 分离部署配置 (未来使用) ===
# BIANDEX_API_URL=https://dex.example.com  # BianDEX 独立 API
# SHARED_WALLET_API=https://wallets.example.com  # 共享钱包服务
```

---

## 📦 模块接口定义

### 1. 核心服务接口

```typescript
// src/core/interfaces/WalletService.ts
export interface IWalletService {
  createWallet(config: WalletConfig): Promise<Wallet>;
  getWallet(address: string): Promise<Wallet | null>;
  signTransaction(tx: Transaction): Promise<SignedTransaction>;
}

// src/core/interfaces/MonitoringService.ts
export interface IMonitoringService {
  logEvent(event: Event): Promise<void>;
  getMetrics(timeRange: TimeRange): Promise<Metrics>;
}
```

### 2. Bot 模块接口

```typescript
// src/bot/interfaces/TradingService.ts
export interface ITradingService {
  executeTrade(params: TradeParams): Promise<TradeResult>;
  getQuote(tokenPair: TokenPair): Promise<Quote>;
}
```

### 3. BianDEX 模块接口

```typescript
// src/biandex/interfaces/DEXService.ts
export interface IDEXService {
  swap(params: SwapParams): Promise<SwapResult>;
  addLiquidity(params: LiquidityParams): Promise<LiquidityResult>;
  getPoolInfo(poolAddress: string): Promise<PoolInfo>;
}
```

---

## 🚀 部署场景

### 场景 1: 集成部署 (当前)

```bash
# 启动完整平台
ENABLE_TRADING_BOT=true ENABLE_BIANDEX=true npm run start

# 单一应用，所有功能可用
# Port 10001: Bot API + BianDEX API
# Port 10004: 统一前端界面
```

### 场景 2: 独立部署 (未来)

```bash
# 服务器 1: 只运行交易机器人
ENABLE_TRADING_BOT=true ENABLE_BIANDEX=false npm run start:bot

# 服务器 2: 只运行 BianDEX
ENABLE_TRADING_BOT=false ENABLE_BIANDEX=true npm run start:dex

# 服务器 3: 共享服务 (钱包、监控)
npm run start:core
```

### 场景 3: 微服务架构 (扩展)

```
┌─────────────────┐
│  Load Balancer  │
└────────┬────────┘
         │
    ┌────┴────┬──────────┬──────────┐
    │         │          │          │
┌───▼───┐ ┌──▼──┐  ┌────▼────┐ ┌──▼────┐
│ Bot 1 │ │Bot 2│  │BianDEX 1│ │ Core  │
└───────┘ └─────┘  └─────────┘ └───────┘
```

---

## 📋 分离步骤清单

### Phase 1: 代码重构 (1-2周)

- [ ] 1. 创建模块边界和接口
- [ ] 2. 提取共享服务到 core/
- [ ] 3. 隔离 Bot 逻辑到 bot/
- [ ] 4. 隔离 BianDEX 逻辑到 biandex/
- [ ] 5. 实现配置驱动的模块加载

### Phase 2: 数据库分离 (1周)

- [ ] 6. 创建独立的数据库 schema
- [ ] 7. Bot 专用表 (trades, strategies, bot_*)
- [ ] 8. DEX 专用表 (pools, swaps, dex_*)
- [ ] 9. 共享表 (wallets, users, auth_*)
- [ ] 10. 实现跨模块数据访问层

### Phase 3: API 分离 (1周)

- [ ] 11. Bot API 路由独立 (/api/bot/*)
- [ ] 12. DEX API 路由独立 (/api/dex/*)
- [ ] 13. Core API 路由 (/api/wallets/*, /api/auth/*)
- [ ] 14. 实现 API Gateway 模式

### Phase 4: 前端分离 (1-2周)

- [ ] 15. 提取 BianDEX 前端组件
- [ ] 16. 创建独立的 DEX 前端应用
- [ ] 17. 共享组件库 (wallets, auth)
- [ ] 18. 实现前端路由配置

### Phase 5: 部署配置 (3-5天)

- [ ] 19. Docker 容器化
- [ ] 20. 独立部署脚本
- [ ] 21. 环境变量配置
- [ ] 22. CI/CD 流水线

### Phase 6: 测试和文档 (1周)

- [ ] 23. 集成部署测试
- [ ] 24. 独立部署测试
- [ ] 25. 性能测试
- [ ] 26. 完整部署文档
- [ ] 27. 运维手册

---

## 🔒 监管合规考虑

### 1. 地理隔离
```bash
# 美国区域 - 只部署 Bot
REGION=US ENABLE_BIANDEX=false

# 非美区域 - 完整功能
REGION=INTL ENABLE_BIANDEX=true
```

### 2. KYC/AML 集成点
```typescript
// 预留合规接口
interface IComplianceService {
  checkUser(address: string): Promise<ComplianceStatus>;
  reportTransaction(tx: Transaction): Promise<void>;
}
```

### 3. 数据主权
- 独立数据库部署
- 数据本地化存储
- 符合 GDPR/CCPA

---

## 📊 成本分析

### 集成部署 (当前)
- **服务器**: 1台 (8GB RAM, 4 CPU)
- **月成本**: ~$40-80
- **维护**: 简单

### 独立部署 (未来)
- **服务器**: 3台 (每台 4GB RAM, 2 CPU)
- **月成本**: ~$90-150
- **维护**: 复杂
- **优势**: 更高可用性、独立扩展

---

## 🎯 建议

### 当前阶段 (3-6个月)
✅ **保持集成部署**
- 完善功能
- 积累用户
- 优化性能

### 中期准备 (6-12个月)
🔨 **完成模块化重构**
- 代码重构
- 接口定义
- 配置系统

### 长期规划 (1年+)
🚀 **根据需求分离**
- 用户量 > 10,000
- 监管要求
- 性能瓶颈

---

## 📞 联系方式

项目维护者: BNB Team
文档更新: 2025-10-02
