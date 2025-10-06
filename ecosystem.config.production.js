/**
 * PM2 Production Ecosystem Configuration
 * BSC Trading Bot - v1.0.0
 *
 * 使用方法 Usage:
 * pm2 start ecosystem.config.production.js --env production
 * pm2 save
 * pm2 startup
 */

module.exports = {
  apps: [
    {
      // ========== Main API Server ==========
      name: 'bsc-bot-api',
      script: './dist/server.js',
      instances: 1, // 单实例模式，避免 WebSocket 和数据库冲突
      exec_mode: 'fork',

      // Environment Variables
      env_production: {
        NODE_ENV: 'production',
        PORT: 10001,

        // Load from .env.production
        // All sensitive values should be in .env.production
      },

      // PM2 Resource Management
      max_memory_restart: '1G',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '30s',
      autorestart: true,

      // Graceful Shutdown
      kill_timeout: 10000,
      listen_timeout: 10000,
      shutdown_with_message: true,
      wait_ready: true,

      // Logging Configuration
      log_file: './logs/api-combined.log',
      out_file: './logs/api-out.log',
      error_file: './logs/api-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      log_type: 'json',

      // Monitoring
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.log', 'data'],

      // Error Handling
      exp_backoff_restart_delay: 100,

      // Cron for automatic restart (optional)
      // cron_restart: '0 3 * * *', // Restart at 3 AM daily

      // Source Maps (for better error tracking)
      source_map_support: true,
    },

    {
      // ========== Monitoring Service ==========
      name: 'bsc-bot-monitor',
      script: './dist/monitor/server.js',
      instances: 1,
      exec_mode: 'fork',

      env_production: {
        NODE_ENV: 'production',
        MONITOR_PORT: 9090,
        METRICS_ENABLED: 'true',
      },

      // PM2 Resource Management
      max_memory_restart: '512M',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '30s',
      autorestart: true,

      // Logging
      log_file: './logs/monitor-combined.log',
      out_file: './logs/monitor-out.log',
      error_file: './logs/monitor-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Monitoring
      watch: false,
    },

    {
      // ========== Frontend Next.js Server ==========
      name: 'bsc-bot-frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      cwd: './frontend',
      instances: 1,
      exec_mode: 'fork',

      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        NEXT_PUBLIC_API_URL: 'http://localhost:10001',
        NEXT_PUBLIC_WS_URL: 'ws://localhost:10001',
        NEXT_PUBLIC_CHAIN_ID: '56',
      },

      // PM2 Resource Management
      max_memory_restart: '1G',
      restart_delay: 3000,
      max_restarts: 5,
      min_uptime: '30s',
      autorestart: true,

      // Logging
      log_file: './logs/frontend-combined.log',
      out_file: './logs/frontend-out.log',
      error_file: './logs/frontend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Monitoring
      watch: false,
    },
  ],

  // ========== Deployment Configuration ==========
  deploy: {
    production: {
      user: 'ubuntu', // SSH user
      host: ['your-server-ip'], // Server IP or hostname
      ref: 'origin/main', // Git branch
      repo: 'https://github.com/Web3ok/bsc.git', // Git repository
      path: '/opt/bsc-bot', // Deployment path

      // Pre-deployment commands
      'pre-deploy': 'git fetch --all',

      // Post-deployment commands
      'post-deploy': [
        'npm ci', // Clean install
        'npm run build', // Build TypeScript
        'cd frontend && npm ci && npm run build', // Build Next.js
        'pm2 reload ecosystem.config.production.js --env production', // Reload PM2
        'pm2 save', // Save PM2 process list
      ].join(' && '),

      // Pre-setup commands (first time only)
      'pre-setup': [
        'apt update',
        'apt install -y nodejs npm git',
        'npm install -g pm2',
        'pm2 startup',
      ].join(' && '),

      env: {
        NODE_ENV: 'production',
      },

      // SSH options
      ssh_options: 'StrictHostKeyChecking=no',
    },

    staging: {
      user: 'ubuntu',
      host: ['your-staging-server-ip'],
      ref: 'origin/develop',
      repo: 'https://github.com/Web3ok/bsc.git',
      path: '/opt/bsc-bot-staging',

      'post-deploy': [
        'npm ci',
        'npm run build',
        'cd frontend && npm ci && npm run build',
        'pm2 reload ecosystem.config.production.js --env staging',
      ].join(' && '),

      env: {
        NODE_ENV: 'staging',
      },
    },
  },
};
