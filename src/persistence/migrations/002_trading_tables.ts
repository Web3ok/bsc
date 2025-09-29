import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Trades table - for completed trading operations
  await knex.schema.createTable('trades', (table) => {
    table.increments('id').primary();
    table.string('trade_id').unique().notNullable(); // Unique identifier for the trade
    table.string('wallet_address', 42).notNullable();
    table.string('token_in', 42).notNullable(); // Input token address
    table.string('token_out', 42).notNullable(); // Output token address
    table.string('amount_in').notNullable(); // Amount of input token
    table.string('amount_out').notNullable(); // Amount of output token received
    table.string('price').nullable(); // Price at execution
    table.string('pnl').nullable(); // Profit/loss in USD equivalent
    table.string('volume').nullable(); // Trade volume in USD equivalent
    table.string('slippage').nullable(); // Actual slippage experienced
    table.string('gas_fee').nullable(); // Gas fee paid
    table.enum('trade_type', ['buy', 'sell', 'swap']).notNullable();
    table.enum('status', ['pending', 'completed', 'failed', 'cancelled']).defaultTo('pending');
    table.string('tx_hash', 66).nullable();
    table.string('dex_name').nullable(); // PancakeSwap, Uniswap, etc.
    table.json('route_data').nullable(); // Trading route information
    table.text('error_message').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('completed_at').nullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['wallet_address']);
    table.index(['status']);
    table.index(['trade_type']);
    table.index(['created_at']);
    table.index(['completed_at']);
    table.index(['token_in']);
    table.index(['token_out']);
  });

  // Orders table - for pending/active orders
  const ordersExists = await knex.schema.hasTable('orders');
  if (!ordersExists) {
    await knex.schema.createTable('orders', (table) => {
      table.increments('id').primary();
      table.string('order_id').unique().notNullable();
      table.string('wallet_address', 42).notNullable();
      table.string('token_in', 42).notNullable();
      table.string('token_out', 42).notNullable();
      table.string('amount_in').notNullable();
      table.string('min_amount_out').nullable();
      table.string('target_price').nullable();
      table.string('slippage_tolerance').nullable();
      table.enum('order_type', ['market', 'limit', 'stop_loss', 'take_profit']).notNullable();
      table.enum('status', ['pending', 'active', 'filled', 'cancelled', 'expired']).defaultTo('pending');
      table.string('strategy_id').nullable(); // Link to strategy if automated
      table.timestamp('expires_at').nullable();
      table.json('conditions').nullable(); // Trigger conditions for conditional orders
      table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
      
      table.index(['wallet_address']);
      table.index(['status']);
      table.index(['order_type']);
      table.index(['created_at']);
      table.index(['expires_at']);
    });
  }

  // Trading pairs table - for tracking supported pairs and their metadata
  await knex.schema.createTable('trading_pairs', (table) => {
    table.increments('id').primary();
    table.string('pair_symbol').unique().notNullable(); // e.g., "BNB/USDT"
    table.string('token0_address', 42).notNullable();
    table.string('token1_address', 42).notNullable();
    table.string('token0_symbol', 10).notNullable();
    table.string('token1_symbol', 10).notNullable();
    table.integer('token0_decimals').notNullable();
    table.integer('token1_decimals').notNullable();
    table.string('pair_address', 42).nullable(); // LP pair address
    table.string('dex_name').notNullable(); // PancakeSwap, Uniswap, etc.
    table.boolean('is_active').defaultTo(true);
    table.string('min_trade_amount').nullable();
    table.string('max_trade_amount').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['token0_address']);
    table.index(['token1_address']);
    table.index(['dex_name']);
    table.index(['is_active']);
  });

  // Price history table - for tracking token prices over time
  await knex.schema.createTable('price_history', (table) => {
    table.increments('id').primary();
    table.string('token_address', 42).notNullable();
    table.string('token_symbol', 10).notNullable();
    table.string('price_usd').notNullable();
    table.string('volume_24h').nullable();
    table.string('market_cap').nullable();
    table.string('price_change_24h').nullable();
    table.string('data_source').notNullable(); // CoinGecko, DEX, etc.
    table.timestamp('recorded_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['token_address', 'recorded_at']);
    table.index(['recorded_at']);
  });

  // Portfolio snapshots table - for tracking portfolio value over time
  await knex.schema.createTable('portfolio_snapshots', (table) => {
    table.increments('id').primary();
    table.string('wallet_address', 42).notNullable();
    table.string('total_value_usd').notNullable();
    table.json('token_balances').notNullable(); // Array of {token, balance, value_usd}
    table.string('pnl_24h').nullable();
    table.string('pnl_7d').nullable();
    table.string('pnl_30d').nullable();
    table.timestamp('snapshot_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['wallet_address', 'snapshot_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('portfolio_snapshots');
  await knex.schema.dropTableIfExists('price_history');
  await knex.schema.dropTableIfExists('trading_pairs');
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('trades');
}