#!/bin/bash

# BSC Trading Bot - Complete Startup Script
# This script starts all necessary services for the trading bot

set -e

echo "🚀 Starting BSC Trading Bot Services..."
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo -e "${RED}❌ Node.js version 16 or higher is required${NC}"
    exit 1
fi

# Set environment variables
export NODE_ENV=${NODE_ENV:-development}
export JWT_SECRET=${JWT_SECRET:-dev-secret-key-for-testing-only-256bits-long}
export PORT=${PORT:-10001}
export DATABASE_URL=${DATABASE_URL:-./data/bot.db}

echo "📝 Environment Configuration:"
echo "  - NODE_ENV: $NODE_ENV"
echo "  - PORT: $PORT"
echo "  - DATABASE_URL: $DATABASE_URL"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found, creating from template...${NC}"
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}✅ Created .env from .env.example${NC}"
    else
        echo -e "${YELLOW}Creating basic .env file...${NC}"
        cat > .env << EOF
JWT_SECRET=$JWT_SECRET
PORT=$PORT
DATABASE_URL=$DATABASE_URL
NODE_ENV=$NODE_ENV
BSC_RPC_URL=https://bsc-dataseed.binance.org/
COINGECKO_API_KEY=demo-key
DEFAULT_SLIPPAGE=0.5
EOF
        echo -e "${GREEN}✅ Created basic .env file${NC}"
    fi
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Run database migrations
echo ""
echo "🗄️  Setting up database..."
npx knex migrate:latest
echo -e "${GREEN}✅ Database migrations complete${NC}"

# Build TypeScript if needed
if [ ! -d "dist" ] || [ "$1" == "--build" ]; then
    echo ""
    echo "🔨 Building TypeScript..."
    npm run build || echo -e "${YELLOW}⚠️  Build had some issues, continuing...${NC}"
fi

# Kill existing processes on the ports
echo ""
echo "🔄 Checking for existing processes..."
lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
lsof -ti:10002 | xargs kill -9 2>/dev/null || true
lsof -ti:10003 | xargs kill -9 2>/dev/null || true
lsof -ti:10004 | xargs kill -9 2>/dev/null || true
echo -e "${GREEN}✅ Ports cleared${NC}"

# Start services
echo ""
echo "🚀 Starting services..."
echo "========================================"

# Start API server
echo "Starting API server on port $PORT..."
JWT_SECRET=$JWT_SECRET PORT=$PORT npm run server:dev > logs/api-server.log 2>&1 &
API_PID=$!
echo "API Server PID: $API_PID"

# Wait for API server to be ready
echo -n "Waiting for API server to start..."
for i in {1..30}; do
    if curl -s http://localhost:$PORT/api/health > /dev/null 2>&1; then
        echo -e " ${GREEN}✅${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Check if API server is running
if ! curl -s http://localhost:$PORT/api/health > /dev/null 2>&1; then
    echo -e " ${RED}❌ Failed to start API server${NC}"
    echo "Check logs/api-server.log for errors"
    exit 1
fi

# Start monitoring service (optional)
if [ "$1" == "--with-monitoring" ]; then
    echo "Starting monitoring service..."
    npm run monitor > logs/monitor.log 2>&1 &
    MONITOR_PID=$!
    echo "Monitoring Service PID: $MONITOR_PID"
fi

# Start frontend (optional)
if [ "$1" == "--with-frontend" ] || [ "$2" == "--with-frontend" ]; then
    echo "Starting frontend services..."
    cd frontend
    if [ ! -d "node_modules" ]; then
        npm install
    fi
    npm run dev > ../logs/frontend.log 2>&1 &
    FRONTEND_PID=$!
    cd ..
    echo "Frontend PID: $FRONTEND_PID"
fi

# Save PIDs to file for later shutdown
echo "$API_PID" > .pids/api.pid
[ ! -z "$MONITOR_PID" ] && echo "$MONITOR_PID" > .pids/monitor.pid
[ ! -z "$FRONTEND_PID" ] && echo "$FRONTEND_PID" > .pids/frontend.pid

# Display status
echo ""
echo "========================================"
echo -e "${GREEN}✅ All services started successfully!${NC}"
echo ""
echo "📊 Service Status:"
echo "  - API Server: http://localhost:$PORT"
echo "  - Health Check: http://localhost:$PORT/api/health"
[ ! -z "$FRONTEND_PID" ] && echo "  - Frontend: http://localhost:10002"
echo ""
echo "📁 Log Files:"
echo "  - API Server: logs/api-server.log"
[ ! -z "$MONITOR_PID" ] && echo "  - Monitoring: logs/monitor.log"
[ ! -z "$FRONTEND_PID" ] && echo "  - Frontend: logs/frontend.log"
echo ""
echo "🛑 To stop all services, run: ./scripts/stop-all.sh"
echo "========================================"

# Keep script running if --daemon flag is not set
if [ "$1" != "--daemon" ] && [ "$2" != "--daemon" ] && [ "$3" != "--daemon" ]; then
    echo ""
    echo "Press Ctrl+C to stop all services..."
    trap 'echo "Stopping services..."; ./scripts/stop-all.sh; exit' INT
    wait
fi