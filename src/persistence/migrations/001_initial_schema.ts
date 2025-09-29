import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Wallets table
  await knex.schema.createTable('wallets', (table) => {
    table.string('address', 42).primary();
    table.text('private_key_encrypted').notNullable();
    table.integer('derivation_index').nullable();
    table.string('label').nullable();
    table.string('group_name').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['group_name']);
    table.index(['created_at']);
  });

  // Transactions table
  await knex.schema.createTable('transactions', (table) => {
    table.increments('id').primary();
    table.string('tx_hash', 66).unique().notNullable();
    table.string('from_address', 42).notNullable();
    table.string('to_address', 42).notNullable();
    table.string('amount').notNullable(); // Store as string to preserve precision
    table.string('token_address', 42).nullable(); // null for BNB
    table.string('token_symbol', 10).nullable();
    table.integer('token_decimals').nullable();
    table.string('gas_used').nullable();
    table.string('gas_price').notNullable(); // In gwei
    table.string('transaction_fee').nullable(); // Total fee in BNB
    table.enum('status', ['pending', 'confirmed', 'failed']).defaultTo('pending');
    table.enum('operation_type', ['transfer', 'trade_buy', 'trade_sell', 'approve']).notNullable();
    table.string('block_number').nullable();
    table.integer('block_timestamp').nullable();
    table.text('error_message').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['from_address']);
    table.index(['to_address']);
    table.index(['status']);
    table.index(['operation_type']);
    table.index(['created_at']);
    table.index(['token_address']);
  });

  // Approvals table
  await knex.schema.createTable('approvals', (table) => {
    table.increments('id').primary();
    table.string('wallet_address', 42).notNullable();
    table.string('token_address', 42).notNullable();
    table.string('spender_address', 42).notNullable();
    table.string('amount').notNullable(); // Approved amount
    table.string('tx_hash', 66).nullable();
    table.enum('status', ['pending', 'confirmed', 'failed']).defaultTo('pending');
    table.timestamp('expires_at').nullable(); // For time-based limits
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    
    table.unique(['wallet_address', 'token_address', 'spender_address']);
    table.index(['wallet_address']);
    table.index(['status']);
  });

  // Strategies table
  await knex.schema.createTable('strategies', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.enum('type', ['grid', 'basic_mm', 'arbitrage']).notNullable();
    table.enum('status', ['inactive', 'active', 'paused', 'error']).defaultTo('inactive');
    table.json('config').notNullable(); // Strategy-specific configuration
    table.json('state').nullable(); // Runtime state
    table.string('wallet_address', 42).nullable(); // Primary wallet for strategy
    table.string('token_pair').nullable(); // e.g., "BNB/USDT"
    table.timestamp('started_at').nullable();
    table.timestamp('stopped_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['status']);
    table.index(['type']);
    table.index(['wallet_address']);
  });

  // Strategy performance metrics
  await knex.schema.createTable('strategy_metrics', (table) => {
    table.increments('id').primary();
    table.integer('strategy_id').references('id').inTable('strategies').onDelete('CASCADE');
    table.string('metric_name').notNullable(); // e.g., 'total_volume', 'profit_loss', 'trades_count'
    table.string('metric_value').notNullable(); // Store as string for precision
    table.timestamp('recorded_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['strategy_id', 'metric_name', 'recorded_at']);
  });

  // System metrics table
  await knex.schema.createTable('system_metrics', (table) => {
    table.increments('id').primary();
    table.string('metric_name').notNullable();
    table.string('metric_value').notNullable();
    table.json('metadata').nullable(); // Additional context
    table.timestamp('recorded_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['metric_name', 'recorded_at']);
  });

  // Audit log table
  await knex.schema.createTable('audit_log', (table) => {
    table.increments('id').primary();
    table.string('action').notNullable(); // e.g., 'wallet_created', 'transfer_sent'
    table.string('entity_type').notNullable(); // e.g., 'wallet', 'transaction'
    table.string('entity_id').nullable();
    table.string('user_agent').nullable();
    table.json('old_values').nullable();
    table.json('new_values').nullable();
    table.text('notes').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['action']);
    table.index(['entity_type']);
    table.index(['created_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('system_metrics');
  await knex.schema.dropTableIfExists('strategy_metrics');
  await knex.schema.dropTableIfExists('strategies');
  await knex.schema.dropTableIfExists('approvals');
  await knex.schema.dropTableIfExists('transactions');
  await knex.schema.dropTableIfExists('wallets');
}