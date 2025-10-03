#!/bin/bash

# Comprehensive API Testing Script

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

API_URL="http://localhost:10001"
PASSED=0
FAILED=0

test_api() {
    local name=$1
    local endpoint=$2
    local method=${3:-GET}
    local data=$4
    
    echo -n "Testing $name... "
    
    if [ "$method" = "GET" ]; then
        if curl -f -s "$API_URL$endpoint" > /dev/null; then
            echo -e "${GREEN}✅ PASS${NC}"
            PASSED=$((PASSED + 1))
        else
            echo -e "${RED}❌ FAIL${NC}"
            FAILED=$((FAILED + 1))
        fi
    elif [ "$method" = "POST" ]; then
        if curl -f -s -X POST -H "Content-Type: application/json" -d "$data" "$API_URL$endpoint" > /dev/null; then
            echo -e "${GREEN}✅ PASS${NC}"
            PASSED=$((PASSED + 1))
        else
            echo -e "${RED}❌ FAIL${NC}"
            FAILED=$((FAILED + 1))
        fi
    fi
}

echo "=========================================="
echo "  Comprehensive API Testing"
echo "=========================================="
echo ""

# Dashboard APIs
echo "📊 Dashboard APIs:"
test_api "Dashboard Overview" "/api/dashboard/overview"
test_api "Dashboard Status" "/api/dashboard/status"
echo ""

# Trading APIs
echo "💱 Trading APIs:"
test_api "Trading Quote (BNB→CAKE)" "/api/trading/quote" "POST" '{"tokenIn":"BNB","tokenOut":"0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82","amountIn":"0.1","slippage":0.5}'
echo ""

# Wallet APIs
echo "💼 Wallet APIs:"
test_api "Wallet List" "/api/v1/wallets/list"
echo ""

# Monitoring APIs
echo "📈 Monitoring APIs:"
test_api "Monitoring Alerts" "/api/monitoring/alerts"
test_api "System Metrics" "/api/monitoring/metrics"
test_api "Health Checks" "/api/monitoring/health-checks"
echo ""

# Batch APIs
echo "🔄 Batch Operation APIs:"
test_api "Batch Operations Create" "/api/v1/batch/operations" "POST" '{"operations":[],"config":{"maxConcurrency":1}}'
echo ""

# Summary
echo ""
echo "=========================================="
echo "  Test Summary"
echo "=========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All API tests passed!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some API tests failed!${NC}"
    exit 1
fi
