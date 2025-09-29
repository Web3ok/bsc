# 🚀 BSC Trading Bot - Operations Quick Reference

## 📊 **上线后健康监控系统已就绪**

### 🏥 **自动化健康检查**

```bash
# 立即生成健康报告
./scripts/post-launch-health-check.sh --days=7 --format=markdown

# JSON格式输出（用于监控系统集成）
./scripts/post-launch-health-check.sh --days=1 --format=json

# 保存报告到文件
./scripts/post-launch-health-check.sh --days=1 --format=markdown --output=reports/health-$(date +%Y%m%d).md
```

### ⏰ **自动化调度设置**

```bash
# 一键设置完整监控系统
./scripts/setup-health-monitoring.sh

# 包含以下自动化任务：
# • 每日 9:00 AM 健康报告 (Markdown)
# • 每小时健康检查 (JSON)
# • 每周日 10:00 AM 综合报告
# • 日志轮转配置
# • 告警通知系统
```

---

## 🔧 **日常运维命令**

### **服务状态检查**
```bash
# API服务器健康
curl http://localhost:3010/health

# 系统状态 (需认证)
curl -H "Authorization: Bearer dev_token_123" http://localhost:3010/api/v1/system/status

# 市场数据API
curl -H "Authorization: Bearer dev_token_123" http://localhost:3010/api/v1/market/pairs

# 风险管理状态
curl -H "Authorization: Bearer dev_token_123" http://localhost:3010/api/v1/risk/status
```

### **服务管理**
```bash
# PM2 管理
pm2 status                    # 查看服务状态
pm2 logs                      # 查看实时日志
pm2 restart all              # 重启所有服务
pm2 reload ecosystem.config.js --env production

# systemd 管理
systemctl status bsc-bot-api        # API服务状态
systemctl restart bsc-bot-api       # 重启API服务
journalctl -u bsc-bot-api -f        # 实时日志
```

---

## 📈 **监控指标概览**

### **关键健康指标**

| 指标类别 | 关键指标 | 正常范围 | 告警阈值 |
|----------|----------|----------|----------|
| **系统资源** | Memory RSS | < 1GB | > 1.5GB |
| | Response Time | < 300ms | > 1s |
| | Process Uptime | > 1h | 重启频繁 |
| **交易性能** | Success Rate | > 98% | < 95% |
| | Volume 24h | 正常波动 | 异常下降 |
| | P&L Trend | 根据策略 | 超出止损 |
| **风险管理** | Risk Score | < 50 | > 80 |
| | Active Alerts | 0 | > 5 |
| | Emergency Stop | false | true |

### **实时监控面板**

```bash
# HTML监控面板 (自动设置后可用)
open monitoring/health-dashboard.html

# 命令行监控 (实时)
watch -n 30 './scripts/post-launch-health-check.sh --days=1'
```

---

## 🚨 **应急响应流程**

### **Critical 告警处理**

1. **API服务宕机**
   ```bash
   # 检查进程状态
   pm2 status || systemctl status bsc-bot-api
   
   # 重启服务
   pm2 restart all || systemctl restart bsc-bot-api
   
   # 查看错误日志
   pm2 logs --err || journalctl -u bsc-bot-api --since "5 minutes ago"
   ```

2. **内存使用过高**
   ```bash
   # 检查内存使用
   ./scripts/post-launch-health-check.sh | grep "Memory RSS"
   
   # 重启服务释放内存
   pm2 reload ecosystem.config.js --env production
   ```

3. **交易执行异常**
   ```bash
   # 检查风险管理状态
   curl -H "Authorization: Bearer dev_token_123" http://localhost:3010/api/v1/risk/status
   
   # 如需要，激活紧急停机
   curl -X POST -H "Authorization: Bearer dev_token_123" http://localhost:3010/api/v1/risk/emergency-stop
   ```

### **常见故障排查**

| 问题症状 | 可能原因 | 解决方案 |
|----------|----------|----------|
| API 503错误 | 服务未启动/崩溃 | 重启服务，检查日志 |
| 认证失败 | Token过期/错误 | 检查 .env 中的 AUTH_TOKEN |
| WebSocket断连 | 网络问题/服务重启 | 检查防火墙，重启服务 |
| 交易延迟高 | RPC问题/网络拥堵 | 切换备用RPC，检查网络 |
| 内存泄漏 | 代码bug/数据积累 | 重启服务，监控趋势 |

---

## 📊 **报告与分析**

### **自动生成的报告**

```bash
# 报告存储位置
reports/daily/          # 每日健康报告
logs/health-reports/    # 小时级健康数据
logs/health-alerts.log  # 告警历史记录

# 查看最新报告
ls -la reports/daily/ | head -5
cat reports/daily/daily-health-$(date +%Y%m%d).md

# 分析历史趋势
grep "Memory RSS" logs/health-reports/*.json | tail -24  # 24小时内存趋势
```

### **自定义分析查询**

```bash
# 获取系统指标历史
find logs/health-reports/ -name "*.json" -mtime -7 | xargs jq '.system_resources'

# 分析交易性能趋势
find logs/health-reports/ -name "*.json" -mtime -1 | xargs jq '.trading_performance'

# 风险事件统计
grep "risk_score" logs/health-reports/*.json | awk -F'"' '{print $4}' | sort -n
```

---

## 📞 **联系方式与升级路径**

### **告警通知配置**

```bash
# Telegram通知 (推荐)
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="your-chat-id"

# Slack通知
export SLACK_WEBHOOK_URL="your-webhook-url"

# 测试通知
./scripts/health-alert-notification.sh "TEST" "System notification test"
```

### **扩展监控**

```bash
# 启用实时监控服务 (可选)
sudo systemctl start bsc-bot-health-monitor

# 查看实时监控日志
tail -f logs/health-reports/realtime-health.json

# 集成外部监控系统 (Grafana/Prometheus)
# JSON格式输出可直接接入监控数据管道
```

---

## 🎯 **优化建议**

### **短期优化 (1周内)**
- [ ] 配置生产域名 CORS 白名单
- [ ] 设置 JWT Token 定期轮换
- [ ] 配置 Telegram/Slack 告警
- [ ] 验证备份策略执行

### **中期优化 (1月内)**
- [ ] 实施金丝雀发布流程
- [ ] 配置多环境监控
- [ ] 建立性能基准测试
- [ ] 完善灾难恢复计划

### **长期优化**
- [ ] 机器学习异常检测
- [ ] 智能告警降噪
- [ ] 预测性维护
- [ ] 容量规划自动化

---

## 📚 **相关文档**

- `PRODUCTION_QUICK_START.md` - 生产部署指南
- `monitoring/grafana-promql-validation.md` - Grafana监控校验
- `scripts/production_drill.sh` - 生产演练脚本
- `ecosystem.config.js` - PM2集群配置

---

**🎉 系统已完成企业级运维配置，准备支撑大规模生产流量！**

*最后更新：2025-09-26 | BSC Trading Bot Operations Team*