# BianDEX 快速启动指南

## 📋 前置要求

- Node.js >= 16
- npm 或 yarn
- 3个终端窗口

## 🚀 本地开发环境启动

### 第1步: 启动本地区块链节点

```bash
cd contracts-project
npm run node
```

保持此终端运行，这将在 `http://localhost:8545` 启动 Hardhat 网络节点。

### 第2步: 部署BianDEX合约

打开新终端：

```bash
cd contracts-project
npm run deploy:local
```

部署完成后，你会看到所有合约地址。这些地址已自动保存到 `deployments/local-latest.json`。

### 第3步: 启动前端

打开新终端：

```bash
cd frontend
npm run dev
```

前端将在 `http://localhost:3000` 启动。

访问 `http://localhost:3000/dex` 查看 BianDEX 界面。

### 第4步: 启动后端监控服务（可选）

打开新终端：

```bash
cd ..  # 回到项目根目录
JWT_SECRET=dev-secret-key-for-testing-only-256bits-long PORT=10001 npm run server:dev
```

后端API将在 `http://localhost:10001` 启动。

## 📊 可用的API端点

### 后端监控服务

- `http://localhost:10001/healthz` - 健康检查
- `http://localhost:10001/biandex/stats` - BianDEX统计数据
- `http://localhost:10001/biandex/pools` - 流动性池信息

需要认证的端点需要添加 JWT token。

## 🧪 测试合约

```bash
cd contracts-project
npm test
```

应该看到 70 个测试全部通过 ✅

## 📝 合约地址

部署后，合约地址保存在 `contracts-project/deployments/local-latest.json`。

前端会自动使用 hardhat 配置中的地址（见 `frontend/src/contracts/biandex/config.ts`）。

## 🔧 常用命令

### 合约相关

```bash
cd contracts-project

# 编译合约
npm run compile

# 运行测试
npm test

# Gas分析
npm run test:gas

# 清理编译产物
npm run clean

# 部署到本地
npm run deploy:local

# 部署到BSC测试网
npm run deploy:testnet
```

### 前端相关

```bash
cd frontend

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 启动生产服务器
npm start
```

### 后端相关

```bash
# 回到项目根目录
cd ..

# 启动后端开发服务器
JWT_SECRET=dev-secret-key-for-testing-only-256bits-long PORT=10001 npm run server:dev

# 构建后端
npm run build

# 运行测试
npm test
```

## 🎯 快速测试流程

1. **启动本地节点**: `npm run node`
2. **部署合约**: `npm run deploy:local`
3. **启动前端**: `cd ../frontend && npm run dev`
4. **访问**: http://localhost:3000/dex
5. **连接钱包**: 使用 Hardhat 提供的测试账户
6. **开始交易**: 在 BianDEX 上进行swap和添加流动性

## 🔑 测试账户

Hardhat 本地网络提供了10个测试账户，每个账户有 10000 ETH。

第一个账户（部署者）:
- 地址: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- 私钥: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

在 MetaMask 中导入此私钥，并连接到 `http://localhost:8545`（Chain ID: 31337）。

## 📚 项目结构

```
BNB/
├── contracts-project/          # 智能合约项目
│   ├── contracts/             # Solidity合约
│   ├── test/                  # 合约测试
│   ├── scripts/               # 部署脚本
│   └── deployments/           # 部署记录
├── frontend/                   # Next.js前端
│   ├── src/app/dex/          # DEX页面
│   ├── src/contracts/biandex/ # 合约ABI和配置
│   └── src/hooks/            # React hooks
└── src/                        # 后端服务
    ├── services/             # 业务逻辑
    └── monitor/              # 监控服务
```

## ❓ 常见问题

### Q: 前端连接不上合约？
A: 确保：
1. 本地节点正在运行
2. 合约已部署
3. MetaMask 连接到正确的网络（localhost:8545）

### Q: 交易失败？
A: 检查：
1. 账户有足够的ETH支付gas
2. 代币已授权给Router合约
3. 滑点设置合理

### Q: 看不到流动性池？
A: 确保已运行 `npm run deploy:local`，这会自动创建 TKA-TKB 测试池。

## 🆘 获取帮助

- 查看完整文档: `contracts-project/docs/`
- 项目README: `contracts-project/README.md`
- 部署文档: `contracts-project/docs/DEPLOYMENT.md`

## ✅ 检查清单

- [ ] Node.js >= 16 已安装
- [ ] 所有依赖已安装 (`npm install`)
- [ ] Hardhat 节点正在运行
- [ ] 合约已部署
- [ ] 前端正在运行
- [ ] MetaMask 已配置
- [ ] 可以在 DEX 上交易

完成以上步骤后，你就有了一个完整的 BianDEX 开发环境！
