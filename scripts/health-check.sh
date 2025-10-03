#!/bin/bash

# ==========================================
# BSC Trading Bot - Health Check Script
# ==========================================
#
# This script performs comprehensive health checks
#
# Usage:
#   ./scripts/health-check.sh
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed
# ==========================================

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

print_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    PASSED=$((PASSED + 1))
}

print_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    FAILED=$((FAILED + 1))
}

print_warn() {
    echo -e "${YELLOW}⚠️  WARN${NC}: $1"
}

echo "========================================"
echo "  BSC Trading Bot - Health Check"
echo "========================================"
echo ""

# Check 1: Backend API
echo "🔍 Checking backend API..."
if curl -f -s http://localhost:10001/api/dashboard/status > /dev/null; then
    print_pass "Backend API is responding"
else
    print_fail "Backend API is not responding"
fi

# Check 2: Frontend
echo "🔍 Checking frontend..."
if curl -f -s http://localhost:10002 > /dev/null; then
    print_pass "Frontend is responding"
else
    print_fail "Frontend is not responding"
fi

# Check 3: WebSocket
echo "🔍 Checking WebSocket..."
if curl -f -s http://localhost:10001 > /dev/null; then
    print_pass "WebSocket endpoint is accessible"
else
    print_fail "WebSocket endpoint is not accessible"
fi

# Check 4: Database
echo "🔍 Checking database..."
if [ -f "./data/bot.db" ]; then
    print_pass "Database file exists"
else
    print_warn "Database file not found (may not be initialized yet)"
fi

# Check 5: Environment variables
echo "🔍 Checking environment..."
if [ -f ".env" ]; then
    print_pass ".env file exists"
    
    if grep -q "dev-secret-key-for-testing-only" .env; then
        print_warn "Using development JWT_SECRET"
    fi
    
    if grep -q "NODE_ENV=production" .env; then
        print_pass "Running in production mode"
    else
        print_warn "Running in development mode"
    fi
else
    print_fail ".env file not found"
fi

# Check 6: Disk space
echo "🔍 Checking disk space..."
DISK_USAGE=$(df -h . | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -lt 90 ]; then
    print_pass "Disk space is sufficient ($DISK_USAGE% used)"
else
    print_fail "Disk space is running low ($DISK_USAGE% used)"
fi

# Check 7: PM2 processes
echo "🔍 Checking PM2 processes..."
if command -v pm2 &> /dev/null; then
    if pm2 list | grep -q "online"; then
        print_pass "PM2 processes are running"
    else
        print_warn "PM2 is installed but no processes are running"
    fi
else
    print_warn "PM2 is not installed"
fi

# Summary
echo ""
echo "========================================"
echo "  Health Check Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All checks passed!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some checks failed. Please review the issues above.${NC}"
    exit 1
fi
