# BianDEX 完整项目结构

本文档提供了 BianDEX 完整功能的项目结构和关键代码框架。

---

## 📁 项目目录结构

```
BianDEX/
├── contracts-project/              # 智能合约项目
│   ├── contracts/
│   │   ├── BianDEX.sol          ✅ 已完成
│   │   ├── BianDEXRouter.sol    ✅ 已完成  
│   │   ├── FeeDistributor.sol     ✅ 已完成
│   │   ├── LPMining.sol           📝 待实现
│   │   ├── TWAPOracle.sol         📝 待实现
│   │   ├── RewardToken.sol        📝 待实现
│   │   └── test/
│   │       ├── TestToken.sol      ✅ 已完成
│   │       └── WBNB.sol           ✅ 已完成
│   ├── test/
│   │   ├── BianDEX.test.js      ✅ 已完成 (38/38)
│   │   ├── BianDEXRouter.test.js ✅ 已完成 (11/11)
│   │   ├── FeeDistributor.test.js 📝 待实现
│   │   ├── LPMining.test.js       📝 待实现
│   │   └── TWAPOracle.test.js     📝 待实现
│   ├── scripts/
│   │   ├── deploy-bsc.js          ✅ 已完成
│   │   ├── gas-analysis.js        ✅ 已完成
│   │   └── deploy-advanced.js     📝 待实现
│   ├── DEPLOYMENT.md              ✅ 已完成
│   ├── SECURITY.md                ✅ 已完成
│   └── ROADMAP.md                 ✅ 已完成
│
├── frontend/                      # 前端应用
│   ├── src/
│   │   ├── app/                   # Next.js 13+ App Router
│   │   │   ├── page.tsx           # 首页
│   │   │   ├── swap/
│   │   │   │   └── page.tsx       # Swap 页面
│   │   │   ├── liquidity/
│   │   │   │   └── page.tsx       # 流动性页面
│   │   │   ├── farming/
│   │   │   │   └── page.tsx       # 挖矿页面
│   │   │   └── analytics/
│   │   │       └── page.tsx       # 分析页面
│   │   ├── components/
│   │   │   ├── Web3/
│   │   │   │   ├── WalletConnect.tsx
│   │   │   │   └── NetworkSwitch.tsx
│   │   │   ├── Swap/
│   │   │   │   ├── SwapInterface.tsx
│   │   │   │   ├── TokenInput.tsx
│   │   │   │   ├── TokenSelector.tsx
│   │   │   │   └── SlippageSettings.tsx
│   │   │   ├── Liquidity/
│   │   │   │   ├── AddLiquidity.tsx
│   │   │   │   ├── RemoveLiquidity.tsx
│   │   │   │   └── PositionCard.tsx
│   │   │   ├── Farming/
│   │   │   │   ├── FarmCard.tsx
│   │   │   │   └── HarvestButton.tsx
│   │   │   ├── Analytics/
│   │   │   │   ├── TVLChart.tsx
│   │   │   │   ├── VolumeChart.tsx
│   │   │   │   └── MetricCard.tsx
│   │   │   └── Common/
│   │   │       ├── Button.tsx
│   │   │       ├── Card.tsx
│   │   │       └── Modal.tsx
│   │   ├── hooks/
│   │   │   ├── useWallet.ts
│   │   │   ├── useContract.ts
│   │   │   ├── useSwap.ts
│   │   │   ├── useLiquidity.ts
│   │   │   ├── useFarming.ts
│   │   │   ├── usePrice.ts
│   │   │   └── useTransactions.ts
│   │   ├── lib/
│   │   │   ├── contracts.ts
│   │   │   ├── tokens.ts
│   │   │   ├── utils.ts
│   │   │   └── api.ts
│   │   ├── config/
│   │   │   ├── wagmi.ts
│   │   │   ├── chains.ts
│   │   │   └── constants.ts
│   │   └── styles/
│   │       └── globals.css
│   ├── public/
│   │   └── images/
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                       # 后端服务
│   ├── src/
│   │   ├── services/
│   │   │   ├── blockchain-monitor.ts
│   │   │   ├── alert-service.ts
│   │   │   ├── tvl-tracker.ts
│   │   │   ├── analytics-service.ts
│   │   │   └── price-service.ts
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── tvl.ts
│   │   │   │   ├── volume.ts
│   │   │   │   ├── transactions.ts
│   │   │   │   └── analytics.ts
│   │   │   └── middleware/
│   │   │       └── auth.ts
│   │   ├── db/
│   │   │   ├── schema.ts
│   │   │   └── queries.ts
│   │   ├── utils/
│   │   │   └── helpers.ts
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
│
└── subgraph/                      # The Graph 索引
    ├── schema.graphql
    ├── subgraph.yaml
    ├── src/
    │   └── mapping.ts
    └── package.json
```

---

## 🔧 核心合约代码框架

### LPMining.sol (待实现)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LPMining
 * @notice LP 挖矿奖励合约，类似 MasterChef
 */
contract LPMining is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    struct PoolInfo {
        IERC20 lpToken;
        uint256 allocPoint;
        uint256 lastRewardBlock;
        uint256 accRewardPerShare;
        uint256 totalStaked;
    }
    
    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
        uint256 pendingRewards;
    }
    
    IERC20 public rewardToken;
    uint256 public rewardPerBlock;
    uint256 public startBlock;
    uint256 public totalAllocPoint;
    
    PoolInfo[] public poolInfo;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Harvest(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    
    constructor(
        IERC20 _rewardToken,
        uint256 _rewardPerBlock,
        uint256 _startBlock
    ) Ownable(msg.sender) {
        rewardToken = _rewardToken;
        rewardPerBlock = _rewardPerBlock;
        startBlock = _startBlock;
    }
    
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }
    
    function addPool(uint256 _allocPoint, IERC20 _lpToken, bool _withUpdate) external onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        
        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint += _allocPoint;
        
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardBlock: lastRewardBlock,
            accRewardPerShare: 0,
            totalStaked: 0
        }));
    }
    
    function setAllocPoint(uint256 _pid, uint256 _allocPoint, bool _withUpdate) external onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        
        totalAllocPoint = totalAllocPoint - poolInfo[_pid].allocPoint + _allocPoint;
        poolInfo[_pid].allocPoint = _allocPoint;
    }
    
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        
        uint256 lpSupply = pool.totalStaked;
        if (lpSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        
        uint256 multiplier = block.number - pool.lastRewardBlock;
        uint256 reward = (multiplier * rewardPerBlock * pool.allocPoint) / totalAllocPoint;
        
        pool.accRewardPerShare += (reward * 1e12) / lpSupply;
        pool.lastRewardBlock = block.number;
    }
    
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }
    
    function pendingReward(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 lpSupply = pool.totalStaked;
        
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 multiplier = block.number - pool.lastRewardBlock;
            uint256 reward = (multiplier * rewardPerBlock * pool.allocPoint) / totalAllocPoint;
            accRewardPerShare += (reward * 1e12) / lpSupply;
        }
        
        return (user.amount * accRewardPerShare / 1e12) - user.rewardDebt + user.pendingRewards;
    }
    
    function deposit(uint256 _pid, uint256 _amount) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        updatePool(_pid);
        
        if (user.amount > 0) {
            uint256 pending = (user.amount * pool.accRewardPerShare / 1e12) - user.rewardDebt;
            if (pending > 0) {
                user.pendingRewards += pending;
            }
        }
        
        if (_amount > 0) {
            pool.lpToken.safeTransferFrom(msg.sender, address(this), _amount);
            user.amount += _amount;
            pool.totalStaked += _amount;
        }
        
        user.rewardDebt = user.amount * pool.accRewardPerShare / 1e12;
        
        emit Deposit(msg.sender, _pid, _amount);
    }
    
    function withdraw(uint256 _pid, uint256 _amount) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        require(user.amount >= _amount, "Insufficient balance");
        
        updatePool(_pid);
        
        uint256 pending = (user.amount * pool.accRewardPerShare / 1e12) - user.rewardDebt;
        if (pending > 0) {
            user.pendingRewards += pending;
        }
        
        if (_amount > 0) {
            user.amount -= _amount;
            pool.totalStaked -= _amount;
            pool.lpToken.safeTransfer(msg.sender, _amount);
        }
        
        user.rewardDebt = user.amount * pool.accRewardPerShare / 1e12;
        
        emit Withdraw(msg.sender, _pid, _amount);
    }
    
    function harvest(uint256 _pid) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        updatePool(_pid);
        
        uint256 pending = (user.amount * pool.accRewardPerShare / 1e12) - user.rewardDebt;
        uint256 totalReward = pending + user.pendingRewards;
        
        require(totalReward > 0, "No rewards");
        
        user.pendingRewards = 0;
        user.rewardDebt = user.amount * pool.accRewardPerShare / 1e12;
        
        rewardToken.safeTransfer(msg.sender, totalReward);
        
        emit Harvest(msg.sender, _pid, totalReward);
    }
    
    function emergencyWithdraw(uint256 _pid) external nonReentrant {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;
        user.pendingRewards = 0;
        
        pool.totalStaked -= amount;
        pool.lpToken.safeTransfer(msg.sender, amount);
        
        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }
}
```

---

## 🎨 前端核心组件示例

### WalletConnect.tsx

```typescript
'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';

export function WalletConnect() {
  return <ConnectButton />;
}
```

### SwapInterface.tsx  

```typescript
'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Token, SwapQuote } from '@/types';
import { TokenInput } from './TokenInput';
import { SlippageSettings } from './SlippageSettings';
import { SwapButton } from './SwapButton';

export function SwapInterface() {
  const { address } = useAccount();
  const [tokenIn, setTokenIn] = useState<Token | null>(null);
  const [tokenOut, setTokenOut] = useState<Token | null>(null);
  const [amountIn, setAmountIn] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  
  return (
    <div className="w-full max-w-md p-6 bg-white rounded-2xl shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Swap</h2>
        <SlippageSettings value={slippage} onChange={setSlippage} />
      </div>
      
      <TokenInput
        label="From"
        token={tokenIn}
        amount={amountIn}
        onChange={setAmountIn}
        onSelectToken={setTokenIn}
      />
      
      <div className="flex justify-center my-4">
        <button className="p-2 rounded-full bg-gray-100 hover:bg-gray-200">
          ↓
        </button>
      </div>
      
      <TokenInput
        label="To"
        token={tokenOut}
        amount="" // 从 quote 获取
        onSelectToken={setTokenOut}
        readOnly
      />
      
      <SwapButton 
        tokenIn={tokenIn}
        tokenOut={tokenOut}
        amountIn={amountIn}
        slippage={slippage}
      />
    </div>
  );
}
```

---

## 📊 后端 API 示例

### TVL Tracker Service

```typescript
// backend/src/services/tvl-tracker.ts

import { ethers } from 'ethers';
import { DEX_FACTORY_ABI, ERC20_ABI } from '../abis';

export class TVLTracker {
  private provider: ethers.Provider;
  private factory: ethers.Contract;
  
  constructor(rpcUrl: string, factoryAddress: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.factory = new ethers.Contract(factoryAddress, DEX_FACTORY_ABI, this.provider);
  }
  
  async calculateTVL(): Promise<{ total: number; pairs: any[] }> {
    const pairCount = await this.factory.allPairsLength();
    let totalTVL = 0;
    const pairs = [];
    
    for (let i = 0; i < pairCount; i++) {
      const pairAddress = await this.factory.allPairs(i);
      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
      
      const token0Address = await pair.token0();
      const token1Address = await pair.token1();
      const reserves = await pair.getReserves();
      
      const token0Price = await this.getTokenPrice(token0Address);
      const token1Price = await this.getTokenPrice(token1Address);
      
      const tvl = (
        Number(ethers.formatEther(reserves[0])) * token0Price +
        Number(ethers.formatEther(reserves[1])) * token1Price
      );
      
      totalTVL += tvl;
      pairs.push({ address: pairAddress, tvl });
    }
    
    return { total: totalTVL, pairs };
  }
  
  private async getTokenPrice(tokenAddress: string): Promise<number> {
    // 从 CoinGecko/PancakeSwap 获取价格
    // 简化示例，实际需要实现价格查询逻辑
    return 1; // $1 USD
  }
}
```

---

## 🚀 快速开始命令

```bash
# 1. 智能合约开发
cd contracts-project
npm install
npx hardhat compile
npx hardhat test
npm run deploy:testnet

# 2. 前端开发
cd frontend
npm install
npm run dev

# 3. 后端服务
cd backend
npm install
npm run dev

# 4. The Graph
cd subgraph
npm install
npm run codegen
npm run build
npm run deploy
```

---

## ✅ 开发检查清单

### 智能合约
- [x] BianDEX 核心合约
- [x] BianDEXRouter
- [x] FeeDistributor
- [ ] LPMining
- [ ] TWAPOracle
- [ ] RewardToken
- [ ] 所有合约测试
- [ ] Gas 优化
- [ ] 安全审计

### 前端
- [ ] 项目初始化 (Next.js 13+)
- [ ] Web3 钱包集成
- [ ] Swap 界面
- [ ] 流动性管理
- [ ] 挖矿页面
- [ ] 交易历史
- [ ] 响应式设计
- [ ] 性能优化

### 后端
- [ ] Express/Fastify 服务器
- [ ] TVL 追踪服务
- [ ] 价格查询服务
- [ ] 分析服务
- [ ] 告警系统
- [ ] 数据库设计
- [ ] API 文档

### DevOps
- [ ] CI/CD 流程
- [ ] 监控告警
- [ ] 日志收集
- [ ] 备份策略
- [ ] 负载测试

---

**文档版本**: 1.0  
**最后更新**: 2025-09-30

这个文档提供了完整项目的鸟瞰图。根据实际需求，可以优先实现核心功能，其他功能可以迭代开发。
