# BSC Trading Bot - Deployment Guide 部署指南

## 📋 Table of Contents

1. [Quick Start 快速开始](#quick-start)
2. [Prerequisites 前置要求](#prerequisites)
3. [Installation 安装](#installation)
4. [Configuration 配置](#configuration)
5. [Deployment Methods 部署方式](#deployment-methods)
6. [Monitoring 监控](#monitoring)
7. [Troubleshooting 故障排查](#troubleshooting)
8. [Security Checklist 安全清单](#security-checklist)

## Quick Start

```bash
# Clone repository
git clone https://github.com/yourusername/bnb-trading-bot.git
cd bnb-trading-bot

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npx knex migrate:latest

# Start all services
./scripts/start-all.sh

# Check health
./scripts/health-check.sh
```

## Prerequisites

### System Requirements

- **OS**: Linux (Ubuntu 20.04+), macOS 11+, Windows 10+ (WSL2)
- **Node.js**: v18.0.0 or higher
- **NPM**: v8.0.0 or higher
- **RAM**: Minimum 2GB, Recommended 4GB
- **Storage**: Minimum 10GB free space
- **Network**: Stable internet connection for BSC RPC access

### Required Software

```bash
# Check Node.js version
node --version  # Should be >= v18.0.0

# Check npm version
npm --version   # Should be >= 8.0.0

# Install PM2 for production
npm install -g pm2

# Install SQLite3 (if not using PostgreSQL)
# Ubuntu/Debian
sudo apt-get install sqlite3

# macOS
brew install sqlite3
```

## Installation

### 1. Clone and Setup

```bash
# Clone repository
git clone https://github.com/yourusername/bnb-trading-bot.git
cd bnb-trading-bot

# Install dependencies
npm install

# Install frontend dependencies
cd frontend
npm install
cd ..
```

### 2. Environment Configuration

```bash
# Copy environment template
cp .env.production .env

# Generate secure JWT secret
openssl rand -hex 32
# Add to .env as JWT_SECRET

# Generate encryption password
openssl rand -base64 32
# Add to .env as ENCRYPTION_PASSWORD
```

### 3. Database Setup

#### SQLite (Default)

```bash
# Create data directory
mkdir -p data

# Run migrations
npx knex migrate:latest
```

#### PostgreSQL (Production Recommended)

```bash
# Install PostgreSQL
sudo apt-get install postgresql postgresql-contrib

# Create database
sudo -u postgres createdb bsc_trading_bot

# Update .env
DB_CLIENT=pg
DB_HOST=localhost
DB_PORT=5432
DB_NAME=bsc_trading_bot
DB_USER=your_user
DB_PASSWORD=your_password

# Run migrations
npx knex migrate:latest
```

### 4. Build Project

```bash
# Build TypeScript
npm run build

# Build frontend (if needed)
cd frontend
npm run build
cd ..
```

## Configuration

### Essential Environment Variables

```env
# Authentication (REQUIRED - Generate new values!)
JWT_SECRET=your-generated-jwt-secret-min-256-bits
ENCRYPTION_PASSWORD=your-encryption-password

# Network
NODE_ENV=production
PORT=10001

# BSC Network
BSC_RPC_URL=https://bsc-dataseed.binance.org/
BSC_CHAIN_ID=56

# Database
DATABASE_URL=./data/trading-bot.sqlite
# Or for PostgreSQL:
# DATABASE_URL=postgresql://user:pass@localhost:5432/bsc_trading_bot

# Price Service
COINGECKO_API_KEY=your-coingecko-api-key

# Alerts (At least one recommended)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR/WEBHOOK
ALERT_EMAIL=alerts@yourcompany.com

# Trading Configuration
DEFAULT_SLIPPAGE=0.5
MAX_SLIPPAGE=5
DEFAULT_GAS_LIMIT=500000

# Monitoring
METRICS_ENABLED=true
LOG_LEVEL=info
```

### Advanced Configuration

See `.env.production` for complete configuration options including:
- Rate limiting settings
- Cache configuration
- Backup settings
- Feature flags
- Performance tuning

## Deployment Methods

### Method 1: PM2 (Recommended for VPS)

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js --env production

# Or use deployment script
./scripts/deploy-production.sh --method=pm2

# Save PM2 configuration
pm2 save
pm2 startup

# Monitor
pm2 monit
```

**ecosystem.config.js**:
```javascript
module.exports = {
  apps: [{
    name: 'bsc-trading-bot',
    script: './dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 10001
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true,
    watch: false,
    max_memory_restart: '1G',
    cron_restart: '0 0 * * *'
  }]
};
```

### Method 2: Systemd (Linux Production)

```bash
# Create systemd service
sudo nano /etc/systemd/system/bsc-trading-bot.service

# Add configuration (see below)

# Enable and start service
sudo systemctl enable bsc-trading-bot
sudo systemctl start bsc-trading-bot

# Check status
sudo systemctl status bsc-trading-bot
```

**/etc/systemd/system/bsc-trading-bot.service**:
```ini
[Unit]
Description=BSC Trading Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/bnb-trading-bot
EnvironmentFile=/home/ubuntu/bnb-trading-bot/.env
ExecStart=/usr/bin/node /home/ubuntu/bnb-trading-bot/dist/server.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/bsc-trading-bot/output.log
StandardError=append:/var/log/bsc-trading-bot/error.log

[Install]
WantedBy=multi-user.target
```

### Method 3: Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --production

# Copy built files
COPY dist/ ./dist/
COPY .env.production .env

# Create data directory
RUN mkdir -p data logs

# Run migrations
RUN npx knex migrate:latest

EXPOSE 10001

CMD ["node", "dist/server.js"]
```

Build and run:
```bash
# Build image
docker build -t bsc-trading-bot .

# Run container
docker run -d \
  --name bsc-bot \
  -p 10001:10001 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  --env-file .env.production \
  bsc-trading-bot

# Check logs
docker logs -f bsc-bot
```

### Method 4: Cloud Deployment

#### AWS EC2

```bash
# Launch EC2 instance (t2.medium recommended)
# SSH into instance
ssh -i your-key.pem ubuntu@your-instance-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup
git clone your-repo
cd bnb-trading-bot
npm install
npm run build

# Setup PM2
npm install -g pm2
pm2 start ecosystem.config.js --env production
```

#### Heroku

```bash
# Install Heroku CLI
# Create Procfile
echo "web: node dist/server.js" > Procfile

# Create app
heroku create your-app-name

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set JWT_SECRET=your-secret

# Deploy
git push heroku main

# Check logs
heroku logs --tail
```

## Monitoring

### Health Checks

```bash
# Run health check script
./scripts/health-check.sh

# Or use API endpoint
curl http://localhost:10001/api/health
```

### Logging

```bash
# View logs
tail -f logs/api-server.log

# PM2 logs
pm2 logs bsc-trading-bot

# Systemd logs
journalctl -u bsc-trading-bot -f
```

### Metrics

Access metrics at: `http://localhost:9090/metrics` (if enabled)

### Alert Channels

Configure at least one alert channel:
1. **Slack**: Set `SLACK_WEBHOOK_URL`
2. **Discord**: Set `DISCORD_WEBHOOK_URL`
3. **Email**: Configure SMTP settings
4. **Custom**: Set `CUSTOM_ALERT_WEBHOOK`

## Troubleshooting

### Common Issues

#### 1. Port Already in Use
```bash
# Find process using port
lsof -i:10001

# Kill process
kill -9 <PID>

# Or change port in .env
PORT=10002
```

#### 2. Database Connection Failed
```bash
# Check database exists
ls -la data/trading-bot.sqlite

# Check permissions
chmod 644 data/trading-bot.sqlite

# Re-run migrations
npx knex migrate:latest
```

#### 3. API Not Responding
```bash
# Check service status
systemctl status bsc-trading-bot

# Check logs for errors
tail -100 logs/api-server.log | grep ERROR

# Restart service
./scripts/stop-all.sh
./scripts/start-all.sh
```

#### 4. High Memory Usage
```bash
# Check memory
free -h

# Restart with memory limit
NODE_OPTIONS="--max-old-space-size=1024" npm start

# Or use PM2 memory limit
pm2 start app.js --max-memory-restart 1G
```

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug npm run server:dev

# Or set in .env
LOG_LEVEL=debug
```

## Security Checklist

### Pre-Deployment

- [ ] Generate new JWT_SECRET (min 256 bits)
- [ ] Generate new ENCRYPTION_PASSWORD
- [ ] Never commit .env file
- [ ] Use environment-specific configs
- [ ] Enable HTTPS/TLS for API
- [ ] Configure CORS properly
- [ ] Set up rate limiting
- [ ] Enable security headers (Helmet)
- [ ] Audit npm packages: `npm audit`

### Production Security

- [ ] Use strong database passwords
- [ ] Enable firewall (UFW/iptables)
- [ ] Configure fail2ban
- [ ] Regular security updates
- [ ] Monitor for suspicious activity
- [ ] Backup encryption keys securely
- [ ] Rotate JWT secrets periodically
- [ ] Use secrets management service
- [ ] Enable audit logging
- [ ] Regular security scans

### Network Security

```bash
# UFW firewall setup
sudo ufw allow 22/tcp  # SSH
sudo ufw allow 10001/tcp  # API
sudo ufw enable

# Fail2ban for brute force protection
sudo apt-get install fail2ban
sudo systemctl enable fail2ban
```

## Backup & Recovery

### Automated Backups

```bash
# Setup daily backup cron
crontab -e

# Add backup job
0 2 * * * /home/ubuntu/bnb-trading-bot/scripts/backup.sh
```

**scripts/backup.sh**:
```bash
#!/bin/bash
BACKUP_DIR="/backup/bsc-bot"
DATE=$(date +%Y%m%d_%H%M%S)

# Backup database
cp data/trading-bot.sqlite $BACKUP_DIR/db_$DATE.sqlite

# Backup configuration
cp .env $BACKUP_DIR/env_$DATE

# Keep only last 30 days
find $BACKUP_DIR -mtime +30 -delete
```

### Recovery

```bash
# Restore database
cp /backup/bsc-bot/db_latest.sqlite data/trading-bot.sqlite

# Restore configuration
cp /backup/bsc-bot/env_latest .env

# Restart services
./scripts/start-all.sh
```

## Support

For issues and questions:
- GitHub Issues: [Project Issues](https://github.com/yourusername/bnb-trading-bot/issues)
- Documentation: [Wiki](https://github.com/yourusername/bnb-trading-bot/wiki)
- Email: support@yourcompany.com

## License

MIT License - See LICENSE file for details