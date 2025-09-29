const knex = require('knex');
require('dotenv').config();

const config = {
  client: 'sqlite3',
  connection: {
    filename: process.env.DB_PATH || './data/bot.db'
  },
  useNullAsDefault: true
};

const db = knex(config);

async function createMarketTables() {
  try {
    console.log('🗄️  Creating market data tables...');
    
    // Create swap_events table for raw swap event data
    if (!(await db.schema.hasTable('swap_events'))) {
      await db.schema.createTable('swap_events', (table) => {
        table.string('event_id', 128).primary();
        table.string('transaction_hash', 66).notNullable();
        table.string('block_number').notNullable();
        table.integer('log_index').notNullable();
        table.string('pair_address', 42).notNullable();
        table.string('sender', 42).notNullable();
        table.string('recipient', 42).notNullable();
        table.string('amount_0_in').notNullable();
        table.string('amount_1_in').notNullable();
        table.string('amount_0_out').notNullable();
        table.string('amount_1_out').notNullable();
        table.timestamp('timestamp').notNullable();
        table.timestamp('processed_at').defaultTo(db.fn.now()).notNullable();
        
        table.index(['pair_address', 'timestamp']);
        table.index(['transaction_hash']);
        table.index(['block_number']);
        table.index(['processed_at']);
      });
      console.log('✅ Created swap_events table');
    }

    // Create price_updates table for calculated price data
    if (!(await db.schema.hasTable('price_updates'))) {
      await db.schema.createTable('price_updates', (table) => {
        table.increments('id').primary();
        table.string('pair', 20).notNullable();
        table.string('token_0', 20).notNullable();
        table.string('token_1', 20).notNullable();
        table.string('price').notNullable();
        table.string('volume_24h').nullable();
        table.timestamp('timestamp').notNullable();
        table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
        
        table.index(['pair', 'timestamp']);
        table.index(['timestamp']);
      });
      console.log('✅ Created price_updates table');
    }

    // Create latest_prices table for quick price lookups
    if (!(await db.schema.hasTable('latest_prices'))) {
      await db.schema.createTable('latest_prices', (table) => {
        table.string('pair', 20).primary();
        table.string('price').notNullable();
        table.timestamp('updated_at').notNullable();
      });
      console.log('✅ Created latest_prices table');
    }

    // Create candlestick_data table for OHLCV data
    if (!(await db.schema.hasTable('candlestick_data'))) {
      await db.schema.createTable('candlestick_data', (table) => {
        table.increments('id').primary();
        table.string('pair', 20).notNullable();
        table.string('interval').notNullable(); // 1m, 5m, 15m, 1h, 4h, 1d
        table.timestamp('timestamp').notNullable(); // Start of interval
        table.string('open_price').notNullable();
        table.string('high_price').notNullable();
        table.string('low_price').notNullable();
        table.string('close_price').notNullable();
        table.string('volume').notNullable();
        table.integer('trade_count').defaultTo(0);
        table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(db.fn.now()).notNullable();
        
        table.unique(['pair', 'interval', 'timestamp']);
        table.index(['pair', 'interval', 'timestamp']);
        table.index(['timestamp']);
      });
      console.log('✅ Created candlestick_data table');
    }

    // Create market_metrics table for aggregated metrics
    if (!(await db.schema.hasTable('market_metrics'))) {
      await db.schema.createTable('market_metrics', (table) => {
        table.increments('id').primary();
        table.string('metric_type').notNullable(); // volume_24h, price_change_24h, etc.
        table.string('pair', 20).nullable(); // null for global metrics
        table.string('value').notNullable();
        table.json('metadata').nullable();
        table.timestamp('period_start').notNullable();
        table.timestamp('period_end').notNullable();
        table.timestamp('calculated_at').defaultTo(db.fn.now()).notNullable();
        
        table.index(['metric_type', 'pair', 'period_start']);
        table.index(['calculated_at']);
      });
      console.log('✅ Created market_metrics table');
    }

    console.log('✅ Market data tables created successfully!');
    
  } catch (error) {
    console.error('❌ Failed to create market data tables:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

createMarketTables();