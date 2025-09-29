#!/bin/bash

# BSC Trading Bot - Production Health Check Script
# Comprehensive health monitoring for production deployment

set -e

# Configuration
API_URL="${API_URL:-http://localhost:10001}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:10002}"
TIMEOUT=5
RETRY_COUNT=3

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "======================================"
echo "BSC Trading Bot - Production Health Check"
echo "======================================"
echo ""
echo "Timestamp: $(date)"
echo "API URL: $API_URL"
echo ""

# Results tracking
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNINGS=0

# Function to perform check with retry
check_with_retry() {
    local url=$1
    local check_name=$2
    local retry_count=${3:-$RETRY_COUNT}
    
    for i in $(seq 1 $retry_count); do
        if curl -s -f -m $TIMEOUT "$url" > /dev/null 2>&1; then
            return 0
        fi
        
        if [ $i -lt $retry_count ]; then
            sleep 2
        fi
    done
    
    return 1
}

# Function to check service
check_service() {
    local service_name=$1
    local url=$2
    local expected=$3
    
    ((TOTAL_CHECKS++))
    
    echo -n "  Checking $service_name... "
    
    RESPONSE=$(curl -s -m $TIMEOUT "$url" 2>/dev/null)
    
    if [ -z "$RESPONSE" ]; then
        echo -e "${RED}✗ No response${NC}"
        ((FAILED_CHECKS++))
        return 1
    fi
    
    if echo "$RESPONSE" | jq -e "$expected" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ OK${NC}"
        ((PASSED_CHECKS++))
        return 0
    else
        echo -e "${RED}✗ Failed${NC}"
        ((FAILED_CHECKS++))
        return 1
    fi
}

# 1. API Health Check
echo "1️⃣  API Health Checks"
echo "━━━━━━━━━━━━━━━━━━━━"

# Basic health
check_service "API Health" "${API_URL}/api/health" '.status == "healthy"'

# Get detailed health info
HEALTH_DATA=$(curl -s "${API_URL}/api/health" 2>/dev/null)

if [ ! -z "$HEALTH_DATA" ]; then
    # Check individual services
    echo ""
    echo "  Service Status:"
    
    # API Service
    API_STATUS=$(echo "$HEALTH_DATA" | jq -r '.services.api' 2>/dev/null)
    if [ "$API_STATUS" = "healthy" ]; then
        echo -e "    API:        ${GREEN}✓ $API_STATUS${NC}"
    else
        echo -e "    API:        ${RED}✗ $API_STATUS${NC}"
        ((WARNINGS++))
    fi
    
    # Database Service
    DB_STATUS=$(echo "$HEALTH_DATA" | jq -r '.services.database' 2>/dev/null)
    if [ "$DB_STATUS" = "healthy" ]; then
        echo -e "    Database:   ${GREEN}✓ $DB_STATUS${NC}"
    elif [ "$DB_STATUS" = "degraded" ]; then
        echo -e "    Database:   ${YELLOW}⚠ $DB_STATUS${NC}"
        ((WARNINGS++))
    else
        echo -e "    Database:   ${RED}✗ $DB_STATUS${NC}"
        ((FAILED_CHECKS++))
    fi
    
    # RPC Providers
    RPC_STATUS=$(echo "$HEALTH_DATA" | jq -r '.services.rpc_providers' 2>/dev/null)
    if [ "$RPC_STATUS" = "healthy" ]; then
        echo -e "    RPC:        ${GREEN}✓ $RPC_STATUS${NC}"
    else
        echo -e "    RPC:        ${YELLOW}⚠ $RPC_STATUS${NC}"
        ((WARNINGS++))
    fi
    
    # WebSocket
    WS_STATUS=$(echo "$HEALTH_DATA" | jq -r '.services.websocket' 2>/dev/null)
    if [ "$WS_STATUS" = "healthy" ]; then
        echo -e "    WebSocket:  ${GREEN}✓ $WS_STATUS${NC}"
    else
        echo -e "    WebSocket:  ${YELLOW}⚠ $WS_STATUS${NC}"
        ((WARNINGS++))
    fi
    
    # Uptime
    UPTIME=$(echo "$HEALTH_DATA" | jq -r '.uptime' 2>/dev/null)
    if [ ! -z "$UPTIME" ] && [ "$UPTIME" != "null" ]; then
        echo -e "    Uptime:     ${BLUE}$(printf "%.0f" $UPTIME) seconds${NC}"
    fi
fi

echo ""

# 2. Process Checks
echo "2️⃣  Process Checks"
echo "━━━━━━━━━━━━━━━━━"

# Check Node.js processes
NODE_PROCS=$(ps aux | grep -E "node.*server|npm.*run" | grep -v grep | wc -l)
echo -e "  Node.js processes: ${BLUE}$NODE_PROCS${NC}"

# Check specific services
if pgrep -f "npm run server" > /dev/null; then
    echo -e "  API Server:        ${GREEN}✓ Running${NC}"
    ((PASSED_CHECKS++))
else
    echo -e "  API Server:        ${RED}✗ Not running${NC}"
    ((FAILED_CHECKS++))
fi

if pgrep -f "npm run dev" > /dev/null; then
    echo -e "  Frontend:          ${GREEN}✓ Running${NC}"
    ((PASSED_CHECKS++))
else
    echo -e "  Frontend:          ${YELLOW}⚠ Not running (may be normal in production)${NC}"
    ((WARNINGS++))
fi

echo ""

# 3. Database Checks
echo "3️⃣  Database Checks"
echo "━━━━━━━━━━━━━━━━━"

if [ -f "./data/bot.db" ]; then
    DB_SIZE=$(du -h ./data/bot.db | cut -f1)
    TABLE_COUNT=$(sqlite3 ./data/bot.db "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
    
    echo -e "  Database file:     ${GREEN}✓ Found${NC}"
    echo -e "  Database size:     ${BLUE}$DB_SIZE${NC}"
    echo -e "  Total tables:      ${BLUE}$TABLE_COUNT${NC}"
    
    # Check critical tables
    CRITICAL_TABLES=("wallets" "transactions" "blockchain_transactions" "monitoring_status")
    MISSING_TABLES=0
    
    for table in "${CRITICAL_TABLES[@]}"; do
        if sqlite3 ./data/bot.db ".tables" 2>/dev/null | grep -q "$table"; then
            echo -e "  Table '$table':    ${GREEN}✓ Exists${NC}"
        else
            echo -e "  Table '$table':    ${RED}✗ Missing${NC}"
            ((MISSING_TABLES++))
        fi
    done
    
    if [ $MISSING_TABLES -gt 0 ]; then
        echo -e "  ${YELLOW}⚠ Run database migrations: npx knex migrate:latest${NC}"
        ((WARNINGS++))
    fi
else
    echo -e "  Database file:     ${RED}✗ Not found${NC}"
    ((FAILED_CHECKS++))
fi

echo ""

# 4. Port Checks
echo "4️⃣  Port Availability"
echo "━━━━━━━━━━━━━━━━━━"

# Check if ports are listening
PORTS_TO_CHECK=(10001 10002 10003 10004)

for port in "${PORTS_TO_CHECK[@]}"; do
    if lsof -i:$port > /dev/null 2>&1; then
        echo -e "  Port $port:       ${GREEN}✓ In use${NC}"
        ((PASSED_CHECKS++))
    else
        if [ $port -eq 10001 ]; then
            echo -e "  Port $port:       ${RED}✗ Not listening (API)${NC}"
            ((FAILED_CHECKS++))
        else
            echo -e "  Port $port:       ${YELLOW}⚠ Not listening${NC}"
        fi
    fi
done

echo ""

# 5. Resource Usage
echo "5️⃣  Resource Usage"
echo "━━━━━━━━━━━━━━━━"

# Memory usage
MEM_USAGE=$(ps aux | grep -E "node|npm" | grep -v grep | awk '{sum += $6} END {printf "%.1f", sum/1024}')
echo -e "  Node.js memory:    ${BLUE}${MEM_USAGE} MB${NC}"

# CPU usage
CPU_USAGE=$(ps aux | grep -E "node|npm" | grep -v grep | awk '{sum += $3} END {printf "%.1f", sum}')
echo -e "  Node.js CPU:       ${BLUE}${CPU_USAGE}%${NC}"

# Disk usage
DISK_USAGE=$(df -h . | awk 'NR==2 {print $5}')
echo -e "  Disk usage:        ${BLUE}$DISK_USAGE${NC}"

echo ""

# 6. Log Files Check
echo "6️⃣  Log Files"
echo "━━━━━━━━━━━━"

if [ -d "./logs" ]; then
    LOG_COUNT=$(find ./logs -name "*.log" 2>/dev/null | wc -l)
    LOG_SIZE=$(du -sh ./logs 2>/dev/null | cut -f1)
    
    echo -e "  Log directory:     ${GREEN}✓ Exists${NC}"
    echo -e "  Log files:         ${BLUE}$LOG_COUNT files${NC}"
    echo -e "  Total size:        ${BLUE}$LOG_SIZE${NC}"
    
    # Check for recent errors
    if [ -f "./logs/error.log" ]; then
        RECENT_ERRORS=$(tail -n 100 ./logs/error.log 2>/dev/null | grep -c "ERROR" || echo "0")
        if [ $RECENT_ERRORS -gt 0 ]; then
            echo -e "  Recent errors:     ${YELLOW}⚠ $RECENT_ERRORS errors in last 100 lines${NC}"
            ((WARNINGS++))
        else
            echo -e "  Recent errors:     ${GREEN}✓ None${NC}"
        fi
    fi
else
    echo -e "  Log directory:     ${YELLOW}⚠ Not found${NC}"
    ((WARNINGS++))
fi

echo ""

# 7. Configuration Check
echo "7️⃣  Configuration"
echo "━━━━━━━━━━━━━━━"

if [ -f ".env" ]; then
    echo -e "  .env file:         ${GREEN}✓ Found${NC}"
    
    # Check critical env vars (without exposing values)
    CRITICAL_VARS=("JWT_SECRET" "DATABASE_URL" "BSC_RPC_URL")
    
    for var in "${CRITICAL_VARS[@]}"; do
        if grep -q "^$var=" .env; then
            echo -e "  $var:    ${GREEN}✓ Set${NC}"
        else
            echo -e "  $var:    ${RED}✗ Missing${NC}"
            ((FAILED_CHECKS++))
        fi
    done
else
    echo -e "  .env file:         ${RED}✗ Not found${NC}"
    ((FAILED_CHECKS++))
fi

echo ""

# 8. Monitoring & Alerts Check
echo "8️⃣  Monitoring & Alerts"
echo "━━━━━━━━━━━━━━━━━━━━"

# Check if monitoring is running
MONITOR_STATUS=$(curl -s "${API_URL}/api/monitor/status" 2>/dev/null | jq -r '.data.isMonitoring' 2>/dev/null)

if [ "$MONITOR_STATUS" = "true" ]; then
    echo -e "  Blockchain Monitor: ${GREEN}✓ Running${NC}"
    
    WATCHED_COUNT=$(curl -s "${API_URL}/api/monitor/status" 2>/dev/null | jq -r '.data.watchedAddresses' 2>/dev/null)
    echo -e "  Watched Addresses:  ${BLUE}$WATCHED_COUNT${NC}"
else
    echo -e "  Blockchain Monitor: ${YELLOW}⚠ Not running${NC}"
    ((WARNINGS++))
fi

# Check alert channels configuration
if grep -q "SLACK_WEBHOOK_URL=" .env 2>/dev/null; then
    echo -e "  Slack Alerts:       ${GREEN}✓ Configured${NC}"
else
    echo -e "  Slack Alerts:       ${YELLOW}⚠ Not configured${NC}"
fi

if grep -q "DISCORD_WEBHOOK_URL=" .env 2>/dev/null; then
    echo -e "  Discord Alerts:     ${GREEN}✓ Configured${NC}"
else
    echo -e "  Discord Alerts:     ${YELLOW}⚠ Not configured${NC}"
fi

echo ""

# Summary
echo "======================================"
echo "📊 Health Check Summary"
echo "======================================"
echo -e "  Total Checks:      ${BLUE}$TOTAL_CHECKS${NC}"
echo -e "  Passed:            ${GREEN}$PASSED_CHECKS${NC}"
echo -e "  Failed:            ${RED}$FAILED_CHECKS${NC}"
echo -e "  Warnings:          ${YELLOW}$WARNINGS${NC}"
echo ""

# Overall status
if [ $FAILED_CHECKS -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
        echo -e "${GREEN}✅ System is fully healthy and ready for production!${NC}"
        exit 0
    else
        echo -e "${YELLOW}⚠️  System is operational but has $WARNINGS warning(s)${NC}"
        echo ""
        echo "Recommended actions for warnings:"
        echo "  • Review warning items above"
        echo "  • Consider configuring alert channels"
        echo "  • Check if all optional services are needed"
        exit 0
    fi
else
    echo -e "${RED}❌ System has $FAILED_CHECKS critical issue(s) that need attention${NC}"
    echo ""
    echo "Critical actions required:"
    echo "  1. Check if all services are running: ./scripts/start-all.sh"
    echo "  2. Check database migrations: ./scripts/check-db-migrations.sh"
    echo "  3. Review error logs: tail -f ./logs/error.log"
    echo "  4. Verify environment configuration: cat .env"
    echo "  5. Run integration tests: npm run test:integration"
    exit 1
fi