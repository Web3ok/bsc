#!/bin/bash
set -e

# ============================================
# BSC Trading Bot - Production Deployment Script
# Version: 1.0.0
# ============================================

echo "🚀 BSC Trading Bot - Production Deployment"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
REPO_DIR=$(pwd)
LOG_DIR="${REPO_DIR}/logs"
BACKUP_DIR="${REPO_DIR}/backups"

echo "📋 Step 1: Pre-deployment Checks"
if [ ! -f ".env.production" ]; then
  echo -e "${RED}❌ .env.production not found${NC}"
  exit 1
fi

if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2..."
  npm install -g pm2
fi

echo -e "${GREEN}✅ Checks passed${NC}"
echo ""

echo "📁 Step 2: Creating Directories"
mkdir -p "${LOG_DIR}" "${BACKUP_DIR}" "${REPO_DIR}/data"
echo -e "${GREEN}✅ Done${NC}"
echo ""

echo "📦 Step 3: Installing Dependencies"
npm ci
cd frontend && npm ci && cd ..
echo -e "${GREEN}✅ Done${NC}"
echo ""

echo "🔨 Step 4: Building Application"
npm run build
cd frontend && npm run build && cd ..
echo -e "${GREEN}✅ Done${NC}"
echo ""

echo "▶️  Step 5: Starting with PM2"
pm2 stop ecosystem.config.production.js 2>/dev/null || true
pm2 start ecosystem.config.production.js --env production
pm2 save

echo -e "${GREEN}✅ Deployment completed!${NC}"
echo ""
pm2 status
