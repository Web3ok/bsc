#!/bin/bash

# BSC Trading Bot - Post-Launch Health Check & Daily Report
# Usage: ./scripts/post-launch-health-check.sh [--days=7] [--format=json|html|markdown] [--output=file]

set -e

# Configuration
HOST=${BOT_HOST:-localhost}
API_PORT=${API_PORT:-3010}
MONITOR_PORT=${MONITOR_PORT:-3001}
AUTH_TOKEN=${AUTH_TOKEN:-dev_token_123}
REPORT_DAYS=${REPORT_DAYS:-7}
OUTPUT_FORMAT="markdown"
OUTPUT_FILE=""
OUTPUT_DIR=""
EXIT_ON_ERROR=false

# Health status tracking
HEALTH_STATUS=0  # 0=healthy, 1=warning, 2=critical

# Parse arguments
for arg in "$@"; do
  case $arg in
    --days=*)
      REPORT_DAYS="${arg#*=}"
      shift
      ;;
    --format=*)
      OUTPUT_FORMAT="${arg#*=}"
      shift
      ;;
    --output=*)
      OUTPUT_FILE="${arg#*=}"
      shift
      ;;
    --output-dir=*)
      OUTPUT_DIR="${arg#*=}"
      shift
      ;;
    --exit-on-error)
      EXIT_ON_ERROR=true
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo "Options:"
      echo "  --days=N          Number of days for report (default: 7)"
      echo "  --format=FORMAT   Output format: json|markdown (default: markdown)"
      echo "  --output=FILE     Save to specific file"
      echo "  --output-dir=DIR  Save to directory with auto-generated filename"
      echo "  --exit-on-error   Exit with non-zero code on health issues"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --help for usage)"
      exit 1
      ;;
  esac
done

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
  echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Health status update function
update_health_status() {
  local new_status=$1
  if [[ $new_status -gt $HEALTH_STATUS ]]; then
    HEALTH_STATUS=$new_status
  fi
}

# Validation functions
validate_permissions() {
  local target_dir="$1"
  if [[ ! -w "$target_dir" ]]; then
    log "${RED}Error: No write permission for directory: $target_dir${NC}"
    return 1
  fi
  return 0
}

validate_environment() {
  # Check if we're in production and validate critical settings
  if [[ "$NODE_ENV" == "production" ]]; then
    log "Production environment detected - enabling stricter validation"
    
    # Check for placeholder values that shouldn't be in production
    if [[ "$AUTH_TOKEN" == "dev_token_123" ]]; then
      log "${YELLOW}Warning: Using default development token in production${NC}"
      update_health_status 1
    fi
    
    # Validate host configuration
    if [[ "$HOST" == "localhost" ]]; then
      log "${YELLOW}Warning: Using localhost in production environment${NC}"
    fi
  fi
  
  return 0
}

# Health check functions
check_api_health() {
  local response=$(curl -s -w "%{http_code}" -o /tmp/api_health_response.json "http://$HOST:$API_PORT/health" 2>/dev/null)
  local http_code=$(echo "$response" | tail -n1)
  local response_time=$(curl -s -w "%{time_total}" -o /dev/null "http://$HOST:$API_PORT/health" 2>/dev/null)
  
  if [[ "$http_code" == "200" ]]; then
    local status=$(cat /tmp/api_health_response.json | jq -r '.data.status' 2>/dev/null || echo "unknown")
    local uptime=$(cat /tmp/api_health_response.json | jq -r '.data.uptime' 2>/dev/null || echo "unknown")
    
    # Check response time threshold
    if [[ $(echo "$response_time > 1.0" | bc -l 2>/dev/null) == 1 ]]; then
      update_health_status 1  # Warning for slow response
    fi
    
    echo "✅|$response_time|$uptime|$status"
  else
    update_health_status 2  # Critical for API failure
    echo "❌|$response_time|0|error"
  fi
}

check_monitoring_health() {
  local response=$(curl -s -w "%{http_code}" -o /tmp/monitor_health_response.html "http://$HOST:$MONITOR_PORT/health" 2>/dev/null)
  local http_code=$(echo "$response" | tail -n1)
  local response_time=$(curl -s -w "%{time_total}" -o /dev/null "http://$HOST:$MONITOR_PORT/health" 2>/dev/null)
  
  if [[ "$http_code" == "200" ]]; then
    echo "✅|$response_time|running"
  else
    echo "❌|$response_time|error"
  fi
}

check_websocket_health() {
  # Simple WebSocket connectivity test
  local ws_test=$(timeout 5 bash -c "echo 'test' | websocat ws://$HOST:$API_PORT/ws" 2>/dev/null || echo "failed")
  if [[ "$ws_test" != "failed" ]]; then
    echo "✅|connected"
  else
    echo "❌|disconnected"
  fi
}

get_system_metrics() {
  local response=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "http://$HOST:$API_PORT/api/v1/system/status" 2>/dev/null)
  if [[ $? -eq 0 ]]; then
    local memory_rss=$(echo "$response" | jq -r '.data.memory.rss // 0' 2>/dev/null)
    local memory_heap=$(echo "$response" | jq -r '.data.memory.heapUsed // 0' 2>/dev/null)
    local uptime=$(echo "$response" | jq -r '.data.uptime // 0' 2>/dev/null)
    local pid=$(echo "$response" | jq -r '.data.pid // 0' 2>/dev/null)
    echo "$memory_rss|$memory_heap|$uptime|$pid"
  else
    echo "0|0|0|0"
  fi
}

get_trading_metrics() {
  local response=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "http://$HOST:$API_PORT/api/v1/system/metrics" 2>/dev/null)
  if [[ $? -eq 0 ]]; then
    local trades_24h=$(echo "$response" | jq -r '.data.trades_24h // 0' 2>/dev/null)
    local volume_24h=$(echo "$response" | jq -r '.data.volume_24h // 0' 2>/dev/null)
    local pnl_24h=$(echo "$response" | jq -r '.data.pnl_24h // 0' 2>/dev/null)
    local active_strategies=$(echo "$response" | jq -r '.data.active_strategies // 0' 2>/dev/null)
    echo "$trades_24h|$volume_24h|$pnl_24h|$active_strategies"
  else
    echo "0|0|0|0"
  fi
}

get_risk_metrics() {
  local response=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "http://$HOST:$API_PORT/api/v1/risk/status" 2>/dev/null)
  if [[ $? -eq 0 ]]; then
    local risk_score=$(echo "$response" | jq -r '.data.risk_score // 0' 2>/dev/null)
    local max_drawdown=$(echo "$response" | jq -r '.data.max_drawdown // 0' 2>/dev/null)
    local var_1d=$(echo "$response" | jq -r '.data.var_1d // 0' 2>/dev/null)
    local emergency_stop=$(echo "$response" | jq -r '.data.emergency_stop // false' 2>/dev/null)
    local active_alerts=$(echo "$response" | jq -r '.data.active_alerts // 0' 2>/dev/null)
    echo "$risk_score|$max_drawdown|$var_1d|$emergency_stop|$active_alerts"
  else
    echo "0|0|0|false|0"
  fi
}

check_prometheus_targets() {
  # Query Prometheus for target health
  local prom_query='up{job="bsc-bot"}'
  local response=$(curl -s "http://$HOST:9090/api/v1/query?query=${prom_query}" 2>/dev/null)
  if [[ $? -eq 0 ]]; then
    local result=$(echo "$response" | jq -r '.data.result[0].value[1] // "0"' 2>/dev/null)
    if [[ "$result" == "1" ]]; then
      echo "✅|up"
    else
      echo "❌|down"
    fi
  else
    echo "❓|unknown"
  fi
}

# Report generation functions
generate_markdown_report() {
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  local api_health_result=$(check_api_health)
  local monitor_health_result=$(check_monitoring_health)
  local ws_health_result=$(check_websocket_health)
  local system_metrics_result=$(get_system_metrics)
  local trading_metrics_result=$(get_trading_metrics)
  local risk_metrics_result=$(get_risk_metrics)
  local prometheus_result=$(check_prometheus_targets)
  
  # Parse results
  IFS='|' read -r api_status api_response_time api_uptime api_health <<< "$api_health_result"
  IFS='|' read -r monitor_status monitor_response_time monitor_health <<< "$monitor_health_result"
  IFS='|' read -r ws_status ws_connection <<< "$ws_health_result"
  IFS='|' read -r memory_rss memory_heap uptime pid <<< "$system_metrics_result"
  IFS='|' read -r trades_24h volume_24h pnl_24h active_strategies <<< "$trading_metrics_result"
  IFS='|' read -r risk_score max_drawdown var_1d emergency_stop active_alerts <<< "$risk_metrics_result"
  IFS='|' read -r prom_status prom_health <<< "$prometheus_result"

  cat << EOF
# 📊 BSC Trading Bot - Post-Launch Health Report

**Generated:** $timestamp  
**Report Period:** Last $REPORT_DAYS days  
**Environment:** $(echo $NODE_ENV | tr '[:lower:]' '[:upper:]')

---

## 🏥 System Health Overview

| Service | Status | Response Time | Details |
|---------|--------|---------------|---------|
| API Server (3010) | $api_status | ${api_response_time}s | Uptime: ${api_uptime}s, Health: $api_health |
| Monitor Service (3001) | $monitor_status | ${monitor_response_time}s | Status: $monitor_health |
| WebSocket (3010/ws) | $ws_status | - | Connection: $ws_connection |
| Prometheus Targets | $prom_status | - | Health: $prom_health |

## 🖥️ System Resources

| Metric | Current Value | Status |
|--------|---------------|--------|
| Memory RSS | $(echo "scale=2; $memory_rss/1024/1024" | bc) MB | $([ $memory_rss -lt 1073741824 ] && echo "✅ Normal" || echo "⚠️ High") |
| Memory Heap | $(echo "scale=2; $memory_heap/1024/1024" | bc) MB | $([ $memory_heap -lt 536870912 ] && echo "✅ Normal" || echo "⚠️ High") |
| Process Uptime | $(echo "scale=0; $uptime/3600" | bc)h $(echo "scale=0; ($uptime%3600)/60" | bc)m | ✅ Running |
| Process ID | $pid | - |

## 📈 Trading Performance (24h)

| Metric | Value | Trend |
|--------|-------|-------|
| Total Trades | $trades_24h | $([ $trades_24h -gt 100 ] && echo "📈 Active" || echo "📉 Low") |
| Volume (USD) | \$$(printf "%.2f" $volume_24h) | $([ $(echo "$volume_24h > 10000" | bc) -eq 1 ] && echo "📈 High" || echo "📊 Moderate") |
| P&L (24h) | \$$(printf "%.2f" $pnl_24h) | $([ $(echo "$pnl_24h > 0" | bc) -eq 1 ] && echo "💰 Profitable" || echo "📉 Loss") |
| Active Strategies | $active_strategies | $([ $active_strategies -gt 0 ] && echo "🟢 Running" || echo "🟡 Idle") |

## 🛡️ Risk Management

| Metric | Value | Status |
|--------|-------|--------|
| Risk Score | $(printf "%.1f" $risk_score)/100 | $([ $(echo "$risk_score < 50" | bc) -eq 1 ] && echo "🟢 Low" || [ $(echo "$risk_score < 80" | bc) -eq 1 ] && echo "🟡 Medium" || echo "🔴 High") |
| Max Drawdown | $(printf "%.1f" $max_drawdown)% | $([ $(echo "$max_drawdown > -10" | bc) -eq 1 ] && echo "🟢 Normal" || echo "🟡 Elevated") |
| VaR (1-Day) | \$$(printf "%.2f" $var_1d) | $([ $(echo "$var_1d > -1000" | bc) -eq 1 ] && echo "🟢 Acceptable" || echo "🟡 Monitor") |
| Emergency Stop | $([ "$emergency_stop" == "false" ] && echo "🟢 Normal" || echo "🔴 ACTIVE") | $([ "$emergency_stop" == "false" ] && echo "System operational" || echo "⚠️ System halted") |
| Active Alerts | $active_alerts | $([ $active_alerts -eq 0 ] && echo "🟢 Clear" || echo "⚠️ Attention needed") |

---

## 📋 Daily Checklist Status

- [ ] API endpoints responding (< 300ms) $api_status
- [ ] WebSocket connections stable $ws_status
- [ ] Prometheus targets up $prom_status
- [ ] Trading failure rate < 2%
- [ ] No critical alerts active $([ $active_alerts -eq 0 ] && echo "✅" || echo "❌")
- [ ] Emergency stop inactive $([ "$emergency_stop" == "false" ] && echo "✅" || echo "❌")
- [ ] Memory usage normal $([ $memory_rss -lt 1073741824 ] && echo "✅" || echo "❌")

## 🔧 Recommended Actions

EOF

  # Add conditional recommendations
  if [ $memory_rss -gt 1073741824 ]; then
    echo "- ⚠️ **Memory Usage High**: Consider restarting services or investigating memory leaks"
  fi
  
  if [ "$emergency_stop" == "true" ]; then
    echo "- 🚨 **Emergency Stop Active**: Investigate cause and clear after resolution"
  fi
  
  if [ $active_alerts -gt 0 ]; then
    echo "- ⚠️ **Active Alerts**: Review and resolve $active_alerts pending alerts"
  fi
  
  if [ $(echo "$pnl_24h < -500" | bc) -eq 1 ]; then
    echo "- 📉 **Significant Loss**: Review trading strategies and risk parameters"
  fi
  
  echo ""
  echo "## 📞 Emergency Contacts"
  echo ""
  echo "- **DevOps Team**: [emergency-contact]"
  echo "- **Trading Team**: [trading-team-contact]"
  echo "- **Risk Management**: [risk-team-contact]"
  echo ""
  echo "---"
  echo "*Report generated by BSC Trading Bot Health Check v2.0*"
}

generate_json_report() {
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local api_health_result=$(check_api_health)
  local system_metrics_result=$(get_system_metrics)
  local trading_metrics_result=$(get_trading_metrics)
  local risk_metrics_result=$(get_risk_metrics)
  
  # Parse results
  IFS='|' read -r api_status api_response_time api_uptime api_health <<< "$api_health_result"
  IFS='|' read -r memory_rss memory_heap uptime pid <<< "$system_metrics_result"
  IFS='|' read -r trades_24h volume_24h pnl_24h active_strategies <<< "$trading_metrics_result"
  IFS='|' read -r risk_score max_drawdown var_1d emergency_stop active_alerts <<< "$risk_metrics_result"
  
  cat << EOF
{
  "timestamp": "$timestamp",
  "report_period_days": $REPORT_DAYS,
  "health": {
    "api_server": {
      "status": "$(echo $api_status | tr -d '✅❌')",
      "response_time_seconds": $api_response_time,
      "uptime_seconds": $api_uptime,
      "health_status": "$api_health"
    },
    "overall_status": "$([ "$api_status" == "✅" ] && echo "healthy" || echo "unhealthy")"
  },
  "system_resources": {
    "memory_rss_bytes": $memory_rss,
    "memory_heap_bytes": $memory_heap,
    "uptime_seconds": $uptime,
    "process_id": $pid
  },
  "trading_performance": {
    "trades_24h": $trades_24h,
    "volume_24h_usd": $volume_24h,
    "pnl_24h_usd": $pnl_24h,
    "active_strategies": $active_strategies
  },
  "risk_management": {
    "risk_score": $risk_score,
    "max_drawdown_percent": $max_drawdown,
    "var_1d_usd": $var_1d,
    "emergency_stop": $emergency_stop,
    "active_alerts": $active_alerts
  },
  "recommendations": [
    $([ $memory_rss -gt 1073741824 ] && echo "\"Memory usage high - consider restart\"," || echo "")
    $([ "$emergency_stop" == "true" ] && echo "\"Emergency stop active - investigate\"," || echo "")
    $([ $active_alerts -gt 0 ] && echo "\"Active alerts require attention\"," || echo "")
    "Regular monitoring recommended"
  ]
}
EOF
}

# Main execution
main() {
  log "${BLUE}Starting BSC Trading Bot Post-Launch Health Check${NC}"
  log "Report period: $REPORT_DAYS days"
  log "Output format: $OUTPUT_FORMAT"
  
  # Environment validation
  validate_environment
  
  # Check dependencies
  if ! command -v jq &> /dev/null; then
    log "${YELLOW}Warning: jq not found, JSON parsing may be limited${NC}"
    update_health_status 1
  fi
  
  if ! command -v bc &> /dev/null; then
    log "${YELLOW}Warning: bc not found, calculations may be limited${NC}"
    update_health_status 1
  fi
  
  # Determine output file path
  local final_output_file=""
  if [[ -n "$OUTPUT_FILE" ]]; then
    final_output_file="$OUTPUT_FILE"
  elif [[ -n "$OUTPUT_DIR" ]]; then
    mkdir -p "$OUTPUT_DIR"
    if ! validate_permissions "$OUTPUT_DIR"; then
      log "${RED}Cannot write to output directory: $OUTPUT_DIR${NC}"
      exit 3
    fi
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local extension="md"
    [[ "$OUTPUT_FORMAT" == "json" ]] && extension="json"
    final_output_file="$OUTPUT_DIR/health-report-${timestamp}.${extension}"
  fi
  
  # Generate report
  case "$OUTPUT_FORMAT" in
    "json")
      report_content=$(generate_json_report)
      ;;
    "markdown"|*)
      report_content=$(generate_markdown_report)
      ;;
  esac
  
  # Output report
  if [[ -n "$final_output_file" ]]; then
    echo "$report_content" > "$final_output_file"
    if [[ $? -eq 0 ]]; then
      log "${GREEN}Report saved to: $final_output_file${NC}"
    else
      log "${RED}Failed to save report to: $final_output_file${NC}"
      update_health_status 2
    fi
  else
    echo "$report_content"
  fi
  
  # Final health status reporting
  case $HEALTH_STATUS in
    0)
      log "${GREEN}Health check completed successfully - System is healthy${NC}"
      ;;
    1)
      log "${YELLOW}Health check completed with warnings - Some issues detected${NC}"
      ;;
    2)
      log "${RED}Health check completed with errors - Critical issues detected${NC}"
      ;;
  esac
  
  # Exit with appropriate code
  if [[ "$EXIT_ON_ERROR" == "true" ]]; then
    exit $HEALTH_STATUS
  else
    exit 0
  fi
}

# Run main function
main "$@"