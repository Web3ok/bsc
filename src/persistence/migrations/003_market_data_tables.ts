import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create swap_events table for DEX swap transaction data
  if (!(await knex.schema.hasTable('swap_events'))) {
    await knex.schema.createTable('swap_events', (table) => {
    table.string('event_id', 128).primary().comment('Unique event identifier: txHash_logIndex');
    table.string('transaction_hash', 66).notNullable().comment('Transaction hash');
    table.integer('log_index').notNullable().comment('Log index in transaction');
    table.integer('block_number').notNullable().comment('Block number');
    table.string('block_hash', 66).notNullable().comment('Block hash');
    table.string('pair_address', 42).notNullable().comment('DEX pair contract address');
    table.string('token0_address', 42).notNullable().comment('Token0 contract address');
    table.string('token1_address', 42).notNullable().comment('Token1 contract address');
    table.string('sender', 42).notNullable().comment('Transaction sender address');
    table.string('recipient', 42).comment('Swap recipient address');
    table.decimal('amount0_in', 36, 18).notNullable().comment('Token0 input amount');
    table.decimal('amount1_in', 36, 18).notNullable().comment('Token1 input amount');
    table.decimal('amount0_out', 36, 18).notNullable().comment('Token0 output amount');
    table.decimal('amount1_out', 36, 18).notNullable().comment('Token1 output amount');
    table.timestamp('timestamp').notNullable().comment('Event timestamp');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Record creation time');
    
    // Indexes for efficient querying
    table.index(['pair_address', 'timestamp'], 'idx_swap_events_pair_time');
    table.index(['transaction_hash'], 'idx_swap_events_tx_hash');
    table.index(['block_number'], 'idx_swap_events_block');
    table.index(['timestamp'], 'idx_swap_events_timestamp');
    });
  }

  // Create price_updates table for real-time price tracking
  if (!(await knex.schema.hasTable('price_updates'))) {
    await knex.schema.createTable('price_updates', (table) => {
    table.increments('id').primary();
    table.string('pair', 20).notNullable().comment('Trading pair symbol (e.g., BNB/USDT)');
    table.string('token_0', 20).notNullable().comment('Token0 symbol');
    table.string('token_1', 20).notNullable().comment('Token1 symbol');
    table.string('price').notNullable().comment('Token0/Token1 price');
    table.string('volume_24h').nullable().comment('24h trading volume');
    table.timestamp('timestamp').notNullable().comment('Price update timestamp');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Record creation time');
    
    // Indexes for efficient querying
    table.index(['pair', 'timestamp'], 'idx_price_updates_pair_time');
    table.index(['timestamp'], 'idx_price_updates_timestamp');
    });
  }

  // Create latest_prices table for current price storage
  if (!(await knex.schema.hasTable('latest_prices'))) {
    await knex.schema.createTable('latest_prices', (table) => {
    table.string('pair', 20).primary().comment('Trading pair symbol (e.g., BNB/USDT)');
    table.string('price').notNullable().comment('Current price');
    table.timestamp('updated_at').notNullable().comment('Last update timestamp');
    });
  }

  // Create candlestick_data table for OHLCV data
  if (!(await knex.schema.hasTable('candlestick_data'))) {
    await knex.schema.createTable('candlestick_data', (table) => {
    table.increments('id').primary();
    table.string('pair', 20).notNullable().comment('Trading pair symbol (e.g., BNB/USDT)');
    table.string('interval').notNullable().comment('Time interval: 1m, 5m, 15m, 1h, 4h, 1d');
    table.timestamp('timestamp').notNullable().comment('Candle start timestamp');
    table.string('open_price').notNullable().comment('Opening price');
    table.string('high_price').notNullable().comment('Highest price');
    table.string('low_price').notNullable().comment('Lowest price');
    table.string('close_price').notNullable().comment('Closing price');
    table.string('volume').notNullable().comment('Trading volume');
    table.integer('trade_count').defaultTo(0).comment('Number of trades');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Record creation time');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Record update time');
    
    // Indexes for efficient querying
    table.index(['pair', 'interval', 'timestamp'], 'idx_candlestick_pair_interval_time');
    table.index(['timestamp'], 'idx_candlestick_timestamp');
    table.index(['interval'], 'idx_candlestick_interval');
    
    // Unique constraint to prevent duplicate candles
    table.unique(['pair', 'interval', 'timestamp'], 'uniq_candlestick_data');
    });
  }

  // Create market_metrics table for market statistics
  if (!(await knex.schema.hasTable('market_metrics'))) {
    await knex.schema.createTable('market_metrics', (table) => {
    table.increments('id').primary();
    table.string('metric_type').notNullable().comment('Metric type: volume_24h, price_change_24h, etc.');
    table.string('pair', 20).nullable().comment('Trading pair (null for global metrics)');
    table.string('value').notNullable().comment('Metric value');
    table.json('metadata').nullable().comment('Additional metadata as JSON');
    table.timestamp('period_start').notNullable().comment('Metric period start');
    table.timestamp('period_end').notNullable().comment('Metric period end');
    table.timestamp('calculated_at').defaultTo(knex.fn.now()).comment('Calculation timestamp');
    
    // Indexes for efficient querying
    table.index(['metric_type', 'pair', 'period_start'], 'idx_market_metrics_type_pair_start');
    table.index(['calculated_at'], 'idx_market_metrics_calculated');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('market_metrics');
  await knex.schema.dropTableIfExists('candlestick_data');
  await knex.schema.dropTableIfExists('latest_prices');
  await knex.schema.dropTableIfExists('price_updates');
  await knex.schema.dropTableIfExists('swap_events');
}