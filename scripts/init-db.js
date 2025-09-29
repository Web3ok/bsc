const knex = require('knex');
const path = require('path');
require('dotenv').config();

const config = {
  client: 'sqlite3',
  connection: {
    filename: process.env.DB_PATH || './data/bot.db'
  },
  useNullAsDefault: true
};

const db = knex(config);

async function initializeDatabase() {
  try {
    console.log('🗄️  Initializing database...');
    
    // Create wallets table
    await db.schema.createTable('wallets', (table) => {
      table.string('address', 42).primary();
      table.text('private_key_encrypted').notNullable();
      table.integer('derivation_index').nullable();
      table.string('label').nullable();
      table.string('group_name').nullable();
      table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
      table.timestamp('updated_at').defaultTo(db.fn.now()).notNullable();
      
      table.index(['group_name']);
      table.index(['created_at']);
    });

    // Create transactions table
    await db.schema.createTable('transactions', (table) => {
      table.increments('id').primary();
      table.string('tx_hash', 66).unique().notNullable();
      table.string('from_address', 42).notNullable();
      table.string('to_address', 42).notNullable();
      table.string('amount').notNullable();
      table.string('token_address', 42).nullable();
      table.string('token_symbol', 10).nullable();
      table.integer('token_decimals').nullable();
      table.string('gas_used').nullable();
      table.string('gas_price').notNullable();
      table.string('transaction_fee').nullable();
      table.string('status').defaultTo('pending').checkIn(['pending', 'confirmed', 'failed']);
      table.string('operation_type').notNullable().checkIn(['transfer', 'trade_buy', 'trade_sell', 'approve']);
      table.string('block_number').nullable();
      table.integer('block_timestamp').nullable();
      table.text('error_message').nullable();
      table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
      table.timestamp('updated_at').defaultTo(db.fn.now()).notNullable();
      
      table.index(['from_address']);
      table.index(['to_address']);
      table.index(['status']);
      table.index(['operation_type']);
      table.index(['created_at']);
    });

    // Create orders table
    await db.schema.createTable('orders', (table) => {
      table.increments('id').primary();
      table.string('order_id', 64).unique().notNullable();
      table.string('order_type').notNullable().checkIn(['market_buy', 'market_sell', 'limit_buy', 'limit_sell']);
      table.string('status').defaultTo('pending').checkIn(['pending', 'executing', 'completed', 'failed', 'cancelled', 'expired']);
      
      table.string('wallet_address', 42).notNullable();
      table.string('token_in_address', 42).notNullable();
      table.string('token_out_address', 42).notNullable();
      table.string('token_in_symbol', 20).notNullable();
      table.string('token_out_symbol', 20).notNullable();
      table.string('amount_in').notNullable();
      table.string('amount_out_expected').nullable();
      table.string('amount_out_min').nullable();
      table.string('amount_out_actual').nullable();
      
      table.decimal('slippage', 8, 6).notNullable();
      table.decimal('price_impact', 8, 6).nullable();
      table.string('execution_price').nullable();
      table.json('trading_path').nullable();
      
      table.string('tx_hash', 66).nullable();
      table.string('gas_used').nullable();
      table.string('gas_price').nullable();
      table.string('total_fee_bnb').nullable();
      
      table.timestamp('created_at').defaultTo(db.fn.now()).notNullable();
      table.timestamp('updated_at').defaultTo(db.fn.now()).notNullable();
      table.timestamp('executed_at').nullable();
      table.timestamp('expires_at').nullable();
      
      table.json('metadata').nullable();
      table.text('failure_reason').nullable();
      table.integer('retry_count').defaultTo(0);
      table.string('parent_order_id', 64).nullable();
      
      table.index(['wallet_address']);
      table.index(['status']);
      table.index(['order_type']);
      table.index(['created_at']);
    });

    // Create system_metrics table
    await db.schema.createTable('system_metrics', (table) => {
      table.increments('id').primary();
      table.string('metric_name').notNullable();
      table.string('metric_value').notNullable();
      table.json('metadata').nullable();
      table.timestamp('recorded_at').defaultTo(db.fn.now()).notNullable();
      
      table.index(['metric_name', 'recorded_at']);
    });

    console.log('✅ Database initialized successfully!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

initializeDatabase();