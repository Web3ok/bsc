# BianDEX 实施指南

这份指南提供了从当前状态到完整功能实现的详细步骤和最佳实践。

---

## 📊 当前项目状态

### ✅ 已完成 (生产就绪)

**智能合约**:
- BianDEX 核心合约 (SimpleLiquidityPool + Factory)
- BianDEXRouter (多跳、BNB 支持)
- FeeDistributor (手续费分红)
- 完整测试覆盖 (49/49 测试通过)
- 部署脚本和文档
- 安全审计准备

**基础设施**:
- Hardhat 配置
- Gas 分析工具
- BSC 部署脚本
- 合约验证集成

### 📝 待实现

**智能合约** (1-2周):
1. LPMining 合约
2. TWAPOracle 合约
3. RewardToken 合约

**前端应用** (2-3周):
4. Next.js 项目搭建
5. Web3 钱包集成
6. Swap UI
7. 流动性管理
8. 挖矿界面
9. 交易历史

**后端服务** (2-3周):
10. API 服务器
11. TVL 追踪
12. 监控告警
13. 分析报表

---

## 🗓️ 推荐实施计划

### 第一周：智能合约完善

#### Day 1-2: LPMining 合约

**代码位置**: `contracts/LPMining.sol` (已提供完整代码)

**任务清单**:
```bash
# 1. 复制 LPMining.sol 到 contracts/
# 2. 创建 RewardToken.sol
# 3. 编译测试
npx hardhat compile

# 4. 编写测试
# 创建 test/LPMining.test.js
```

**测试用例** (test/LPMining.test.js):
```javascript
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LPMining", function () {
  let mining, rewardToken, lpToken;
  let owner, user1, user2;
  
  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    
    // 部署奖励代币
    const RewardToken = await ethers.getContractFactory("TestToken");
    rewardToken = await RewardToken.deploy("Reward Token", "RWD", ethers.parseEther("1000000"));
    
    // 部署 LP 代币
    lpToken = await RewardToken.deploy("LP Token", "LP", ethers.parseEther("1000000"));
    
    // 部署挖矿合约
    const LPMining = await ethers.getContractFactory("LPMining");
    const startBlock = await ethers.provider.getBlockNumber() + 10;
    mining = await LPMining.deploy(
      await rewardToken.getAddress(),
      ethers.parseEther("10"), // 10 tokens per block
      startBlock
    );
    
    // 转移奖励代币到挖矿合约
    await rewardToken.transfer(await mining.getAddress(), ethers.parseEther("100000"));
    
    // 转移 LP 代币给用户
    await lpToken.transfer(user1.address, ethers.parseEther("1000"));
    await lpToken.transfer(user2.address, ethers.parseEther("1000"));
  });
  
  it("Should add pool correctly", async function () {
    await mining.addPool(100, await lpToken.getAddress(), false);
    expect(await mining.poolLength()).to.equal(1);
    
    const pool = await mining.poolInfo(0);
    expect(pool.allocPoint).to.equal(100);
  });
  
  it("Should deposit and withdraw", async function () {
    await mining.addPool(100, await lpToken.getAddress(), false);
    
    const amount = ethers.parseEther("100");
    await lpToken.connect(user1).approve(await mining.getAddress(), amount);
    await mining.connect(user1).deposit(0, amount);
    
    const userInfo = await mining.userInfo(0, user1.address);
    expect(userInfo.amount).to.equal(amount);
    
    await mining.connect(user1).withdraw(0, amount);
    expect((await mining.userInfo(0, user1.address)).amount).to.equal(0);
  });
  
  it("Should harvest rewards", async function () {
    await mining.addPool(100, await lpToken.getAddress(), false);
    
    const amount = ethers.parseEther("100");
    await lpToken.connect(user1).approve(await mining.getAddress(), amount);
    await mining.connect(user1).deposit(0, amount);
    
    // 挖几个区块
    for (let i = 0; i < 10; i++) {
      await ethers.provider.send("evm_mine");
    }
    
    const pending = await mining.pendingReward(0, user1.address);
    expect(pending).to.be.gt(0);
    
    await mining.connect(user1).harvest(0);
    const balance = await rewardToken.balanceOf(user1.address);
    expect(balance).to.be.closeTo(pending, ethers.parseEther("1"));
  });
  
  it("Should handle multiple users", async function () {
    await mining.addPool(100, await lpToken.getAddress(), false);
    
    // User1 质押
    await lpToken.connect(user1).approve(await mining.getAddress(), ethers.parseEther("100"));
    await mining.connect(user1).deposit(0, ethers.parseEther("100"));
    
    // 挖几个区块
    for (let i = 0; i < 5; i++) {
      await ethers.provider.send("evm_mine");
    }
    
    // User2 质押
    await lpToken.connect(user2).approve(await mining.getAddress(), ethers.parseEther("100"));
    await mining.connect(user2).deposit(0, ethers.parseEther("100"));
    
    // 再挖几个区块
    for (let i = 0; i < 5; i++) {
      await ethers.provider.send("evm_mine");
    }
    
    const pending1 = await mining.pendingReward(0, user1.address);
    const pending2 = await mining.pendingReward(0, user2.address);
    
    // User1 应该获得更多奖励（质押更早）
    expect(pending1).to.be.gt(pending2);
  });
});
```

**Gas 优化检查**:
```bash
npm run gas-analysis
```

#### Day 3-4: TWAP Oracle

**文件**: `contracts/TWAPOracle.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./BianDEX.sol";

contract TWAPOracle {
    struct Observation {
        uint256 timestamp;
        uint256 price0Cumulative;
        uint256 price1Cumulative;
    }
    
    address public immutable pair;
    Observation[] public observations;
    
    uint256 public constant MIN_UPDATE_INTERVAL = 10 minutes;
    uint256 public constant WINDOW_SIZE = 24 hours;
    
    event ObservationRecorded(uint256 timestamp, uint256 price0Cumulative, uint256 price1Cumulative);
    
    constructor(address _pair) {
        pair = _pair;
        _record(); // 初始观察
    }
    
    function update() external returns (bool) {
        return _record();
    }
    
    function consult(address token, uint256 amountIn) external view returns (uint256 amountOut) {
        require(observations.length >= 2, "Insufficient data");
        
        Observation memory firstObservation = observations[0];
        Observation memory lastObservation = observations[observations.length - 1];
        
        uint256 timeElapsed = lastObservation.timestamp - firstObservation.timestamp;
        require(timeElapsed >= WINDOW_SIZE, "Window too small");
        
        SimpleLiquidityPool pairContract = SimpleLiquidityPool(pair);
        address token0 = address(pairContract.token0());
        
        uint256 priceCumulativeStart;
        uint256 priceCumulativeEnd;
        
        if (token == token0) {
            priceCumulativeStart = firstObservation.price0Cumulative;
            priceCumulativeEnd = lastObservation.price0Cumulative;
        } else {
            priceCumulativeStart = firstObservation.price1Cumulative;
            priceCumulativeEnd = lastObservation.price1Cumulative;
        }
        
        uint256 priceAverage = (priceCumulativeEnd - priceCumulativeStart) / timeElapsed;
        amountOut = (amountIn * priceAverage) / (2**112);
    }
    
    function _record() private returns (bool) {
        if (observations.length > 0) {
            Observation memory last = observations[observations.length - 1];
            if (block.timestamp - last.timestamp < MIN_UPDATE_INTERVAL) {
                return false;
            }
        }
        
        SimpleLiquidityPool pairContract = SimpleLiquidityPool(pair);
        (uint256 reserve0, uint256 reserve1) = pairContract.getReserves();
        
        uint256 price0Cumulative = (reserve1 * (2**112) / reserve0) * block.timestamp;
        uint256 price1Cumulative = (reserve0 * (2**112) / reserve1) * block.timestamp;
        
        observations.push(Observation({
            timestamp: block.timestamp,
            price0Cumulative: price0Cumulative,
            price1Cumulative: price1Cumulative
        }));
        
        // 清理旧数据（保留最近 48小时）
        while (observations.length > 0 && 
               block.timestamp - observations[0].timestamp > WINDOW_SIZE * 2) {
            // 移除第一个元素（Gas 优化：可以使用循环队列）
            for (uint i = 0; i < observations.length - 1; i++) {
                observations[i] = observations[i + 1];
            }
            observations.pop();
        }
        
        emit ObservationRecorded(block.timestamp, price0Cumulative, price1Cumulative);
        return true;
    }
}
```

#### Day 5: 合约集成测试

```bash
# 运行所有测试
npx hardhat test

# 预期结果
# BianDEX: 38/38 ✅
# BianDEXRouter: 11/11 ✅
# FeeDistributor: 10/10 ✅  (新增)
# LPMining: 8/8 ✅  (新增)
# TWAPOracle: 6/6 ✅  (新增)
# 总计: 73/73 tests passing

# Gas 报告
npm run gas-analysis
```

---

### 第二周：前端基础搭建

#### Day 1: 项目初始化

```bash
# 创建 Next.js 项目
cd ..
npx create-next-app@latest frontend --typescript --tailwind --app

cd frontend

# 安装 Web3 依赖
npm install wagmi viem @rainbow-me/rainbowkit
npm install @tanstack/react-query

# 安装 UI 组件库
npm install @radix-ui/react-dialog @radix-ui/react-select
npm install lucide-react class-variance-authority clsx tailwind-merge

# 安装图表库
npm install recharts date-fns
```

**项目结构**:
```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── swap/
│   │   ├── liquidity/
│   │   └── farming/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   └── config/
```

#### Day 2-3: Web3 钱包集成

**config/wagmi.ts**:
```typescript
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { bsc, bscTestnet } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'BianDEX',
  projectId: 'YOUR_PROJECT_ID', // 从 WalletConnect 获取
  chains: [bsc, bscTestnet],
  ssr: true,
});
```

**app/layout.tsx**:
```typescript
'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { config } from '@/config/wagmi';

const queryClient = new QueryClient();

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WagmiProvider config={config}>
          <QueryClientProvider client={queryClient}>
            <RainbowKitProvider>
              {children}
            </RainbowKitProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </body>
    </html>
  );
}
```

#### Day 4-7: Swap UI 实现

**components/Swap/SwapInterface.tsx**: (已在 PROJECT_STRUCTURE.md 中提供)

**hooks/useSwap.ts**:
```typescript
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { ROUTER_ADDRESS, ROUTER_ABI } from '@/lib/contracts';

export function useSwap() {
  const { writeContract, data: hash } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });
  
  const swap = async (
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    minAmountOut: string,
    deadline: bigint
  ) => {
    await writeContract({
      address: ROUTER_ADDRESS,
      abi: ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        parseEther(amountIn),
        parseEther(minAmountOut),
        [tokenIn, tokenOut],
        account,
        deadline
      ]
    });
  };
  
  return { swap, isLoading, isSuccess };
}
```

---

### 第三周：流动性和挖矿

#### Day 1-3: 流动性管理

**pages/liquidity/page.tsx**:
```typescript
'use client';

import { AddLiquidity } from '@/components/Liquidity/AddLiquidity';
import { RemoveLiquidity } from '@/components/Liquidity/RemoveLiquidity';
import { MyPositions } from '@/components/Liquidity/MyPositions';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export default function LiquidityPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-4xl font-bold mb-8">Liquidity</h1>
      
      <Tabs defaultValue="add">
        <TabsList>
          <TabsTrigger value="add">Add</TabsTrigger>
          <TabsTrigger value="remove">Remove</TabsTrigger>
          <TabsTrigger value="positions">My Positions</TabsTrigger>
        </TabsList>
        
        <TabsContent value="add">
          <AddLiquidity />
        </TabsContent>
        
        <TabsContent value="remove">
          <RemoveLiquidity />
        </TabsContent>
        
        <TabsContent value="positions">
          <MyPositions />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

#### Day 4-7: 挖矿界面

**pages/farming/page.tsx**:
```typescript
'use client';

import { FarmCard } from '@/components/Farming/FarmCard';
import { useFarmPools } from '@/hooks/useFarming';

export default function FarmingPage() {
  const { pools, isLoading } = useFarmPools();
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-4xl font-bold mb-8">Farms</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {pools.map((pool) => (
          <FarmCard key={pool.id} pool={pool} />
        ))}
      </div>
    </div>
  );
}
```

---

### 第四周：后端和监控

#### Day 1-2: 后端 API 服务器

```bash
mkdir backend
cd backend
npm init -y
npm install express ethers dotenv cors

# TypeScript 配置
npm install -D typescript @types/node @types/express ts-node
npx tsc --init
```

**backend/src/index.ts**:
```typescript
import express from 'express';
import cors from 'cors';
import { tvlRouter } from './routes/tvl';
import { analyticsRouter } from './routes/analytics';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/tvl', tvlRouter);
app.use('/api/analytics', analyticsRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

#### Day 3-4: 监控仪表板

**components/Dashboard/Overview.tsx**:
```typescript
'use client';

import { MetricCard } from './MetricCard';
import { TVLChart } from './TVLChart';
import { VolumeChart } from './VolumeChart';
import { useDashboardData } from '@/hooks/useDashboard';

export function DashboardOverview() {
  const { tvl, volume24h, fees24h, isLoading } = useDashboardData();
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Total Value Locked"
          value={`$${tvl.toLocaleString()}`}
          change={5.2}
        />
        
        <MetricCard
          title="24h Volume"
          value={`$${volume24h.toLocaleString()}`}
        />
        
        <MetricCard
          title="24h Fees"
          value={`$${fees24h.toLocaleString()}`}
        />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TVLChart />
        <VolumeChart />
      </div>
    </div>
  );
}
```

#### Day 5-7: 告警和分析

**backend/src/services/alert-service.ts**: (已在 ROADMAP.md 中提供)

**实现步骤**:
1. 设置 Slack/Discord webhooks
2. 配置告警规则
3. 实现实时监控
4. 测试告警触发

---

## 🎯 里程碑检查点

### Milestone 1: 智能合约完成 (第1周末)
- [ ] LPMining 合约测试通过
- [ ] TWAPOracle 合约测试通过
- [ ] 所有合约 Gas 优化完成
- [ ] 部署脚本更新

### Milestone 2: 前端基础完成 (第2周末)
- [ ] 钱包连接正常工作
- [ ] Swap 界面完成并测试
- [ ] 响应式设计实现

### Milestone 3: 核心功能完成 (第3周末)
- [ ] 流动性管理完整功能
- [ ] 挖矿界面和交互
- [ ] 交易历史查询

### Milestone 4: 生产就绪 (第4周末)
- [ ] 后端 API 稳定运行
- [ ] 监控仪表板部署
- [ ] 告警系统测试通过
- [ ] 完整的 E2E 测试

---

## 📝 开发最佳实践

### 代码质量

```bash
# 智能合约
npm install -D solhint
npx solhint 'contracts/**/*.sol'

# 前端
npm install -D eslint prettier
npm run lint
npm run format

# 测试覆盖率
npx hardhat coverage
```

### Git Workflow

```bash
# 功能分支
git checkout -b feature/lp-mining
git add .
git commit -m "feat: implement LP mining contract"
git push origin feature/lp-mining

# Pull Request
# Code Review
# Merge to main
```

### 持续集成

**.github/workflows/test.yml**:
```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run tests
        run: npm test
      
      - name: Check coverage
        run: npx hardhat coverage
```

---

## 🚀 部署流程

### 测试网部署

```bash
# 1. 配置环境变量
cp .env.example .env
# 编辑 .env 添加 PRIVATE_KEY 和 BSCSCAN_API_KEY

# 2. 部署所有合约
npx hardhat run scripts/deploy-all.js --network bsc_testnet

# 3. 验证合约
npx hardhat verify --network bsc_testnet <CONTRACT_ADDRESS>

# 4. 前端环境变量
cd frontend
cp .env.example .env.local
# 添加合约地址

# 5. 部署前端
npm run build
npm run start
```

### 主网部署

```bash
# ⚠️ 确保完成以下检查
- [ ] 测试网完整测试 (> 1周)
- [ ] 安全审计通过
- [ ] 多签钱包配置
- [ ] 监控告警就绪
- [ ] 应急预案准备

# 部署命令
npx hardhat run scripts/deploy-all.js --network bsc_mainnet
```

---

## 📚 参考资源

### 智能合约
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Uniswap V2 Docs](https://docs.uniswap.org/contracts/v2/overview)
- [MasterChef Contract](https://github.com/pancakeswap/pancake-smart-contracts)

### 前端
- [wagmi Documentation](https://wagmi.sh/)
- [RainbowKit Docs](https://www.rainbowkit.com/)
- [Next.js Docs](https://nextjs.org/docs)

### DevOps
- [Hardhat Docs](https://hardhat.org/docs)
- [The Graph Docs](https://thegraph.com/docs/)
- [BSCScan API](https://docs.bscscan.com/)

---

## 💡 常见问题

### Q: 如何测试 TWAP Oracle？
A: 需要模拟时间流逝：
```javascript
await ethers.provider.send("evm_increaseTime", [3600]); // 增加 1 小时
await ethers.provider.send("evm_mine");
```

### Q: 前端如何处理大数字？
A: 使用 viem 的 parseEther 和 formatEther：
```typescript
import { parseEther, formatEther } from 'viem';
```

### Q: 如何优化 Gas？
A: 
1. 使用 view/pure 函数
2. 批量操作
3. 避免循环中的 SLOAD
4. 使用事件代替存储

---

**文档版本**: 1.0  
**最后更新**: 2025-09-30  
**预计完成时间**: 4-6 周（3-5 人团队）

这份指南应该能让你的团队快速启动并高效完成所有功能的开发！
