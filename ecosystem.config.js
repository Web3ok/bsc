module.exports = {
  apps: [
    {
      name: 'bsc-bot-api',
      script: './dist/server.js',
      cwd: '/opt/bsc-bot',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        API_PORT: 3010,
        NEXT_PUBLIC_API_URL: 'https://api.yourdomain.com',
        // Database
        DATABASE_URL: process.env.DATABASE_URL,
        // Blockchain
        BSC_RPC_URL: process.env.BSC_RPC_URL,
        BSC_RPC_URL_BACKUP: process.env.BSC_RPC_URL_BACKUP,
        PRIVATE_KEY: process.env.PRIVATE_KEY,
        // Authentication
        JWT_SECRET: process.env.JWT_SECRET,
        API_SECRET_KEY: process.env.API_SECRET_KEY,
        // External APIs
        COINMARKETCAP_API_KEY: process.env.COINMARKETCAP_API_KEY,
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,
        // Redis
        REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
      },
      env_development: {
        NODE_ENV: 'development',
        API_PORT: 3010,
        NEXT_PUBLIC_API_URL: 'http://localhost:3010',
      },
      // PM2 Configuration
      max_memory_restart: '1G',
      restart_delay: 1000,
      max_restarts: 5,
      min_uptime: '10s',
      
      // Logging
      log_file: './logs/combined.log',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Monitoring
      watch: false,
      ignore_watch: ['node_modules', 'logs', '*.log'],
      
      // Advanced
      kill_timeout: 5000,
      listen_timeout: 10000,
      shutdown_with_message: true,
    },
    {
      name: 'bsc-bot-monitor',
      script: './dist/monitoring/monitor.js',
      cwd: '/opt/bsc-bot',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        MONITOR_PORT: 3001,
        DATABASE_URL: process.env.DATABASE_URL,
        PROMETHEUS_PORT: 9090,
      },
      
      // PM2 Configuration
      max_memory_restart: '512M',
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: '10s',
      
      // Logging
      log_file: './logs/monitor-combined.log',
      out_file: './logs/monitor-out.log',
      error_file: './logs/monitor-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Monitoring
      watch: false,
    },
    {
      name: 'bsc-bot-frontend',
      script: 'npm',
      args: 'start',
      cwd: '/opt/bsc-bot/frontend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        NEXT_PUBLIC_API_URL: 'https://api.yourdomain.com',
      },
      
      // PM2 Configuration
      max_memory_restart: '512M',
      restart_delay: 1000,
      max_restarts: 5,
      min_uptime: '10s',
      
      // Logging
      log_file: './logs/frontend-combined.log',
      out_file: './logs/frontend-out.log',
      error_file: './logs/frontend-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Monitoring
      watch: false,
    }
  ],
  
  deploy: {
    production: {
      user: 'ubuntu',
      host: ['your-server-ip'],
      ref: 'origin/main',
      repo: 'git@github.com:your-username/bsc-bot.git',
      path: '/opt/bsc-bot',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'apt update && apt install -y nodejs npm git',
      env: {
        NODE_ENV: 'production'
      }
    }
  }
};