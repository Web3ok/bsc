import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create blockchain monitoring transactions table
  // This table tracks all blockchain events detected by the monitoring service
  await knex.schema.createTable('blockchain_transactions', (table) => {
    table.increments('id').primary();
    table.string('tx_hash', 66).unique().notNullable();
    table.string('from_address', 42).notNullable();
    table.string('to_address', 42).notNullable();
    table.string('amount').notNullable(); // Amount transferred (raw value)
    table.string('token_address', 42).nullable(); // Token contract address, null for native BNB
    table.string('token_symbol', 10).nullable();
    table.integer('token_decimals').nullable();
    table.string('gas_used').nullable();
    table.string('gas_price').notNullable();
    table.string('transaction_fee').nullable(); // Total fee in native currency
    table.enum('status', ['pending', 'confirmed', 'failed']).defaultTo('confirmed');
    table.enum('operation_type', ['transfer', 'token_transfer', 'swap', 'approve']).notNullable();
    table.string('block_number').notNullable();
    table.integer('block_timestamp').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    
    // Indexes for efficient querying
    table.index(['from_address']);
    table.index(['to_address']);
    table.index(['status']);
    table.index(['operation_type']);
    table.index(['block_number']);
    table.index(['block_timestamp']);
    table.index(['created_at']);
    table.index(['token_address']);
  });

  // Create monitoring status table to track which addresses are being watched
  await knex.schema.createTable('monitoring_status', (table) => {
    table.increments('id').primary();
    table.string('wallet_address', 42).unique().notNullable();
    table.boolean('is_active').defaultTo(true);
    table.string('last_processed_block').nullable();
    table.timestamp('started_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    
    table.index(['wallet_address']);
    table.index(['is_active']);
  });

  // Create alerts table for monitoring notifications
  await knex.schema.createTable('monitoring_alerts', (table) => {
    table.increments('id').primary();
    table.string('wallet_address', 42).notNullable();
    table.string('alert_type').notNullable(); // 'large_transfer', 'new_token', 'unusual_activity'
    table.string('tx_hash', 66).nullable();
    table.json('alert_data').notNullable(); // Additional context data
    table.string('severity').notNullable(); // 'low', 'medium', 'high', 'critical'
    table.boolean('is_resolved').defaultTo(false);
    table.timestamp('triggered_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('resolved_at').nullable();
    
    table.index(['wallet_address']);
    table.index(['alert_type']);
    table.index(['severity']);
    table.index(['is_resolved']);
    table.index(['triggered_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('monitoring_alerts');
  await knex.schema.dropTableIfExists('monitoring_status');
  await knex.schema.dropTableIfExists('blockchain_transactions');
}