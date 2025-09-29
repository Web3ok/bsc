# BSC Market Maker Bot - Operations Manual

## 🚀 Production Deployment

### Prerequisites
```bash
# 1. Environment Setup
cp .env.example .env
# Edit .env with production values

# 2. Build and Migrate
npm run build
npm run migrate  # or: node scripts/migrate-market-tables.js

# 3. Verify Configuration
node dist/cli/index.js bot health
```

### Startup Sequence
```bash
# Option A: Full Service Stack
node dist/cli/index.js bot start

# Option B: Staged Startup
node dist/cli/index.js monitor start
node dist/cli/index.js market start  
node dist/cli/index.js bot start --monitoring-only --market-only=false

# Option C: Safe Mode (No WebSocket)
node dist/cli/index.js bot start --no-websocket
```

### Health Check Endpoints
```bash
# Public endpoint (always available)
curl http://localhost:3001/healthz

# Authenticated endpoints (requires auth if enabled)
curl -H "Authorization: Bearer dev_token_123" http://localhost:3001/health
curl -H "Authorization: Bearer dev_token_123" http://localhost:3001/metrics
curl -H "Authorization: Bearer dev_token_123" http://localhost:3001/prometheus

# Market Data API
curl http://localhost:3002/api/v1/candles/BNB-USDT?interval=1h&limit=24
```

## 🛡️ Emergency Procedures

### Immediate Stop (Emergency)
```bash
# Method 1: CLI Emergency Stop
node dist/cli/index.js emergency stop

# Method 2: Kill Process
pkill -f "dist/cli/index.js bot start"
pkill -f "node dist/cli/index.js"

# Method 3: Database Emergency Flag
sqlite3 data/test_bot.db "UPDATE system_config SET value='true' WHERE key='emergency_stop';"
```

### Graceful Shutdown
```bash
# Stop services in reverse order
node dist/cli/index.js market stop
node dist/cli/index.js monitor stop  
node dist/cli/index.js bot stop

# Or send SIGTERM
kill -TERM $(pgrep -f "dist/cli/index.js bot start")
```

### Rollback Procedures

#### Database Rollback
```bash
# 1. Stop all services
node dist/cli/index.js bot stop

# 2. Backup current state
cp data/test_bot.db data/backup_$(date +%Y%m%d_%H%M%S).db

# 3. Restore from backup
cp data/backup_YYYYMMDD_HHMMSS.db data/test_bot.db

# 4. Restart services
node dist/cli/index.js bot start
```

#### Code Rollback
```bash
# 1. Emergency stop
node dist/cli/index.js emergency stop

# 2. Rollback to previous version
git checkout <previous-commit-hash>
npm run build

# 3. Verify database compatibility
node dist/cli/index.js bot health

# 4. Restart if healthy
node dist/cli/index.js bot start
```

## 📊 Monitoring & Alerting

### Key Metrics to Monitor

#### System Health
- `health_check_status` - Overall system health (1=healthy, 0=unhealthy)
- `emergency_stop_active` - Emergency stop status (1=active, 0=inactive)
- `uptime_seconds` - Service uptime

#### Resource Usage  
- `system_memory_usage_bytes` - Memory consumption
- `system_cpu_usage_percent` - CPU utilization
- Database size: `du -h data/test_bot.db`

#### Market Data Pipeline
- `websocket_connections_total` - WebSocket connection count
- `swap_events_processed_total` - Processed swap events
- `price_updates_total` - Price updates processed
- `market_data_errors_total` - Processing error count

#### RPC & Network
- `rpc_requests_total` - RPC request count
- RPC error rate: `(failed_requests / total_requests) * 100`
- WebSocket reconnection count

### Alerting Thresholds

#### Critical Alerts (Immediate Response)
```bash
# System down
health_check_status == 0

# Emergency stop activated
emergency_stop_active == 1

# High error rate
market_data_errors_total > 100/hour

# Resource exhaustion
system_memory_usage_bytes > 80% of available
system_cpu_usage_percent > 90% for 5+ minutes
```

#### Warning Alerts (Monitor Closely)
```bash
# WebSocket issues
websocket_connections_total == 0 for 2+ minutes
websocket_reconnect_count > 5/hour

# RPC issues  
rpc_error_rate > 5%
rpc_response_time_p95 > 5000ms

# Data pipeline delays
(current_time - latest_price_update) > 300 seconds
candlestick_aggregation_lag > 60 seconds
```

#### Resource Alerts
```bash
# Disk space
df -h | grep data/test_bot.db | awk '{print $5}' > 70%

# Database growth
database_size_mb > 1000 MB (consider archiving)

# Queue backlog
event_queue_size > 1000 events
```

## 🔧 Troubleshooting

### Common Issues

#### WebSocket Connection Fails
```bash
# Check network connectivity
curl -v https://bsc-dataseed1.binance.org/

# Check RPC configuration
node -e "console.log(process.env.RPC_URL)"

# Restart with WebSocket disabled
node dist/cli/index.js bot start --no-websocket
```

#### Database Locked/Corrupted
```bash
# Check database integrity
sqlite3 data/test_bot.db "PRAGMA integrity_check;"

# Rebuild from backup
cp data/backup_latest.db data/test_bot.db

# If no backup, migrate fresh database
rm data/test_bot.db
npm run migrate
```

#### High Memory Usage
```bash
# Check metrics cache size
node -e "
const { eventParser } = require('./dist/market/eventParser');
console.log('Cache stats:', eventParser.getCacheStats());
"

# Clear caches and restart
node dist/cli/index.js bot stop
node dist/cli/index.js bot start
```

#### RPC Rate Limiting
```bash
# Switch to backup RPC
# Edit .env: RPC_URL=https://bsc-dataseed2.binance.org/

# Check rate limiting
curl -v -X POST https://bsc-dataseed1.binance.org/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## 📋 Maintenance Tasks

### Daily
- [ ] Check `/health` endpoint response
- [ ] Verify latest price updates are recent (<5 minutes)
- [ ] Check error counts in logs
- [ ] Verify disk space usage

### Weekly  
- [ ] Backup database: `cp data/test_bot.db backups/weekly_$(date +%Y%m%d).db`
- [ ] Review Prometheus metrics for trends
- [ ] Check and rotate logs if needed
- [ ] Update RPC endpoints if experiencing issues

### Monthly
- [ ] Database cleanup/archiving (>30 days old data)
- [ ] Security update review
- [ ] Performance optimization review
- [ ] Disaster recovery test

## 🎯 Performance Baselines

### Expected Performance (Normal Operations)
- Health check response: <100ms
- Price update frequency: 1-10 updates/second
- WebSocket reconnections: <1/hour
- Database queries (P95): <300ms
- Memory usage: <512MB
- CPU usage: <20%

### Performance Degradation Triggers
- Health check response: >1000ms
- Price update lag: >300 seconds
- WebSocket reconnects: >5/hour
- Database queries (P95): >1000ms
- Memory usage: >1GB
- CPU usage: >80% sustained

## 📞 Escalation Procedures

### Incident Severity Levels

#### S1 - Critical (Immediate Response)
- System completely down
- Emergency stop activated
- Data corruption detected
- **Response**: Immediate, 24/7

#### S2 - High (1 hour response)  
- Partial service degradation
- High error rates (>5%)
- WebSocket connection issues
- **Response**: During business hours

#### S3 - Medium (24 hour response)
- Performance degradation
- Non-critical alerts
- **Response**: Next business day

#### S4 - Low (Best effort)
- Enhancement requests
- Documentation updates
- **Response**: When available

### Contact Information
- Primary On-Call: [Your contact]
- Secondary On-Call: [Backup contact]  
- Escalation Manager: [Manager contact]
- Vendor Support: [BSC/RPC provider contacts]