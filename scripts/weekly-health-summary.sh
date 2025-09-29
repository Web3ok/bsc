#!/bin/bash

# BSC Trading Bot - Weekly Health Summary Generator
# Automatically aggregates key metrics and generates weekly reports for operations review
# Usage: ./scripts/weekly-health-summary.sh [--weeks=1] [--format=markdown|json] [--output=file]

set -e

# Configuration
REPORT_WEEKS=${REPORT_WEEKS:-1}
OUTPUT_FORMAT="markdown"
OUTPUT_FILE=""
LOG_DIR="logs/health-reports"
REPORT_DIR="reports/weekly"

# Parse arguments
for arg in "$@"; do
  case $arg in
    --weeks=*)
      REPORT_WEEKS="${arg#*=}"
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
    --help)
      echo "Usage: $0 [--weeks=1] [--format=markdown|json] [--output=file]"
      echo "Generates weekly health summary from accumulated health check data"
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
NC='\033[0m'

# Logging
log() {
  echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Ensure directories exist
mkdir -p "$REPORT_DIR"

# Data aggregation functions
aggregate_system_metrics() {
  local start_date=$(date -d "$REPORT_WEEKS weeks ago" +%Y%m%d)
  local end_date=$(date +%Y%m%d)
  
  log "Aggregating system metrics from $start_date to $end_date..."
  
  # Find all health report files in the date range
  local health_files=()
  for day in $(seq 0 $((REPORT_WEEKS * 7 - 1))); do
    local check_date=$(date -d "$day days ago" +%Y%m%d)
    if [[ "$check_date" -ge "$start_date" ]]; then
      health_files+=($(find "$LOG_DIR" -name "hourly-health-${check_date}-*.json" 2>/dev/null))
    fi
  done
  
  if [[ ${#health_files[@]} -eq 0 ]]; then
    echo "0|0|0|0|0|0|0"  # No data available
    return
  fi
  
  # Calculate aggregated metrics using jq
  local total_files=${#health_files[@]}
  local avg_response_time=$(printf '%s\n' "${health_files[@]}" | xargs cat 2>/dev/null | jq -r '.health.api_server.response_time_seconds // 0' | awk '{sum+=$1} END {printf "%.3f", sum/NR}')
  local avg_memory_mb=$(printf '%s\n' "${health_files[@]}" | xargs cat 2>/dev/null | jq -r '.system_resources.memory_rss_bytes // 0' | awk '{sum+=$1/1024/1024} END {printf "%.1f", sum/NR}')
  local max_memory_mb=$(printf '%s\n' "${health_files[@]}" | xargs cat 2>/dev/null | jq -r '.system_resources.memory_rss_bytes // 0' | awk 'BEGIN{max=0} {if($1/1024/1024>max) max=$1/1024/1024} END {printf "%.1f", max}')
  local total_trades=$(printf '%s\n' "${health_files[@]}" | xargs cat 2>/dev/null | jq -r '.trading_performance.trades_24h // 0' | awk '{sum+=$1} END {printf "%.0f", sum}')
  local total_volume=$(printf '%s\n' "${health_files[@]}" | xargs cat 2>/dev/null | jq -r '.trading_performance.volume_24h_usd // 0' | awk '{sum+=$1} END {printf "%.2f", sum}')
  local avg_risk_score=$(printf '%s\n' "${health_files[@]}" | xargs cat 2>/dev/null | jq -r '.risk_management.risk_score // 0' | awk '{sum+=$1} END {printf "%.1f", sum/NR}')
  local max_alerts=$(printf '%s\n' "${health_files[@]}" | xargs cat 2>/dev/null | jq -r '.risk_management.active_alerts // 0' | awk 'BEGIN{max=0} {if($1>max) max=$1} END {printf "%.0f", max}')
  
  echo "$total_files|$avg_response_time|$avg_memory_mb|$max_memory_mb|$total_trades|$total_volume|$avg_risk_score|$max_alerts"
}

calculate_availability() {
  local start_date=$(date -d "$REPORT_WEEKS weeks ago" +%Y%m%d)
  
  # Count successful vs failed health checks
  local total_checks=0
  local successful_checks=0
  
  for day in $(seq 0 $((REPORT_WEEKS * 7 - 1))); do
    local check_date=$(date -d "$day days ago" +%Y%m%d)
    if [[ "$check_date" -ge "$start_date" ]]; then
      local day_files=$(find "$LOG_DIR" -name "hourly-health-${check_date}-*.json" 2>/dev/null)
      for file in $day_files; do
        if [[ -f "$file" ]]; then
          total_checks=$((total_checks + 1))
          local api_healthy=$(cat "$file" 2>/dev/null | jq -r '.health.overall_status' 2>/dev/null)
          if [[ "$api_healthy" == "healthy" ]]; then
            successful_checks=$((successful_checks + 1))
          fi
        fi
      done
    fi
  done
  
  if [[ $total_checks -eq 0 ]]; then
    echo "0.00|0|0"
  else
    local availability=$(echo "scale=4; $successful_checks * 100 / $total_checks" | bc)
    echo "$availability|$successful_checks|$total_checks"
  fi
}

get_incident_summary() {
  local start_date=$(date -d "$REPORT_WEEKS weeks ago" +%Y-%m-%d)
  local alerts_file="logs/health-alerts.log"
  
  if [[ ! -f "$alerts_file" ]]; then
    echo "0|0|0"
    return
  fi
  
  # Count alerts by severity in the date range
  local total_alerts=$(awk -v start="$start_date" '$1 " " $2 >= start' "$alerts_file" | wc -l)
  local critical_alerts=$(awk -v start="$start_date" '$1 " " $2 >= start && /CRITICAL/' "$alerts_file" | wc -l)
  local warning_alerts=$(awk -v start="$start_date" '$1 " " $2 >= start && /WARNING/' "$alerts_file" | wc -l)
  
  echo "$total_alerts|$critical_alerts|$warning_alerts"
}

get_performance_trend() {
  local start_date=$(date -d "$REPORT_WEEKS weeks ago" +%Y%m%d)
  local week1_data week2_data
  
  # Get metrics for first half vs second half of the period
  local mid_point=$((REPORT_WEEKS * 7 / 2))
  
  # First half metrics
  local first_half_files=()
  for day in $(seq $mid_point $((REPORT_WEEKS * 7 - 1))); do
    local check_date=$(date -d "$day days ago" +%Y%m%d)
    first_half_files+=($(find "$LOG_DIR" -name "hourly-health-${check_date}-*.json" 2>/dev/null))
  done
  
  # Second half metrics  
  local second_half_files=()
  for day in $(seq 0 $((mid_point - 1))); do
    local check_date=$(date -d "$day days ago" +%Y%m%d)
    second_half_files+=($(find "$LOG_DIR" -name "hourly-health-${check_date}-*.json" 2>/dev/null))
  done
  
  local first_avg_response=0 second_avg_response=0
  local first_avg_trades=0 second_avg_trades=0
  
  if [[ ${#first_half_files[@]} -gt 0 ]]; then
    first_avg_response=$(printf '%s\n' "${first_half_files[@]}" | xargs cat 2>/dev/null | jq -r '.health.api_server.response_time_seconds // 0' | awk '{sum+=$1} END {printf "%.3f", sum/NR}')
    first_avg_trades=$(printf '%s\n' "${first_half_files[@]}" | xargs cat 2>/dev/null | jq -r '.trading_performance.trades_24h // 0' | awk '{sum+=$1} END {printf "%.0f", sum/NR}')
  fi
  
  if [[ ${#second_half_files[@]} -gt 0 ]]; then
    second_avg_response=$(printf '%s\n' "${second_half_files[@]}" | xargs cat 2>/dev/null | jq -r '.health.api_server.response_time_seconds // 0' | awk '{sum+=$1} END {printf "%.3f", sum/NR}')
    second_avg_trades=$(printf '%s\n' "${second_half_files[@]}" | xargs cat 2>/dev/null | jq -r '.trading_performance.trades_24h // 0' | awk '{sum+=$1} END {printf "%.0f", sum/NR}')
  fi
  
  # Calculate trends (positive = improving, negative = degrading)
  local response_trend=$(echo "scale=3; ($first_avg_response - $second_avg_response) * -1" | bc)  # Lower response time is better
  local trades_trend=$(echo "scale=0; $second_avg_trades - $first_avg_trades" | bc)
  
  echo "$response_trend|$trades_trend|$first_avg_response|$second_avg_response"
}

generate_weekly_markdown_summary() {
  local week_start=$(date -d "$REPORT_WEEKS weeks ago" +"%Y-%m-%d")
  local week_end=$(date +"%Y-%m-%d")
  local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  
  # Aggregate data
  local system_metrics=$(aggregate_system_metrics)
  local availability_data=$(calculate_availability)
  local incident_data=$(get_incident_summary)
  local performance_trend=$(get_performance_trend)
  
  # Parse results
  IFS='|' read -r total_files avg_response avg_memory max_memory total_trades total_volume avg_risk max_alerts <<< "$system_metrics"
  IFS='|' read -r availability successful_checks total_checks <<< "$availability_data"
  IFS='|' read -r total_incidents critical_incidents warning_incidents <<< "$incident_data"
  IFS='|' read -r response_trend trades_trend first_response second_response <<< "$performance_trend"
  
  # Generate trend indicators
  local response_indicator=$(echo "$response_trend > 0" | bc -l) 
  local trades_indicator=$(echo "$trades_trend > 0" | bc -l)
  
  response_indicator=$([ "$response_indicator" -eq 1 ] && echo "📈 Improving" || echo "📉 Degrading")
  trades_indicator=$([ "$trades_indicator" -eq 1 ] && echo "📈 Increasing" || echo "📉 Decreasing")
  
  cat << EOF
# 📊 BSC Trading Bot - Weekly Health Summary

**Report Period:** $week_start to $week_end  
**Generated:** $timestamp  
**Data Points:** $total_files health checks analyzed

---

## 🎯 **Executive Summary**

### Overall System Health: $([ $(echo "$availability > 99" | bc) -eq 1 ] && echo "🟢 EXCELLENT" || [ $(echo "$availability > 95" | bc) -eq 1 ] && echo "🟡 GOOD" || echo "🔴 NEEDS ATTENTION")

| Key Metric | Value | Status |
|------------|-------|--------|
| **System Availability** | $(printf "%.2f" "$availability")% | $([ $(echo "$availability > 99" | bc) -eq 1 ] && echo "🟢 Excellent" || echo "⚠️ Monitor") |
| **Average Response Time** | $(printf "%.0f" "$(echo "$avg_response * 1000" | bc)")ms | $([ $(echo "$avg_response < 0.3" | bc) -eq 1 ] && echo "🟢 Optimal" || echo "⚠️ Review") |
| **Peak Memory Usage** | $(printf "%.1f" "$max_memory") MB | $([ $(echo "$max_memory < 1024" | bc) -eq 1 ] && echo "🟢 Normal" || echo "⚠️ High") |
| **Total Trading Volume** | \$$(printf "%'.0f" "$total_volume") | $([ $(echo "$total_volume > 100000" | bc) -eq 1 ] && echo "📈 High Activity" || echo "📊 Normal") |
| **Critical Incidents** | $critical_incidents | $([ "$critical_incidents" -eq 0 ] && echo "🟢 None" || echo "🔴 Attention Needed") |

---

## 📈 **Performance Trends**

### Response Time Trend: $response_indicator
- **First Half Period**: $(printf "%.0f" "$(echo "$first_response * 1000" | bc)")ms average
- **Second Half Period**: $(printf "%.0f" "$(echo "$second_response * 1000" | bc)")ms average
- **Change**: $(printf "%+.0f" "$(echo "$response_trend * 1000" | bc)")ms

### Trading Activity Trend: $trades_indicator  
- **Weekly Total Trades**: $(printf "%.0f" "$total_trades")
- **Daily Average**: $(printf "%.0f" "$(echo "$total_trades / 7" | bc)")
- **Trend Change**: $(printf "%+.0f" "$trades_trend") trades/day

---

## 🛡️ **Reliability Metrics**

### Availability & Uptime
- **Overall Availability**: $(printf "%.2f" "$availability")% ($successful_checks/$total_checks successful checks)
- **Target SLA**: 99.9% ($([ $(echo "$availability > 99.9" | bc) -eq 1 ] && echo "✅ MET" || echo "❌ MISSED"))
- **Downtime**: ~$(printf "%.1f" "$(echo "(100 - $availability) * $REPORT_WEEKS * 7 * 24 / 100" | bc)") hours (estimated)

### Incident Summary
| Severity | Count | Change from Previous Week |
|----------|-------|---------------------------|
| **Critical** | $critical_incidents | $([ "$critical_incidents" -eq 0 ] && echo "🟢 None" || echo "📊 $critical_incidents incidents") |
| **Warning** | $warning_incidents | $([ "$warning_incidents" -lt 5 ] && echo "🟢 Low" || echo "⚠️ Monitor") |
| **Total** | $total_incidents | $([ "$total_incidents" -lt 10 ] && echo "🟢 Acceptable" || echo "⚠️ High") |

---

## 🖥️ **System Resources Analysis**

### Memory Management
- **Average Memory Usage**: $(printf "%.1f" "$avg_memory") MB
- **Peak Memory Usage**: $(printf "%.1f" "$max_memory") MB  
- **Memory Efficiency**: $([ $(echo "$max_memory < 512" | bc) -eq 1 ] && echo "🟢 Excellent" || [ $(echo "$max_memory < 1024" | bc) -eq 1 ] && echo "🟡 Good" || echo "🔴 Review needed")
- **Growth Trend**: $([ $(echo "$max_memory - $avg_memory < 200" | bc) -eq 1 ] && echo "📊 Stable" || echo "📈 Variable")

### Risk Management Health
- **Average Risk Score**: $(printf "%.1f" "$avg_risk")/100
- **Peak Alert Count**: $max_alerts concurrent alerts
- **Risk Assessment**: $([ $(echo "$avg_risk < 30" | bc) -eq 1 ] && echo "🟢 Low Risk" || [ $(echo "$avg_risk < 60" | bc) -eq 1 ] && echo "🟡 Medium Risk" || echo "🔴 High Risk")

---

## 📋 **Operational Recommendations**

### This Week's Action Items
EOF

  # Add conditional recommendations based on metrics
  if [ $(echo "$availability < 99.5" | bc) -eq 1 ]; then
    echo "- 🔴 **PRIORITY**: Investigate availability issues - current $(printf "%.2f" "$availability")% below target"
  fi
  
  if [ $(echo "$max_memory > 1024" | bc) -eq 1 ]; then
    echo "- ⚠️ **Memory Usage**: Peak usage $(printf "%.1f" "$max_memory")MB - consider memory optimization"
  fi
  
  if [ $(echo "$avg_response > 0.5" | bc) -eq 1 ]; then
    echo "- ⚠️ **Performance**: Average response time $(printf "%.0f" "$(echo "$avg_response * 1000" | bc)")ms - investigate latency"
  fi
  
  if [ "$critical_incidents" -gt 0 ]; then
    echo "- 🚨 **Incident Review**: $critical_incidents critical incidents require root cause analysis"
  fi
  
  if [ $(echo "$total_trades < 100" | bc) -eq 1 ]; then
    echo "- 📊 **Trading Activity**: Low trading volume $(printf "%.0f" "$total_trades") - review strategy performance"
  fi

  cat << EOF

### Next Week's Focus Areas
- [ ] Monitor system availability (target: >99.9%)
- [ ] Review memory usage patterns and optimization opportunities  
- [ ] Analyze trading performance and strategy effectiveness
- [ ] Update incident response procedures based on this week's events
- [ ] Conduct weekly drill exercise (production_drill.sh)

---

## 📞 **Weekly Review Meeting Topics**

1. **System Reliability**: Availability trends and incident patterns
2. **Performance Optimization**: Response time and resource utilization
3. **Trading Effectiveness**: Volume trends and strategy performance  
4. **Risk Management**: Alert patterns and risk score analysis
5. **Operational Excellence**: Process improvements and automation opportunities

---

## 📊 **Appendix: Data Sources**

- **Health Checks**: $total_files automated health reports
- **Date Range**: $week_start to $week_end  
- **Monitoring Frequency**: Hourly automated checks
- **Alert Sources**: System logs and real-time monitoring

---

**📈 Week-over-week improvement focus**: $([ $(echo "$response_trend > 0 && $trades_trend > 0" | bc) -eq 1 ] && echo "Performance and activity both improving ✅" || [ $(echo "$response_trend > 0" | bc) -eq 1 ] && echo "Performance improving, monitor trading activity" || [ $(echo "$trades_trend > 0" | bc) -eq 1 ] && echo "Trading activity up, optimize performance" || echo "Focus on both performance and activity optimization")

*Report generated by BSC Trading Bot Weekly Health Summary v2.0*
*Next automated summary: $(date -d "next Sunday 10:00" '+%Y-%m-%d %H:%M')*
EOF
}

generate_weekly_json_summary() {
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local week_start=$(date -d "$REPORT_WEEKS weeks ago" +"%Y-%m-%d")
  local week_end=$(date +"%Y-%m-%d")
  
  local system_metrics=$(aggregate_system_metrics)
  local availability_data=$(calculate_availability)
  local incident_data=$(get_incident_summary)
  local performance_trend=$(get_performance_trend)
  
  # Parse results
  IFS='|' read -r total_files avg_response avg_memory max_memory total_trades total_volume avg_risk max_alerts <<< "$system_metrics"
  IFS='|' read -r availability successful_checks total_checks <<< "$availability_data"
  IFS='|' read -r total_incidents critical_incidents warning_incidents <<< "$incident_data"
  IFS='|' read -r response_trend trades_trend first_response second_response <<< "$performance_trend"
  
  cat << EOF
{
  "report_metadata": {
    "generated_at": "$timestamp",
    "period_start": "$week_start",
    "period_end": "$week_end",
    "weeks_covered": $REPORT_WEEKS,
    "data_points": $total_files
  },
  "executive_summary": {
    "overall_health_grade": "$([ $(echo "$availability > 99" | bc) -eq 1 ] && echo "A" || [ $(echo "$availability > 95" | bc) -eq 1 ] && echo "B" || echo "C")",
    "availability_percent": $(printf "%.2f" "$availability"),
    "avg_response_time_ms": $(printf "%.0f" "$(echo "$avg_response * 1000" | bc)"),
    "peak_memory_mb": $(printf "%.1f" "$max_memory"),
    "total_trading_volume_usd": $(printf "%.2f" "$total_volume"),
    "critical_incidents": $critical_incidents
  },
  "availability_metrics": {
    "overall_availability_percent": $(printf "%.4f" "$availability"),
    "successful_health_checks": $successful_checks,
    "total_health_checks": $total_checks,
    "sla_target_percent": 99.9,
    "sla_met": $([ $(echo "$availability > 99.9" | bc) -eq 1 ] && echo "true" || echo "false")
  },
  "performance_trends": {
    "response_time": {
      "first_half_avg_ms": $(printf "%.0f" "$(echo "$first_response * 1000" | bc)"),
      "second_half_avg_ms": $(printf "%.0f" "$(echo "$second_response * 1000" | bc)"),
      "trend_change_ms": $(printf "%+.0f" "$(echo "$response_trend * 1000" | bc)"),
      "trend_direction": "$([ $(echo "$response_trend > 0" | bc) -eq 1 ] && echo "improving" || echo "degrading")"
    },
    "trading_activity": {
      "total_trades": $(printf "%.0f" "$total_trades"),
      "daily_average": $(printf "%.0f" "$(echo "$total_trades / 7" | bc)"),
      "trend_change": $(printf "%+.0f" "$trades_trend"),
      "trend_direction": "$([ $(echo "$trades_trend > 0" | bc) -eq 1 ] && echo "increasing" || echo "decreasing")"
    }
  },
  "system_resources": {
    "memory": {
      "average_usage_mb": $(printf "%.1f" "$avg_memory"),
      "peak_usage_mb": $(printf "%.1f" "$max_memory"),
      "efficiency_rating": "$([ $(echo "$max_memory < 512" | bc) -eq 1 ] && echo "excellent" || [ $(echo "$max_memory < 1024" | bc) -eq 1 ] && echo "good" || echo "needs_review")"
    },
    "risk_management": {
      "average_risk_score": $(printf "%.1f" "$avg_risk"),
      "peak_alert_count": $max_alerts,
      "risk_level": "$([ $(echo "$avg_risk < 30" | bc) -eq 1 ] && echo "low" || [ $(echo "$avg_risk < 60" | bc) -eq 1 ] && echo "medium" || echo "high")"
    }
  },
  "incident_summary": {
    "total_incidents": $total_incidents,
    "critical_incidents": $critical_incidents,
    "warning_incidents": $warning_incidents,
    "incident_rate_per_day": $(printf "%.2f" "$(echo "scale=2; $total_incidents / 7" | bc)")
  },
  "recommendations": {
    "priority_actions": [
      $([ $(echo "$availability < 99.5" | bc) -eq 1 ] && echo "\"Investigate availability issues\"," || echo "")
      $([ $(echo "$max_memory > 1024" | bc) -eq 1 ] && echo "\"Optimize memory usage\"," || echo "")
      $([ $(echo "$avg_response > 0.5" | bc) -eq 1 ] && echo "\"Investigate response latency\"," || echo "")
      $([ "$critical_incidents" -gt 0 ] && echo "\"Conduct incident root cause analysis\"," || echo "")
      "Continue regular monitoring"
    ],
    "next_week_focus": [
      "Monitor system availability",
      "Review memory patterns", 
      "Analyze trading performance",
      "Update incident procedures",
      "Conduct weekly drill"
    ]
  }
}
EOF
}

# Main execution
main() {
  log "${BLUE}Starting BSC Trading Bot Weekly Health Summary${NC}"
  log "Report weeks: $REPORT_WEEKS"
  log "Output format: $OUTPUT_FORMAT"
  
  # Check dependencies
  if ! command -v jq &> /dev/null; then
    log "${YELLOW}Warning: jq not found, some analytics may be limited${NC}"
  fi
  
  if ! command -v bc &> /dev/null; then
    log "${YELLOW}Warning: bc not found, calculations may be limited${NC}"
  fi
  
  # Check if health data exists
  if [[ ! -d "$LOG_DIR" ]]; then
    log "${RED}Error: Health reports directory not found: $LOG_DIR${NC}"
    log "Please run health checks first using: ./scripts/post-launch-health-check.sh"
    exit 1
  fi
  
  local health_files_count=$(find "$LOG_DIR" -name "hourly-health-*.json" 2>/dev/null | wc -l)
  if [[ $health_files_count -eq 0 ]]; then
    log "${YELLOW}Warning: No health data files found in $LOG_DIR${NC}"
    log "Limited summary will be generated"
  fi
  
  # Generate report
  case "$OUTPUT_FORMAT" in
    "json")
      report_content=$(generate_weekly_json_summary)
      ;;
    "markdown"|*)
      report_content=$(generate_weekly_markdown_summary)
      ;;
  esac
  
  # Output report
  if [[ -n "$OUTPUT_FILE" ]]; then
    echo "$report_content" > "$OUTPUT_FILE"
    log "${GREEN}Weekly summary saved to: $OUTPUT_FILE${NC}"
  else
    echo "$report_content"
  fi
  
  log "${GREEN}Weekly health summary completed successfully${NC}"
}

# Run main function
main "$@"