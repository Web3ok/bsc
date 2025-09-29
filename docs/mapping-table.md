| 需求来源 | 功能描述 | 当前代码位置/现状 | 测试覆盖 | 状态 |
| --- | --- | --- | --- | --- |
| README.md Features | Wallet Management (生成/导入/管理 HD 钱包) | `src/wallet/index.ts`、`legacy-manager.ts` 可生成/导入；CSV 导出安全 | `tests/wallet.test.ts`、`tests/wallet-export.test.ts`、`tests/smoke/cli-smoke.test.ts` | ✅ 已实现（基础功能） |
| README.md Features | Batch Operations (批量买卖、转账) | `src/batch`、`src/transfer` 仅骨架；API/CLI 多为 TODO | 无 | ❌ 未实现 |
| README.md Features | DEX Integration (PancakeSwap V2/V3) | `src/dex/multi-dex-aggregator.ts` 等为示例/占位 | 无 | ❌ 未实现 |
| README.md Features | Risk Management (滑点/额度/白黑名单) | `src/risk/*` 为空 | 无 | ❌ 未实现 |
| README.md Features | Monitoring (实时指标、告警) | `src/monitor/*` 为 mock | 无 | ❌ 未实现 |
| README.md Features | Security (加密存储、CSV 安全) | 钱包加密存储、导出安全已实现 | `tests/wallet-export.test.ts` | ✅ 已部分实现 |
| PROJECT_STATUS.md | “系统已可用、真实行情、批量交易、监控” | 与 README 类似，多数仍占位 | 无 | ❌ 不符 |
| 核心功能文档 | 多 DEX (V2/V3/V4/Uniswap) | 同上，占位 | 无 | ❌ 未实现 |
| 核心功能文档 | 批量交易引擎、智能路由 | `MultiDEXAggregator` 等为示范 | 无 | ❌ 未实现 |
| 核心功能文档 | Web 前端、实时 WebSocket | 无前端代码或 WebSocket 实现 | 无 | ❌ 未实现 |
| 开发任务计划 | Provider/Gas/Nonce 管理 | `src/tx` 等未实现 | 无 | ❌ 未实现 |
| 开发任务计划 | 策略/回测模块 | `src/strategy*` 空 | 无 | ❌ 未实现 |
| 开发任务计划 | 风控/监控 | `src/risk`/`src/monitor` 空 | 无 | ❌ 未实现 |
| TODO.md (最新) | CLI 日志统一、回归 test/E2E | 已补齐 `tests/cli-trade.test.ts`、`src/scripts/end-to-end-test.ts` | `npm run test:smoke`、`npx vitest run` | ✅ 已完成 |
