# BSC Trading Bot - Production Drill Guide

## 🎯 Overview

This guide provides comprehensive instructions for conducting production readiness drills and setting up monitoring dashboards for the BSC Trading Bot system.

## 🛠️ Production Drill Script

### Quick Start

```bash
# Basic drill (safe mode)
./scripts/production_drill.sh --skip-destructive

# Full drill with authentication
./scripts/production_drill.sh --auth-token "your-secret-token"

# Remote drill
./scripts/production_drill.sh --host "production.example.com" --auth-token "token"

# Quick verification
./scripts/production_drill.sh --duration 60 --skip-destructive
```

### Drill Scenarios Covered

#### 1. 🏥 Health Check Verification
- **What it tests**: All health endpoints and API accessibility
- **Endpoints checked**:
  - `GET /healthz` - Public health check
  - `GET /health` - Authenticated health check (if token provided)
  - `GET /metrics` - Prometheus metrics endpoint
  - `GET /status` - System status overview
  - `GET /api/v1/pairs` - Market data API

#### 2. 🔌 WebSocket Connection Drill
- **What it tests**: WebSocket resilience and reconnection
- **Actions performed**:
  - Monitors current WebSocket status
  - Simulates network disconnection (if `--skip-destructive` not set)
  - Verifies automatic reconnection
  - Checks WebSocket metrics

#### 3. 💻 Resource Exhaustion Testing
- **What it tests**: System behavior under high load
- **Actions performed**:
  - Monitors current CPU and memory usage
  - Simulates high CPU load for 30 seconds (if destructive tests enabled)
  - Verifies system recovery
  - Checks resource metrics

#### 4. 🗄️ Database Connectivity
- **What it tests**: Database health and API dependencies
- **Actions performed**:
  - Checks database-related metrics
  - Tests market data API (requires database)
  - Verifies data consistency

#### 5. 📈 Strategy Operations
- **What it tests**: Strategy management system
- **Actions performed**:
  - Monitors strategy-related metrics
  - Checks system status for strategy information
  - Verifies strategy monitoring capabilities

#### 6. 💰 Fund Management Testing
- **What it tests**: Fund management system monitoring
- **Actions performed**:
  - Checks fund-related metrics
  - Monitors balance and wallet metrics
  - Verifies fund management observability

#### 7. 🚨 Alert and Recovery Systems
- **What it tests**: Alert configuration and recovery procedures
- **Actions performed**:
  - Validates Prometheus alert rules
  - Checks alert-related metrics
  - Verifies alerting system configuration

### Configuration Options

```bash
# Environment Variables
export BOT_HOST="localhost"           # Target host
export METRICS_PORT="3001"           # Metrics endpoint port
export API_PORT="3010"               # API endpoint port
export AUTH_TOKEN="your-token"       # Authentication token
export DRILL_DURATION="300"          # Drill duration in seconds
export SKIP_DESTRUCTIVE="false"      # Skip destructive tests

# Command Line Options
--host HOST                          # Bot host (default: localhost)
--metrics-port PORT                  # Metrics port (default: 3001)
--api-port PORT                     # API port (default: 3010)
--auth-token TOKEN                  # Authentication token
--duration SECONDS                  # Drill duration (default: 300)
--skip-destructive                  # Skip destructive tests
--help                             # Show help
```

### Sample Output

```
======================================================
  BSC Trading Bot - Production Drill Script
======================================================

>>> 预检查
2024-01-15 10:30:00 [SUCCESS] Metrics Service is running on port 3001
2024-01-15 10:30:00 [SUCCESS] API Service is running on port 3010
2024-01-15 10:30:01 [SUCCESS] Pre-drill checks passed

>>> 健康检查演练
2024-01-15 10:30:01 [SUCCESS] Public Health Check is running on port 3001
2024-01-15 10:30:01 [SUCCESS] Authenticated Health Check is running on port 3001
2024-01-15 10:30:01 [SUCCESS] Metrics endpoint returned 45 metrics

>>> WebSocket断连演练
2024-01-15 10:30:01 [WARN] Skipping WebSocket disconnection drill (SKIP_DESTRUCTIVE=true)

...

====== PRODUCTION DRILL REPORT ======
Drill completed at: Mon Jan 15 10:35:00 EST 2024
Total log entries: 127
Errors: 0
Warnings: 3
Successes: 24
Full log: /path/to/logs/production_drill_20240115_103000.log
=====================================
```

## 📊 Grafana Dashboard Setup

### Available Dashboards

#### 1. System Overview Dashboard
- **File**: `monitoring/grafana-dashboard-system-overview.json`
- **Purpose**: High-level system health and performance
- **Panels**:
  - System Status (UP/DOWN)
  - WebSocket Connection Status
  - Database Connection Status
  - Active Strategies Count
  - System Resources (CPU/Memory)
  - Event Processing Rate
  - Trading Activity Overview
  - Wallet Balances
  - Errors and Alerts

#### 2. Trading Performance Dashboard
- **File**: `monitoring/grafana-dashboard-trading-performance.json`
- **Purpose**: Trading metrics and strategy performance
- **Panels**:
  - Total Realized P&L
  - Average Win Rate
  - Total Trades
  - Maximum Drawdown
  - Strategy P&L Over Time
  - Trade Execution Success Rate
  - Trading Volume by Strategy
  - Strategy Risk Metrics (Sharpe/Sortino)
  - Grid Strategy Metrics

#### 3. Risk Management Dashboard
- **File**: `monitoring/grafana-dashboard-risk-management.json`
- **Purpose**: Risk control and fund management
- **Panels**:
  - Portfolio Risk Score (Gauge)
  - Value at Risk (VaR)
  - Active Risk Alerts
  - Emergency Stop Status
  - Risk Metrics Over Time
  - Position Sizes vs Limits
  - Risk Actions Executed
  - Fund Management Operations
  - Asset Allocation (Pie Chart)
  - Risk Limit Utilization

### Dashboard Import Process

#### Step 1: Access Grafana
```bash
# Open Grafana in your browser
http://your-grafana-host:3000
```

#### Step 2: Import Dashboards
1. Click **"+"** → **"Import"**
2. Click **"Upload JSON file"**
3. Select dashboard file:
   - `monitoring/grafana-dashboard-system-overview.json`
   - `monitoring/grafana-dashboard-trading-performance.json`
   - `monitoring/grafana-dashboard-risk-management.json`
4. Configure datasource:
   - Set **Prometheus datasource UID** to match your setup
   - Default: `prometheus-uid`
5. Click **"Import"**

#### Step 3: Configure Data Source
```yaml
# prometheus.yml configuration
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'bsc-bot'
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/metrics'
    scrape_interval: 30s
    bearer_token: 'your-auth-token'  # If authentication enabled
```

## 🚀 Pre-Production Checklist

### Environment Setup
```bash
# 1. Set environment variables
export NODE_ENV=production
export DATABASE_URL="postgresql://user:pass@host:5432/db"
export RPC_URL="https://bsc-dataseed1.binance.org/"
export TREASURY_PRIVATE_KEY="0x..."
export AUTH_TOKEN="secure-production-token"
export ENABLE_AUTH=true

# 2. Database migration
npm run build
npm run migrate

# 3. Verify all tables created
psql $DATABASE_URL -c "\dt"
```

### Security Configuration
```bash
# 1. Enable authentication
export ENABLE_AUTH=true
export AUTH_TOKEN=$(openssl rand -hex 32)

# 2. Configure firewall (example)
ufw allow 3001/tcp  # Metrics port
ufw allow 3010/tcp  # API port
ufw deny 5432/tcp   # Database port (internal only)

# 3. Set up reverse proxy (nginx example)
location /metrics {
    proxy_pass http://localhost:3001;
    allow 10.0.0.0/8;  # Monitor network only
    deny all;
}
```

### Monitoring Setup
```bash
# 1. Start Prometheus
prometheus --config.file=monitoring/prometheus.yml

# 2. Start Grafana
grafana-server --config=monitoring/grafana.ini

# 3. Import alert rules
curl -X POST \
  http://prometheus:9090/api/v1/rules \
  -H 'Content-Type: application/yaml' \
  --data-binary @monitoring/prometheus-alerts.yml
```

## 🧪 Test Scenarios

### Scenario 1: Normal Operations Test
```bash
# Start system
npx bsc-bot bot start

# Run basic drill
./scripts/production_drill.sh --skip-destructive --duration 60

# Check all green on dashboards
# ✅ System Status: UP
# ✅ WebSocket: CONNECTED  
# ✅ Database: CONNECTED
# ✅ Error Rate: < 0.1%
```

### Scenario 2: High Load Test
```bash
# Run full drill with load testing
./scripts/production_drill.sh --duration 300

# Monitor resource usage
# ✅ CPU < 80% during load
# ✅ Memory < 1GB
# ✅ Response time < 100ms
# ✅ No failed requests
```

### Scenario 3: Alert Testing
```bash
# Trigger WebSocket disconnection
./scripts/production_drill.sh --host disconnected-host

# Expected alerts:
# 🚨 WebSocketDisconnected (Warning)
# 🚨 EventProcessingLag (High)
# ✅ Auto-reconnection within 60s
```

### Scenario 4: Recovery Test
```bash
# Stop database temporarily
docker stop postgres-container

# Expected behavior:
# 🚨 DatabaseDisconnected (Critical)
# ✅ API returns 503 Service Unavailable
# ✅ System enters degraded mode

# Restart database
docker start postgres-container

# Expected recovery:
# ✅ DatabaseConnected within 30s
# ✅ All services resume normal operation
```

## 📈 Success Metrics

### System Health
- ✅ **Uptime**: > 99.9%
- ✅ **Response Time**: < 100ms (95th percentile)
- ✅ **Error Rate**: < 0.1%
- ✅ **Memory Usage**: < 512MB baseline

### Trading Performance  
- ✅ **Trade Success Rate**: > 95%
- ✅ **Order Latency**: < 5 seconds
- ✅ **Price Feed Delay**: < 1 second
- ✅ **Strategy Execution**: < 10 second intervals

### Risk Management
- ✅ **Risk Alert Response**: < 30 seconds
- ✅ **Emergency Stop**: < 10 seconds
- ✅ **Position Monitoring**: Real-time
- ✅ **Fund Sweeps**: Daily execution

## 🔧 Troubleshooting

### Common Issues

#### Drill Script Failures
```bash
# Permission denied
chmod +x ./scripts/production_drill.sh

# Authentication failures
export AUTH_TOKEN="correct-token"

# Network connectivity
curl -f http://localhost:3001/healthz
```

#### Dashboard Import Issues
```bash
# Update datasource UID in JSON
sed -i 's/"prometheus-uid"/"your-prometheus-uid"/g' dashboard.json

# Check Prometheus connectivity
curl http://prometheus:9090/api/v1/query?query=up
```

#### Alert Rule Issues
```bash
# Validate YAML syntax
yamllint monitoring/prometheus-alerts.yml

# Reload alert rules
curl -X POST http://prometheus:9090/-/reload
```

### Emergency Procedures

#### System Down
```bash
# 1. Check system status
npx bsc-bot bot status

# 2. Check logs
tail -f logs/app.log

# 3. Restart services
npx bsc-bot bot restart

# 4. Run health drill
./scripts/production_drill.sh --skip-destructive --duration 60
```

#### High Error Rate
```bash
# 1. Check error metrics
curl -H "Authorization: Bearer $AUTH_TOKEN" \
  http://localhost:3001/metrics | grep error

# 2. Enable emergency stop if needed
npx bsc-bot emergency stop

# 3. Review and fix issues
# 4. Resume operations
npx bsc-bot emergency resume
```

## 📞 Support

### Production Drill Support
- **Script Location**: `scripts/production_drill.sh`
- **Log Location**: `logs/production_drill_*.log`
- **Help Command**: `./scripts/production_drill.sh --help`

### Dashboard Support  
- **Dashboard Files**: `monitoring/grafana-dashboard-*.json`
- **Grafana Docs**: https://grafana.com/docs/grafana/latest/dashboards/
- **Prometheus Query Guide**: https://prometheus.io/docs/prometheus/latest/querying/

### System Support
- **Operations Manual**: `OPERATIONS.md`
- **System Overview**: `SYSTEM_COMPLETE.md`  
- **CLI Help**: `npx bsc-bot --help`

---

**Ready for Production** 🚀  
The system is fully prepared for production deployment with comprehensive monitoring, alerting, and recovery procedures.