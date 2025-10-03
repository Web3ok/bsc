# 🔐 测试钱包配置指南

**测试钱包地址**: `0x1A83e4CD841Fc9118fD67313A5dc15ab36C96e2a`
**私钥**: `0x183b51f44ee349c0c2a5efa70fcb9434f88f7ea650052cdc528b25837321c87e`

⚠️ **警告**: 这是测试钱包，仅用于 BSC 测试网。切勿将真实资金存入此钱包！

---

## 🦊 MetaMask 导入钱包

### 方法 1: 通过私钥导入

1. **打开 MetaMask**
2. **点击右上角账户图标** → **导入账户 (Import Account)**
3. **选择类型**: 私钥 (Private Key)
4. **粘贴私钥**:
   ```
   0x183b51f44ee349c0c2a5efa70fcb9434f88f7ea650052cdc528b25837321c87e
   ```
5. **点击 "导入" (Import)**
6. **账户名称**: 建议命名为 "BSC Test Wallet"

---

## 🌐 添加 BSC 测试网

### 自动添加 (推荐)

1. 访问: https://chainlist.org/?search=bsc+testnet
2. 搜索 "BSC Testnet"
3. 点击 "Add to MetaMask"
4. 确认添加

### 手动添加

1. **打开 MetaMask**
2. **点击网络下拉菜单** → **添加网络 (Add Network)** → **手动添加网络 (Add Network Manually)**
3. **填写信息**:
   - **网络名称**: BSC Testnet
   - **RPC URL**: `https://data-seed-prebsc-1-s1.binance.org:8545/`
   - **链 ID**: `97`
   - **货币符号**: tBNB
   - **区块浏览器**: https://testnet.bscscan.com
4. **点击 "保存" (Save)**

---

## 💰 获取测试网 BNB (tBNB)

### 步骤:

1. **访问官方水龙头**: https://testnet.bnbchain.org/faucet-smart
2. **连接 MetaMask** (确保使用测试钱包地址)
3. **点击 "Give me BNB" 按钮**
4. **等待 ~30 秒**
5. **检查余额** (应该收到 0.5 tBNB)

### 备用水龙头:
- https://testnet.binance.org/faucet-smart
- 如果上面的不工作，可以在 Twitter 发推特请求

---

## ✅ 验证配置

### 检查清单:

- [ ] MetaMask 已安装
- [ ] 测试钱包已导入
- [ ] BSC Testnet 网络已添加
- [ ] 已切换到 BSC Testnet
- [ ] 已获取 tBNB (至少 0.1 tBNB)
- [ ] 钱包地址正确: `0x1A83...6e2a`

### 验证命令:

在浏览器控制台 (F12) 运行:
```javascript
// 检查当前网络
ethereum.request({ method: 'eth_chainId' })
  .then(chainId => console.log('Chain ID:', parseInt(chainId, 16)))
// 应该显示: 97

// 检查账户
ethereum.request({ method: 'eth_accounts' })
  .then(accounts => console.log('Account:', accounts[0]))
// 应该显示: 0x1a83e4cd841fc9118fd67313a5dc15ab36c96e2a
```

---

## 🧪 开始测试

### 1. 打开 DEX 页面
```
访问: http://localhost:10002/dex
```

### 2. 连接钱包
- 点击右上角 "Connect Wallet" 按钮
- 选择 MetaMask
- 确认连接

### 3. 检查连接状态
确认以下信息显示正确:
- ✅ 网络名称: "BNB Smart Chain Testnet" 或 "BSC Testnet"
- ✅ 钱包地址: `0x1A83...6e2a`
- ✅ tBNB 余额显示

### 4. 获取测试代币

现在你有两个选择获取 USDT、BUSD、USDC 测试代币:

#### 选项 A: 在我们的 DEX 上 Swap (推荐)
1. 进入 Swap 标签页
2. From: BNB → To: USDT
3. 输入金额: 0.1 BNB
4. 点击 "Swap"
5. 确认交易

#### 选项 B: 使用 PancakeSwap 测试网
1. 访问: https://pancake.kiemtienonline360.com/
2. 连接钱包
3. Swap tBNB → USDT/BUSD/USDC

---

## 📝 测试用例

### Test 1: BNB → USDT Swap
```
From: 0.01 BNB
To: USDT (估计 ~3 USDT)
Slippage: 0.5%
预期结果: 交易成功
```

### Test 2: USDT → BNB Swap (需要 Approve)
```
From: 1 USDT
To: BNB
步骤:
1. 点击 "Approve USDT"
2. 确认授权交易
3. 等待确认
4. 点击 "Swap"
5. 确认兑换交易
```

### Test 3: 添加流动性
```
Token A: BNB (0.01)
Token B: USDT (3)
步骤:
1. 切换到 "Liquidity" 标签
2. 选择 "Add Liquidity"
3. 输入金额
4. Approve USDT
5. 点击 "Add Liquidity"
6. 确认交易
7. 检查 LP 代币余额
```

---

## 🔍 交易验证

每次交易后，在 BSCScan Testnet 上验证:

1. **复制交易哈希** (从 MetaMask)
2. **访问**: https://testnet.bscscan.com
3. **粘贴交易哈希**
4. **检查**:
   - ✅ Status: Success
   - ✅ From: 你的地址
   - ✅ To: Router 合约
   - ✅ Token Transfers: 正确的代币

---

## 🐛 常见问题

### Q1: 钱包连接不上？
**A**:
1. 确保 MetaMask 已安装
2. 刷新页面 (Cmd+Shift+R)
3. 检查是否在 BSC Testnet 网络

### Q2: 没有收到 tBNB？
**A**:
1. 检查钱包地址是否正确
2. 等待 1-2 分钟
3. 刷新余额
4. 尝试另一个水龙头

### Q3: Swap 失败？
**A**:
1. 增加 Slippage 到 1-2%
2. 检查是否有足够的 gas fee
3. 确认已 Approve 代币

### Q4: 看不到 LP 代币？
**A**:
1. 在 MetaMask 中导入 LP token 地址
2. LP token 地址可以从交易详情中找到
3. 或者在 "Liquidity" → "Remove" 标签页查看

---

## 📊 测试记录模板

```markdown
## 测试会话: [日期时间]

### 环境
- 钱包: 0x1A83e4CD841Fc9118fD67313A5dc15ab36C96e2a
- 网络: BSC Testnet (97)
- 初始 tBNB: [金额]

### 测试结果

#### Test 1: BNB → USDT
- [ ] 成功
- TX Hash: [哈希]
- Gas Used: [gas]
- 备注:

#### Test 2: USDT → BNB (带 Approve)
- [ ] Approve 成功
- Approve TX: [哈希]
- [ ] Swap 成功
- Swap TX: [哈希]
- 备注:

#### Test 3: 添加流动性
- [ ] 成功
- TX Hash: [哈希]
- LP Token 获得: [数量]
- 备注:

### 发现的问题
1. [描述]
2. [描述]

### 建议
1. [建议]
2. [建议]
```

---

## 🎯 测试目标

完成以下所有测试:
- [ ] 成功连接钱包到 DEX
- [ ] 完成 BNB → Token swap
- [ ] 完成 Token → BNB swap (含 approve)
- [ ] 完成 Token → Token swap
- [ ] 成功添加流动性
- [ ] 成功移除流动性
- [ ] 测试网络切换功能
- [ ] 测试错误处理 (余额不足等)

---

## 🚀 开始测试

1. **导入钱包** ✅
2. **添加 BSC Testnet** ✅
3. **获取 tBNB** ✅
4. **打开 DEX**: http://localhost:10002/dex
5. **连接钱包**
6. **开始 Swap 测试**
7. **记录结果**

**祝测试顺利！** 🎉

---

**更新时间**: 2025-10-03
**版本**: v1.0
