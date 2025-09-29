# BSC Market Maker Bot - 运维手册 (Runbook)

## 🎯 概述

本运维手册提供BSC做市机器人的日常运维、应急处理、灰度发布和备份恢复的标准操作程序。涵盖监控、策略、资金管理三大系统的完整运维流程。

## 🚨 紧急情况处理

### 1. 紧急全面停机 (Emergency Shutdown)

**触发条件**:
- 检测到异常大额交易或资金流失
- 市场极端波动（如闪崩、异常价格）
- 系统安全漏洞或攻击迹象
- 合规或监管要求

**操作步骤**:
```bash
# 1. 立即停止所有交易活动
npx bsc-bot emergency stop-all --reason "EMERGENCY_SHUTDOWN"

# 2. 停止策略管理器（优先级最高）
npx bsc-bot strategy list
npx bsc-bot strategy stop <strategy-id>  # 对所有活跃策略

# 3. 停止资金管理服务
npx bsc-bot funds status
npx bsc-bot bot stop  # 完全停止

# 4. 记录当前状态
npx bsc-bot bot status --json > emergency_state_$(date +%Y%m%d_%H%M%S).json
npx bsc-bot funds balances --export json > emergency_balances_$(date +%Y%m%d_%H%M%S).json

# 5. 通知相关人员
echo "EMERGENCY STOP executed at $(date)" | mail -s "BSC Bot Emergency Stop" ops-team@company.com
```

**验证清单**:
- [ ] 所有策略状态为 'stopped'
- [ ] 没有pending交易订单
- [ ] 资金管理服务已停止
- [ ] 余额快照已保存
- [ ] 通知已发送

### 2. 策略紧急暂停 (Strategy Emergency Pause)

**触发条件**:
- 单个策略异常亏损超过阈值
- 策略执行错误率超过10%
- 价格异常导致错误交易

**操作步骤**:
```bash
# 1. 识别问题策略
npx bsc-bot strategy list --status active
npx bsc-bot strategy status <strategy-id>

# 2. 暂停问题策略
npx bsc-bot strategy pause <strategy-id>

# 3. 分析策略状态
npx bsc-bot strategy status <strategy-id> --json > strategy_analysis_$(date +%Y%m%d_%H%M%S).json

# 4. 检查相关订单
npx bsc-bot strategy conditional list --strategy-id <strategy-id>

# 5. 如果需要，取消待执行订单
npx bsc-bot strategy conditional cancel <order-id>
```

### 3. 资金管理紧急冻结 (Funds Emergency Freeze)

**触发条件**:
- 异常资金流动
- Gas费用异常消耗
- 疑似账户安全问题

**操作步骤**:
```bash
# 1. 检查当前资金状态
npx bsc-bot funds status --json > funds_emergency_$(date +%Y%m%d_%H%M%S).json

# 2. 停止所有自动化资金操作
# 修改配置或重启时使用 --no-funds
npx bsc-bot bot start --no-funds

# 3. 检查所有pending操作
npx bsc-bot funds gas history --limit 50
npx bsc-bot funds sweep history --limit 50

# 4. 如果需要，手动取消pending任务
# 注意：这需要数据库直接操作
```

## 🔄 灰度发布流程 (Canary Deployment)

### 1. 新策略灰度发布

**阶段1: 测试环境验证**
```bash
# 1. 在测试环境部署
npx bsc-bot strategy create -t grid -s BTC/USDT -n "Canary Grid V2" \
  -m paper -p '{"grid_count":5,"base_order_size":"10"}'

# 2. 运行小规模回测
npx bsc-bot backtest quick-grid -s BTC/USDT --days 7 --grid-count 5

# 3. 分析回测结果
npx bsc-bot backtest show <backtest-id>
```

**阶段2: 小规模实盘**
```bash
# 1. 创建金丝雀策略（小仓位）
npx bsc-bot strategy create -t grid -s BTC/USDT -n "Canary Grid V2 Live" \
  -m live -p '{"grid_count":3,"base_order_size":"5","upper_price":"102000","lower_price":"98000"}'

# 2. 设置严格风控
# 配置小额限制和短期监控

# 3. 监控关键指标（1-2小时）
watch -n 30 'npx bsc-bot strategy status <canary-strategy-id>'

# 4. 检查交易质量
npx bsc-bot strategy status <canary-strategy-id> | grep -E "(PnL|trades|win_rate)"
```

**阶段3: 逐步扩容**
```bash
# 如果金丝雀策略表现良好，逐步增加仓位
npx bsc-bot strategy pause <canary-strategy-id>
# 修改参数增加base_order_size
npx bsc-bot strategy resume <canary-strategy-id>
```

### 2. 系统版本灰度发布

**部署前检查**:
```bash
# 1. 备份当前配置
cp -r /opt/bsc-bot/config /opt/bsc-bot/config.backup.$(date +%Y%m%d_%H%M%S)

# 2. 数据库备份
pg_dump bsc_bot > db_backup_$(date +%Y%m%d_%H%M%S).sql

# 3. 检查系统状态
npx bsc-bot bot status --json > pre_deploy_status.json
```

**灰度部署**:
```bash
# 1. 部署到预备环境
git checkout <new-version>
npm install
npm run build

# 2. 运行数据库迁移（如有）
npx knex migrate:latest

# 3. 启动时先禁用高风险功能
npx bsc-bot bot start --no-strategies --no-funds

# 4. 验证基础服务正常
npx bsc-bot bot health

# 5. 逐步启用功能
npx bsc-bot bot stop
npx bsc-bot bot start --no-funds  # 启用策略
# 观察30分钟后再启用资金管理
npx bsc-bot bot start  # 全功能启用
```

## 📤 回滚流程 (Rollback Procedures)

### 1. 应用代码回滚

**快速回滚**:
```bash
# 1. 停止当前服务
npx bsc-bot bot stop

# 2. 回滚代码
git checkout <previous-stable-version>
npm install
npm run build

# 3. 回滚数据库（如需要）
psql bsc_bot < db_backup_<timestamp>.sql

# 4. 恢复配置
cp -r /opt/bsc-bot/config.backup.<timestamp>/* /opt/bsc-bot/config/

# 5. 重启服务
npx bsc-bot bot start

# 6. 验证服务状态
npx bsc-bot bot status
npx bsc-bot bot health
```

### 2. 数据回滚

**策略数据回滚**:
```bash
# 1. 停止相关策略
npx bsc-bot strategy stop <strategy-id>

# 2. 从备份恢复策略配置
# 注意：需要手动SQL操作，谨慎执行
```

**资金管理数据回滚**:
```bash
# 1. 停止资金管理服务
npx bsc-bot bot start --no-funds

# 2. 检查资金状态一致性
npx bsc-bot funds balances --export json
# 对比备份数据，确保资金安全
```

## 🔄 备份与恢复 (Backup & Recovery)

### 1. 日常备份策略

**自动化备份脚本** (`scripts/backup.sh`):
```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/bsc-bot"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份目录
mkdir -p $BACKUP_DIR/$DATE

# 1. 数据库备份
pg_dump bsc_bot | gzip > $BACKUP_DIR/$DATE/database.sql.gz

# 2. 配置备份
tar -czf $BACKUP_DIR/$DATE/config.tar.gz /opt/bsc-bot/config

# 3. 日志备份
tar -czf $BACKUP_DIR/$DATE/logs.tar.gz /opt/bsc-bot/logs

# 4. 系统状态快照
npx bsc-bot bot status --json > $BACKUP_DIR/$DATE/system_status.json
npx bsc-bot funds status --json > $BACKUP_DIR/$DATE/funds_status.json

# 5. 清理7天前的备份
find $BACKUP_DIR -type d -mtime +7 -exec rm -rf {} \;

echo "Backup completed: $BACKUP_DIR/$DATE"
```

**定时任务设置**:
```bash
# 添加到crontab
0 2 * * * /opt/bsc-bot/scripts/backup.sh >> /opt/bsc-bot/logs/backup.log 2>&1
```

### 2. 灾难恢复流程

**完全系统恢复**:
```bash
# 1. 恢复数据库
gunzip -c database.sql.gz | psql bsc_bot

# 2. 恢复配置
tar -xzf config.tar.gz -C /

# 3. 验证数据完整性
npx bsc-bot bot health

# 4. 逐步启动服务
npx bsc-bot bot start --monitoring-only
npx bsc-bot bot start --market-only
npx bsc-bot bot start --no-funds
npx bsc-bot bot start
```

## 📊 监控与告警 (Monitoring & Alerting)

### 1. 关键指标监控

**系统健康指标**:
- CPU使用率 < 80%
- 内存使用率 < 85%
- 磁盘使用率 < 90%
- 网络延迟 < 100ms

**业务指标监控**:
- 策略执行成功率 > 95%
- 订单执行延迟 < 5秒
- 资金管理操作成功率 > 98%
- WebSocket连接稳定性 > 99%

**资金安全指标**:
- 单日总交易量不超过设定阈值
- Gas消耗异常检测
- 余额异常变动告警
- 异常大额转账告警

### 2. 告警规则配置

**关键告警** (P1 - 立即响应):
```yaml
alerts:
  - alert: BotSystemDown
    expr: up{job="bsc-bot"} == 0
    for: 1m
    
  - alert: StrategyLossExceeded
    expr: strategy_daily_loss > 1000
    for: 5m
    
  - alert: FundsAbnormalMovement
    expr: funds_hourly_outflow > 10000
    for: 2m
```

**警告告警** (P2 - 30分钟内响应):
```yaml
alerts:
  - alert: HighErrorRate
    expr: error_rate > 0.05
    for: 10m
    
  - alert: LowGasBalance
    expr: gas_balance < 0.02
    for: 15m
```

### 3. 告警响应流程

**P1告警响应**:
1. 立即检查系统状态
2. 如必要执行紧急停机
3. 通知技术负责人
4. 开始问题排查

**P2告警响应**:
1. 记录告警信息
2. 分析趋势和根因
3. 计划维护时间
4. 更新监控阈值

## 🔐 安全运维 (Security Operations)

### 1. 访问控制

**端点保护**:
```bash
# 为监控端点添加基础认证
# 在nginx/apache配置中:
location /metrics {
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;
}

location /health {
    allow 10.0.0.0/8;
    deny all;
}
```

**API限流配置**:
```javascript
// 在API层添加限流
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100 // 最多100个请求
});

app.use('/api', limiter);
```

### 2. 密钥管理

**私钥轮换**:
```bash
# 1. 生成新私钥
npx bsc-bot wallet generate

# 2. 资金迁移到新地址
npx bsc-bot funds sweep execute -w <old-address> -t <new-address> -a BNB

# 3. 更新配置
# 修改环境变量中的TREASURY_PRIVATE_KEY

# 4. 重启服务
npx bsc-bot bot stop
npx bsc-bot bot start
```

### 3. 审计日志

**日志分析**:
```bash
# 检查异常交易
grep -E "(ERROR|WARN)" /opt/bsc-bot/logs/app.log | grep -i "transaction"

# 分析资金流动
grep "funds" /opt/bsc-bot/logs/app.log | grep -E "(sweep|drip|rebalance)"

# 监控访问模式
tail -f /var/log/nginx/access.log | grep "/api\|/metrics\|/health"
```

## 📋 日常维护清单

### 每日检查 (Daily Checklist)
- [ ] 检查系统整体状态 `npx bsc-bot bot status`
- [ ] 检查策略运行情况 `npx bsc-bot strategy list`
- [ ] 检查资金管理状态 `npx bsc-bot funds status`
- [ ] 查看告警日志
- [ ] 检查备份完成情况
- [ ] 查看关键指标趋势

### 每周检查 (Weekly Checklist)
- [ ] 分析策略性能表现
- [ ] 检查资金利用效率
- [ ] 更新监控阈值
- [ ] 清理过期日志和备份
- [ ] 检查系统资源使用趋势
- [ ] 更新文档和流程

### 每月检查 (Monthly Checklist)
- [ ] 全面系统性能评估
- [ ] 安全漏洞扫描
- [ ] 密钥轮换计划
- [ ] 灾难恢复演练
- [ ] 合规报告生成
- [ ] 系统优化和升级规划

## 📞 联系信息

**紧急联系人**:
- 技术负责人: [姓名] - [电话] - [邮箱]
- 运维负责人: [姓名] - [电话] - [邮箱]
- 风控负责人: [姓名] - [电话] - [邮箱]

**升级路径**:
P1告警: 技术负责人 → CTO → CEO
P2告警: 运维团队 → 技术负责人

**相关文档**:
- 系统架构文档: `ARCHITECTURE.md`
- 资金管理系统文档: `FUNDS_MANAGEMENT_COMPLETE.md`
- API文档: `docs/API.md`
- 监控仪表板: Grafana Dashboard ID: `bsc-bot-overview`

---

**文档版本**: v1.0
**最后更新**: 2024年
**维护人员**: DevOps团队