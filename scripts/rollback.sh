#!/bin/bash

# BSC Trading Bot - Emergency Rollback Script
# Quickly rollback to a previous backup in case of deployment failure

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
ROLLBACK_TEMP="/tmp/bsc_bot_rollback_$$"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "======================================"
echo "⚠️  BSC Trading Bot - Emergency Rollback"
echo "======================================"
echo ""
echo -e "${YELLOW}WARNING: This will restore the system to a previous state!${NC}"
echo ""

# Function to list available backups
list_backups() {
    echo "📦 Available Backups:"
    echo "━━━━━━━━━━━━━━━━━━"
    
    if [ ! -d "$BACKUP_DIR" ]; then
        echo -e "${RED}No backup directory found!${NC}"
        exit 1
    fi
    
    BACKUPS=($(ls -1t "$BACKUP_DIR"/bsc_bot_backup_*.tar.gz* 2>/dev/null))
    
    if [ ${#BACKUPS[@]} -eq 0 ]; then
        echo -e "${RED}No backups found!${NC}"
        exit 1
    fi
    
    for i in "${!BACKUPS[@]}"; do
        BACKUP_FILE=$(basename "${BACKUPS[$i]}")
        BACKUP_SIZE=$(du -h "${BACKUPS[$i]}" | cut -f1)
        BACKUP_DATE=$(echo "$BACKUP_FILE" | grep -oE '[0-9]{8}_[0-9]{6}' | sed 's/_/ /')
        
        echo "  $((i+1)). $BACKUP_FILE"
        echo "      Date: $BACKUP_DATE"
        echo "      Size: $BACKUP_SIZE"
        echo ""
    done
    
    return ${#BACKUPS[@]}
}

# Function to create emergency backup before rollback
create_emergency_backup() {
    echo "🔒 Creating emergency backup before rollback..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    EMERGENCY_BACKUP="$BACKUP_DIR/emergency_$(date +%Y%m%d_%H%M%S).tar.gz"
    
    # Backup critical current state
    tar -czf "$EMERGENCY_BACKUP" \
        ./data/bot.db \
        ./.env \
        ./logs \
        2>/dev/null || true
    
    if [ -f "$EMERGENCY_BACKUP" ]; then
        echo -e "${GREEN}✓ Emergency backup created: $(basename $EMERGENCY_BACKUP)${NC}"
    else
        echo -e "${YELLOW}⚠ Could not create emergency backup${NC}"
    fi
    
    echo ""
}

# Function to stop all services
stop_services() {
    echo "🛑 Stopping all services..."
    echo "━━━━━━━━━━━━━━━━━━━━"
    
    # Stop PM2 processes
    if command -v pm2 &> /dev/null; then
        echo -n "  Stopping PM2 processes... "
        pm2 stop all 2>/dev/null || true
        echo -e "${GREEN}✓${NC}"
    fi
    
    # Kill Node.js processes
    echo -n "  Stopping Node.js processes... "
    pkill -f "node.*server" 2>/dev/null || true
    pkill -f "npm.*run" 2>/dev/null || true
    echo -e "${GREEN}✓${NC}"
    
    # Wait for processes to stop
    sleep 2
    
    echo ""
}

# Function to extract and restore backup
restore_backup() {
    local backup_file=$1
    
    echo "📂 Restoring from backup..."
    echo "━━━━━━━━━━━━━━━━━━━━━━"
    
    # Create temp directory
    mkdir -p "$ROLLBACK_TEMP"
    
    # Check if backup is encrypted
    if [[ "$backup_file" == *.enc ]]; then
        echo -n "  Decrypting backup... "
        
        if [ -z "$BACKUP_ENCRYPTION_KEY" ]; then
            echo -e "${RED}✗${NC}"
            echo ""
            echo -e "${RED}ERROR: Backup is encrypted but no BACKUP_ENCRYPTION_KEY found!${NC}"
            echo "Please set: export BACKUP_ENCRYPTION_KEY='your-key'"
            exit 1
        fi
        
        DECRYPTED_FILE="$ROLLBACK_TEMP/backup.tar.gz"
        openssl enc -d -aes-256-cbc \
            -in "$backup_file" \
            -out "$DECRYPTED_FILE" \
            -pass pass:"$BACKUP_ENCRYPTION_KEY" 2>/dev/null
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓${NC}"
            backup_file="$DECRYPTED_FILE"
        else
            echo -e "${RED}✗ Decryption failed${NC}"
            exit 1
        fi
    fi
    
    # Extract backup
    echo -n "  Extracting backup... "
    tar -xzf "$backup_file" -C "$ROLLBACK_TEMP" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC}"
    else
        echo -e "${RED}✗ Extraction failed${NC}"
        exit 1
    fi
    
    # Find the extracted directory
    EXTRACTED_DIR=$(find "$ROLLBACK_TEMP" -type d -name ".temp_*" | head -1)
    
    if [ -z "$EXTRACTED_DIR" ]; then
        echo -e "${RED}ERROR: Could not find extracted backup data${NC}"
        exit 1
    fi
    
    # Restore database
    if [ -f "$EXTRACTED_DIR/bot.db" ]; then
        echo -n "  Restoring database... "
        mkdir -p ./data
        cp "$EXTRACTED_DIR/bot.db" ./data/bot.db
        echo -e "${GREEN}✓${NC}"
    fi
    
    # Restore configuration
    if [ -f "$EXTRACTED_DIR/.env" ]; then
        echo -n "  Restoring configuration... "
        cp "$EXTRACTED_DIR/.env" ./.env.rollback
        echo -e "${GREEN}✓${NC}"
        echo -e "    ${YELLOW}Note: Configuration saved as .env.rollback${NC}"
        echo -e "    ${YELLOW}Review and rename to .env when ready${NC}"
    fi
    
    # Restore migrations
    if [ -d "$EXTRACTED_DIR/migrations" ]; then
        echo -n "  Restoring migrations... "
        cp -r "$EXTRACTED_DIR/migrations" ./migrations.rollback
        echo -e "${GREEN}✓${NC}"
    fi
    
    # Restore scripts
    if [ -d "$EXTRACTED_DIR/scripts" ]; then
        echo -n "  Restoring scripts... "
        cp -r "$EXTRACTED_DIR/scripts" ./scripts.rollback
        echo -e "${GREEN}✓${NC}"
    fi
    
    # Show backup info
    if [ -f "$EXTRACTED_DIR/backup_info.json" ]; then
        echo ""
        echo "  Backup Information:"
        cat "$EXTRACTED_DIR/backup_info.json" | jq '.' 2>/dev/null || cat "$EXTRACTED_DIR/backup_info.json"
    fi
    
    echo ""
}

# Function to verify rollback
verify_rollback() {
    echo "✅ Verifying rollback..."
    echo "━━━━━━━━━━━━━━━━━━"
    
    local verification_passed=true
    
    # Check database
    if [ -f "./data/bot.db" ]; then
        echo -e "  Database: ${GREEN}✓ Restored${NC}"
        TABLE_COUNT=$(sqlite3 ./data/bot.db "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
        echo "    Tables: $TABLE_COUNT"
    else
        echo -e "  Database: ${RED}✗ Not found${NC}"
        verification_passed=false
    fi
    
    # Check configuration
    if [ -f "./.env.rollback" ]; then
        echo -e "  Configuration: ${GREEN}✓ Restored (as .env.rollback)${NC}"
    else
        echo -e "  Configuration: ${YELLOW}⚠ Not restored${NC}"
    fi
    
    # Check migrations
    if [ -d "./migrations.rollback" ] || [ -d "./migrations" ]; then
        echo -e "  Migrations: ${GREEN}✓ Present${NC}"
    else
        echo -e "  Migrations: ${YELLOW}⚠ Not found${NC}"
    fi
    
    echo ""
    
    if [ "$verification_passed" = false ]; then
        echo -e "${RED}⚠ Rollback verification failed!${NC}"
        return 1
    fi
    
    return 0
}

# Function to start services
start_services() {
    echo "🚀 Starting services..."
    echo "━━━━━━━━━━━━━━━━━━"
    
    echo -e "${YELLOW}Note: Manual intervention may be required${NC}"
    echo ""
    echo "To complete the rollback:"
    echo "  1. Review the restored configuration:"
    echo "     cat .env.rollback"
    echo ""
    echo "  2. If configuration looks good, activate it:"
    echo "     mv .env.rollback .env"
    echo ""
    echo "  3. Run database migrations if needed:"
    echo "     npx knex migrate:latest"
    echo ""
    echo "  4. Start the services:"
    echo "     ./scripts/start-all.sh"
    echo ""
    echo "  5. Check system health:"
    echo "     ./scripts/health-check.sh"
    echo ""
}

# Function to cleanup
cleanup() {
    echo "🧹 Cleaning up..."
    rm -rf "$ROLLBACK_TEMP"
    echo -e "${GREEN}✓ Cleanup complete${NC}"
}

# Main execution
main() {
    # List available backups
    list_backups
    BACKUP_COUNT=$?
    
    # Select backup
    echo -n "Select backup to restore (1-$BACKUP_COUNT, or 'q' to quit): "
    read -r selection
    
    if [ "$selection" = "q" ] || [ "$selection" = "Q" ]; then
        echo "Rollback cancelled."
        exit 0
    fi
    
    # Validate selection
    if ! [[ "$selection" =~ ^[0-9]+$ ]] || [ "$selection" -lt 1 ] || [ "$selection" -gt "$BACKUP_COUNT" ]; then
        echo -e "${RED}Invalid selection!${NC}"
        exit 1
    fi
    
    SELECTED_BACKUP="${BACKUPS[$((selection-1))]}"
    
    echo ""
    echo "Selected: $(basename $SELECTED_BACKUP)"
    echo ""
    echo -e "${YELLOW}⚠️  This will replace current data with the backup!${NC}"
    echo -n "Are you sure you want to proceed? (yes/no): "
    read -r confirmation
    
    if [ "$confirmation" != "yes" ]; then
        echo "Rollback cancelled."
        exit 0
    fi
    
    echo ""
    
    # Create emergency backup
    create_emergency_backup
    
    # Stop services
    stop_services
    
    # Restore backup
    restore_backup "$SELECTED_BACKUP"
    
    # Verify rollback
    verify_rollback
    
    # Cleanup
    cleanup
    
    # Start services
    start_services
    
    echo "======================================"
    echo -e "${GREEN}✅ Rollback completed successfully!${NC}"
    echo "======================================"
    echo ""
    echo "Emergency backup created at:"
    echo "  $EMERGENCY_BACKUP"
    echo ""
    echo "If you need to undo this rollback:"
    echo "  ./scripts/rollback.sh"
    echo "  (and select the emergency backup)"
    echo ""
}

# Trap errors
trap 'echo -e "\n${RED}Error occurred during rollback!${NC}"; cleanup; exit 1' ERR

# Check if running as intended
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Usage: $0"
    echo ""
    echo "Emergency rollback script for BSC Trading Bot"
    echo "Restores the system from a previous backup"
    echo ""
    echo "Environment variables:"
    echo "  BACKUP_DIR - Directory containing backups (default: ./backups)"
    echo "  BACKUP_ENCRYPTION_KEY - Key for encrypted backups"
    exit 0
fi

# Run main function
main