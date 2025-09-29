import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Orders table - for tracking all trade orders/plans
  await knex.schema.createTable('orders', (table) => {
    table.increments('id').primary();
    table.string('order_id', 64).unique().notNullable(); // UUID for idempotency
    table.enum('order_type', ['market_buy', 'market_sell', 'limit_buy', 'limit_sell']).notNullable();
    table.enum('status', ['pending', 'executing', 'completed', 'failed', 'cancelled', 'expired']).defaultTo('pending');
    
    // Order details
    table.string('wallet_address', 42).notNullable();
    table.string('token_in_address', 42).notNullable();
    table.string('token_out_address', 42).notNullable();
    table.string('token_in_symbol', 20).notNullable();
    table.string('token_out_symbol', 20).notNullable();
    table.string('amount_in').notNullable(); // Input amount (string for precision)
    table.string('amount_out_expected').nullable(); // Expected output amount
    table.string('amount_out_min').nullable(); // Minimum acceptable output
    table.string('amount_out_actual').nullable(); // Actual received amount
    
    // Trading parameters
    table.decimal('slippage', 8, 6).notNullable(); // e.g., 0.005000 for 0.5%
    table.decimal('price_impact', 8, 6).nullable();
    table.string('execution_price').nullable();
    table.json('trading_path').nullable(); // Array of token addresses
    
    // Execution details
    table.string('tx_hash', 66).nullable();
    table.string('gas_used').nullable();
    table.string('gas_price').nullable();
    table.string('total_fee_bnb').nullable();
    
    // Timestamps and lifecycle
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('executed_at').nullable();
    table.timestamp('expires_at').nullable(); // For limit orders
    
    // Metadata and context
    table.json('metadata').nullable(); // Strategy context, user data, etc.
    table.text('failure_reason').nullable();
    table.integer('retry_count').defaultTo(0);
    table.string('parent_order_id', 64).nullable(); // For order replacement/cancellation
    
    // Indexes
    table.index(['wallet_address']);
    table.index(['status']);
    table.index(['order_type']);
    table.index(['created_at']);
    table.index(['token_in_address']);
    table.index(['token_out_address']);
    table.index(['expires_at']);
  });

  // Order events table - detailed audit trail for each order
  await knex.schema.createTable('order_events', (table) => {
    table.increments('id').primary();
    table.string('order_id', 64).notNullable().references('order_id').inTable('orders').onDelete('CASCADE');
    table.enum('event_type', [
      'created', 'validated', 'quote_obtained', 'approval_started', 'approval_completed',
      'execution_started', 'tx_submitted', 'tx_confirmed', 'completed',
      'failed', 'cancelled', 'expired', 'replaced'
    ]).notNullable();
    table.text('event_message').nullable();
    table.json('event_data').nullable(); // Context data for the event
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['order_id', 'created_at']);
    table.index(['event_type']);
  });

  // Price snapshots - for tracking prices at time of order
  await knex.schema.createTable('price_snapshots', (table) => {
    table.increments('id').primary();
    table.string('token_pair', 50).notNullable(); // e.g., "BNB/USDT"
    table.string('token_in_address', 42).notNullable();
    table.string('token_out_address', 42).notNullable();
    table.string('price').notNullable(); // Price at snapshot time
    table.string('liquidity_bnb').nullable(); // Liquidity in BNB terms
    table.decimal('volume_24h_bnb', 20, 8).nullable();
    table.string('source', 20).defaultTo('pancakeswap_v2'); // Price source
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['token_pair', 'created_at']);
    table.index(['token_in_address', 'token_out_address']);
    table.index(['created_at']);
  });

  // Balance snapshots - for tracking wallet balances over time
  await knex.schema.createTable('balance_snapshots', (table) => {
    table.increments('id').primary();
    table.string('wallet_address', 42).notNullable();
    table.string('token_address', 42).notNullable(); // "BNB" for native BNB
    table.string('token_symbol', 20).notNullable();
    table.string('balance').notNullable(); // Raw balance
    table.string('balance_usd').nullable(); // USD value at snapshot time
    table.enum('snapshot_trigger', ['manual', 'pre_trade', 'post_trade', 'scheduled', 'emergency']).notNullable();
    table.string('related_order_id', 64).nullable(); // If triggered by trade
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['wallet_address', 'token_address']);
    table.index(['created_at']);
    table.index(['related_order_id']);
  });

  // System events - for operational monitoring
  await knex.schema.createTable('system_events', (table) => {
    table.increments('id').primary();
    table.enum('event_type', [
      'startup', 'shutdown', 'emergency_stop', 'emergency_resume',
      'config_update', 'strategy_start', 'strategy_stop', 'health_check_fail',
      'rpc_error', 'high_failure_rate', 'nonce_repair', 'gas_spike'
    ]).notNullable();
    table.enum('severity', ['info', 'warning', 'error', 'critical']).notNullable();
    table.string('component', 50).nullable(); // Which component generated the event
    table.text('message').notNullable();
    table.json('event_data').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['event_type']);
    table.index(['severity']);
    table.index(['created_at']);
    table.index(['component']);
  });

  // Risk events - for tracking risk management actions
  await knex.schema.createTable('risk_events', (table) => {
    table.increments('id').primary();
    table.enum('risk_type', [
      'high_slippage', 'high_price_impact', 'volume_limit_exceeded',
      'blacklisted_token', 'suspicious_address', 'rate_limit_hit',
      'emergency_triggered', 'unusual_pattern'
    ]).notNullable();
    table.enum('action_taken', ['blocked', 'warned', 'logged', 'emergency_stop']).notNullable();
    table.string('wallet_address', 42).nullable();
    table.string('token_address', 42).nullable();
    table.string('order_id', 64).nullable();
    table.text('risk_message').notNullable();
    table.json('risk_data').nullable(); // Context data (amounts, thresholds, etc.)
    table.integer('risk_score').nullable(); // 0-100 risk score
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['risk_type']);
    table.index(['wallet_address']);
    table.index(['created_at']);
    table.index(['risk_score']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('risk_events');
  await knex.schema.dropTableIfExists('system_events');
  await knex.schema.dropTableIfExists('balance_snapshots');
  await knex.schema.dropTableIfExists('price_snapshots');
  await knex.schema.dropTableIfExists('order_events');
  await knex.schema.dropTableIfExists('orders');
}