# BSC Trading Bot & BianDEX Platform

<div align="center">

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.9+-blue.svg)](https://www.typescriptlang.org/)
[![Production Ready](https://img.shields.io/badge/production-ready-brightgreen.svg)]()

**A professional-grade trading bot and DEX platform for Binance Smart Chain**

[Features](#-features) • [Quick Start](#-quick-start) • [Documentation](#-documentation) • [Deployment](#-deployment)

[English](README.md) | [中文](README.zh-CN.md)

</div>

---

## 🎯 Overview

BSC Trading Bot is an enterprise-grade automated trading platform for Binance Smart Chain with integrated BianDEX - a complete decentralized exchange solution.

### Key Highlights

- ✅ **Production Ready** - Battle-tested, comprehensive error handling
- ✅ **Modular Architecture** - Independent or combined deployment
- ✅ **Real Data** - DexScreener, CoinGecko, PancakeSwap integration
- ✅ **Regulatory Compliant** - Geographic separation ready
- ✅ **Full Stack** - Backend + Frontend + Smart Contracts

---

## ✨ Features

### 🤖 Trading Bot
- **Automated Trading** - PancakeSwap and DEX integration
- **Batch Wallet Management** - Create, import, export wallets
- **Smart Strategies** - Grid, DCA, arbitrage
- **Group Operations** - Organize by groups and tags
- **Batch Transfers** - 1-to-1, 1-to-many, many-to-many

### 🔀 BianDEX
- **Complete DEX** - Swap, liquidity, farming
- **LP Mining** - Stake LP tokens for rewards
- **DAO Governance** - Community decision making
- **Analytics** - CoinGecko-backed real-time metrics with automatic fallback
- **Audited Contracts** - 12 contracts, 3500+ LOC

### 🎨 Platform
- **Modern UI** - Responsive NextUI design
- **Multi-language** - Chinese & English
- **Web3** - WalletConnect, MetaMask
- **Real-time** - WebSocket updates
- **Secure** - JWT auth, encrypted keys

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.0.0
- npm or yarn
- SQLite or PostgreSQL

### Installation

```bash
# 1. Clone repository
git clone <repository-url>
cd BNB

# 2. Install dependencies
npm install
cd frontend && npm install && cd ..

# 3. Configure environment
cp .env.example .env
# Edit .env with your settings

# 4. Initialize database
npm run migrate

# 5. Start services
# Backend defaults to authenticated mode. Set DISABLE_AUTH=true only when you explicitly want to bypass auth in local debugging.
npm run server:dev          # Terminal 1: Backend
cd frontend && npm run dev  # Terminal 2: Frontend
```

### Access
- Frontend: http://localhost:10004
- Backend: http://localhost:10001
- API Health: http://localhost:10001/api/health

---

## ⚙️ Configuration

### Module Control
```bash
# Full platform (default)
ENABLE_TRADING_BOT=true
ENABLE_BIANDEX=true

# Bot only
npm run dev:bot

# DEX only
npm run dev:dex
```

### Network
```bash
# BSC Mainnet
CHAIN_ID=56
RPC_URL=https://bsc-dataseed1.binance.org/

# BSC Testnet
CHAIN_ID=97
```

See [.env.example](.env.example) for all options.

### Authentication Flow
1. `POST /api/auth/nonce` to obtain a one-time nonce (response includes the exact message to sign).
2. Sign `Sign in to BSC Trading Bot\nAddress: {wallet}\nNonce: {nonce}` with the target wallet.
3. `POST /api/auth/login` with `walletAddress`, `nonce`, and `signature` to receive a JWT.
4. Include `Authorization: Bearer <token>` for all `/api/v1/*` and `/api/trading` endpoints.
5. Development shortcuts: explicitly set `DISABLE_AUTH=true` or `ALLOW_DEV_LOGIN=true` when you need to bypass auth locally.

### WebSocket Endpoint
- Backend WebSocket server listens on `ws://<host>:10001/ws` by default.
- Set `NEXT_PUBLIC_WS_URL` if the frontend should connect to a custom WebSocket endpoint.

---

## 🚢 Deployment

### Development
```bash
npm run server:dev
cd frontend && npm run dev
```

### Production

**Option 1: Quick Deploy**
```bash
./scripts/deploy.sh production
```

**Option 2: PM2**
```bash
npm run build
pm2 start npm --name "bsc-bot" -- run start:full
```

**Option 3: Docker**
```bash
docker-compose up -d
```

**Option 4: Separate Deployment**
```bash
# Server 1 - Bot only
ENABLE_BIANDEX=false npm run start:bot

# Server 2 - DEX only  
ENABLE_TRADING_BOT=false npm run start:dex
```

See [SEPARATION_GUIDE.md](SEPARATION_GUIDE.md) for details.

---

## 📚 Documentation

- [API Documentation](docs/API.md) - Complete API reference
- [Architecture Guide](ARCHITECTURE.md) - System design
- [Deployment Guide](README_DEPLOYMENT.md) - Deployment scenarios
- [Separation Guide](SEPARATION_GUIDE.md) - Independent deployment
- [Project Summary](SUMMARY.md) - Feature overview

---

## 🔒 Security

### Pre-deployment Checklist
```bash
# 1. Run security check
./scripts/security-check.sh

# 2. Update secrets
JWT_SECRET=<64+ chars random string>
ENCRYPTION_PASSWORD=<32+ chars random string>

# 3. Configure production settings
NODE_ENV=production
DISABLE_AUTH=false
LOG_LEVEL=warn
```

### Security Features
- JWT Authentication
- AES-256 Encryption
- Rate Limiting
- Helmet.js Headers
- CORS Protection
- SQL Injection Prevention

---

## 📊 API Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | System health |
| `/api/v1/wallets/list` | GET | List wallets |
| `/api/v1/wallets/generate` | POST | Create wallets |
| `/api/v1/wallets/batch-transfer` | POST | Batch transfer |
| `/api/trading/quote` | POST | Get quote |
| `/api/trading/execute` | POST | Execute trade |
| `/api/dashboard/overview` | GET | Dashboard metrics |

Full API docs: [docs/API.md](docs/API.md)

---

## 🛠️ Development

### Project Structure
```
├── src/              # Backend source
├── frontend/         # Next.js frontend
├── contracts-project/# Smart contracts
├── scripts/          # Deployment scripts
├── data/            # Database & exports
└── docs/            # Documentation
```

### Scripts
```bash
npm run server:dev      # Start backend dev
npm run dev:bot         # Bot only dev
npm run dev:dex         # DEX only dev
npm run build           # Build backend
npm run migrate         # Run migrations
npm test                # Run tests
```

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Run tests
5. Create pull request

---

## 📝 License

MIT License - see [LICENSE](LICENSE)

---

## 🙏 Acknowledgments

- PancakeSwap - DEX integration
- Next.js - Frontend framework
- ethers.js - Ethereum library
- NextUI - UI components

---

## 📞 Support

- Issues: [GitHub Issues](https://github.com/yourorg/bsc-bot/issues)
- Docs: See [docs/](docs/) directory
- Email: support@yourdomain.com

---

## 🗺️ Roadmap

**Q4 2025**
- Mobile application
- Advanced analytics
- Multi-chain support

**Q1 2026**
- Institutional features
- White-label solution
- Advanced strategies

---

<div align="center">

**Built with ❤️ for the BSC Community**

[⬆ Back to Top](#bsc-trading-bot--biandex-platform)

</div>
