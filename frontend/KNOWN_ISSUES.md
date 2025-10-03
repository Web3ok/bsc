# Known Issues

## Web3/RainbowKit Dependency Conflicts

**Status**: Temporarily Disabled
**Date**: 2025-10-02
**Affected Components**: DEX page (`/dex`), Web3Provider

### Problem

RainbowKit v2.x 与 wagmi v1.4 不兼容，同时 wagmi v2.x 的依赖结构也存在问题：

1. **RainbowKit 兼容性**:
   - RainbowKit 2.2.8+ 需要 wagmi ^2.9.0
   - wagmi 1.4.13 不导出 `useAccountEffect`
   - RainbowKit 1.3.7 也不兼容 wagmi 1.4

2. **Wagmi 依赖问题**:
   - wagmi 依赖的 `@tanstack/query-core` 版本冲突
   - node_modules 中缺少必需文件
   - `wagmi/dist/chains.js` 文件缺失

3. **WalletConnect 依赖**:
   - 缺少 cross-fetch ponyfill 文件
   - 多层嵌套依赖损坏

### Temporary Solution

为了让主要功能正常运行,暂时禁用了 Web3 相关功能:

**Files Modified:**
- `frontend/app/providers.tsx` - 注释掉 `Web3Provider`
- `frontend/app/dex/page.tsx` - 注释掉 wagmi/RainbowKit hooks
- `frontend/package.json` - 移除 `@rainbow-me/rainbowkit`

**Current State:**
- ✅ Dashboard (/) - 正常
- ✅ Trading (/trading) - 正常
- ✅ Monitoring (/monitoring) - 正常
- ✅ Settings (/settings) - 正常
- ⚠️  DEX (/dex) - 显示"Connect Wallet (Coming Soon)"占位符

### Recommended Fixes

#### Option 1: 升级到最新稳定版本组合 (推荐)
```bash
npm install @rainbow-me/rainbowkit@2.2.0 wagmi@2.17.0 viem@2.21.0 @tanstack/react-query@5.59.0 @tanstack/query-core@5.59.0 --legacy-peer-deps
```

然后更新代码为 wagmi v2 API:
- `WagmiConfig` → `WagmiProvider`
- `createConfig` API 改变
- `useNetwork` → `useChainId` + `useChains`
- `configureChains` 移除, 使用 `transports`

#### Option 2: 使用旧版本组合
```bash
npm install @rainbow-me/rainbowkit@1.0.0 wagmi@1.0.0 viem@1.0.0
```

#### Option 3: 移除 RainbowKit, 使用其他钱包连接方案
考虑使用:
- `@web3modal/wagmi` (Web3Modal)
- `@dynamic-labs/sdk-react` (Dynamic)
- `connectkit` (ConnectKit)

### Testing Checklist

在重新启用 Web3 功能后,需要测试:

- [ ] MetaMask 连接
- [ ] WalletConnect 连接
- [ ] 网络切换 (BSC Mainnet/Testnet)
- [ ] DEX Swap 界面
- [ ] DEX Liquidity 界面
- [ ] 钱包余额显示
- [ ] 交易执行

### References

- [RainbowKit v2 Migration Guide](https://www.rainbowkit.com/docs/migration-guide)
- [Wagmi v2 Migration Guide](https://wagmi.sh/react/guides/migrate-from-v1-to-v2)
- [TanStack Query v5 Migration](https://tanstack.com/query/latest/docs/react/guides/migrating-to-v5)

### Notes

- 所有非 Web3 功能(Dashboard, Trading, Monitoring等)完全正常工作
- Backend API 健康且功能完整
- 这只影响前端的区块链钱包连接功能
- BianDEX 的后端 API 仍然可以通过 Trading 页面使用
