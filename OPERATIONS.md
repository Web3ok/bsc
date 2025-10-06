# BSC Trading Bot - Production Operations Manual
# 生产环境运维手册

## 📋 目录 Table of Contents

1. [日常运维 Daily Operations](#日常运维-daily-operations)
2. [监控与告警 Monitoring & Alerting](#监控与告警-monitoring--alerting)
3. [故障排查 Troubleshooting](#故障排查-troubleshooting)
4. [备份与恢复 Backup & Recovery](#备份与恢复-backup--recovery)
5. [安全检查 Security Checks](#安全检查-security-checks)
6. [性能优化 Performance Tuning](#性能优化-performance-tuning)
7. [应急响应 Incident Response](#应急响应-incident-response)

---

## 日常运维 Daily Operations

### 每日检查清单 Daily Checklist

#### 1. 系统健康检查 (每天早上9点 / Daily at 9 AM)

```bash
# 1. 检查服务状态 Check service status
pm2 status
# 或 or
systemctl status bsc-trading-bot

# 2. 健康检查 Health check
curl http://localhost:10001/api/health
# 预期响应 Expected: {"status":"ok","timestamp":"..."}

# 3. 检查日志错误数 Check error count in logs
tail -1000 logs/api-server.log | grep -i error | wc -l
# 预期 Expected: < 10 errors/day

# 4. 检查磁盘空间 Check disk space
df -h | grep -E '(data|logs)'
# 预期 Expected: < 70% usage
```

#### 2. 交易活动检查 (每天下午2点 / Daily at 2 PM)

```bash
# 1. 检查最近交易 Check recent trades
curl http://localhost:10001/api/v1/trading/history?limit=20

# 2. 检查WebSocket连接 Check WebSocket connections
curl http://localhost:10001/api/health | jq '.websocket_connections'

# 3. 检查价格缓存命中率 Check price cache hit rate
tail -100 logs/api-server.log | grep "Price cache" | grep "HIT\|MISS"
# 预期命中率 Expected: > 70% HIT rate
```

#### 3. 数据库维护 (每天晚上11点 / Daily at 11 PM)

```bash
# 1. 数据库大小检查 Check database size
du -h data/trading-bot.sqlite
# PostgreSQL版本 PostgreSQL version:
# psql -U user -d bsc_trading_bot -c "SELECT pg_size_pretty(pg_database_size('bsc_trading_bot'));"

# 2. 清理过期数据 Clean old data (>90 days)
# SQLite
sqlite3 data/trading-bot.sqlite "DELETE FROM trades WHERE created_at < datetime('now', '-90 days');"

# PostgreSQL
# psql -U user -d bsc_trading_bot -c "DELETE FROM trades WHERE created_at < NOW() - INTERVAL '90 days';"

# 3. 数据库优化 Database optimization
# SQLite
sqlite3 data/trading-bot.sqlite "VACUUM;"

# PostgreSQL
# psql -U user -d bsc_trading_bot -c "VACUUM ANALYZE;"
```

### 每周任务 Weekly Tasks

#### 1. 备份验证 (每周一 / Every Monday)

```bash
# 1. 创建备份 Create backup
./scripts/backup.sh

# 2. 验证备份完整性 Verify backup integrity
# SQLite
sqlite3 backups/db_latest.sqlite "PRAGMA integrity_check;"

# 3. 测试恢复流程 Test restore process (在测试环境 in test environment)
cp backups/db_latest.sqlite data/test-restore.sqlite
sqlite3 data/test-restore.sqlite "SELECT COUNT(*) FROM trades;"
```

#### 2. 安全审计 (每周三 / Every Wednesday)

```bash
# 1. 运行安全检查 Run security check
./scripts/production-safety-check.sh

# 2. 检查依赖漏洞 Check dependency vulnerabilities
npm audit
npm audit fix --dry-run  # 查看修复方案 See fix proposals

# 3. 检查JWT密钥强度 Check JWT secret strength
node -e "console.log('JWT_SECRET length:', process.env.JWT_SECRET?.length)"
# 预期 Expected: >= 64 characters

# 4. 检查访问日志异常 Check access logs for anomalies
tail -1000 logs/api-server.log | grep "401\|403" | wc -l
# 预期 Expected: < 50 unauthorized attempts/week
```

#### 3. 性能报告 (每周五 / Every Friday)

```bash
# 1. 生成性能报告 Generate performance report
./scripts/weekly-health-summary.sh > reports/weekly_$(date +%Y%m%d).md

# 2. 关键指标检查 Check key metrics
# - 平均响应时间 Average response time: < 200ms
# - 交易成功率 Trade success rate: > 95%
# - 数据库查询P95 Database query P95: < 300ms
# - 缓存命中率 Cache hit rate: > 70%
```

### 每月任务 Monthly Tasks

#### 1. 容量规划 (每月1号 / 1st of Month)

```bash
# 1. 数据增长趋势 Data growth trend
for i in {1..30}; do
  du -h data/trading-bot.sqlite | awk '{print $1}'
done | tail -30

# 2. 用户增长分析 User growth analysis
sqlite3 data/trading-bot.sqlite "SELECT COUNT(DISTINCT wallet_address) FROM trades WHERE created_at > datetime('now', '-30 days');"

# 3. 资源使用报告 Resource usage report
pm2 describe bsc-trading-bot | grep -E '(memory|cpu)'
```

#### 2. 日志归档 (每月5号 / 5th of Month)

```bash
# 1. 归档旧日志 Archive old logs (>30 days)
tar -czf logs/archive_$(date -d "last month" +%Y%m).tar.gz \
  $(find logs/ -name "*.log" -mtime +30)

# 2. 删除已归档日志 Delete archived logs
find logs/ -name "*.log" -mtime +30 -delete

# 3. 清理PM2日志 Clean PM2 logs
pm2 flush
```

#### 3. 灾难恢复演练 (每月15号 / 15th of Month)

```bash
# 1. 模拟完全故障 Simulate complete failure
./scripts/disaster-recovery-drill.sh

# 演练内容 Drill includes:
# - 从备份恢复数据库 Restore database from backup
# - 重建所有服务 Rebuild all services
# - 验证数据完整性 Verify data integrity
# - 测量恢复时间 Measure recovery time (目标 Target: < 30 minutes)
```

---

## 监控与告警 Monitoring & Alerting

### 关键指标 Key Metrics

#### 1. 系统健康指标 System Health Metrics

```bash
# 实时监控命令 Real-time monitoring commands

# CPU使用率 CPU usage
top -bn1 | grep "Cpu(s)" | awk '{print $2}' | awk -F'%' '{print $1}'

# 内存使用 Memory usage
free -m | awk 'NR==2{printf "%.2f%%", $3*100/$2}'

# 磁盘IO Disk I/O
iostat -x 1 3

# 网络连接数 Network connections
netstat -an | grep :10001 | wc -l
```

#### 2. 应用性能指标 Application Performance Metrics

```bash
# WebSocket连接数 WebSocket connections
curl -s http://localhost:10001/api/health | jq '.websocket_connections'

# 交易队列长度 Trade queue length
curl -s http://localhost:10001/api/metrics | grep trade_queue_length

# 价格缓存命中率 Price cache hit rate
curl -s http://localhost:10001/api/metrics | grep cache_hit_rate

# 数据库连接池状态 Database pool status
curl -s http://localhost:10001/api/metrics | grep db_pool_used
```

#### 3. 业务指标 Business Metrics

```bash
# 24小时交易量 24h trade volume
sqlite3 data/trading-bot.sqlite \
  "SELECT COUNT(*) FROM trades WHERE created_at > datetime('now', '-1 day');"

# 交易成功率 Trade success rate
sqlite3 data/trading-bot.sqlite \
  "SELECT
    (COUNT(CASE WHEN status='completed' THEN 1 END) * 100.0 / COUNT(*)) as success_rate
   FROM trades WHERE created_at > datetime('now', '-1 day');"

# 平均Gas费用 Average gas fee
sqlite3 data/trading-bot.sqlite \
  "SELECT AVG(CAST(gas_fee AS REAL)) FROM trades WHERE created_at > datetime('now', '-1 day');"
```

### 告警配置 Alert Configuration

#### 1. 严重告警 Critical Alerts (立即响应 Immediate Response)

```yaml
# 建议使用Prometheus + Alertmanager配置
# Recommended: Configure with Prometheus + Alertmanager

alerts:
  - name: ServiceDown
    condition: up{job="bsc-trading-bot"} == 0
    duration: 1m
    severity: critical
    action: 立即通知 + 自动重启 Notify immediately + Auto restart

  - name: HighErrorRate
    condition: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
    duration: 5m
    severity: critical
    action: 立即通知运维团队 Notify ops team immediately

  - name: DatabaseConnectionFailed
    condition: db_connection_errors > 10
    duration: 5m
    severity: critical
    action: 检查数据库状态 + 切换备用连接 Check DB status + Switch to backup connection
```

#### 2. 警告告警 Warning Alerts (1小时内响应 Response within 1 hour)

```yaml
alerts:
  - name: HighMemoryUsage
    condition: process_resident_memory_bytes > 1GB
    duration: 10m
    severity: warning
    action: 检查内存泄漏 Check for memory leaks

  - name: SlowDatabaseQueries
    condition: db_query_duration_p95 > 1000ms
    duration: 10m
    severity: warning
    action: 检查慢查询 + 考虑添加索引 Check slow queries + Consider indexing

  - name: WebSocketReconnectStorm
    condition: websocket_reconnect_count > 10/hour
    duration: 1h
    severity: warning
    action: 检查RPC稳定性 Check RPC stability
```

#### 3. 信息告警 Info Alerts (24小时内响应 Response within 24 hours)

```yaml
alerts:
  - name: DiskSpaceWarning
    condition: disk_usage > 70%
    duration: 1h
    severity: info
    action: 计划日志清理 Plan log cleanup

  - name: LowCacheHitRate
    condition: cache_hit_rate < 60%
    duration: 1h
    severity: info
    action: 优化缓存TTL Cache TTL optimization

  - name: HighTradeVolume
    condition: trades_per_hour > 1000
    duration: 1h
    severity: info
    action: 监控系统负载 Monitor system load
```

### 监控仪表板 Monitoring Dashboard

推荐使用Grafana配置以下面板 (Recommended Grafana panels):

1. **系统概览 System Overview**
   - CPU/内存使用率 CPU/Memory usage
   - 磁盘空间 Disk space
   - 网络流量 Network traffic

2. **应用健康 Application Health**
   - API响应时间 API response time
   - 错误率 Error rate
   - WebSocket连接数 WebSocket connections

3. **交易监控 Trading Monitoring**
   - 交易成功率 Trade success rate
   - 交易量趋势 Trade volume trend
   - Gas费用统计 Gas fee statistics

4. **数据库性能 Database Performance**
   - 查询时间分布 Query time distribution
   - 连接池使用率 Connection pool usage
   - 慢查询列表 Slow query list

---

## 故障排查 Troubleshooting

### 常见问题与解决方案 Common Issues & Solutions

#### 问题1: 服务无响应 Service Not Responding

**症状 Symptoms:**
```bash
curl http://localhost:10001/api/health
# curl: (7) Failed to connect to localhost port 10001: Connection refused
```

**诊断步骤 Diagnosis:**
```bash
# 1. 检查进程是否运行 Check if process is running
ps aux | grep node | grep -v grep

# 2. 检查端口占用 Check port usage
lsof -i:10001

# 3. 检查日志错误 Check logs for errors
tail -50 logs/api-server.log
```

**解决方案 Solutions:**
```bash
# 方案A: 重启服务 Restart service
pm2 restart bsc-trading-bot
# 或 or
systemctl restart bsc-trading-bot

# 方案B: 端口冲突解决 Resolve port conflict
# 修改.env中的PORT配置 Change PORT in .env
PORT=10002

# 方案C: 完全重启 Full restart
pm2 delete all
npm run build
pm2 start ecosystem.config.js --env production
```

#### 问题2: 数据库连接错误 Database Connection Error

**症状 Symptoms:**
```
Error: Failed to get database connection
Error: Database locked
```

**诊断步骤 Diagnosis:**
```bash
# 1. 检查数据库完整性 Check database integrity
sqlite3 data/trading-bot.sqlite "PRAGMA integrity_check;"

# 2. 检查连接数 Check connection count
lsof data/trading-bot.sqlite

# 3. 检查文件权限 Check file permissions
ls -la data/trading-bot.sqlite
```

**解决方案 Solutions:**
```bash
# 方案A: 释放数据库锁 Release database lock
fuser -k data/trading-bot.sqlite

# 方案B: 修复权限 Fix permissions
chmod 644 data/trading-bot.sqlite
chown $(whoami):$(whoami) data/trading-bot.sqlite

# 方案C: 从备份恢复 Restore from backup
cp backups/db_latest.sqlite data/trading-bot.sqlite

# 方案D: 迁移到PostgreSQL (生产推荐 Production recommended)
# 修改.env Change .env:
DB_CLIENT=pg
DATABASE_URL=postgresql://user:pass@localhost:5432/bsc_trading_bot
# 运行迁移 Run migrations
npx knex migrate:latest
```

#### 问题3: WebSocket连接频繁断开 WebSocket Disconnects

**症状 Symptoms:**
```
WebSocket disconnected (code: 1006)
Reconnecting in 5s...
```

**诊断步骤 Diagnosis:**
```bash
# 1. 检查RPC健康 Check RPC health
curl -X POST https://bsc-dataseed.binance.org/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# 2. 检查心跳日志 Check heartbeat logs
tail -100 logs/api-server.log | grep "ping\|pong"

# 3. 检查网络稳定性 Check network stability
ping -c 10 bsc-dataseed.binance.org
```

**解决方案 Solutions:**
```bash
# 方案A: 切换RPC节点 Switch RPC node
# 修改.env Change .env:
BSC_RPC_URL=https://bsc-dataseed2.binance.org/

# 方案B: 调整心跳间隔 Adjust heartbeat interval
# src/core-server.ts, line 630:
setInterval(() => { ws.ping(); }, 60000); // 改为60秒 Change to 60s

# 方案C: 使用多个RPC备份 Use multiple RPC backups
BSC_RPC_URLS=https://bsc-dataseed1.binance.org/,https://bsc-dataseed2.binance.org/
```

#### 问题4: 高内存占用 High Memory Usage

**症状 Symptoms:**
```bash
pm2 describe bsc-trading-bot
# memory: 1.5 GB (should be < 512 MB)
```

**诊断步骤 Diagnosis:**
```bash
# 1. 生成堆快照 Generate heap snapshot
node --inspect dist/server.js
# 在Chrome DevTools中生成快照 Generate snapshot in Chrome DevTools

# 2. 检查缓存大小 Check cache size
curl http://localhost:10001/api/metrics | grep cache_size

# 3. 检查WebSocket连接数 Check WebSocket connections
lsof -i | grep 10001 | wc -l
```

**解决方案 Solutions:**
```bash
# 方案A: 清空缓存重启 Clear cache and restart
pm2 restart bsc-trading-bot

# 方案B: 减少缓存TTL Reduce cache TTL
# src/services/price-cache-service.ts, line 6:
private readonly CACHE_TTL_MS = 15_000; // 30s改为15s Change 30s to 15s

# 方案C: 启用垃圾回收优化 Enable GC optimization
pm2 start dist/server.js --node-args="--max-old-space-size=512 --gc-interval=100"

# 方案D: 定期重启 Scheduled restart
pm2 start ecosystem.config.js --cron-restart="0 */12 * * *" # 每12小时重启 Restart every 12h
```

#### 问题5: 交易失败率高 High Trade Failure Rate

**症状 Symptoms:**
```sql
-- 交易成功率 < 90% Trade success rate < 90%
SELECT
  (COUNT(CASE WHEN status='completed' THEN 1 END) * 100.0 / COUNT(*)) as success_rate
FROM trades WHERE created_at > datetime('now', '-1 day');
```

**诊断步骤 Diagnosis:**
```bash
# 1. 分析失败原因 Analyze failure reasons
sqlite3 data/trading-bot.sqlite \
  "SELECT status, COUNT(*) FROM trades
   WHERE created_at > datetime('now', '-1 day')
   GROUP BY status;"

# 2. 检查Gas价格 Check gas price
curl http://localhost:10001/api/v1/gas-price

# 3. 检查滑点设置 Check slippage settings
grep SLIPPAGE .env
```

**解决方案 Solutions:**
```bash
# 方案A: 调整Gas设置 Adjust gas settings
# .env:
DEFAULT_GAS_LIMIT=600000  # 从500000增加 Increase from 500000
GAS_PRICE_MULTIPLIER=1.2  # 加快确认 Faster confirmation

# 方案B: 调整滑点容忍 Adjust slippage tolerance
DEFAULT_SLIPPAGE=1.0  # 从0.5增加到1.0 Increase from 0.5 to 1.0

# 方案C: 减少交易截止时间 Reduce deadline
# frontend/src/components/dex/SwapInterface.tsx, line 226:
const deadline = Math.floor(Date.now() / 1000) + 60 * 2; // 改为2分钟 Change to 2 minutes

# 方案D: 检查流动性 Check liquidity
curl "https://api.pancakeswap.info/api/v2/tokens/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
```

### 诊断工具 Diagnostic Tools

#### 1. 健康检查脚本 Health Check Script

```bash
#!/bin/bash
# scripts/health-check.sh

echo "=== BSC Trading Bot Health Check ==="
echo ""

# API健康 API Health
echo "1. API Health:"
curl -s http://localhost:10001/api/health | jq '.'
echo ""

# 数据库状态 Database Status
echo "2. Database Status:"
sqlite3 data/trading-bot.sqlite "PRAGMA integrity_check;"
echo ""

# 最近交易 Recent Trades
echo "3. Recent Trades (Last 24h):"
sqlite3 data/trading-bot.sqlite \
  "SELECT COUNT(*) as total,
          SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as success,
          SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
   FROM trades WHERE created_at > datetime('now', '-1 day');"
echo ""

# 系统资源 System Resources
echo "4. System Resources:"
echo "CPU: $(top -bn1 | grep "Cpu(s)" | awk '{print $2}')"
echo "Memory: $(free -m | awk 'NR==2{printf "%.2f%%", $3*100/$2}')"
echo "Disk: $(df -h | grep -E '(data|logs)' | awk '{print $5}')"
echo ""

# WebSocket状态 WebSocket Status
echo "5. WebSocket Status:"
netstat -an | grep :10001 | grep ESTABLISHED | wc -l
echo " active connections"
```

#### 2. 性能分析脚本 Performance Analysis Script

```bash
#!/bin/bash
# scripts/performance-analysis.sh

echo "=== Performance Analysis ==="

# 响应时间测试 Response time test
echo "1. API Response Time (10 samples):"
for i in {1..10}; do
  time=$(curl -o /dev/null -s -w '%{time_total}\n' http://localhost:10001/api/health)
  echo "Sample $i: ${time}s"
done

# 数据库查询性能 Database query performance
echo ""
echo "2. Database Query Performance:"
sqlite3 data/trading-bot.sqlite <<EOF
.timer ON
SELECT COUNT(*) FROM trades WHERE created_at > datetime('now', '-7 days');
SELECT * FROM trades ORDER BY created_at DESC LIMIT 100;
EOF

# 缓存命中率 Cache hit rate
echo ""
echo "3. Cache Hit Rate (Last 1000 requests):"
tail -1000 logs/api-server.log | grep -E "cache.*HIT|cache.*MISS" | \
  awk '{print $NF}' | sort | uniq -c

# WebSocket性能 WebSocket performance
echo ""
echo "4. WebSocket Performance:"
tail -1000 logs/api-server.log | grep -E "ping|pong" | tail -20
```

---

## 备份与恢复 Backup & Recovery

### 自动备份策略 Automated Backup Strategy

#### 1. 数据库备份 Database Backup

```bash
#!/bin/bash
# scripts/backup.sh

BACKUP_DIR="/backup/bsc-bot"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

# 创建备份目录 Create backup directory
mkdir -p $BACKUP_DIR/{daily,weekly,monthly}

# 每日备份 Daily backup
if [ $(date +%H) -eq 2 ]; then
  # SQLite
  cp data/trading-bot.sqlite $BACKUP_DIR/daily/db_$DATE.sqlite

  # PostgreSQL
  # pg_dump -U user bsc_trading_bot | gzip > $BACKUP_DIR/daily/db_$DATE.sql.gz
fi

# 每周备份 Weekly backup (周日 Sunday)
if [ $(date +%u) -eq 7 ]; then
  cp data/trading-bot.sqlite $BACKUP_DIR/weekly/db_$(date +%Y_W%V).sqlite
fi

# 每月备份 Monthly backup (1号 1st day)
if [ $(date +%d) -eq 1 ]; then
  cp data/trading-bot.sqlite $BACKUP_DIR/monthly/db_$(date +%Y_%m).sqlite
fi

# 清理旧备份 Clean old backups
find $BACKUP_DIR/daily -mtime +$KEEP_DAYS -delete
find $BACKUP_DIR/weekly -mtime +90 -delete
find $BACKUP_DIR/monthly -mtime +365 -delete

# 验证备份 Verify backup
sqlite3 $BACKUP_DIR/daily/db_$DATE.sqlite "PRAGMA integrity_check;" > /dev/null
if [ $? -eq 0 ]; then
  echo "✅ Backup successful: $BACKUP_DIR/daily/db_$DATE.sqlite"
else
  echo "❌ Backup failed: integrity check error"
  exit 1
fi
```

#### 2. 配置备份 Configuration Backup

```bash
#!/bin/bash
# scripts/backup-config.sh

BACKUP_DIR="/backup/bsc-bot/config"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份环境配置 Backup environment config
cp .env $BACKUP_DIR/.env_$DATE

# 备份PM2配置 Backup PM2 config
cp ecosystem.config.js $BACKUP_DIR/ecosystem_$DATE.js

# 备份Nginx配置 (如有 if applicable)
# cp /etc/nginx/sites-available/bsc-bot $BACKUP_DIR/nginx_$DATE.conf

# 压缩 Compress
tar -czf $BACKUP_DIR/config_$DATE.tar.gz $BACKUP_DIR/*_$DATE*

echo "✅ Configuration backup: $BACKUP_DIR/config_$DATE.tar.gz"
```

### 恢复流程 Restore Procedures

#### 1. 数据库恢复 Database Restore

```bash
#!/bin/bash
# scripts/restore-database.sh

# 使用方法 Usage: ./restore-database.sh /backup/bsc-bot/daily/db_20241204_020000.sqlite

BACKUP_FILE=$1

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Backup file not found: $BACKUP_FILE"
  exit 1
fi

# 验证备份完整性 Verify backup integrity
sqlite3 $BACKUP_FILE "PRAGMA integrity_check;" > /dev/null
if [ $? -ne 0 ]; then
  echo "❌ Backup file is corrupted"
  exit 1
fi

# 停止服务 Stop service
echo "Stopping service..."
pm2 stop bsc-trading-bot

# 备份当前数据库 Backup current database
echo "Backing up current database..."
cp data/trading-bot.sqlite data/trading-bot_pre-restore_$(date +%Y%m%d_%H%M%S).sqlite

# 恢复数据库 Restore database
echo "Restoring database..."
cp $BACKUP_FILE data/trading-bot.sqlite

# 验证恢复 Verify restore
sqlite3 data/trading-bot.sqlite "SELECT COUNT(*) FROM trades;" > /dev/null
if [ $? -eq 0 ]; then
  echo "✅ Database restored successfully"
else
  echo "❌ Restore failed, rolling back..."
  cp data/trading-bot_pre-restore_*.sqlite data/trading-bot.sqlite
  exit 1
fi

# 重启服务 Restart service
echo "Starting service..."
pm2 start bsc-trading-bot

echo "✅ Restore complete"
```

#### 2. 完整系统恢复 Full System Restore

```bash
#!/bin/bash
# scripts/disaster-recovery.sh

echo "=== Disaster Recovery Procedure ==="

# 1. 停止所有服务 Stop all services
echo "1. Stopping all services..."
pm2 delete all

# 2. 恢复代码 Restore code
echo "2. Restoring code from git..."
git fetch origin
git checkout main
git pull origin main

# 3. 安装依赖 Install dependencies
echo "3. Installing dependencies..."
npm ci

# 4. 恢复配置 Restore configuration
echo "4. Restoring configuration..."
LATEST_CONFIG=$(ls -t /backup/bsc-bot/config/*.tar.gz | head -1)
tar -xzf $LATEST_CONFIG -C .

# 5. 恢复数据库 Restore database
echo "5. Restoring database..."
LATEST_DB=$(ls -t /backup/bsc-bot/daily/*.sqlite | head -1)
cp $LATEST_DB data/trading-bot.sqlite

# 6. 验证数据库 Verify database
echo "6. Verifying database..."
npx knex migrate:latest

# 7. 构建项目 Build project
echo "7. Building project..."
npm run build

# 8. 启动服务 Start services
echo "8. Starting services..."
pm2 start ecosystem.config.js --env production

# 9. 健康检查 Health check
echo "9. Running health check..."
sleep 5
curl http://localhost:10001/api/health

echo "✅ Disaster recovery complete"
```

### 备份验证 Backup Verification

```bash
#!/bin/bash
# scripts/verify-backup.sh

BACKUP_FILE=$1

echo "=== Backup Verification ==="

# 1. 文件完整性 File integrity
echo "1. Checking file integrity..."
sqlite3 $BACKUP_FILE "PRAGMA integrity_check;"

# 2. 数据完整性 Data integrity
echo "2. Checking data integrity..."
TRADE_COUNT=$(sqlite3 $BACKUP_FILE "SELECT COUNT(*) FROM trades;")
echo "Total trades: $TRADE_COUNT"

# 3. 关键表检查 Check critical tables
echo "3. Checking critical tables..."
TABLES=$(sqlite3 $BACKUP_FILE ".tables")
REQUIRED_TABLES="trades users wallets knex_migrations"

for table in $REQUIRED_TABLES; do
  if echo "$TABLES" | grep -q "$table"; then
    echo "✅ Table $table exists"
  else
    echo "❌ Table $table missing"
  fi
done

# 4. 最近数据检查 Check recent data
echo "4. Checking recent data..."
LATEST_TRADE=$(sqlite3 $BACKUP_FILE "SELECT MAX(created_at) FROM trades;")
echo "Latest trade: $LATEST_TRADE"

echo "✅ Backup verification complete"
```

---

## 安全检查 Security Checks

### 生产部署前检查 Pre-Production Security Checklist

使用自动化脚本 (Use automated script):

```bash
#!/bin/bash
# scripts/production-safety-check.sh (已存在 Already exists)

./scripts/production-safety-check.sh
```

手动检查清单 (Manual checklist):

```bash
# 1. 认证配置 Authentication config
grep DISABLE_AUTH .env
# 预期 Expected: DISABLE_AUTH=false 或不存在 or not present

# 2. JWT密钥强度 JWT secret strength
node -e "console.log('Length:', process.env.JWT_SECRET?.length)"
# 预期 Expected: >= 64 characters

# 3. 数据库密码 Database password
grep DB_PASSWORD .env
# 预期 Expected: 强密码 Strong password (16+ chars, mixed case, numbers, symbols)

# 4. 环境变量泄露 Environment variable leaks
git ls-files | xargs grep -l "JWT_SECRET\|DB_PASSWORD"
# 预期 Expected: 无文件包含真实密钥 No files with real secrets

# 5. CORS配置 CORS configuration
grep CORS_ORIGINS .env
# 预期 Expected: 仅生产域名 Production domains only

# 6. 日志级别 Log level
grep LOG_LEVEL .env
# 预期 Expected: warn 或 error (非debug Not debug)

# 7. 防火墙规则 Firewall rules
sudo ufw status
# 预期 Expected: 仅开放必要端口 Only necessary ports open (22, 10001)

# 8. SSL/TLS配置 SSL/TLS config
curl -I https://your-domain.com
# 预期 Expected: HTTPS重定向 HTTPS redirect enabled

# 9. 依赖漏洞 Dependency vulnerabilities
npm audit
# 预期 Expected: 0 high/critical vulnerabilities

# 10. 敏感文件权限 Sensitive file permissions
ls -la .env data/trading-bot.sqlite
# 预期 Expected: 600 或 644 permissions
```

### 定期安全审计 Regular Security Audit

```bash
#!/bin/bash
# scripts/security-audit.sh

echo "=== Security Audit ==="

# 1. 检查未授权访问尝试 Check unauthorized access attempts
echo "1. Unauthorized access attempts (last 24h):"
tail -10000 logs/api-server.log | grep -E "401|403" | wc -l

# 2. 检查异常交易 Check suspicious trades
echo "2. Suspicious trades:"
sqlite3 data/trading-bot.sqlite <<EOF
SELECT COUNT(*) FROM trades
WHERE amount_in > 1000000000000000000000 -- > 1000 BNB
   OR created_at != updated_at;
EOF

# 3. 检查JWT密钥轮换 Check JWT secret rotation
echo "3. JWT secret last changed:"
stat -c %y .env | grep "JWT_SECRET"

# 4. 检查数据库访问 Check database access
echo "4. Database access patterns:"
lsof data/trading-bot.sqlite | awk '{print $1}' | sort | uniq -c

# 5. 检查网络连接 Check network connections
echo "5. Active network connections:"
netstat -an | grep ESTABLISHED | grep 10001 | wc -l

# 6. 生成安全报告 Generate security report
cat > /tmp/security-audit-$(date +%Y%m%d).md <<EOF
# Security Audit Report
Date: $(date)

## Summary
- Unauthorized attempts: $(tail -10000 logs/api-server.log | grep -E "401|403" | wc -l)
- Suspicious trades: [manual review required]
- Active connections: $(netstat -an | grep ESTABLISHED | grep 10001 | wc -l)

## Recommendations
- [ ] Rotate JWT_SECRET if > 90 days old
- [ ] Review firewall rules
- [ ] Update dependencies with vulnerabilities
EOF

echo "✅ Security audit complete: /tmp/security-audit-$(date +%Y%m%d).md"
```

---

## 性能优化 Performance Tuning

### 数据库优化 Database Optimization

#### 1. 索引优化 Index Optimization

```sql
-- 检查现有索引 Check existing indexes
.indexes

-- 查询计划分析 Query plan analysis
EXPLAIN QUERY PLAN
SELECT * FROM trades WHERE wallet_address = '0x...' ORDER BY created_at DESC LIMIT 20;

-- 添加缺失索引 Add missing indexes (如果SCAN出现 if SCAN appears)
CREATE INDEX IF NOT EXISTS idx_trades_wallet_created ON trades(wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_tx_hash ON trades(tx_hash);
```

#### 2. 查询优化 Query Optimization

```bash
# 识别慢查询 Identify slow queries
tail -10000 logs/api-server.log | grep "Query took" | awk '{print $NF}' | sort -n | tail -20

# 优化慢查询示例 Optimize slow query example
# 优化前 Before:
# SELECT * FROM trades WHERE created_at > '2024-01-01' ORDER BY created_at DESC;

# 优化后 After:
# SELECT id, tx_hash, wallet_address, amount_in, amount_out, status, created_at
# FROM trades
# WHERE created_at > '2024-01-01'
# ORDER BY created_at DESC
# LIMIT 100;
```

#### 3. 连接池优化 Connection Pool Optimization

```javascript
// src/persistence/database.ts
// 根据负载调整 Adjust based on load

// 低负载 Low load (< 100 req/min)
pool: { min: 2, max: 5 }

// 中等负载 Medium load (100-500 req/min)
pool: { min: 5, max: 10 }

// 高负载 High load (> 500 req/min)
pool: { min: 10, max: 20 }
```

### 缓存优化 Cache Optimization

#### 1. 价格缓存调优 Price Cache Tuning

```javascript
// src/services/price-cache-service.ts

// 高波动市场 High volatility market
private readonly CACHE_TTL_MS = 15_000; // 15秒 15s

// 稳定市场 Stable market
private readonly CACHE_TTL_MS = 60_000; // 60秒 60s

// 限流调整 Rate limit adjustment
private readonly MAX_REQUESTS_PER_WINDOW = 60; // 从40增加 Increase from 40
```

#### 2. API响应缓存 API Response Cache

```javascript
// src/middleware/cache.ts

// 按端点调整TTL Adjust TTL per endpoint
app.get('/api/v1/tokens', cacheMiddleware(60_000)); // 1分钟 1 min
app.get('/api/v1/pairs', cacheMiddleware(30_000));  // 30秒 30s
app.get('/api/dashboard/overview', cacheMiddleware(10_000)); // 10秒 10s
```

### WebSocket优化 WebSocket Optimization

```javascript
// src/core-server.ts

// 调整心跳间隔 Adjust heartbeat interval
const HEARTBEAT_INTERVAL = 30000; // 默认 Default: 30s

// 高延迟网络 High latency network
const HEARTBEAT_INTERVAL = 60000; // 60秒 60s

// 低延迟网络 Low latency network
const HEARTBEAT_INTERVAL = 15000; // 15秒 15s

// 连接限制 Connection limit
const MAX_CONNECTIONS = 100; // 根据服务器资源调整 Adjust based on server resources
```

---

## 应急响应 Incident Response

### 事件分级 Incident Severity Levels

#### S1 - 严重事件 Critical (15分钟响应 15-min response)

**症状 Symptoms:**
- 服务完全不可用 Service completely down
- 数据丢失或损坏 Data loss or corruption
- 安全漏洞被利用 Security breach exploited

**响应流程 Response:**
```bash
# 1. 立即通知 Immediate notification
echo "CRITICAL: BSC Trading Bot down" | mail -s "S1 Incident" oncall@team.com

# 2. 快速诊断 Quick diagnosis
./scripts/health-check.sh
tail -100 logs/api-server.log | grep ERROR

# 3. 紧急修复 Emergency fix
# 选项A: 回滚到上个版本 Option A: Rollback
git checkout <last-stable-commit>
npm run build
pm2 restart all

# 选项B: 从备份恢复 Option B: Restore from backup
./scripts/restore-database.sh /backup/bsc-bot/daily/db_latest.sqlite

# 4. 验证恢复 Verify recovery
curl http://localhost:10001/api/health

# 5. 根本原因分析 Root cause analysis (事后 Post-incident)
```

#### S2 - 高级事件 High (1小时响应 1-hour response)

**症状 Symptoms:**
- 性能严重下降 Severe performance degradation
- 部分功能不可用 Partial functionality unavailable
- 高错误率 High error rate (> 10%)

**响应流程 Response:**
```bash
# 1. 确认问题范围 Confirm scope
./scripts/health-check.sh
./scripts/performance-analysis.sh

# 2. 隔离问题 Isolate issue
# 如果是WebSocket问题 If WebSocket issue:
grep WEBSOCKET_ENABLED .env
# 临时禁用 Temporarily disable:
# WEBSOCKET_ENABLED=false

# 3. 监控修复效果 Monitor fix effect
watch -n 5 'curl -s http://localhost:10001/api/health | jq .'

# 4. 记录事件 Log incident
./scripts/incident-report.sh S2 "High error rate on /api/trading"
```

#### S3 - 中级事件 Medium (4小时响应 4-hour response)

**症状 Symptoms:**
- 缓存失效 Cache misses
- 慢查询增加 Slow queries increasing
- 非核心功能异常 Non-critical feature issues

**响应流程 Response:**
```bash
# 1. 性能分析 Performance analysis
./scripts/performance-analysis.sh > /tmp/perf-report.txt

# 2. 优化调整 Optimization adjustments
# 数据库优化 Database optimization
sqlite3 data/trading-bot.sqlite "VACUUM; ANALYZE;"

# 缓存调整 Cache adjustment
# 临时增加TTL Temporarily increase TTL

# 3. 监控趋势 Monitor trends
tail -f logs/api-server.log | grep "response_time"
```

#### S4 - 低级事件 Low (24小时响应 24-hour response)

**症状 Symptoms:**
- 告警阈值接近 Alert thresholds approaching
- 磁盘空间告警 Disk space warning
- 非紧急优化需求 Non-urgent optimization needs

**响应流程 Response:**
```bash
# 1. 计划维护窗口 Plan maintenance window
# 2. 准备优化方案 Prepare optimization plan
# 3. 在低峰期执行 Execute during off-peak hours
```

### 事件报告模板 Incident Report Template

```bash
#!/bin/bash
# scripts/incident-report.sh

SEVERITY=$1
DESCRIPTION=$2
DATE=$(date +%Y%m%d_%H%M%S)

cat > reports/incident_${SEVERITY}_${DATE}.md <<EOF
# Incident Report: $SEVERITY

## Summary
- **Date**: $(date)
- **Severity**: $SEVERITY
- **Description**: $DESCRIPTION
- **Reporter**: $(whoami)

## Timeline
- **Detected**: $(date -d "5 minutes ago" +"%Y-%m-%d %H:%M:%S")
- **Responded**: $(date +"%Y-%m-%d %H:%M:%S")
- **Resolved**: [To be updated]

## Impact
- Affected users: [To be determined]
- Duration: [To be calculated]
- Transactions affected: [To be counted]

## Root Cause
[To be investigated]

## Actions Taken
1. [Action 1]
2. [Action 2]

## Prevention
- [ ] Update monitoring alerts
- [ ] Add automated safeguards
- [ ] Document lessons learned

## Follow-up
- [ ] Post-mortem meeting
- [ ] Update runbook
- [ ] Implement preventive measures
EOF

echo "✅ Incident report created: reports/incident_${SEVERITY}_${DATE}.md"
```

### 联系清单 Contact List

```bash
# /etc/bsc-bot/contacts.txt

# Primary On-Call
Name: [Your Name]
Phone: [Phone Number]
Email: [Email]
Hours: 24/7

# Secondary On-Call
Name: [Backup Name]
Phone: [Phone Number]
Email: [Email]
Hours: Business hours

# DevOps Team
Email: devops@team.com
Slack: #bsc-bot-alerts

# External Vendors
BSC Support: support@binance.org
RPC Provider: support@nodereal.io
```

---

## 附录 Appendix

### 关键指标参考值 Key Metrics Reference

| 指标 Metric | 正常值 Normal | 警告值 Warning | 严重值 Critical |
|-------------|---------------|----------------|-----------------|
| API响应时间 Response Time | < 200ms | 200-500ms | > 500ms |
| 交易成功率 Trade Success Rate | > 95% | 90-95% | < 90% |
| 数据库查询P95 DB Query P95 | < 300ms | 300-1000ms | > 1000ms |
| 内存使用 Memory Usage | < 512MB | 512MB-1GB | > 1GB |
| CPU使用 CPU Usage | < 30% | 30-70% | > 70% |
| WebSocket连接 WS Connections | 10-100 | 100-500 | > 500 |
| 缓存命中率 Cache Hit Rate | > 70% | 50-70% | < 50% |
| 错误率 Error Rate | < 1% | 1-5% | > 5% |

### 常用命令速查 Command Quick Reference

```bash
# 服务管理 Service Management
pm2 status                          # 查看状态 Check status
pm2 restart bsc-trading-bot        # 重启 Restart
pm2 logs bsc-trading-bot --lines 100  # 查看日志 View logs
pm2 monit                          # 实时监控 Real-time monitoring

# 数据库 Database
sqlite3 data/trading-bot.sqlite "SELECT COUNT(*) FROM trades;"
sqlite3 data/trading-bot.sqlite "VACUUM; ANALYZE;"
npx knex migrate:latest            # 运行迁移 Run migrations

# 健康检查 Health Checks
curl http://localhost:10001/api/health
./scripts/health-check.sh
./scripts/production-safety-check.sh

# 日志分析 Log Analysis
tail -f logs/api-server.log        # 实时日志 Real-time logs
grep ERROR logs/api-server.log     # 错误日志 Error logs
grep "response_time" logs/api-server.log | awk '{print $NF}' | sort -n  # 响应时间 Response times

# 备份恢复 Backup & Restore
./scripts/backup.sh                # 备份 Backup
./scripts/restore-database.sh <file>  # 恢复 Restore

# 性能分析 Performance
./scripts/performance-analysis.sh
top -p $(pgrep -f "node dist/server.js")
```

### 故障决策树 Troubleshooting Decision Tree

```
服务无响应 Service Not Responding
├─ 进程未运行 Process not running
│  └─ pm2 start ecosystem.config.js --env production
├─ 端口冲突 Port conflict
│  └─ 修改.env中的PORT Change PORT in .env
└─ 数据库锁定 Database locked
   └─ fuser -k data/trading-bot.sqlite

高错误率 High Error Rate
├─ WebSocket断开 WebSocket disconnect
│  └─ 切换RPC节点 Switch RPC node
├─ 数据库慢查询 Slow DB queries
│  └─ 添加索引 Add indexes
└─ 内存不足 Out of memory
   └─ pm2 restart + 增加内存限制 Increase memory limit

交易失败 Trade Failures
├─ Gas价格过低 Gas too low
│  └─ 增加GAS_PRICE_MULTIPLIER Increase multiplier
├─ 滑点过低 Slippage too low
│  └─ 增加DEFAULT_SLIPPAGE Increase slippage
└─ 流动性不足 Insufficient liquidity
   └─ 检查PancakeSwap流动性 Check PancakeSwap liquidity
```

---

**文档版本 Document Version:** 1.0
**最后更新 Last Updated:** 2025-10-04
**维护者 Maintainer:** DevOps Team

**紧急联系 Emergency Contact:** devops@team.com | #bsc-bot-alerts
