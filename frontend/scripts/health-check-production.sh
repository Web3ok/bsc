#!/bin/bash

# ==========================================
# BSC Trading Bot - Production Health Check
# ==========================================

set -e

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
echo "  Production Environment Health Check"
echo "========================================"
echo ""

# Check 1: Environment Mode
echo "🔍 Checking production environment..."
if grep -q "NODE_ENV=production" .env 2>/dev/null; then
    print_pass "Running in production mode"
else
    print_fail "Not running in production mode"
fi

# Check 2: Authentication
echo "🔍 Checking authentication..."
if grep -q "DISABLE_AUTH=false" .env 2>/dev/null; then
    print_pass "Authentication is enabled"
else
    print_fail "Authentication is DISABLED (security risk)"
fi

# Check 3: JWT Secret
echo "🔍 Checking JWT secret..."
if grep -q "dev-secret-key-for-testing-only" .env 2>/dev/null; then
    print_fail "Using development JWT_SECRET (security risk)"
else
    print_pass "Using custom JWT_SECRET"
fi

# Check 4: Encryption Password
echo "🔍 Checking encryption password..."
if grep -q "test-password" .env 2>/dev/null; then
    print_fail "Using test ENCRYPTION_PASSWORD (security risk)"
else
    print_pass "Using custom ENCRYPTION_PASSWORD"
fi

# Check 5: File Permissions
echo "🔍 Checking file permissions..."
if [ -f ".env" ]; then
    if [ "$(uname)" = "Darwin" ]; then
        PERMS=$(stat -f "%Lp" .env 2>/dev/null)
    else
        PERMS=$(stat -c "%a" .env 2>/dev/null)
    fi
    if [ "$PERMS" = "600" ]; then
        print_pass ".env file permissions are secure (600)"
    else
        print_warn ".env file permissions are $PERMS (should be 600)"
    fi
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
    echo -e "${GREEN}🎉 Production environment is healthy!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Critical issues found. Please review above.${NC}"
    exit 1
fi
