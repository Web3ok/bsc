#!/bin/bash

# One-Click Deployment Script for BSC Trading Bot
# Usage: ./scripts/deploy.sh [environment]

set -e

ENVIRONMENT=${1:-production}

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "================================"
echo "BSC Trading Bot Deployment"
echo "Environment: $ENVIRONMENT"
echo "================================"
echo ""

# Step 1: Security check
echo -e "${BLUE}[1/8] Running security checks...${NC}"
if [ -f scripts/security-check.sh ]; then
    bash scripts/security-check.sh || {
        echo -e "${YELLOW}Security check failed. Continue anyway? (y/N)${NC}"
        read -r response
        if [[ ! "$response" =~ ^[Yy]$ ]]; then
            exit 1
        fi
    }
fi

# Step 2: Install dependencies
echo -e "${BLUE}[2/8] Installing dependencies...${NC}"
npm ci --production

# Step 3: Build backend
echo -e "${BLUE}[3/8] Building backend...${NC}"
npm run build

# Step 4: Build frontend
echo -e "${BLUE}[4/8] Building frontend...${NC}"
cd frontend
npm ci --production
npm run build
cd ..

# Step 5: Database migration
echo -e "${BLUE}[5/8] Running database migrations...${NC}"
if [ "$ENVIRONMENT" = "production" ]; then
    NODE_ENV=production npm run migrate
else
    npm run migrate
fi

# Step 6: Create necessary directories
echo -e "${BLUE}[6/8] Creating directories...${NC}"
mkdir -p data/exports
mkdir -p data/backups
mkdir -p logs

# Step 7: Set file permissions
echo -e "${BLUE}[7/8] Setting file permissions...${NC}"
chmod 600 .env 2>/dev/null || true
chmod -R 755 data
chmod -R 755 logs

# Step 8: Start services
echo -e "${BLUE}[8/8] Starting services...${NC}"

if command -v pm2 &> /dev/null; then
    # Using PM2
    echo "Using PM2 for process management..."

    # Stop existing processes
    pm2 delete bsc-bot-backend 2>/dev/null || true
    pm2 delete bsc-bot-frontend 2>/dev/null || true

    # Start backend
    if [ "$ENVIRONMENT" = "production" ]; then
        pm2 start npm --name "bsc-bot-backend" -- run start:full
    else
        pm2 start npm --name "bsc-bot-backend" -- run server:dev
    fi

    # Start frontend
    cd frontend
    if [ "$ENVIRONMENT" = "production" ]; then
        pm2 start npm --name "bsc-bot-frontend" -- start
    else
        pm2 start npm --name "bsc-bot-frontend" -- run dev
    fi
    cd ..

    # Save PM2 configuration
    pm2 save

    echo -e "${GREEN}✓ Services started with PM2${NC}"
    echo ""
    echo "Use 'pm2 status' to check service status"
    echo "Use 'pm2 logs' to view logs"

elif command -v systemctl &> /dev/null; then
    # Using systemd
    echo "Using systemd for process management..."

    # Create systemd service files
    cat > /tmp/bsc-bot.service << EOF
[Unit]
Description=BSC Trading Bot Backend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
Environment="NODE_ENV=$ENVIRONMENT"
ExecStart=$(which node) dist/server.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    sudo mv /tmp/bsc-bot.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable bsc-bot
    sudo systemctl restart bsc-bot

    echo -e "${GREEN}✓ Backend service started with systemd${NC}"
    echo "Use 'sudo systemctl status bsc-bot' to check status"

else
    # Fallback: run directly
    echo "No process manager found, starting services directly..."

    if [ "$ENVIRONMENT" = "production" ]; then
        nohup npm run start:full > logs/backend.log 2>&1 &
        cd frontend && nohup npm start > ../logs/frontend.log 2>&1 &
    else
        nohup npm run server:dev > logs/backend.log 2>&1 &
        cd frontend && nohup npm run dev > ../logs/frontend.log 2>&1 &
    fi

    echo -e "${GREEN}✓ Services started in background${NC}"
    echo "Logs are available in logs/ directory"
fi

echo ""
echo "================================"
echo -e "${GREEN}Deployment Complete!${NC}"
echo "================================"
echo ""
echo "Backend: http://localhost:10001"
echo "Frontend: http://localhost:$(cd frontend && grep -o "PORT=[0-9]*" .env.local 2>/dev/null | cut -d= -f2 || echo 3000)"
echo ""
echo "Health check: curl http://localhost:10001/api/health"
echo ""
