# BianDEX 功能扩展路线图

## 📋 项目概览

本路线图包含 12 个主要功能模块的完整开发计划，分为 3 个阶段。

---

## 🔧 第一阶段：合约功能增强 (1-2周)

### 1. 手续费分红机制 ✅

**状态**: 已创建基础合约

**文件**: `contracts/FeeDistributor.sol`

**功能**:
- LP 持有者质押获得交易手续费分红
- 采用 MasterChef 风格的奖励计算
- 支持随时存取和领取奖励

**实现细节**:
```solidity
- deposit(amount): 质押 LP 代币
- withdraw(amount): 取回 LP 代币  
- claim(): 领取累计奖励
- distributeFees(amount): 分配手续费（仅 owner）
- pendingReward(user): 查询待领取奖励
```

**Gas 成本**:
- 质押: ~100k gas
- 取回: ~80k gas
- 领取: ~60k gas

**测试要点**:
- [ ] 单用户质押/取回/领取
- [ ] 多用户并发质押
- [ ] 奖励计算准确性
- [ ] 手续费分配正确性
- [ ] 重入攻击防护

---

### 2. LP 挖矿奖励系统

**预计时间**: 3-4天

**文件**: `contracts/LPMining.sol`

**功能**:
- 质押 LP 获得治理代币奖励
- 多池支持，不同池不同权重
- 线性释放，可调整奖励速率

**架构设计**:
```solidity
contract LPMining {
    struct PoolInfo {
        IERC20 lpToken;
        uint256 allocPoint;      // 分配权重
        uint256 lastRewardBlock;
        uint256 accTokenPerShare;
    }
    
    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
    }
    
    IERC20 public rewardToken;
    uint256 public tokenPerBlock;
    uint256 public totalAllocPoint;
    
    PoolInfo[] public poolInfo;
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    
    function deposit(uint256 pid, uint256 amount);
    function withdraw(uint256 pid, uint256 amount);
    function harvest(uint256 pid);
    function emergencyWithdraw(uint256 pid);
    
    function addPool(uint256 allocPoint, IERC20 lpToken) onlyOwner;
    function setAllocPoint(uint256 pid, uint256 allocPoint) onlyOwner;
    function setTokenPerBlock(uint256 amount) onlyOwner;
}
```

**关键特性**:
- ✅ 防止重复添加池子
- ✅ 紧急取款功能（放弃奖励）
- ✅ 奖励速率可调整
- ✅ 支持动态添加/移除池子

---

### 3. TWAP 价格预言机

**预计时间**: 4-5天

**文件**: `contracts/TWAPOracle.sol`

**功能**:
- 时间加权平均价格
- 防止闪电贷操纵
- 可配置时间窗口

**实现参考 Uniswap V2**:
```solidity
contract TWAPOracle {
    struct Observation {
        uint256 timestamp;
        uint256 price0Cumulative;
        uint256 price1Cumulative;
    }
    
    address public pair;
    Observation[] public observations;
    uint256 public windowSize = 24 hours;
    
    function update() external;
    function consult(address token, uint256 amountIn) external view returns (uint256 amountOut);
    
    function _computeAmountOut(
        uint256 priceCumulativeStart,
        uint256 priceCumulativeEnd,
        uint256 timeElapsed,
        uint256 amountIn
    ) private pure returns (uint256);
}
```

**数学原理**:
```
TWAP = (Σ(price_i * time_i)) / total_time
price_cumulative = Σ(price_i * time_i)
```

**安全考虑**:
- 最小更新间隔（防止操纵）
- 最小观察窗口（确保数据充足）
- 异常值检测

---

### 4. 扩展代币标准支持

**预计时间**: 2-3天

**功能**:
- 支持收费代币（transfer fee）
- 支持 rebasing 代币
- 支持 ERC777

**修改点**:
```solidity
// 支持收费代币
function _handleTransferFee(
    IERC20 token,
    uint256 expectedAmount
) internal returns (uint256 actualAmount) {
    uint256 balanceBefore = token.balanceOf(address(this));
    token.safeTransferFrom(msg.sender, address(this), expectedAmount);
    uint256 balanceAfter = token.balanceOf(address(this));
    actualAmount = balanceAfter - balanceBefore;
}
```

**兼容性测试**:
- [ ] USDT (无返回值)
- [ ] SAFEMOON (转账扣费)
- [ ] AMPL (弹性供应)

---

## 🎨 第二阶段：前端开发 (2-3周)

### 5. Web3 钱包连接

**技术栈**:
- RainbowKit / ConnectKit
- wagmi (React Hooks)
- ethers.js v6

**文件结构**:
```
frontend/
├── src/
│   ├── components/
│   │   └── WalletConnect.tsx
│   ├── hooks/
│   │   ├── useWallet.ts
│   │   └── useContract.ts
│   ├── config/
│   │   └── wagmi.ts
│   └── utils/
│       └── contracts.ts
```

**核心功能**:
```typescript
// hooks/useWallet.ts
export function useWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  
  return {
    address,
    isConnected,
    connect,
    disconnect,
    connectors
  };
}

// hooks/useContract.ts
export function useBianDEX() {
  const { data: signer } = useSigner();
  
  return useMemo(() => {
    if (!signer) return null;
    return new Contract(DEX_ADDRESS, DEX_ABI, signer);
  }, [signer]);
}
```

---

### 6. Swap UI 界面

**设计要求**:
- 代币选择器
- 数量输入
- 滑点设置
- 价格影响显示
- Gas 估算

**组件结构**:
```typescript
// components/Swap/SwapInterface.tsx
export function SwapInterface() {
  const [tokenIn, setTokenIn] = useState<Token>();
  const [tokenOut, setTokenOut] = useState<Token>();
  const [amountIn, setAmountIn] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  
  const { data: quote } = useSwapQuote(tokenIn, tokenOut, amountIn);
  const { write: executeSwap } = useSwap();
  
  return (
    <Card>
      <TokenInput
        label="From"
        token={tokenIn}
        amount={amountIn}
        onChange={setAmountIn}
        onSelectToken={setTokenIn}
      />
      
      <SwapButton onClick={() => {/* 交换 */}} />
      
      <TokenInput
        label="To"
        token={tokenOut}
        amount={quote?.amountOut}
        onSelectToken={setTokenOut}
        readOnly
      />
      
      <SwapDetails
        priceImpact={quote?.priceImpact}
        minReceived={quote?.minReceived}
        fee={quote?.fee}
      />
      
      <SlippageSettings value={slippage} onChange={setSlippage} />
      
      <Button onClick={executeSwap}>Swap</Button>
    </Card>
  );
}
```

---

### 7. 流动性管理面板

**功能模块**:
- 添加流动性
- 移除流动性
- LP 持仓查询
- 收益统计

**页面布局**:
```typescript
// pages/liquidity.tsx
export default function LiquidityPage() {
  const { positions } = useLPPositions();
  
  return (
    <Container>
      <Tabs>
        <Tab label="Add Liquidity">
          <AddLiquidityForm />
        </Tab>
        
        <Tab label="My Positions">
          <PositionsList positions={positions} />
        </Tab>
      </Tabs>
    </Container>
  );
}

// components/Liquidity/AddLiquidityForm.tsx
export function AddLiquidityForm() {
  return (
    <Form>
      <TokenPairInput />
      <AmountInputs />
      <PriceRangeSelector />
      <Summary />
      <SubmitButton />
    </Form>
  );
}
```

---

### 8. 交易历史查询

**数据来源**:
- The Graph (推荐)
- 直接查询事件日志
- 后端 API

**实现方案 A: The Graph**
```graphql
# schema.graphql
type Swap @entity {
  id: ID!
  user: Bytes!
  tokenIn: Token!
  tokenOut: Token!
  amountIn: BigInt!
  amountOut: BigInt!
  timestamp: BigInt!
  txHash: Bytes!
}

type LiquidityAdded @entity {
  id: ID!
  user: Bytes!
  pair: Pair!
  amount0: BigInt!
  amount1: BigInt!
  liquidity: BigInt!
  timestamp: BigInt!
}
```

**前端查询**:
```typescript
// hooks/useTransactionHistory.ts
export function useTransactionHistory(address: string) {
  const { data, loading } = useQuery(gql`
    query GetUserHistory($user: Bytes!) {
      swaps(where: { user: $user }, orderBy: timestamp, orderDirection: desc) {
        id
        tokenIn { symbol }
        tokenOut { symbol }
        amountIn
        amountOut
        timestamp
      }
    }
  `, { variables: { user: address } });
  
  return { history: data?.swaps, loading };
}
```

---

## 📊 第三阶段：运营工具 (2-3周)

### 9. 实时监控仪表板

**技术栈**:
- React + TypeScript
- Chart.js / Recharts
- WebSocket (实时数据)

**指标面板**:
```typescript
// components/Dashboard/Overview.tsx
export function DashboardOverview() {
  const { tvl } = useTVL();
  const { volume24h } = useVolume();
  const { fees24h } = useFees();
  
  return (
    <Grid>
      <MetricCard
        title="Total Value Locked"
        value={formatUSD(tvl)}
        change={tvlChange24h}
      />
      
      <MetricCard
        title="24h Volume"
        value={formatUSD(volume24h)}
      />
      
      <MetricCard
        title="24h Fees"
        value={formatUSD(fees24h)}
      />
      
      <ChartCard title="TVL Trend">
        <LineChart data={tvlHistory} />
      </ChartCard>
      
      <ChartCard title="Volume by Pair">
        <BarChart data={volumeByPair} />
      </ChartCard>
    </Grid>
  );
}
```

---

### 10. 自动化告警系统

**告警规则**:
- 大额交易 (> $100k)
- 价格异常波动 (> 10%)
- 流动性骤降 (> 20%)
- Gas 价格飙升
- 合约暂停事件

**实现架构**:
```typescript
// backend/services/alert-service.ts
export class AlertService {
  private rules: AlertRule[] = [];
  
  async checkRules() {
    for (const rule of this.rules) {
      const triggered = await rule.evaluate();
      if (triggered) {
        await this.sendAlert(rule);
      }
    }
  }
  
  private async sendAlert(rule: AlertRule) {
    // Slack
    await this.slackClient.send(rule.message);
    
    // Discord  
    await this.discordClient.send(rule.message);
    
    // Email
    await this.emailClient.send(rule.message);
    
    // Telegram
    await this.telegramBot.send(rule.message);
  }
}

// 规则示例
const largeTradeRule = new AlertRule({
  name: 'Large Trade',
  condition: (trade) => trade.amountUSD > 100000,
  message: (trade) => `⚠️ Large trade detected: ${trade.amountUSD}`
});
```

---

### 11. TVL 追踪工具

**数据计算**:
```typescript
// backend/services/tvl-tracker.ts
export class TVLTracker {
  async calculateTVL(): Promise<TVLData> {
    const pairs = await this.getAllPairs();
    let totalTVL = 0;
    const pairTVLs = [];
    
    for (const pair of pairs) {
      const reserves = await pair.getReserves();
      const token0Price = await this.getPrice(pair.token0);
      const token1Price = await this.getPrice(pair.token1);
      
      const tvl = (
        reserves[0] * token0Price +
        reserves[1] * token1Price
      );
      
      totalTVL += tvl;
      pairTVLs.push({ pair: pair.address, tvl });
    }
    
    return { total: totalTVL, pairs: pairTVLs };
  }
  
  async trackHistoricalTVL() {
    const tvl = await this.calculateTVL();
    await this.db.saveTVLSnapshot({
      timestamp: Date.now(),
      ...tvl
    });
  }
}
```

**API 接口**:
```typescript
// GET /api/tvl
router.get('/tvl', async (req, res) => {
  const tvl = await tvlTracker.calculateTVL();
  res.json(tvl);
});

// GET /api/tvl/history?period=7d
router.get('/tvl/history', async (req, res) => {
  const { period } = req.query;
  const history = await db.getTVLHistory(period);
  res.json(history);
});
```

---

### 12. 用户分析报表

**分析维度**:
- 日活用户 (DAU)
- 新用户增长
- 用户留存率
- 交易频次分布
- 用户价值分层

**报表生成**:
```typescript
// backend/services/analytics-service.ts
export class AnalyticsService {
  async generateUserReport(period: string) {
    const users = await this.getUserActivity(period);
    
    return {
      dau: this.calculateDAU(users),
      newUsers: this.countNewUsers(users),
      retention: this.calculateRetention(users),
      volumeDistribution: this.analyzeVolumeDistribution(users),
      userSegments: this.segmentUsers(users)
    };
  }
  
  private segmentUsers(users: User[]) {
    return {
      whales: users.filter(u => u.volume > 1000000),  // > $1M
      active: users.filter(u => u.txCount > 10),
      casual: users.filter(u => u.txCount <= 10)
    };
  }
}
```

---

## 🚀 快速开始

### 合约开发

```bash
cd contracts-project

# 编译新合约
npx hardhat compile

# 运行测试
npx hardhat test test/FeeDistributor.test.js
npx hardhat test test/LPMining.test.js

# 部署
npx hardhat run scripts/deploy-advanced.js --network bsc_testnet
```

### 前端开发

```bash
cd frontend

# 安装依赖
npm install

# 添加新依赖
npm install wagmi viem @rainbow-me/rainbowkit
npm install recharts date-fns

# 开发
npm run dev

# 构建
npm run build
```

### 后端服务

```bash
cd backend

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env

# 启动服务
npm run dev

# 部署
npm run deploy
```

---

## 📝 开发优先级建议

### 高优先级 (立即开始)
1. ✅ 手续费分红机制
2. LP 挖矿奖励系统
3. Web3 钱包连接
4. Swap UI 界面

### 中优先级 (1-2周后)
5. 流动性管理面板
6. 交易历史查询
7. 实时监控仪表板
8. TVL 追踪工具

### 低优先级 (可选)
9. TWAP 价格预言机
10. 扩展代币标准支持
11. 自动化告警系统
12. 用户分析报表

---

## 📊 预估工作量

| 阶段 | 模块数 | 预计时间 | 人力需求 |
|------|--------|----------|----------|
| 第一阶段 | 4 | 1-2周 | 1-2 Solidity 工程师 |
| 第二阶段 | 4 | 2-3周 | 2-3 前端工程师 |
| 第三阶段 | 4 | 2-3周 | 1-2 全栈工程师 |
| **总计** | **12** | **5-8周** | **3-5 人** |

---

## ✅ 验收标准

### 合约
- [ ] 所有合约测试通过 (覆盖率 > 95%)
- [ ] Gas 优化完成
- [ ] 安全审计通过
- [ ] 文档完整

### 前端
- [ ] 所有功能正常工作
- [ ] 响应式设计
- [ ] 浏览器兼容性测试
- [ ] 性能优化 (Lighthouse > 90)

### 后端
- [ ] API 稳定性测试
- [ ] 负载测试通过
- [ ] 监控告警正常
- [ ] 日志完整

---

**最后更新**: 2025-09-30
**版本**: 1.0
