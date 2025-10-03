#!/bin/bash

# ==========================================
# BSC Trading Bot - Production Deployment Script
# ==========================================
#
# This script helps deploy the BSC Trading Bot to production
#
# Usage:
#   ./scripts/deploy-production.sh
#
# ==========================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════${NC}"
    echo ""
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    print_error "Do not run this script as root!"
    exit 1
fi

print_header "BSC Trading Bot - Production Deployment"

# Step 1: Pre-deployment checks
print_header "Step 1: Pre-deployment Checks"

print_info "Checking Node.js version..."
NODE_VERSION=$(node --version)
print_success "Node.js version: $NODE_VERSION"

print_info "Checking npm version..."
NPM_VERSION=$(npm --version)
print_success "npm version: $NPM_VERSION"

# Check if .env file exists
if [ ! -f ".env" ]; then
    print_error ".env file not found!"
    print_warning "Please create .env from .env.example:"
    echo "  cp .env.example .env"
    exit 1
fi
print_success ".env file found"

# Check critical environment variables
print_info "Checking environment variables..."

if grep -q "dev-secret-key-for-testing-only" .env; then
    print_error "JWT_SECRET is still using dev value!"
    print_warning "Please set a strong JWT_SECRET in .env"
    exit 1
fi

if grep -q "test-password" .env; then
    print_error "ENCRYPTION_PASSWORD is still using test value!"
    print_warning "Please set a strong ENCRYPTION_PASSWORD in .env"
    exit 1
fi

if grep -q "NODE_ENV=development" .env; then
    print_warning "NODE_ENV is set to development"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

print_success "Environment variables check passed"

# Step 2: Install dependencies
print_header "Step 2: Installing Dependencies"

print_info "Installing backend dependencies (including devDependencies for build)..."
npm install
print_success "Backend dependencies installed"

print_info "Installing frontend dependencies (including devDependencies for build)..."
cd frontend
npm install
cd ..
print_success "Frontend dependencies installed"

# Step 3: Build project
print_header "Step 3: Building Project"

print_info "Compiling TypeScript..."
npm run build
print_success "TypeScript compiled"

print_info "Building frontend..."
cd frontend
npm run build
cd ..
print_success "Frontend built"

# Step 3.5: Prune devDependencies after build
print_header "Step 3.5: Optimizing Dependencies"

print_info "Removing devDependencies from backend..."
npm prune --production
print_success "Backend dependencies optimized"

print_info "Removing devDependencies from frontend..."
cd frontend
npm prune --production
cd ..
print_success "Frontend dependencies optimized"

# Step 4: Database setup
print_header "Step 4: Database Setup"

print_info "Creating data directory..."
mkdir -p ./data
print_success "Data directory created"

# Step 5: PM2 deployment
print_header "Step 5: PM2 Deployment"

print_info "Checking if PM2 is installed..."
if ! command -v pm2 &> /dev/null; then
    print_warning "PM2 not found. Installing PM2..."
    npm install -g pm2
    print_success "PM2 installed"
else
    print_success "PM2 is already installed"
fi

print_info "Stopping existing PM2 processes..."
pm2 stop all || true
pm2 delete all || true
print_success "Existing processes stopped"

print_info "Starting backend with PM2..."
pm2 start npm --name "bsc-bot-backend" -- run start
print_success "Backend started"

print_info "Starting frontend with PM2..."
cd frontend
pm2 start npm --name "bsc-bot-frontend" -- start
cd ..
print_success "Frontend started"

print_info "Saving PM2 configuration..."
pm2 save
print_success "PM2 configuration saved"

print_info "Setting up PM2 startup script..."
pm2 startup | tail -1 | bash || true
print_success "PM2 startup configured"

# Step 6: Health check
print_header "Step 6: Health Check"

sleep 5  # Wait for services to start

print_info "Checking backend health..."
if curl -f http://localhost:10001/api/dashboard/status > /dev/null 2>&1; then
    print_success "Backend is healthy"
else
    print_error "Backend health check failed!"
    print_warning "Check logs with: pm2 logs bsc-bot-backend"
fi

print_info "Checking frontend..."
if curl -f http://localhost:10002 > /dev/null 2>&1; then
    print_success "Frontend is healthy"
else
    print_error "Frontend health check failed!"
    print_warning "Check logs with: pm2 logs bsc-bot-frontend"
fi

# Step 7: Summary
print_header "Deployment Complete"

print_success "BSC Trading Bot has been deployed successfully!"
echo ""
print_info "Services running:"
pm2 list
echo ""
print_info "Useful commands:"
echo "  pm2 logs          - View all logs"
echo "  pm2 logs bsc-bot-backend  - View backend logs"
echo "  pm2 logs bsc-bot-frontend - View frontend logs"
echo "  pm2 restart all   - Restart all services"
echo "  pm2 stop all      - Stop all services"
echo "  pm2 monit         - Monitor services"
echo ""
print_info "Access the application:"
echo "  Frontend: http://localhost:10002"
echo "  Backend API: http://localhost:10001"
echo ""
print_warning "Important reminders:"
echo "  1. Set up SSL/TLS certificates for production"
echo "  2. Configure firewall rules"
echo "  3. Set up monitoring and alerts"
echo "  4. Configure backup strategy"
echo "  5. Review security settings"
echo ""
print_success "Happy trading! 🚀"
