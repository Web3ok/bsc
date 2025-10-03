# BianDEX 整合计划

**目标**: 将 SimpleDEX 改名为 BianDEX,并整合到现有的前后端项目中

---

## 📋 整合步骤

### 第一步: 重命名项目 (SimpleDEX → BianDEX)

#### 1.1 合约文件重命名

```bash
# 在 contracts/ 目录下
cd contracts

# 重命名核心合约
mv SimpleDEX.sol BianDEX.sol
mv SimpleDEXRouter.sol BianDEXRouter.sol

# 重命名治理合约  
cd governance
mv SimpleDEXGovernor.sol BianDEXGovernor.sol
```

#### 1.2 合约内容替换

需要在以下文件中将 `SimpleDEX` 替换为 `BianDEX`:

**智能合约文件**:
- `contracts/BianDEX.sol`
- `contracts/BianDEXRouter.sol`
- `contracts/governance/BianDEXGovernor.sol`
- `contracts/governance/GovernanceToken.sol`
- `contracts/LPMining.sol`
- `contracts/FeeDistributor.sol`
- `contracts/TWAPOracle.sol`

**测试文件**:
- `test/SimpleDEX.test.js` → `test/BianDEX.test.js`
- `test/SimpleDEXRouter.test.js` → `test/BianDEXRouter.test.js`
- `test/LPMining.test.js`

**部署脚本**:
- `scripts/deploy-bsc.js`
- `scripts/deploy-governance.js`
- `scripts/deploy-advanced.js`

**文档**:
- All `.md` files in `docs/`
- `README.md`
- `package.json`

#### 1.3 批量替换命令

```bash
# 在项目根目录执行
cd /Users/ph88vito/project/BNB/contracts-project

# 替换所有 Solidity 文件
find contracts -name "*.sol" -type f -exec sed -i '' 's/SimpleDEX/BianDEX/g' {} +

# 替换所有测试文件
find test -name "*.js" -type f -exec sed -i '' 's/SimpleDEX/BianDEX/g' {} +

# 替换所有脚本文件
find scripts -name "*.js" -type f -exec sed -i '' 's/SimpleDEX/BianDEX/g' {} +

# 替换所有文档
find docs -name "*.md" -type f -exec sed -i '' 's/SimpleDEX/BianDEX/g' {} +
sed -i '' 's/SimpleDEX/BianDEX/g' README.md
sed -i '' 's/SimpleDEX/BianDEX/g' package.json

# 重命名文件
mv contracts/SimpleDEX.sol contracts/BianDEX.sol
mv contracts/SimpleDEXRouter.sol contracts/BianDEXRouter.sol
mv contracts/governance/SimpleDEXGovernor.sol contracts/governance/BianDEXGovernor.sol
mv test/SimpleDEX.test.js test/BianDEX.test.js
mv test/SimpleDEXRouter.test.js test/BianDEXRouter.test.js
```

---

## 第二步: 整合到现有前端项目

### 2.1 项目结构
```
/Users/ph88vito/project/BNB/
├── contracts-project/          # BianDEX 智能合约 (当前目录)
│   ├── contracts/             # 12个合约
│   ├── test/                  # 70个测试
│   ├── scripts/               # 部署脚本
│   └── docs/                  # 文档
│
├── frontend/                   # 现有前端 (Next.js)
│   └── src/
│       ├── app/               
│       ├── components/        
│       ├── hooks/             # 新增 DEX hooks
│       ├── contracts/         # 新增合约 ABIs
│       └── lib/               # 工具函数
│
└── (backend files)            # 现有后端
```

### 2.2 前端整合文件

#### A. 创建合约配置文件

**`frontend/src/contracts/biandex.ts`**
```typescript
export const BIANDEX_CONTRACTS = {
  BianDEX: {
    address: process.env.NEXT_PUBLIC_BIANDEX_ADDRESS || '',
    abi: [] // 从编译后的 artifacts 复制
  },
  BianDEXRouter: {
    address: process.env.NEXT_PUBLIC_ROUTER_ADDRESS || '',
    abi: []
  },
  LimitOrderBook: {
    address: process.env.NEXT_PUBLIC_LIMIT_ORDER_ADDRESS || '',
    abi: []
  },
  DEXAggregator: {
    address: process.env.NEXT_PUBLIC_AGGREGATOR_ADDRESS || '',
    abi: []
  },
  LPMining: {
    address: process.env.NEXT_PUBLIC_LP_MINING_ADDRESS || '',
    abi: []
  },
  GovernanceToken: {
    address: process.env.NEXT_PUBLIC_GOV_TOKEN_ADDRESS || '',
    abi: []
  },
  BianDEXGovernor: {
    address: process.env.NEXT_PUBLIC_GOVERNOR_ADDRESS || '',
    abi: []
  }
}

export const CHAIN_CONFIG = {
  bscTestnet: {
    chainId: 97,
    name: 'BSC Testnet',
    rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545/'
  },
  bscMainnet: {
    chainId: 56,
    name: 'BSC Mainnet',
    rpcUrl: 'https://bsc-dataseed.binance.org/'
  }
}
```

#### B. 创建 DEX Hooks

**`frontend/src/hooks/useBianDEX.ts`**
```typescript
import { useContractRead, useContractWrite } from 'wagmi'
import { BIANDEX_CONTRACTS } from '@/contracts/biandex'

export function useBianDEX() {
  // Swap functionality
  const { writeAsync: swap } = useContractWrite({
    address: BIANDEX_CONTRACTS.BianDEX.address,
    abi: BIANDEX_CONTRACTS.BianDEX.abi,
    functionName: 'swap'
  })

  // Add liquidity
  const { writeAsync: addLiquidity } = useContractWrite({
    address: BIANDEX_CONTRACTS.BianDEX.address,
    abi: BIANDEX_CONTRACTS.BianDEX.abi,
    functionName: 'addLiquidity'
  })

  // Remove liquidity
  const { writeAsync: removeLiquidity } = useContractWrite({
    address: BIANDEX_CONTRACTS.BianDEX.address,
    abi: BIANDEX_CONTRACTS.BianDEX.abi,
    functionName: 'removeLiquidity'
  })

  // Get reserves
  const { data: reserves } = useContractRead({
    address: BIANDEX_CONTRACTS.BianDEX.address,
    abi: BIANDEX_CONTRACTS.BianDEX.abi,
    functionName: 'getReserves'
  })

  return {
    swap,
    addLiquidity,
    removeLiquidity,
    reserves
  }
}
```

#### C. 创建 DEX 页面

**`frontend/src/app/dex/page.tsx`**
```typescript
'use client'

import { useState } from 'react'
import { useBianDEX } from '@/hooks/useBianDEX'

export default function DEXPage() {
  const { swap, addLiquidity, reserves } = useBianDEX()
  const [amountIn, setAmountIn] = useState('')
  const [amountOut, setAmountOut] = useState('')

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-4">BianDEX</h1>
      
      {/* Swap Card */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Swap</h2>
        {/* Swap UI implementation */}
      </div>

      {/* Liquidity Card */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Liquidity</h2>
        {/* Liquidity UI implementation */}
      </div>

      {/* Limit Orders Card */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Limit Orders</h2>
        {/* Limit Orders UI implementation */}
      </div>
    </div>
  )
}
```

#### D. 添加导航链接

在 `frontend/src/app/layout.tsx` 或导航组件中添加:

```typescript
<Link href="/dex">BianDEX</Link>
```

---

## 第三步: 整合到现有后端

### 3.1 后端服务架构

```
backend/
├── src/
│   ├── services/
│   │   ├── biandex/
│   │   │   ├── tvl-tracker.ts       # TVL追踪服务
│   │   │   ├── price-oracle.ts     # 价格预言机
│   │   │   ├── liquidity-monitor.ts # 流动性监控
│   │   │   └── order-matcher.ts     # 限价单撮合
│   │   └── blockchain-monitor.ts    # 现有区块链监控
│   ├── api/
│   │   └── biandex/
│   │       ├── tvl.ts              # TVL API
│   │       ├── pools.ts            # 池子信息API
│   │       ├── orders.ts           # 订单API
│   │       └── governance.ts       # 治理API
│   └── database/
│       └── biandex/
│           ├── pools.model.ts
│           ├── orders.model.ts
│           └── governance.model.ts
```

### 3.2 TVL 追踪服务

**`backend/src/services/biandex/tvl-tracker.ts`**
```typescript
import { ethers } from 'ethers'
import { BIANDEX_CONTRACTS } from './contracts'

export class BianDEXTVLTracker {
  private provider: ethers.Provider
  
  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl)
  }

  async getTotalValueLocked(): Promise<number> {
    const dex = new ethers.Contract(
      BIANDEX_CONTRACTS.BianDEX.address,
      BIANDEX_CONTRACTS.BianDEX.abi,
      this.provider
    )

    const [reserve0, reserve1] = await dex.getReserves()
    
    // Calculate TVL in USD
    // Implementation depends on price oracle
    
    return 0 // Return calculated TVL
  }

  async monitorTVL(): Promise<void> {
    setInterval(async () => {
      const tvl = await this.getTotalValueLocked()
      // Store in database
      // Send to analytics
    }, 60000) // Every minute
  }
}
```

### 3.3 价格预言机服务

**`backend/src/services/biandex/price-oracle.ts`**
```typescript
export class BianDEXPriceOracle {
  async getCurrentPrice(tokenA: string, tokenB: string): Promise<number> {
    const oracle = new ethers.Contract(
      BIANDEX_CONTRACTS.TWAPOracle.address,
      BIANDEX_CONTRACTS.TWAPOracle.abi,
      this.provider
    )

    const price = await oracle.consult(tokenA, ethers.parseEther('1'))
    return Number(ethers.formatEther(price))
  }

  async get24hPriceHistory(tokenA: string, tokenB: string): Promise<number[]> {
    // Fetch historical prices from database
    return []
  }
}
```

### 3.4 API 路由

**`backend/src/api/biandex/tvl.ts`**
```typescript
import express from 'express'
import { BianDEXTVLTracker } from '@/services/biandex/tvl-tracker'

const router = express.Router()
const tvlTracker = new BianDEXTVLTracker(process.env.BSC_RPC_URL!)

router.get('/tvl', async (req, res) => {
  try {
    const tvl = await tvlTracker.getTotalValueLocked()
    res.json({ tvl, timestamp: Date.now() })
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch TVL' })
  }
})

router.get('/tvl/history', async (req, res) => {
  // Return historical TVL data
})

export default router
```

---

## 第四步: 数据库集成

### 4.1 PostgreSQL Schema

```sql
-- BianDEX Pools Table
CREATE TABLE biandex_pools (
  id SERIAL PRIMARY KEY,
  pool_address VARCHAR(42) UNIQUE NOT NULL,
  token0_address VARCHAR(42) NOT NULL,
  token1_address VARCHAR(42) NOT NULL,
  token0_symbol VARCHAR(20),
  token1_symbol VARCHAR(20),
  reserve0 NUMERIC(78, 0),
  reserve1 NUMERIC(78, 0),
  total_supply NUMERIC(78, 0),
  tvl_usd NUMERIC(20, 2),
  volume_24h NUMERIC(20, 2),
  fee_24h NUMERIC(20, 2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Limit Orders Table
CREATE TABLE biandex_limit_orders (
  id SERIAL PRIMARY KEY,
  order_id NUMERIC(78, 0) UNIQUE NOT NULL,
  maker_address VARCHAR(42) NOT NULL,
  token_in VARCHAR(42) NOT NULL,
  token_out VARCHAR(42) NOT NULL,
  amount_in NUMERIC(78, 0),
  min_amount_out NUMERIC(78, 0),
  fee_amount NUMERIC(78, 0),
  deadline BIGINT,
  filled BOOLEAN DEFAULT FALSE,
  cancelled BOOLEAN DEFAULT FALSE,
  tx_hash VARCHAR(66),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- LP Mining Stats Table
CREATE TABLE biandex_lp_mining (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL,
  user_address VARCHAR(42) NOT NULL,
  staked_amount NUMERIC(78, 0),
  pending_rewards NUMERIC(78, 0),
  total_earned NUMERIC(78, 0),
  last_harvest TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(pool_id, user_address)
);

-- Governance Proposals Table
CREATE TABLE biandex_governance_proposals (
  id SERIAL PRIMARY KEY,
  proposal_id NUMERIC(78, 0) UNIQUE NOT NULL,
  proposer VARCHAR(42) NOT NULL,
  description TEXT,
  for_votes NUMERIC(78, 0) DEFAULT 0,
  against_votes NUMERIC(78, 0) DEFAULT 0,
  abstain_votes NUMERIC(78, 0) DEFAULT 0,
  start_block BIGINT,
  end_block BIGINT,
  executed BOOLEAN DEFAULT FALSE,
  cancelled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Price History Table
CREATE TABLE biandex_price_history (
  id SERIAL PRIMARY KEY,
  token0 VARCHAR(42) NOT NULL,
  token1 VARCHAR(42) NOT NULL,
  price NUMERIC(36, 18),
  reserve0 NUMERIC(78, 0),
  reserve1 NUMERIC(78, 0),
  block_number BIGINT,
  timestamp TIMESTAMP DEFAULT NOW(),
  INDEX idx_token_pair (token0, token1, timestamp)
);
```

---

## 第五步: 环境变量配置

### 5.1 前端环境变量

**`frontend/.env.local`**
```bash
# BianDEX Contract Addresses (BSC Testnet)
NEXT_PUBLIC_BIANDEX_ADDRESS=0x...
NEXT_PUBLIC_ROUTER_ADDRESS=0x...
NEXT_PUBLIC_LIMIT_ORDER_ADDRESS=0x...
NEXT_PUBLIC_AGGREGATOR_ADDRESS=0x...
NEXT_PUBLIC_LP_MINING_ADDRESS=0x...
NEXT_PUBLIC_GOV_TOKEN_ADDRESS=0x...
NEXT_PUBLIC_GOVERNOR_ADDRESS=0x...

# Chain Config
NEXT_PUBLIC_CHAIN_ID=97
NEXT_PUBLIC_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/
```

### 5.2 后端环境变量

**`backend/.env`**
```bash
# BianDEX Monitoring
BIANDEX_ENABLED=true
BIANDEX_CONTRACTS_PATH=../contracts-project/artifacts/contracts
BSC_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/

# BianDEX Contract Addresses
BIANDEX_ADDRESS=0x...
ROUTER_ADDRESS=0x...
LIMIT_ORDER_ADDRESS=0x...
AGGREGATOR_ADDRESS=0x...
LP_MINING_ADDRESS=0x...
GOV_TOKEN_ADDRESS=0x...
GOVERNOR_ADDRESS=0x...

# Monitoring Config
TVL_UPDATE_INTERVAL=60000
PRICE_UPDATE_INTERVAL=30000
ORDER_MATCH_INTERVAL=10000
```

---

## 第六步: 部署流程

### 6.1 部署合约

```bash
cd /Users/ph88vito/project/BNB/contracts-project

# 1. 编译合约
npm run compile

# 2. 运行测试
npm test

# 3. 部署到BSC测试网
npm run deploy:testnet

# 4. 部署治理系统
npm run deploy:governance -- --network bsc_testnet

# 5. 部署高级功能
npm run deploy:advanced -- --network bsc_testnet

# 6. 记录合约地址
# 复制输出的地址到环境变量文件
```

### 6.2 复制 ABIs 到前端

```bash
# 创建脚本自动复制 ABIs
node scripts/copy-abis.js
```

**`scripts/copy-abis.js`**
```javascript
const fs = require('fs')
const path = require('path')

const contracts = [
  'BianDEX',
  'BianDEXRouter',
  'LimitOrderBook',
  'DEXAggregator',
  'LPMining',
  'GovernanceToken',
  'BianDEXGovernor'
]

const artifactsPath = path.join(__dirname, '../artifacts/contracts')
const frontendPath = path.join(__dirname, '../../frontend/src/contracts/abis')

// Create directory if not exists
if (!fs.existsSync(frontendPath)) {
  fs.mkdirSync(frontendPath, { recursive: true })
}

contracts.forEach(contract => {
  const artifactPath = path.join(artifactsPath, `${contract}.sol/${contract}.json`)
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  
  const abiPath = path.join(frontendPath, `${contract}.json`)
  fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2))
  
  console.log(`✅ Copied ${contract} ABI`)
})

console.log('\n🎉 All ABIs copied successfully!')
```

### 6.3 启动服务

```bash
# 1. 启动后端
cd backend
npm run server:dev

# 2. 启动前端
cd frontend
npm run dev

# 3. 访问
# Frontend: http://localhost:3000/dex
# Backend API: http://localhost:10001/api/biandex
```

---

## 第七步: 测试整合

### 7.1 前端测试

1. 连接钱包
2. 测试 Swap 功能
3. 测试添加/移除流动性
4. 测试 LP 质押
5. 测试限价单
6. 测试治理投票

### 7.2 后端测试

```bash
# 测试 TVL API
curl http://localhost:10001/api/biandex/tvl

# 测试池子信息
curl http://localhost:10001/api/biandex/pools

# 测试订单API
curl http://localhost:10001/api/biandex/orders
```

---

## 📋 整合检查清单

- [ ] 所有文件中 SimpleDEX 改为 BianDEX
- [ ] 合约重新编译成功
- [ ] 所有测试通过
- [ ] 部署脚本更新
- [ ] 前端合约配置完成
- [ ] 前端 DEX页面创建
- [ ] 后端服务整合
- [ ] 数据库表创建
- [ ] 环境变量配置
- [ ] ABIs 复制到前端
- [ ] API路由测试
- [ ] 前端功能测试
- [ ] 文档更新

---

## 🚀 快速整合命令

```bash
#!/bin/bash
# 执行完整整合流程

echo "🔄 Step 1: 重命名 SimpleDEX 为 BianDEX..."
cd /Users/ph88vito/project/BNB/contracts-project
find . -name "*.sol" -type f -exec sed -i '' 's/SimpleDEX/BianDEX/g' {} +
find . -name "*.js" -type f -exec sed -i '' 's/SimpleDEX/BianDEX/g' {} +
find . -name "*.md" -type f -exec sed -i '' 's/SimpleDEX/BianDEX/g' {} +
mv contracts/SimpleDEX.sol contracts/BianDEX.sol 2>/dev/null
mv contracts/SimpleDEXRouter.sol contracts/BianDEXRouter.sol 2>/dev/null
mv contracts/governance/SimpleDEXGovernor.sol contracts/governance/BianDEXGovernor.sol 2>/dev/null

echo "✅ Step 1 完成"

echo "🔧 Step 2: 重新编译合约..."
npm run compile

echo "🧪 Step 3: 运行测试..."
npm test

echo "📋 Step 4: 复制 ABIs 到前端..."
node scripts/copy-abis.js

echo "✅ 整合完成!"
echo "📌 下一步: 部署合约并配置环境变量"
```

---

**最后更新**: 2025-09-30  
**状态**: 就绪,等待执行
