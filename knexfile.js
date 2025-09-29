require('dotenv').config();

const path = require('path');

module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: process.env.DB_PATH || './data/bot.db'
    },
    migrations: {
      directory: path.join(__dirname, 'dist/persistence/migrations'),
      extension: 'js'
    },
    seeds: {
      directory: path.join(__dirname, 'src/persistence/seeds')
    },
    useNullAsDefault: true
  },
  
  test: {
    client: 'sqlite3',
    connection: {
      filename: './data/test_bot.db'
    },
    migrations: {
      directory: path.join(__dirname, 'src/persistence/migrations'),
      extension: 'ts'
    },
    useNullAsDefault: true
  },
  
  production: {
    client: process.env.DB_CLIENT || 'sqlite3',
    connection: process.env.DB_CLIENT === 'pg' ? {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'bsc_bot',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD
    } : {
      filename: process.env.DB_PATH || './data/bot.db'
    },
    migrations: {
      directory: path.join(__dirname, 'src/persistence/migrations'),
      extension: 'ts'
    },
    seeds: {
      directory: path.join(__dirname, 'src/persistence/seeds')
    },
    useNullAsDefault: true
  }
};