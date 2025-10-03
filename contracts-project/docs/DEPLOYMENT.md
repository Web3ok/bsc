# BianDEX 部署指南

## 📋 目录

- [环境准备](#环境准备)
- [配置说明](#配置说明)
- [部署步骤](#部署步骤)
- [验证合约](#验证合约)
- [测试流程](#测试流程)
- [监控与维护](#监控与维护)

## 🔧 环境准备

### 1. 系统要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### 2. 安装依赖

```bash
npm install
```

### 3. 环境变量配置

创建 `.env` 文件：

```bash
# 部署账户私钥（不要提交到 Git）
PRIVATE_KEY=your_private_key_here

# BSCScan API Key（用于合约验证）
BSCSCAN_API_KEY=your_bscscan_api_key

# RPC 节点（可选，默认使用公共节点）
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545/
BSC_RPC_URL=https://bsc-dataseed.binance.org/
```

**⚠️ 安全提示：**
- 永远不要将私钥提交到版本控制系统
- 使用独立的部署账户，不要使用主钱包
- 在测试网充分测试后再部署到主网

## ⚙️ 配置说明

### 网络配置

项目已配置以下网络：

| 网络 | Chain ID | Gas Price | RPC |
|------|----------|-----------|-----|
| Hardhat | 31337 | Auto | Local |
| BSC Testnet | 97 | 10 Gwei | https://data-seed-prebsc-1-s1.binance.org:8545/ |
| BSC Mainnet | 56 | 5 Gwei | https://bsc-dataseed.binance.org/ |

### Solidity 编译配置

```javascript
{
  version: "0.8.20",
  optimizer: {
    enabled: true,
    runs: 200
  },
  viaIR: true
}
```

## 🚀 部署步骤

### 1. 编译合约

```bash
npx hardhat compile
```

预期输出：
```
Compiled 15 Solidity files successfully
```

### 2. 运行测试

```bash
npm test
```

确保所有 38 个测试通过：
```
✅ 38 passing
```

### 3. Gas 分析（可选）

```bash
npx hardhat run scripts/gas-analysis.js --network hardhat
```

预期 Gas 成本：
- 部署: ~4.5M gas (~0.023 BNB @ 5 Gwei)
- Swap: ~96k gas
- 添加流动性: ~91k-248k gas
- 移除流动性: ~88k gas

### 4. 部署到 BSC 测试网

```bash
npx hardhat run scripts/deploy-bsc.js --network bsc_testnet
```

部署脚本将：
1. 部署 BianDEXFactory
2. 部署 BianDEXRouter
3. 自动验证合约（如果配置了 BSCSCAN_API_KEY）
4. 保存部署信息到 `deployments/` 目录

### 5. 部署到 BSC 主网

**⚠️ 部署前检查清单：**

- [ ] 已在测试网完成充分测试
- [ ] 已进行专业安全审计
- [ ] 部署账户有足够的 BNB（建议 > 0.05 BNB）
- [ ] 已备份部署账户私钥
- [ ] 团队成员已审查部署脚本
- [ ] 已准备监控和告警系统

```bash
npx hardhat run scripts/deploy-bsc.js --network bsc_mainnet
```

## ✅ 验证合约

### 自动验证

部署脚本会自动验证合约（需要 BSCSCAN_API_KEY）

### 手动验证

如果自动验证失败：

```bash
# 验证 Factory
npx hardhat verify --network bsc_testnet <FACTORY_ADDRESS>

# 验证 Router
npx hardhat verify --network bsc_testnet <ROUTER_ADDRESS> <FACTORY_ADDRESS> <WBNB_ADDRESS>
```

## 🧪 测试流程

### 测试网测试步骤

1. **创建交易对**
   ```javascript
   await factory.createPair(tokenA, tokenB);
   ```

2. **添加初始流动性**
   ```javascript
   await router.addLiquidity(
     tokenA,
     tokenB,
     amount0,
     amount1,
     amount0Min,
     amount1Min,
     to,
     deadline
   );
   ```

3. **执行测试 Swap**
   ```javascript
   await router.swapExactTokensForTokens(
     amountIn,
     amountOutMin,
     [tokenA, tokenB],
     to,
     deadline
   );
   ```

4. **测试暂停功能**
   ```javascript
   await pool.pause();
   // 尝试交易应该失败
   await pool.unpause();
   ```

### 建议的测试场景

- ✅ 正常添加/移除流动性
- ✅ 正常 Swap（单跳、多跳）
- ✅ BNB/Token 交换
- ✅ 滑点保护触发
- ✅ Deadline 过期拒绝
- ✅ 暂停/恢复功能
- ✅ Gas 成本验证
- ✅ 大额交易测试
- ✅ 边界条件测试

## 📊 监控与维护

### 合约地址

部署完成后，记录以下地址：

```
Factory:  0x...
Router:   0x...
WBNB:     0x... (预定义)
```

### 监控指标

建议监控以下指标：

1. **流动性指标**
   - 总锁定价值 (TVL)
   - 各交易对流动性
   - LP 代币供应量

2. **交易指标**
   - 24h 交易量
   - 24h 交易笔数
   - 平均 Gas 成本

3. **安全指标**
   - 异常大额交易
   - 暂停事件
   - 所有权变更

### 事件监听

关键事件：

```solidity
event PairCreated(address indexed token0, address indexed token1, address pair);
event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);
```

### 应急响应

如果发现安全问题：

1. **立即暂停受影响的池子**
   ```javascript
   await pool.pause();
   ```

2. **评估影响范围**
   - 检查受影响的交易对
   - 统计潜在损失

3. **通知用户**
   - 发布官方公告
   - 更新前端 UI

4. **修复问题**
   - 修复合约漏洞
   - 重新部署（如需要）
   - 进行安全审计

## 📝 常见问题

### Q: 部署失败怎么办？

A: 检查以下项：
1. 账户余额是否充足
2. Gas Price 是否合理
3. 网络连接是否正常
4. 私钥配置是否正确

### Q: 如何更新合约？

A: BianDEX 合约不可升级。需要部署新版本并迁移流动性。

### Q: 如何转移池子所有权？

A: 使用 Ownable 的 `transferOwnership` 函数：
```javascript
await pool.transferOwnership(newOwner);
```

### Q: Gas 成本太高怎么办？

A: 
1. 等待网络拥堵缓解
2. 调整 Gas Price
3. 考虑批量操作
4. 使用直接池子调用（跳过 Router）

## 🔗 有用链接

- [BSCScan Testnet](https://testnet.bscscan.com/)
- [BSCScan Mainnet](https://bscscan.com/)
- [BSC Testnet Faucet](https://testnet.binance.org/faucet-smart)
- [Hardhat Documentation](https://hardhat.org/docs)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)

## 📄 许可证

MIT License

---

**⚠️ 免责声明**：本指南仅供参考。在生产环境部署前，请确保已进行充分测试和专业安全审计。
