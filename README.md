# BSC Market Maker Bot

A work-in-progress BSC (BNB Chain) market-maker toolkit currently focused on **wallet generation/management** and **CLI tooling**. Trading, batch operations, strategies, risk controls, monitoring, web UI, and other advanced modules are planned but **not yet implemented** (see “Roadmap & Status” below).

## Current Scope vs. Planned Features

| 功能 | 当前状态 | 说明 |
| --- | --- | --- |
| Wallet Management | ✅ 已实现基础功能 | 支持 BIP39/44 派生、批量生成、CSV 安全导出、CLI 操作、加密存储 |
| DEX Trading (PancakeSwap/Uniswap) | 🚧 规划阶段 | `src/dex` 为示例/骨架，无真实交易逻辑 |
| Batch Operations (买卖/转账) | 🚧 规划阶段 | `src/batch`/`src/transfer` 为骨架，待实现执行管线 |
| Strategy & Risk | 🚧 规划阶段 | `src/strategy*`、`src/risk*` 为空模块，待开发策略与风控规则 |
| Monitoring & Web UI | 🚧 规划阶段 | 前端、WebSocket、Prometheus 等尚未开发 |
| Security Enhancements | ✅ 钱包导出安全 | 其余风控、权限管理仍待实现 |

如需参与贡献或规划，请参考 `docs/audit-report.md`、`docs/mapping-table.md` 获取最新审计与差距概览。

## Quick Start

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit configuration
nano .env
```

### Configuration

Set required environment variables in `.env`:

```bash
# Essential settings
ENCRYPTION_PASSWORD=your-strong-password-here
RPC_URL=https://bsc-dataseed1.binance.org/
```

### Basic Usage

```bash
# Generate wallets
npm run dev -- wallet generate --count 5

# List wallets
npm run dev -- wallet list

# Check system status
npm run dev -- monitor status
```

## CLI Commands

### Wallet Management

```bash
# Generate HD wallets
bsc-bot wallet generate --count 10 --start-index 0

# Import from private key
bsc-bot wallet import --private-key 0x... --label "Trading-1"

# List all wallets
bsc-bot wallet list --format table

# Export to CSV
bsc-bot wallet export --output wallets.csv
```

CLI 命令会同时输出可读提示和 JSON 结构化日志：

- 成功生成钱包时会记录一条 `level=30` 的 `Generating wallets` 日志，便于在日志系统里跟踪批量操作。
- 成功导入钱包会追加 `level=30` 的 `Imported wallet` 日志（含钱包地址），方便审计与追踪。
- 如果私钥导入失败，会打印 `Failed to import wallet`，同时产生 `level=50` 的错误日志，日志中的 `err.message` 会包含具体原因，并以非零退出码结束，便于监控及时告警。
- 导出 CSV 的首行标题固定为 `"Address","Label","Group","Index"`，回归测试已经覆盖，若格式发生变化请及时同步前端和自动化脚本。

### API 安全说明

- `/api/batch/wallets/export` 始终只返回地址级数据，不允许导出私钥；若请求携带 `includePrivateKeys=true`，接口会返回 403 并在日志记录 `SECURITY VIOLATION ATTEMPT`。
- 相关安全限制已纳入回归测试，新增功能请勿绕过该约束。

### Trading (Coming Soon)

```bash
# Buy tokens
bsc-bot trade buy 0x... --amount 1 --slippage 0.5

# Batch buy across wallets
bsc-bot trade buy-batch 0x... --group traders --amount 0.1

# Get price quote
bsc-bot trade quote --token-in BNB --token-out 0x... --amount 1
```

### Transfers (Coming Soon)

```bash
# Send tokens
bsc-bot transfer send 0xRecipient --token USDT --amount 100

# Batch transfer from CSV
bsc-bot transfer batch --csv transfers.csv

# Sweep funds to treasury
bsc-bot transfer sweep 0xTreasury --min 0.01
```

## Configuration Files

### `configs/app.toml`
Main application configuration including chain settings, RPC endpoints, trading parameters, and limits.

### `configs/tokens.yml`
Token whitelist/blacklist with metadata and risk categories.

### `configs/strategy.toml`
Strategy parameters for grid trading, arbitrage, and market making.

## Development

```bash
# Development mode
npm run dev

# Build
npm run build

# Run tests
npm test

# Type checking
npm run typecheck

# Lint
npm run lint
```

## Security Best Practices

### Wallet Security
- Use strong encryption passwords (min 20 characters)
- Store mnemonics offline in secure locations
- Never commit private keys or passwords to version control
- Consider hardware wallets for production deployments

### Operational Security
- Start with small amounts for testing
- Use testnet for development and testing
- Monitor transactions and set reasonable limits
- Keep private keys encrypted and access-controlled

### Risk Management
- Configure appropriate slippage limits (0.5-2%)
- Set maximum position sizes and daily limits
- Enable emergency stop mechanisms
- Use whitelist/blacklist for token filtering

## Architecture

```
src/
├── config/         # Configuration loading and management
├── wallet/         # HD wallet generation and management
├── dex/           # DEX integration (PancakeSwap)
├── tx/            # Transaction management and gas optimization
├── batch/         # Batch operation coordination
├── strategy/      # Trading strategies (grid, arbitrage)
├── risk/          # Risk management and controls
├── market/        # Market data and price feeds
├── monitor/       # Monitoring and alerting
├── persistence/   # Database and data storage
├── cli/           # Command-line interface
└── utils/         # Shared utilities and types
```

## Deployment

### PM2 (Recommended)
```bash
npm run deploy:pm2
```

### Systemd
```bash
npm run deploy:systemd
```

### Docker
```bash
docker build -t bsc-bot .
docker run -d --name bsc-bot -v ./data:/app/data bsc-bot
```

## Monitoring

The bot provides comprehensive monitoring through:
- Structured JSON logging with Pino
- Prometheus metrics endpoint (port 9090)
- Web dashboard (optional, port 3000)
- Configurable alerts via webhooks

## Roadmap

### Phase 1: Foundation ✅
- [x] Project structure and configuration
- [x] Wallet management with HD wallets
- [x] Basic CLI commands
- [x] Security and encryption

### Phase 2: Core Trading (In Progress)
- [ ] DEX integration (PancakeSwap V2/V3)
- [ ] Transaction management and gas optimization
- [ ] Single and batch trading operations
- [ ] Risk management and controls

### Phase 3: Advanced Features
- [ ] Market making strategies
- [ ] Arbitrage detection
- [ ] Advanced monitoring and alerting
- [ ] Web dashboard

### Phase 4: Production Ready
- [ ] Multi-DEX support
- [ ] Hardware wallet integration
- [ ] Advanced analytics
- [ ] Comprehensive documentation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see LICENSE file for details

## Disclaimer

⚠️ **Important Risk Warning** ⚠️

This software is for educational and research purposes. Cryptocurrency trading carries significant financial risk. Users are responsible for:
- Understanding the risks involved
- Testing thoroughly before using real funds
- Complying with applicable laws and regulations
- Securing their private keys and funds

The developers assume no responsibility for financial losses.
