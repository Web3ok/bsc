# Multi-stage Dockerfile for BSC Market Maker Bot

# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine AS runtime

WORKDIR /app

# Install production dependencies for native modules
RUN apk add --no-cache python3 make g++

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S botuser -u 1001

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/configs ./configs

# Create necessary directories
RUN mkdir -p data wallets logs && \
    chown -R botuser:nodejs data wallets logs

# Switch to non-root user
USER botuser

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV METRICS_PORT=3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "const http = require('http'); \
                 const options = { host: 'localhost', port: process.env.METRICS_PORT || 3001, path: '/health', timeout: 5000 }; \
                 const req = http.request(options, (res) => { \
                   if (res.statusCode === 200) { process.exit(0); } else { process.exit(1); } \
                 }); \
                 req.on('error', () => { process.exit(1); }); \
                 req.end();"

# Expose ports
EXPOSE 3000 3001

# Default command
CMD ["node", "dist/cli/index.js", "--help"]

# Labels
LABEL org.opencontainers.image.title="BSC Market Maker Bot"
LABEL org.opencontainers.image.description="BSC (BNB Chain) Market Maker Bot with batch wallet management and DEX trading"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.source="https://github.com/your-org/bsc-market-maker-bot"