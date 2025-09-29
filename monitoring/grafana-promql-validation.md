# Grafana Dashboard PromQL Validation Checklist

## 🎯 Overview

This document provides a comprehensive validation checklist for all PromQL queries used in the BSC Trading Bot Grafana dashboards to ensure data accuracy and visualization quality.

## 📊 System Overview Dashboard

### Panel 1: System Status
```promql
# Query: up{job="bsc-bot"}
# Expected: 1 (system up) or 0 (system down)
# Validation:
✅ Label selector matches Prometheus job name
✅ Returns binary value (0/1)
✅ Updates within scrape interval (30s)

# Test:
curl http://localhost:9090/api/v1/query?query=up{job="bsc-bot"}
```

### Panel 2: WebSocket Connection Status
```promql
# Query: websocket_connected{job="bsc-bot"}
# Expected: 1 (connected) or 0 (disconnected)
# Validation:
✅ Metric exists in /metrics endpoint
✅ Updates on WebSocket state change
✅ Properly labeled with job

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep websocket_connected
```

### Panel 3: Database Connection Status
```promql
# Query: database_connected{job="bsc-bot"}
# Expected: 1 (connected) or 0 (disconnected)
# Validation:
✅ Metric exposed by monitoring service
✅ Reflects actual DB connection state
✅ Handles connection failures

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep database_connected
```

### Panel 4: Active Strategies
```promql
# Query: strategies_active_total{job="bsc-bot"}
# Expected: Number of active strategies
# Validation:
✅ Counter metric type
✅ Increases when strategies start
✅ Updates in real-time

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep strategies_active_total
```

### Panel 5: System Resources
```promql
# Memory Usage
# Query: process_resident_memory_bytes{job="bsc-bot"}
# Expected: Memory usage in bytes
# Validation:
✅ Standard process metric
✅ Increases with system load
✅ Reasonable values (< 2GB typically)

# CPU Usage Rate
# Query: rate(process_cpu_seconds_total{job="bsc-bot"}[5m]) * 100
# Expected: CPU percentage (0-100+)
# Validation:
✅ Rate calculation over 5-minute window
✅ Multiplied by 100 for percentage
✅ Handles multi-core systems

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep process_
```

### Panel 6: Event Processing Rate
```promql
# Events per Second
# Query: rate(events_processed_total{job="bsc-bot"}[5m])
# Expected: Events/second rate
# Validation:
✅ Rate function calculates per-second
✅ 5-minute window smooths spikes
✅ Non-negative values

# API Requests per Second
# Query: rate(api_requests_total{job="bsc-bot"}[5m])
# Expected: API requests/second
# Validation:
✅ Includes all API endpoints
✅ Labeled by method/status if needed
✅ Correlates with system load

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep -E "(events_processed|api_requests)_total"
```

## 📈 Trading Performance Dashboard

### Panel 1: Total Realized P&L
```promql
# Query: sum(strategy_realized_pnl_usd{job="bsc-bot"})
# Expected: Sum of all strategy P&L in USD
# Validation:
✅ Sum aggregates across all strategies
✅ USD denomination consistent
✅ Updates after trade completion

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep strategy_realized_pnl_usd
```

### Panel 2: Average Win Rate
```promql
# Query: avg(strategy_win_rate{job="bsc-bot"}) * 100
# Expected: Average win rate as percentage
# Validation:
✅ Average across active strategies
✅ Multiplied by 100 for percentage display
✅ Range 0-100%

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep strategy_win_rate
```

### Panel 3: Total Trades
```promql
# Query: sum(strategy_total_trades{job="bsc-bot"})
# Expected: Total number of trades executed
# Validation:
✅ Counter metric type
✅ Monotonically increasing
✅ Sums across all strategies

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep strategy_total_trades
```

### Panel 4: Maximum Drawdown
```promql
# Query: min(strategy_max_drawdown_percent{job="bsc-bot"})
# Expected: Worst drawdown percentage (negative)
# Validation:
✅ Minimum function finds worst case
✅ Negative values expected
✅ Percentage format

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep strategy_max_drawdown_percent
```

### Panel 5: Strategy P&L Over Time
```promql
# Realized P&L
# Query: strategy_realized_pnl_usd{job="bsc-bot"}
# Expected: Time series by strategy_id
# Validation:
✅ Labeled by strategy_id
✅ USD denomination
✅ Historical data preserved

# Unrealized P&L
# Query: strategy_unrealized_pnl_usd{job="bsc-bot"}
# Expected: Current unrealized P&L
# Validation:
✅ Updates with price changes
✅ Can be positive or negative
✅ Resets when position closed

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep strategy_.*_pnl_usd
```

### Panel 6: Trade Execution Success Rate
```promql
# Success Rate
# Query: rate(orders_filled_total{job="bsc-bot"}[5m]) / rate(orders_total{job="bsc-bot"}[5m]) * 100
# Expected: Success percentage
# Validation:
✅ Division handles zero denominator
✅ Rate functions over same interval
✅ Percentage conversion

# Failure Rate  
# Query: rate(orders_failed_total{job="bsc-bot"}[5m]) / rate(orders_total{job="bsc-bot"}[5m]) * 100
# Expected: Failure percentage
# Validation:
✅ Complementary to success rate
✅ Should sum to ~100% with partial fills

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep orders_.*_total
```

## 🛡️ Risk Management Dashboard

### Panel 1: Portfolio Risk Score
```promql
# Query: portfolio_risk_score{job="bsc-bot"}
# Expected: Risk score 0-100
# Validation:
✅ Gauge metric type
✅ Range 0-100
✅ Updates with position changes

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep portfolio_risk_score
```

### Panel 2: Value at Risk (VaR)
```promql
# Query: portfolio_var_1d{job="bsc-bot"}
# Expected: 1-day VaR in USD (typically negative)
# Validation:
✅ USD denomination
✅ Negative values (potential loss)
✅ Updates with portfolio changes

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep portfolio_var_1d
```

### Panel 3: Active Risk Alerts
```promql
# Query: sum(risk_alerts_active{job="bsc-bot"})
# Expected: Number of active alerts
# Validation:
✅ Sum across all alert types
✅ Non-negative integer
✅ Decreases when alerts resolved

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep risk_alerts_active
```

### Panel 4: Emergency Stop Status
```promql
# Query: emergency_stop_active{job="bsc-bot"}
# Expected: 0 (normal) or 1 (emergency stop)
# Validation:
✅ Binary value
✅ Triggers system-wide halt
✅ Manual override capability

# Test:
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep emergency_stop_active
```

## 🔍 Validation Commands

### Comprehensive Metric Check
```bash
#!/bin/bash

# Check all metrics are available
METRICS_URL="http://localhost:3001/metrics"
AUTH_HEADER="Authorization: Bearer <your-token>"

echo "=== System Metrics ==="
curl -s -H "$AUTH_HEADER" $METRICS_URL | grep -E "(up|websocket_connected|database_connected|strategies_active_total)"

echo -e "\n=== Trading Metrics ==="
curl -s -H "$AUTH_HEADER" $METRICS_URL | grep -E "(strategy_.*_pnl|strategy_win_rate|strategy_total_trades|orders_.*_total)"

echo -e "\n=== Risk Metrics ==="
curl -s -H "$AUTH_HEADER" $METRICS_URL | grep -E "(portfolio_.*|risk_alerts|emergency_stop)"

echo -e "\n=== Performance Metrics ==="
curl -s -H "$AUTH_HEADER" $METRICS_URL | grep -E "(process_.*|events_processed|api_requests)"
```

### PromQL Query Testing
```bash
#!/bin/bash

# Test PromQL queries directly
PROMETHEUS_URL="http://localhost:9090/api/v1/query"

# System health queries
curl -s "$PROMETHEUS_URL?query=up{job=\"bsc-bot\"}" | jq '.data.result[0].value[1]'

# Trading performance queries
curl -s "$PROMETHEUS_URL?query=sum(strategy_realized_pnl_usd{job=\"bsc-bot\"})" | jq '.data.result[0].value[1]'

# Risk management queries
curl -s "$PROMETHEUS_URL?query=portfolio_risk_score{job=\"bsc-bot\"}" | jq '.data.result[0].value[1]'
```

## ⚠️ Common Issues & Fixes

### Missing Metrics
**Problem**: Dashboard shows "No data"
**Check**: 
```bash
curl -H "Authorization: Bearer <token>" http://localhost:3001/metrics | grep <metric_name>
```
**Fix**: Ensure metric is exposed in monitoring service

### Wrong Time Range
**Problem**: Rate functions showing zero
**Check**: Time range in query matches data availability
**Fix**: Adjust rate() window or dashboard time range

### Label Mismatch
**Problem**: Queries return no results
**Check**: Label values match exactly
**Fix**: Update job name or labels in query

### Aggregation Issues
**Problem**: sum() or avg() functions show unexpected values
**Check**: Grouping labels and metric cardinality
**Fix**: Add `by (label)` or adjust aggregation function

## 📋 Validation Checklist

Before dashboard deployment:

- [ ] All PromQL queries syntax validated
- [ ] Metrics exist in /metrics endpoint
- [ ] Data types match expectations (gauge/counter)
- [ ] Time ranges appropriate for data frequency
- [ ] Labels match between query and metrics
- [ ] Aggregation functions work correctly
- [ ] Units and scaling factors correct
- [ ] Thresholds and alerts properly configured
- [ ] Dashboard loads without errors
- [ ] Real-time updates working

## 🔧 Debugging Tools

### Prometheus Query Browser
Access: `http://localhost:9090/graph`
- Test queries interactively
- View metric metadata
- Check label values

### Metrics Endpoint
Access: `http://localhost:3001/metrics` (with auth)
- View raw metric data
- Verify metric names and labels
- Check data freshness

### Dashboard JSON Validation
```bash
# Validate dashboard JSON syntax
cat monitoring/grafana-dashboard-*.json | jq '.'

# Extract all PromQL queries
cat monitoring/grafana-dashboard-*.json | jq -r '.. | .expr? // empty' | sort -u
```

This validation checklist ensures all Grafana dashboards display accurate, real-time data from the BSC Trading Bot system.