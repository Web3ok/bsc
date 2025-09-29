#!/bin/bash

# BSC Trading Bot - Automated Backup Script
# Backs up database, configuration, and critical files

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="bsc_bot_backup_${TIMESTAMP}"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "======================================"
echo "🔒 BSC Trading Bot - Automated Backup"
echo "======================================"
echo ""
echo "Backup Time: $(date)"
echo "Backup Name: $BACKUP_NAME"
echo ""

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"
TEMP_DIR="$BACKUP_DIR/.temp_$TIMESTAMP"
mkdir -p "$TEMP_DIR"

# Track backup status
BACKUP_SUCCESS=true
TOTAL_SIZE=0

# Function to calculate directory size
get_size() {
    du -sh "$1" 2>/dev/null | cut -f1 || echo "0"
}

# Function to backup file/directory
backup_item() {
    local source=$1
    local dest=$2
    local description=$3
    
    echo -n "  Backing up $description... "
    
    if [ -e "$source" ]; then
        cp -r "$source" "$dest" 2>/dev/null
        if [ $? -eq 0 ]; then
            SIZE=$(get_size "$dest")
            echo -e "${GREEN}✓ ($SIZE)${NC}"
            return 0
        else
            echo -e "${RED}✗ Failed${NC}"
            BACKUP_SUCCESS=false
            return 1
        fi
    else
        echo -e "${YELLOW}⚠ Not found${NC}"
        return 2
    fi
}

echo "📁 Creating backup..."
echo ""

# 1. Backup Database
echo "1️⃣  Database Backup"
echo "━━━━━━━━━━━━━━━━━"

# SQLite database
if [ -f "./data/bot.db" ]; then
    # Create database backup with integrity check
    echo -n "  Checking database integrity... "
    if sqlite3 ./data/bot.db "PRAGMA integrity_check;" | grep -q "ok"; then
        echo -e "${GREEN}✓ OK${NC}"
        
        # Backup with VACUUM to optimize
        echo -n "  Creating optimized backup... "
        sqlite3 ./data/bot.db ".backup '$TEMP_DIR/bot.db'"
        
        if [ $? -eq 0 ]; then
            DB_SIZE=$(get_size "$TEMP_DIR/bot.db")
            echo -e "${GREEN}✓ ($DB_SIZE)${NC}"
            
            # Get database stats
            TABLE_COUNT=$(sqlite3 "$TEMP_DIR/bot.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null)
            echo "    Tables: $TABLE_COUNT"
        else
            echo -e "${RED}✗ Failed${NC}"
            BACKUP_SUCCESS=false
        fi
    else
        echo -e "${RED}✗ Integrity check failed${NC}"
        echo "    Attempting raw copy..."
        backup_item "./data/bot.db" "$TEMP_DIR/bot.db" "database (raw)"
    fi
else
    echo -e "${YELLOW}  ⚠ No database found${NC}"
fi

# PostgreSQL database (if configured)
if [ ! -z "$DATABASE_URL" ] && [[ "$DATABASE_URL" == postgres* ]]; then
    echo -n "  PostgreSQL backup... "
    pg_dump "$DATABASE_URL" > "$TEMP_DIR/postgres_dump.sql" 2>/dev/null
    if [ $? -eq 0 ]; then
        gzip "$TEMP_DIR/postgres_dump.sql"
        PG_SIZE=$(get_size "$TEMP_DIR/postgres_dump.sql.gz")
        echo -e "${GREEN}✓ ($PG_SIZE)${NC}"
    else
        echo -e "${YELLOW}⚠ Skipped${NC}"
    fi
fi

echo ""

# 2. Backup Configuration
echo "2️⃣  Configuration Backup"
echo "━━━━━━━━━━━━━━━━━━━━"

backup_item ".env" "$TEMP_DIR/.env" "environment config"
backup_item "knexfile.js" "$TEMP_DIR/knexfile.js" "database config"
backup_item "pm2.json" "$TEMP_DIR/pm2.json" "PM2 config"
backup_item "package.json" "$TEMP_DIR/package.json" "package config"
backup_item "tsconfig.json" "$TEMP_DIR/tsconfig.json" "TypeScript config"

echo ""

# 3. Backup Migrations
echo "3️⃣  Migrations Backup"
echo "━━━━━━━━━━━━━━━━"

if [ -d "./migrations" ]; then
    mkdir -p "$TEMP_DIR/migrations"
    backup_item "./migrations" "$TEMP_DIR/migrations" "database migrations"
else
    echo -e "${YELLOW}  ⚠ No migrations directory${NC}"
fi

echo ""

# 4. Backup Logs (last 1000 lines of each)
echo "4️⃣  Logs Backup"
echo "━━━━━━━━━━━"

if [ -d "./logs" ]; then
    mkdir -p "$TEMP_DIR/logs"
    
    for logfile in ./logs/*.log; do
        if [ -f "$logfile" ]; then
            filename=$(basename "$logfile")
            echo -n "  Backing up $filename... "
            tail -n 1000 "$logfile" > "$TEMP_DIR/logs/$filename" 2>/dev/null
            echo -e "${GREEN}✓${NC}"
        fi
    done
else
    echo -e "${YELLOW}  ⚠ No logs directory${NC}"
fi

echo ""

# 5. Backup Scripts
echo "5️⃣  Scripts Backup"
echo "━━━━━━━━━━━━━━"

if [ -d "./scripts" ]; then
    mkdir -p "$TEMP_DIR/scripts"
    backup_item "./scripts" "$TEMP_DIR/scripts" "utility scripts"
else
    echo -e "${YELLOW}  ⚠ No scripts directory${NC}"
fi

echo ""

# 6. Create backup metadata
echo "6️⃣  Creating Metadata"
echo "━━━━━━━━━━━━━━━━━"

cat > "$TEMP_DIR/backup_info.json" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "$(grep version package.json | head -1 | awk -F'"' '{print $4}')",
  "environment": "${NODE_ENV:-development}",
  "hostname": "$(hostname)",
  "backup_tool_version": "1.0.0",
  "files": {
    "database": $([ -f "$TEMP_DIR/bot.db" ] && echo "true" || echo "false"),
    "config": $([ -f "$TEMP_DIR/.env" ] && echo "true" || echo "false"),
    "migrations": $([ -d "$TEMP_DIR/migrations" ] && echo "true" || echo "false"),
    "logs": $([ -d "$TEMP_DIR/logs" ] && echo "true" || echo "false"),
    "scripts": $([ -d "$TEMP_DIR/scripts" ] && echo "true" || echo "false")
  }
}
EOF

echo -e "  Metadata file created ${GREEN}✓${NC}"

echo ""

# 7. Compress backup
echo "7️⃣  Compressing Backup"
echo "━━━━━━━━━━━━━━━━━━"

cd "$BACKUP_DIR"
echo -n "  Creating archive... "

tar -czf "${BACKUP_NAME}.tar.gz" ".temp_$TIMESTAMP" 2>/dev/null

if [ $? -eq 0 ]; then
    FINAL_SIZE=$(get_size "${BACKUP_NAME}.tar.gz")
    echo -e "${GREEN}✓ ($FINAL_SIZE)${NC}"
    
    # Remove temp directory
    rm -rf ".temp_$TIMESTAMP"
else
    echo -e "${RED}✗ Compression failed${NC}"
    BACKUP_SUCCESS=false
fi

cd - > /dev/null

echo ""

# 8. Encrypt backup (optional)
if [ ! -z "$BACKUP_ENCRYPTION_KEY" ]; then
    echo "8️⃣  Encrypting Backup"
    echo "━━━━━━━━━━━━━━━━━"
    
    echo -n "  Encrypting with AES-256... "
    openssl enc -aes-256-cbc -salt -in "$BACKUP_DIR/${BACKUP_NAME}.tar.gz" \
        -out "$BACKUP_DIR/${BACKUP_NAME}.tar.gz.enc" \
        -pass pass:"$BACKUP_ENCRYPTION_KEY" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC}"
        rm "$BACKUP_DIR/${BACKUP_NAME}.tar.gz"
        BACKUP_FILE="${BACKUP_NAME}.tar.gz.enc"
    else
        echo -e "${YELLOW}⚠ Encryption failed, keeping unencrypted${NC}"
        BACKUP_FILE="${BACKUP_NAME}.tar.gz"
    fi
    
    echo ""
else
    BACKUP_FILE="${BACKUP_NAME}.tar.gz"
fi

# 9. Clean old backups
echo "9️⃣  Cleaning Old Backups"
echo "━━━━━━━━━━━━━━━━━━━"

OLD_BACKUPS=$(find "$BACKUP_DIR" -name "bsc_bot_backup_*.tar.gz*" -type f -mtime +$RETENTION_DAYS 2>/dev/null | wc -l)

if [ $OLD_BACKUPS -gt 0 ]; then
    echo -n "  Removing $OLD_BACKUPS old backup(s)... "
    find "$BACKUP_DIR" -name "bsc_bot_backup_*.tar.gz*" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null
    echo -e "${GREEN}✓${NC}"
else
    echo "  No old backups to remove"
fi

# List current backups
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/bsc_bot_backup_*.tar.gz* 2>/dev/null | wc -l)
TOTAL_BACKUP_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)

echo "  Current backups: $BACKUP_COUNT"
echo "  Total size: $TOTAL_BACKUP_SIZE"

echo ""

# 10. Optional: Upload to cloud storage
if [ ! -z "$BACKUP_S3_BUCKET" ] && command -v aws &> /dev/null; then
    echo "🔟 Cloud Upload"
    echo "━━━━━━━━━━━━"
    
    echo -n "  Uploading to S3... "
    aws s3 cp "$BACKUP_DIR/$BACKUP_FILE" "s3://$BACKUP_S3_BUCKET/backups/$BACKUP_FILE" --quiet
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗ Upload failed${NC}"
    fi
    
    echo ""
fi

# Summary
echo "======================================"
echo "📊 Backup Summary"
echo "======================================"

if [ "$BACKUP_SUCCESS" = true ]; then
    echo -e "${GREEN}✅ Backup completed successfully!${NC}"
    echo ""
    echo "  Backup file: $BACKUP_DIR/$BACKUP_FILE"
    echo "  Size: $(get_size "$BACKUP_DIR/$BACKUP_FILE")"
    echo "  Retention: $RETENTION_DAYS days"
    
    # Restore instructions
    echo ""
    echo "To restore from this backup:"
    echo "  1. Extract: tar -xzf $BACKUP_FILE"
    if [ ! -z "$BACKUP_ENCRYPTION_KEY" ]; then
        echo "     (Decrypt first: openssl enc -d -aes-256-cbc -in $BACKUP_FILE -out backup.tar.gz)"
    fi
    echo "  2. Stop services: ./scripts/stop-all.sh"
    echo "  3. Restore files: cp -r .temp_*/. ."
    echo "  4. Start services: ./scripts/start-all.sh"
    
    exit 0
else
    echo -e "${RED}❌ Backup completed with errors${NC}"
    echo "Please check the errors above and try again"
    exit 1
fi