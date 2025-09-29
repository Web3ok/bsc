#!/bin/bash

# BSC Trading Bot - Production Deployment Script
# Usage: ./scripts/deploy-production.sh [--method=pm2|systemd] [--skip-build] [--skip-migrate]

set -e

# Configuration
PROJECT_DIR="/opt/bsc-bot"
SERVICE_USER="ubuntu"
LOG_DIR="$PROJECT_DIR/logs"
BACKUP_DIR="$PROJECT_DIR/backups/$(date +%Y%m%d_%H%M%S)"

# Parse arguments
METHOD="pm2"
SKIP_BUILD=false
SKIP_MIGRATE=false

for arg in "$@"; do
  case $arg in
    --method=*)
      METHOD="${arg#*=}"
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-migrate)
      SKIP_MIGRATE=true
      shift
      ;;
    *)
      echo "Unknown option: $arg"
      exit 1
      ;;
  esac
done

echo "🚀 Starting BSC Trading Bot Production Deployment"
echo "   Method: $METHOD"
echo "   Skip Build: $SKIP_BUILD"
echo "   Skip Migrate: $SKIP_MIGRATE"
echo "   Project Dir: $PROJECT_DIR"
echo ""

# Pre-deployment checks
echo "📋 Pre-deployment checks..."

# Check if running as correct user
if [[ "$EUID" -eq 0 ]] && [[ "$METHOD" == "systemd" ]]; then
  echo "✅ Running as root (required for systemd)"
elif [[ "$USER" == "$SERVICE_USER" ]] && [[ "$METHOD" == "pm2" ]]; then
  echo "✅ Running as service user ($SERVICE_USER)"
else
  echo "❌ Please run as appropriate user:"
  echo "   PM2: sudo -u $SERVICE_USER $0"
  echo "   Systemd: sudo $0"
  exit 1
fi

# Check project directory
if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "❌ Project directory not found: $PROJECT_DIR"
  exit 1
fi

cd "$PROJECT_DIR"

# Check required files
echo "🔍 Checking required files..."
required_files=(".env" "package.json" "src/server.ts")
for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "❌ Required file missing: $file"
    exit 1
  fi
done
echo "✅ All required files present"

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p "$LOG_DIR" "$BACKUP_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR" "$BACKUP_DIR" 2>/dev/null || true

# Backup current deployment
echo "💾 Creating backup..."
if [[ -d "$PROJECT_DIR/dist" ]]; then
  cp -r "$PROJECT_DIR/dist" "$BACKUP_DIR/"
  echo "✅ Backup created at $BACKUP_DIR"
fi

# Install dependencies
echo "📦 Installing dependencies..."
if [[ "$SKIP_BUILD" == false ]]; then
  npm ci --production=false
  echo "✅ Dependencies installed"
else
  echo "⏭️  Skipping dependency installation"
fi

# Build project
echo "🏗️  Building project..."
if [[ "$SKIP_BUILD" == false ]]; then
  npm run build
  echo "✅ Project built successfully"
else
  echo "⏭️  Skipping build"
fi

# Run database migrations
echo "🗃️  Running database migrations..."
if [[ "$SKIP_MIGRATE" == false ]]; then
  npm run migrate 2>/dev/null || echo "⚠️  Migration failed or no migrations to run"
else
  echo "⏭️  Skipping migrations"
fi

# Deploy based on method
case "$METHOD" in
  "pm2")
    deploy_pm2
    ;;
  "systemd")
    deploy_systemd
    ;;
  *)
    echo "❌ Unknown deployment method: $METHOD"
    exit 1
    ;;
esac

echo ""
echo "🎉 BSC Trading Bot deployed successfully!"
echo ""
echo "📊 Service Status:"
case "$METHOD" in
  "pm2")
    su -c "pm2 status" "$SERVICE_USER"
    echo ""
    echo "📋 Management Commands:"
    echo "   Status:  sudo -u $SERVICE_USER pm2 status"
    echo "   Logs:    sudo -u $SERVICE_USER pm2 logs"
    echo "   Restart: sudo -u $SERVICE_USER pm2 restart all"
    echo "   Stop:    sudo -u $SERVICE_USER pm2 stop all"
    ;;
  "systemd")
    systemctl status bsc-bot-api bsc-bot-monitor
    echo ""
    echo "📋 Management Commands:"
    echo "   Status:  sudo systemctl status bsc-bot-api"
    echo "   Logs:    sudo journalctl -u bsc-bot-api -f"
    echo "   Restart: sudo systemctl restart bsc-bot-api"
    echo "   Stop:    sudo systemctl stop bsc-bot-api bsc-bot-monitor"
    ;;
esac

echo ""
echo "🔗 Service Endpoints:"
echo "   API:       http://localhost:3010/health"
echo "   Monitor:   http://localhost:3001/health"
echo "   Frontend:  http://localhost:3000/"
echo "   WebSocket: ws://localhost:3010/ws"

# Function: Deploy with PM2
deploy_pm2() {
  echo "🔧 Deploying with PM2..."
  
  # Install PM2 if not present
  if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
    pm2 install pm2-logrotate
  fi
  
  # Switch to service user for PM2 operations
  if [[ "$USER" != "$SERVICE_USER" ]]; then
    echo "🔄 Switching to service user for PM2 operations..."
    su -c "
      cd '$PROJECT_DIR'
      pm2 delete all 2>/dev/null || true
      pm2 start ecosystem.config.js --env production
      pm2 save
      pm2 startup
    " "$SERVICE_USER"
  else
    # Stop existing processes
    pm2 delete all 2>/dev/null || true
    
    # Start services
    pm2 start ecosystem.config.js --env production
    pm2 save
    pm2 startup
  fi
  
  echo "✅ PM2 deployment completed"
}

# Function: Deploy with systemd
deploy_systemd() {
  echo "🔧 Deploying with systemd..."
  
  # Copy service files
  cp scripts/systemd/*.service /etc/systemd/system/
  
  # Reload systemd
  systemctl daemon-reload
  
  # Stop existing services
  systemctl stop bsc-bot-api bsc-bot-monitor 2>/dev/null || true
  
  # Enable and start services
  systemctl enable bsc-bot-api bsc-bot-monitor
  systemctl start bsc-bot-api
  sleep 5
  systemctl start bsc-bot-monitor
  
  echo "✅ systemd deployment completed"
}

# Health check
echo ""
echo "🏥 Running health checks..."
sleep 10

# Check API health
if curl -f -s http://localhost:3010/health > /dev/null; then
  echo "✅ API Server: Healthy"
else
  echo "❌ API Server: Not responding"
fi

# Check Monitor health
if curl -f -s http://localhost:3001/health > /dev/null; then
  echo "✅ Monitor Service: Healthy"
else
  echo "❌ Monitor Service: Not responding"
fi

echo ""
echo "🎯 Deployment completed at $(date)"