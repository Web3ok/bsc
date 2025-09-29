#!/bin/bash

# BSC Trading Bot - Stop All Services Script

echo "🛑 Stopping BSC Trading Bot Services..."
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Stop services using PID files
if [ -d ".pids" ]; then
    if [ -f ".pids/api.pid" ]; then
        PID=$(cat .pids/api.pid)
        if kill -0 $PID 2>/dev/null; then
            kill $PID
            echo -e "${GREEN}✅ Stopped API server (PID: $PID)${NC}"
        else
            echo -e "${YELLOW}⚠️  API server not running${NC}"
        fi
        rm -f .pids/api.pid
    fi
    
    if [ -f ".pids/monitor.pid" ]; then
        PID=$(cat .pids/monitor.pid)
        if kill -0 $PID 2>/dev/null; then
            kill $PID
            echo -e "${GREEN}✅ Stopped monitoring service (PID: $PID)${NC}"
        else
            echo -e "${YELLOW}⚠️  Monitoring service not running${NC}"
        fi
        rm -f .pids/monitor.pid
    fi
    
    if [ -f ".pids/frontend.pid" ]; then
        PID=$(cat .pids/frontend.pid)
        if kill -0 $PID 2>/dev/null; then
            kill $PID
            echo -e "${GREEN}✅ Stopped frontend (PID: $PID)${NC}"
        else
            echo -e "${YELLOW}⚠️  Frontend not running${NC}"
        fi
        rm -f .pids/frontend.pid
    fi
fi

# Kill any remaining processes on known ports
echo ""
echo "🔄 Cleaning up ports..."
lsof -ti:10001 | xargs kill -9 2>/dev/null && echo "  - Cleaned port 10001" || true
lsof -ti:10002 | xargs kill -9 2>/dev/null && echo "  - Cleaned port 10002" || true
lsof -ti:10003 | xargs kill -9 2>/dev/null && echo "  - Cleaned port 10003" || true
lsof -ti:10004 | xargs kill -9 2>/dev/null && echo "  - Cleaned port 10004" || true

# Kill any node processes related to the project
pkill -f "npm run server" 2>/dev/null || true
pkill -f "npm run monitor" 2>/dev/null || true
pkill -f "npm run dev" 2>/dev/null || true

echo ""
echo "========================================"
echo -e "${GREEN}✅ All services stopped${NC}"
echo "========================================"