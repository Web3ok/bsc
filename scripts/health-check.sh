#!/bin/bash

# BSC Trading Bot - Health Check Script

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

PORT=${PORT:-10001}

echo "🏥 BSC Trading Bot Health Check"
echo "========================================"
echo ""

# Function to check service
check_service() {
    local name=$1
    local url=$2
    local expected=$3
    
    if curl -s "$url" | grep -q "$expected" 2>/dev/null; then
        echo -e "${GREEN}✅ $name: Healthy${NC}"
        return 0
    else
        echo -e "${RED}❌ $name: Not responding${NC}"
        return 1
    fi
}

# Function to check port
check_port() {
    local name=$1
    local port=$2
    
    if lsof -i:$port > /dev/null 2>&1; then
        echo -e "${GREEN}✅ $name (port $port): Active${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️  $name (port $port): Inactive${NC}"
        return 1
    fi
}

# Check API Server
echo "📡 API Server Status:"
if check_service "Health Endpoint" "http://localhost:$PORT/api/health" "healthy"; then
    # Get detailed health info
    HEALTH_DATA=$(curl -s http://localhost:$PORT/api/health)
    echo -e "  ${BLUE}Version:${NC} $(echo $HEALTH_DATA | grep -oP '"version":"\K[^"]*' || echo 'N/A')"
    echo -e "  ${BLUE}Uptime:${NC} $(echo $HEALTH_DATA | grep -oP '"uptime":\K[0-9]*' || echo '0')s"
fi

echo ""
echo "🔌 Port Status:"
check_port "API Server" $PORT
check_port "Frontend Dev" 10002
check_port "Frontend Alt 1" 10003
check_port "Frontend Alt 2" 10004

echo ""
echo "🗄️  Database Status:"
if [ -f "./data/bot.db" ]; then
    SIZE=$(du -h ./data/bot.db | cut -f1)
    echo -e "${GREEN}✅ Database exists (${SIZE})${NC}"
    
    # Check table count
    TABLE_COUNT=$(sqlite3 ./data/bot.db "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
    echo -e "  ${BLUE}Tables:${NC} $TABLE_COUNT"
else
    echo -e "${RED}❌ Database not found${NC}"
fi

echo ""
echo "📊 Service Endpoints:"
echo "  - API Health: http://localhost:$PORT/api/health"
echo "  - API Prices: http://localhost:$PORT/api/prices/BNB"
echo "  - API Trading History: http://localhost:$PORT/api/trading/history"
echo "  - WebSocket: ws://localhost:$PORT"

echo ""
echo "🔑 Authentication:"
if [ ! -z "$JWT_SECRET" ] && [ "$JWT_SECRET" != "dev-secret-key-for-testing-only-256bits-long" ]; then
    echo -e "${GREEN}✅ Production JWT secret configured${NC}"
else
    echo -e "${YELLOW}⚠️  Using development JWT secret${NC}"
fi

echo ""
echo "📁 Log Files:"
if [ -d "logs" ]; then
    echo "  Log directory exists with $(ls -1 logs/*.log 2>/dev/null | wc -l) log files"
    
    # Show recent errors if any
    if [ -f "logs/api-server.log" ]; then
        ERROR_COUNT=$(grep -c ERROR logs/api-server.log 2>/dev/null || echo "0")
        if [ "$ERROR_COUNT" -gt 0 ]; then
            echo -e "  ${YELLOW}⚠️  Found $ERROR_COUNT errors in API server log${NC}"
        fi
    fi
else
    echo -e "${YELLOW}⚠️  Log directory not found${NC}"
fi

echo ""
echo "🔍 Process Status:"
ps aux | grep -E "node.*server|npm.*server" | grep -v grep > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Server processes running${NC}"
    ps aux | grep -E "node.*server|npm.*server" | grep -v grep | head -3 | while read line; do
        PID=$(echo $line | awk '{print $2}')
        CMD=$(echo $line | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}')
        echo -e "  ${BLUE}PID $PID:${NC} ${CMD:0:60}..."
    done
else
    echo -e "${RED}❌ No server processes found${NC}"
fi

echo ""
echo "========================================"

# Overall status
OVERALL_STATUS=0

# Check critical services
curl -s http://localhost:$PORT/api/health | grep -q "healthy" 2>/dev/null || OVERALL_STATUS=1

if [ $OVERALL_STATUS -eq 0 ]; then
    echo -e "${GREEN}✅ System Status: HEALTHY${NC}"
else
    echo -e "${RED}❌ System Status: DEGRADED${NC}"
    echo ""
    echo "🔧 Troubleshooting:"
    echo "  1. Check if services are running: ./scripts/start-all.sh"
    echo "  2. Check logs: tail -f logs/api-server.log"
    echo "  3. Check environment: cat .env"
    echo "  4. Run tests: npm test"
fi

echo "========================================"

exit $OVERALL_STATUS