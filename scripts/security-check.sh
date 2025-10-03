#!/bin/bash

# Security Check Script for BSC Trading Bot
# Run this before production deployment

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================"
echo "BSC Trading Bot Security Check"
echo "================================"
echo ""

ISSUES=0

# Check 1: Environment variables
echo "1. Checking environment configuration..."
if [ -f .env ]; then
    if grep -q "dev-secret-key-for-testing-only" .env; then
        echo -e "${RED}✗ CRITICAL: Using development JWT_SECRET in production!${NC}"
        ISSUES=$((ISSUES + 1))
    else
        echo -e "${GREEN}✓ JWT_SECRET is not using development key${NC}"
    fi

    if grep -q "your-encryption-password" .env; then
        echo -e "${RED}✗ CRITICAL: Using example ENCRYPTION_PASSWORD!${NC}"
        ISSUES=$((ISSUES + 1))
    else
        echo -e "${GREEN}✓ ENCRYPTION_PASSWORD is customized${NC}"
    fi

    if grep -q "DISABLE_AUTH=true" .env; then
        echo -e "${RED}✗ CRITICAL: Authentication is disabled!${NC}"
        ISSUES=$((ISSUES + 1))
    else
        echo -e "${GREEN}✓ Authentication is enabled${NC}"
    fi
else
    echo -e "${RED}✗ .env file not found!${NC}"
    ISSUES=$((ISSUES + 1))
fi

echo ""

# Check 2: Node modules security
echo "2. Checking npm packages for vulnerabilities..."
if command -v npm &> /dev/null; then
    npm audit --production 2>&1 | tee /tmp/npm-audit.log
    if grep -q "found 0 vulnerabilities" /tmp/npm-audit.log; then
        echo -e "${GREEN}✓ No npm vulnerabilities found${NC}"
    else
        echo -e "${YELLOW}⚠ npm vulnerabilities detected - review above${NC}"
        ISSUES=$((ISSUES + 1))
    fi
fi

echo ""

# Check 3: File permissions
echo "3. Checking file permissions..."
if [ -f .env ]; then
    PERMS=$(stat -f "%A" .env 2>/dev/null || stat -c "%a" .env 2>/dev/null)
    if [ "$PERMS" = "600" ] || [ "$PERMS" = "400" ]; then
        echo -e "${GREEN}✓ .env file has secure permissions${NC}"
    else
        echo -e "${YELLOW}⚠ .env file permissions are $PERMS (should be 600 or 400)${NC}"
        chmod 600 .env
        echo -e "${GREEN}✓ Fixed .env permissions to 600${NC}"
    fi
fi

echo ""

# Check 4: Database security
echo "4. Checking database configuration..."
if [ -f .env ]; then
    if grep -q "DB_PASSWORD=.*password" .env; then
        echo -e "${RED}✗ CRITICAL: Using weak database password!${NC}"
        ISSUES=$((ISSUES + 1))
    else
        echo -e "${GREEN}✓ Database password is customized${NC}"
    fi
fi

echo ""

# Check 5: SSL/TLS
echo "5. Checking SSL/TLS configuration..."
if [ -f .env ]; then
    SSL_CERT=$(grep "SSL_CERT_PATH" .env | cut -d'=' -f2)
    SSL_KEY=$(grep "SSL_KEY_PATH" .env | cut -d'=' -f2)

    if [ -n "$SSL_CERT" ] && [ -f "$SSL_CERT" ]; then
        echo -e "${GREEN}✓ SSL certificate found${NC}"
    else
        echo -e "${YELLOW}⚠ SSL certificate not configured${NC}"
    fi
fi

echo ""

# Check 6: CORS configuration
echo "6. Checking CORS configuration..."
if [ -f .env ]; then
    CORS=$(grep "CORS_ORIGINS" .env | cut -d'=' -f2)
    if [[ "$CORS" == *"localhost"* ]]; then
        echo -e "${YELLOW}⚠ CORS includes localhost - remove in production${NC}"
        ISSUES=$((ISSUES + 1))
    else
        echo -e "${GREEN}✓ CORS configured for production${NC}"
    fi
fi

echo ""

# Check 7: Exposed secrets in code
echo "7. Checking for exposed secrets in code..."
if grep -r "private.*key.*=.*0x" src/ 2>/dev/null | grep -v "example\|test" | head -5; then
    echo -e "${RED}✗ CRITICAL: Found potential private keys in code!${NC}"
    ISSUES=$((ISSUES + 1))
else
    echo -e "${GREEN}✓ No exposed private keys found in code${NC}"
fi

echo ""

# Check 8: Git security
echo "8. Checking git configuration..."
if [ -d .git ]; then
    if [ -f .gitignore ]; then
        if grep -q "\.env" .gitignore; then
            echo -e "${GREEN}✓ .env is in .gitignore${NC}"
        else
            echo -e "${RED}✗ .env not in .gitignore!${NC}"
            ISSUES=$((ISSUES + 1))
        fi

        if grep -q "private.*key" .gitignore; then
            echo -e "${GREEN}✓ Private keys are in .gitignore${NC}"
        else
            echo -e "${YELLOW}⚠ Add private key patterns to .gitignore${NC}"
        fi
    fi
fi

echo ""
echo "================================"
echo "Security Check Summary"
echo "================================"

if [ $ISSUES -eq 0 ]; then
    echo -e "${GREEN}✓ All security checks passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Found $ISSUES security issues!${NC}"
    echo -e "${YELLOW}Please fix the issues above before deploying to production.${NC}"
    exit 1
fi
