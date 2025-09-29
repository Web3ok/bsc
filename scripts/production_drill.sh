#!/bin/bash

# BSC Trading Bot - Production Drill Script
# 生产演练脚本：触发告警、验证自动化响应、测试恢复流程

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$PROJECT_ROOT/logs/production_drill_$(date +%Y%m%d_%H%M%S).log"

# Default values
BOT_HOST="${BOT_HOST:-localhost}"
METRICS_PORT="${METRICS_PORT:-3001}"
API_PORT="${API_PORT:-3010}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
DRILL_DURATION="${DRILL_DURATION:-300}" # 5 minutes
SKIP_DESTRUCTIVE="${SKIP_DESTRUCTIVE:-false}"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Logging functions
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${timestamp} [$level] $message" | tee -a "$LOG_FILE"
}

log_info() { log "INFO" "$*"; }
log_warn() { log "WARN" "$*"; }
log_error() { log "ERROR" "$*"; }
log_success() { log "SUCCESS" "$*"; }

print_banner() {
    echo -e "${BLUE}"
    echo "======================================================"
    echo "  BSC Trading Bot - Production Drill Script"
    echo "======================================================"
    echo -e "${NC}"
}

print_section() {
    echo -e "\n${YELLOW}>>> $1${NC}"
}

# HTTP request helper with auth
api_request() {
    local method=$1
    local endpoint=$2
    local port=$3
    local auth_header=""
    
    if [[ -n "$AUTH_TOKEN" ]]; then
        auth_header="-H 'Authorization: Bearer $AUTH_TOKEN'"
    fi
    
    eval "curl -s -X $method $auth_header http://$BOT_HOST:$port$endpoint"
}

# Check if service is running
check_service() {
    local service_name=$1
    local port=$2
    local endpoint=${3:-"/healthz"}
    
    if curl -s -f "http://$BOT_HOST:$port$endpoint" > /dev/null 2>&1; then
        log_success "$service_name is running on port $port"
        return 0
    else
        log_error "$service_name is not accessible on port $port"
        return 1
    fi
}

# Wait for condition with timeout
wait_for_condition() {
    local condition_func=$1
    local timeout=$2
    local description=$3
    local interval=${4:-5}
    
    log_info "Waiting for: $description (timeout: ${timeout}s)"
    
    local elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if $condition_func; then
            log_success "Condition met: $description"
            return 0
        fi
        sleep $interval
        elapsed=$((elapsed + interval))
        echo -n "."
    done
    
    echo
    log_error "Timeout waiting for: $description"
    return 1
}

# Drill scenarios
drill_health_check() {
    print_section "健康检查演练"
    
    log_info "Testing health endpoints..."
    
    # Test public health check
    if check_service "Public Health Check" "$METRICS_PORT" "/healthz"; then
        local health_response=$(api_request GET "/healthz" "$METRICS_PORT")
        log_info "Public health response: $health_response"
    fi
    
    # Test authenticated health check
    if [[ -n "$AUTH_TOKEN" ]]; then
        if check_service "Authenticated Health Check" "$METRICS_PORT" "/health"; then
            local auth_health=$(api_request GET "/health" "$METRICS_PORT")
            log_info "Authenticated health response: $auth_health"
        fi
    else
        log_warn "AUTH_TOKEN not set, skipping authenticated health check"
    fi
    
    # Test metrics endpoint
    if [[ -n "$AUTH_TOKEN" ]]; then
        log_info "Testing metrics endpoint..."
        local metrics_count=$(api_request GET "/metrics" "$METRICS_PORT" | grep -c "^# HELP" || true)
        if [[ $metrics_count -gt 0 ]]; then
            log_success "Metrics endpoint returned $metrics_count metrics"
        else
            log_error "Metrics endpoint not working properly"
        fi
    fi
    
    # Test market data API
    if check_service "Market Data API" "$API_PORT" "/api/v1/pairs"; then
        log_success "Market Data API is accessible"
    fi
}

drill_websocket_disconnection() {
    print_section "WebSocket断连演练"
    
    if [[ "$SKIP_DESTRUCTIVE" == "true" ]]; then
        log_warn "Skipping WebSocket disconnection drill (SKIP_DESTRUCTIVE=true)"
        return
    fi
    
    log_info "Simulating WebSocket connection issues..."
    
    # Check current WebSocket status
    local ws_status=$(api_request GET "/status" "$METRICS_PORT" | grep -o '"websocket_connected":[^,}]*' || echo '"websocket_connected":unknown')
    log_info "Current WebSocket status: $ws_status"
    
    # Simulate network issues by blocking WebSocket traffic
    if command -v iptables >/dev/null 2>&1; then
        log_info "Temporarily blocking WebSocket traffic (requires sudo)..."
        
        # Block BSC WebSocket port (usually 443 for WSS)
        sudo iptables -A OUTPUT -p tcp --dport 443 -d bsc-ws-node.nariox.org -j REJECT 2>/dev/null || log_warn "Could not block WebSocket traffic"
        
        # Wait and check for disconnection alert
        sleep 30
        
        local new_ws_status=$(api_request GET "/status" "$METRICS_PORT" | grep -o '"websocket_connected":[^,}]*' || echo '"websocket_connected":unknown')
        log_info "WebSocket status after blocking: $new_ws_status"
        
        # Restore connection
        log_info "Restoring WebSocket connectivity..."
        sudo iptables -D OUTPUT -p tcp --dport 443 -d bsc-ws-node.nariox.org -j REJECT 2>/dev/null || log_warn "Could not restore WebSocket traffic"
        
        # Wait for reconnection
        sleep 60
        local restored_status=$(api_request GET "/status" "$METRICS_PORT" | grep -o '"websocket_connected":[^,}]*' || echo '"websocket_connected":unknown')
        log_info "WebSocket status after restore: $restored_status"
    else
        log_warn "iptables not available, skipping network-level WebSocket test"
        
        # Alternative: Check WebSocket connection monitoring
        log_info "Checking WebSocket connection monitoring metrics..."
        local ws_metrics=$(api_request GET "/metrics" "$METRICS_PORT" | grep websocket || echo "No WebSocket metrics found")
        log_info "WebSocket metrics: $ws_metrics"
    fi
}

drill_resource_exhaustion() {
    print_section "资源耗尽演练"
    
    log_info "Testing resource monitoring..."
    
    # Check current resource metrics
    local memory_usage=$(api_request GET "/metrics" "$METRICS_PORT" | grep "process_resident_memory_bytes" | tail -1 || echo "memory_unknown")
    local cpu_usage=$(api_request GET "/metrics" "$METRICS_PORT" | grep "process_cpu_user_seconds_total" | tail -1 || echo "cpu_unknown")
    
    log_info "Current memory usage: $memory_usage"
    log_info "Current CPU usage: $cpu_usage"
    
    # Simulate high CPU load
    if [[ "$SKIP_DESTRUCTIVE" != "true" ]]; then
        log_info "Simulating high CPU load for 30 seconds..."
        
        # Start CPU stress in background
        (yes > /dev/null &) 
        local stress_pid=$!
        
        sleep 30
        
        # Stop stress test
        kill $stress_pid 2>/dev/null || true
        wait $stress_pid 2>/dev/null || true
        
        log_info "CPU stress test completed"
        
        # Check metrics after stress
        sleep 10
        local post_stress_cpu=$(api_request GET "/metrics" "$METRICS_PORT" | grep "process_cpu_user_seconds_total" | tail -1 || echo "cpu_unknown")
        log_info "CPU usage after stress: $post_stress_cpu"
    fi
}

drill_database_connection() {
    print_section "数据库连接演练"
    
    log_info "Testing database connectivity..."
    
    # Check database health through metrics
    local db_metrics=$(api_request GET "/metrics" "$METRICS_PORT" | grep -E "(database|db)_" || echo "No database metrics found")
    
    if [[ "$db_metrics" != "No database metrics found" ]]; then
        log_info "Database metrics available:"
        echo "$db_metrics" | while read -r line; do
            log_info "  $line"
        done
    else
        log_warn "No database metrics found in monitoring"
    fi
    
    # Test database operations through API
    log_info "Testing market data API (requires database)..."
    local pairs_response=$(api_request GET "/api/v1/pairs" "$API_PORT")
    
    if echo "$pairs_response" | grep -q "symbol\|pair" 2>/dev/null; then
        log_success "Database-dependent API endpoints working"
    else
        log_error "Database-dependent API endpoints may have issues"
        log_info "Response: $pairs_response"
    fi
}

drill_strategy_operations() {
    print_section "策略运营演练"
    
    log_info "Testing strategy management capabilities..."
    
    # This would typically test strategy creation, start/stop, etc.
    # Since we don't want to create actual trading strategies in a drill,
    # we'll focus on monitoring and status checking
    
    local system_status=$(api_request GET "/status" "$METRICS_PORT")
    log_info "System status check:"
    
    if command -v jq >/dev/null 2>&1; then
        echo "$system_status" | jq '.' 2>/dev/null || echo "$system_status"
    else
        echo "$system_status"
    fi
    
    # Check strategy-related metrics
    local strategy_metrics=$(api_request GET "/metrics" "$METRICS_PORT" | grep -i strategy || echo "No strategy metrics found")
    if [[ "$strategy_metrics" != "No strategy metrics found" ]]; then
        log_info "Strategy metrics:"
        echo "$strategy_metrics" | while read -r line; do
            log_info "  $line"
        done
    fi
}

drill_fund_management() {
    print_section "资金管理演练"
    
    log_info "Testing fund management monitoring..."
    
    # Check fund-related metrics
    local fund_metrics=$(api_request GET "/metrics" "$METRICS_PORT" | grep -E "(balance|fund|wallet)" || echo "No fund metrics found")
    
    if [[ "$fund_metrics" != "No fund metrics found" ]]; then
        log_info "Fund management metrics:"
        echo "$fund_metrics" | while read -r line; do
            log_info "  $line"
        done
    else
        log_warn "No fund management metrics found"
    fi
    
    # Test balance monitoring
    log_info "Fund management systems appear to be monitored"
}

drill_alert_recovery() {
    print_section "告警恢复演练"
    
    log_info "Testing alert and recovery mechanisms..."
    
    # Check if Prometheus alerts configuration exists
    local alerts_file="$PROJECT_ROOT/monitoring/prometheus-alerts.yml"
    if [[ -f "$alerts_file" ]]; then
        local alert_count=$(grep -c "alert:" "$alerts_file" || echo "0")
        log_success "Found $alert_count alert rules in prometheus-alerts.yml"
        
        # Show critical alerts
        log_info "Critical alert rules:"
        grep -A 5 -B 1 'severity:.*critical' "$alerts_file" | head -20 || log_warn "No critical alerts found"
    else
        log_warn "Prometheus alerts file not found at $alerts_file"
    fi
    
    # Test alert endpoints
    if [[ -n "$AUTH_TOKEN" ]]; then
        log_info "Testing alert-related metrics..."
        local alert_metrics=$(api_request GET "/metrics" "$METRICS_PORT" | grep -E "(alert|error|failure)" | head -10 || echo "No alert metrics found")
        
        if [[ "$alert_metrics" != "No alert metrics found" ]]; then
            log_info "Sample alert metrics:"
            echo "$alert_metrics" | while read -r line; do
                log_info "  $line"
            done
        fi
    fi
}

run_full_drill() {
    print_banner
    
    log_info "Starting production drill at $(date)"
    log_info "Configuration:"
    log_info "  BOT_HOST: $BOT_HOST"
    log_info "  METRICS_PORT: $METRICS_PORT"
    log_info "  API_PORT: $API_PORT"
    log_info "  DRILL_DURATION: $DRILL_DURATION seconds"
    log_info "  SKIP_DESTRUCTIVE: $SKIP_DESTRUCTIVE"
    log_info "  LOG_FILE: $LOG_FILE"
    
    # Pre-drill checks
    print_section "预检查"
    
    local services_ok=true
    
    if ! check_service "Metrics Service" "$METRICS_PORT" "/healthz"; then
        services_ok=false
    fi
    
    if ! check_service "API Service" "$API_PORT" "/api/v1/pairs"; then
        services_ok=false
    fi
    
    if [[ "$services_ok" != "true" ]]; then
        log_error "Pre-drill checks failed. Please ensure services are running."
        exit 1
    fi
    
    log_success "Pre-drill checks passed"
    
    # Execute drill scenarios
    drill_health_check
    drill_websocket_disconnection
    drill_resource_exhaustion
    drill_database_connection
    drill_strategy_operations
    drill_fund_management
    drill_alert_recovery
    
    # Post-drill verification
    print_section "演练后验证"
    
    log_info "Verifying system recovery..."
    
    # Wait for systems to stabilize
    sleep 30
    
    # Final health check
    if check_service "Final Health Check" "$METRICS_PORT" "/healthz"; then
        log_success "System health verified after drill"
    else
        log_error "System health check failed after drill"
    fi
    
    # Generate drill report
    print_section "演练报告"
    
    local end_time=$(date)
    local total_logs=$(wc -l < "$LOG_FILE")
    local error_count=$(grep -c "ERROR" "$LOG_FILE" || echo "0")
    local warning_count=$(grep -c "WARN" "$LOG_FILE" || echo "0")
    local success_count=$(grep -c "SUCCESS" "$LOG_FILE" || echo "0")
    
    echo -e "\n${GREEN}====== PRODUCTION DRILL REPORT ======${NC}"
    echo "Drill completed at: $end_time"
    echo "Total log entries: $total_logs"
    echo "Errors: $error_count"
    echo "Warnings: $warning_count"
    echo "Successes: $success_count"
    echo "Full log: $LOG_FILE"
    echo -e "${GREEN}=====================================${NC}\n"
    
    if [[ $error_count -gt 0 ]]; then
        log_error "Drill completed with $error_count errors. Please review the log."
        exit 1
    else
        log_success "Production drill completed successfully!"
    fi
}

# Script help
show_help() {
    cat << EOF
BSC Trading Bot Production Drill Script

Usage: $0 [OPTIONS]

Options:
    -h, --host HOST              Bot host (default: localhost)
    -m, --metrics-port PORT      Metrics port (default: 3001)
    -a, --api-port PORT         API port (default: 3010)
    -t, --auth-token TOKEN      Authentication token
    -d, --duration SECONDS      Drill duration (default: 300)
    -s, --skip-destructive      Skip destructive tests
    --help                      Show this help

Environment variables:
    BOT_HOST                    Same as --host
    METRICS_PORT               Same as --metrics-port
    API_PORT                   Same as --api-port
    AUTH_TOKEN                 Same as --auth-token
    DRILL_DURATION             Same as --duration
    SKIP_DESTRUCTIVE           Same as --skip-destructive

Examples:
    # Basic drill
    $0

    # Drill with authentication
    $0 --auth-token "your-secret-token"

    # Drill on remote host
    $0 --host "production.example.com" --auth-token "token"

    # Safe drill (skip destructive tests)
    $0 --skip-destructive

    # Quick drill
    $0 --duration 60

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--host)
            BOT_HOST="$2"
            shift 2
            ;;
        -m|--metrics-port)
            METRICS_PORT="$2"
            shift 2
            ;;
        -a|--api-port)
            API_PORT="$2"
            shift 2
            ;;
        -t|--auth-token)
            AUTH_TOKEN="$2"
            shift 2
            ;;
        -d|--duration)
            DRILL_DURATION="$2"
            shift 2
            ;;
        -s|--skip-destructive)
            SKIP_DESTRUCTIVE="true"
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_full_drill
fi