#!/bin/bash

# BSC Trading Bot - Database Migration Checker
# This script verifies that all database migrations are up to date

set -e

echo "======================================"
echo "BSC Trading Bot - Database Migration Check"
echo "======================================"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if knex is available
if ! command -v npx &> /dev/null; then
    echo -e "${RED}❌ Error: npx is not available${NC}"
    exit 1
fi

# Function to check migration status
check_migrations() {
    echo "📊 Checking migration status..."
    echo ""
    
    # Get current migration status
    MIGRATION_STATUS=$(npx knex migrate:status 2>&1)
    
    if echo "$MIGRATION_STATUS" | grep -q "Error"; then
        echo -e "${RED}❌ Error checking migration status:${NC}"
        echo "$MIGRATION_STATUS"
        return 1
    fi
    
    # Check for pending migrations
    if echo "$MIGRATION_STATUS" | grep -q "Pending"; then
        echo -e "${YELLOW}⚠️  There are pending migrations:${NC}"
        echo "$MIGRATION_STATUS"
        echo ""
        echo "Run the following command to apply migrations:"
        echo "  npx knex migrate:latest"
        return 2
    else
        echo -e "${GREEN}✅ All migrations are up to date${NC}"
        echo "$MIGRATION_STATUS"
        return 0
    fi
}

# Function to list all available migrations
list_migrations() {
    echo ""
    echo "📋 Available migrations:"
    echo ""
    
    if [ -d "./migrations" ]; then
        ls -la ./migrations/*.js 2>/dev/null | awk '{print "  - " $NF}' | sed 's|.*/||'
    else
        echo -e "${YELLOW}⚠️  No migrations directory found${NC}"
    fi
}

# Function to check database connectivity
check_database() {
    echo ""
    echo "🔌 Checking database connectivity..."
    
    # Try to run a simple query
    if npx knex raw "SELECT 1" &> /dev/null; then
        echo -e "${GREEN}✅ Database connection successful${NC}"
        
        # Get database type and version
        DB_INFO=$(npx knex raw "SELECT sqlite_version() as version" 2>/dev/null || npx knex raw "SELECT version()" 2>/dev/null)
        echo "  Database info: $DB_INFO"
    else
        echo -e "${RED}❌ Cannot connect to database${NC}"
        echo "  Please check your DATABASE_URL configuration"
        return 1
    fi
}

# Function to count tables
count_tables() {
    echo ""
    echo "📊 Database statistics:"
    
    # For SQLite
    if [ -f "./data/bot.db" ]; then
        TABLE_COUNT=$(sqlite3 ./data/bot.db "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
        echo "  Total tables: $TABLE_COUNT"
        
        # List critical tables
        echo ""
        echo "  Critical tables check:"
        CRITICAL_TABLES=(
            "wallets"
            "transactions"
            "blockchain_transactions"
            "monitoring_status"
            "monitoring_alerts"
            "strategies"
            "orders"
            "price_cache"
            "trading_history"
        )
        
        for table in "${CRITICAL_TABLES[@]}"; do
            if sqlite3 ./data/bot.db ".tables" 2>/dev/null | grep -q "$table"; then
                ROW_COUNT=$(sqlite3 ./data/bot.db "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "0")
                echo -e "    ${GREEN}✓${NC} $table (rows: $ROW_COUNT)"
            else
                echo -e "    ${RED}✗${NC} $table (missing)"
            fi
        done
    fi
}

# Function to backup database before migration
backup_database() {
    echo ""
    echo "💾 Creating database backup..."
    
    BACKUP_DIR="./backups"
    mkdir -p "$BACKUP_DIR"
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    
    if [ -f "./data/bot.db" ]; then
        BACKUP_FILE="$BACKUP_DIR/bot_${TIMESTAMP}.db"
        cp ./data/bot.db "$BACKUP_FILE"
        echo -e "${GREEN}✅ Database backed up to: $BACKUP_FILE${NC}"
        
        # Compress the backup
        gzip "$BACKUP_FILE"
        echo "  Compressed to: ${BACKUP_FILE}.gz"
        
        # Clean old backups (keep last 10)
        ls -t "$BACKUP_DIR"/*.gz 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null
        echo "  Old backups cleaned (keeping last 10)"
    else
        echo -e "${YELLOW}⚠️  No database file found to backup${NC}"
    fi
}

# Main execution
main() {
    echo "Starting database migration check..."
    echo ""
    
    # Check database connectivity
    if ! check_database; then
        echo -e "${RED}Database check failed. Exiting.${NC}"
        exit 1
    fi
    
    # List migrations
    list_migrations
    
    # Check migration status
    MIGRATION_RESULT=0
    check_migrations || MIGRATION_RESULT=$?
    
    if [ $MIGRATION_RESULT -eq 2 ]; then
        # Pending migrations found
        echo ""
        read -p "Do you want to apply pending migrations now? (y/n): " -n 1 -r
        echo ""
        
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            # Backup before migration
            backup_database
            
            echo ""
            echo "🚀 Applying migrations..."
            npx knex migrate:latest
            
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ Migrations applied successfully${NC}"
                
                # Show updated status
                echo ""
                check_migrations
            else
                echo -e "${RED}❌ Migration failed${NC}"
                exit 1
            fi
        fi
    fi
    
    # Count tables
    count_tables
    
    echo ""
    echo "======================================"
    echo -e "${GREEN}Database check complete!${NC}"
    echo "======================================"
}

# Run main function
main