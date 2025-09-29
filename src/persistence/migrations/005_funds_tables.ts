import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create wallet_configs table
  if (!(await knex.schema.hasTable('wallet_configs'))) {
    await knex.schema.createTable('wallet_configs', (table) => {
    table.string('address', 42).primary().comment('Wallet address (0x...)');
    table.string('group', 20).notNullable().comment('Wallet group classification');
    table.string('label', 100).comment('Human readable wallet label');
    table.string('strategy_id', 128).comment('Associated strategy ID if applicable');
    table.boolean('is_managed').defaultTo(true).comment('Whether wallet is under funds management');
    table.string('gas_min_bnb', 50).defaultTo('0.05').comment('Minimum BNB threshold');
    table.string('gas_max_bnb', 50).defaultTo('0.2').comment('Maximum BNB for top-up');
    table.boolean('sweep_enabled').defaultTo(true).comment('Whether sweep is enabled');
    table.string('sweep_min_threshold', 50).defaultTo('0.01').comment('Minimum threshold for sweep');
    table.json('whitelist_assets').comment('Whitelisted assets for operations');
    table.json('blacklist_assets').comment('Blacklisted assets');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Last update timestamp');
    
    table.index(['group'], 'idx_wallet_configs_group');
    table.index(['is_managed'], 'idx_wallet_configs_managed');
    table.index(['strategy_id'], 'idx_wallet_configs_strategy');
    
    table.foreign('strategy_id').references('strategies.id').onDelete('SET NULL');
    });
  }

  // Create balance_snapshots table (extending existing if needed)
  if (!(await knex.schema.hasTable('balance_snapshots'))) {
    await knex.schema.createTable('balance_snapshots', (table) => {
    table.string('id', 128).primary().comment('Unique snapshot identifier');
    table.string('wallet_address', 42).notNullable().comment('Wallet address');
    table.string('wallet_group', 20).comment('Wallet group from config');
    table.string('wallet_label', 100).comment('Wallet label from config');
    table.string('asset_symbol', 20).notNullable().comment('Asset symbol');
    table.string('balance', 50).notNullable().comment('Asset balance');
    table.string('balance_usd', 50).comment('USD equivalent balance');
    table.string('threshold_min', 50).comment('Minimum threshold for this asset');
    table.string('threshold_max', 50).comment('Maximum threshold for this asset');
    table.boolean('is_below_threshold').defaultTo(false).comment('Is below minimum threshold');
    table.boolean('is_above_threshold').defaultTo(false).comment('Is above maximum threshold');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Snapshot timestamp');
    
    table.index(['wallet_address', 'asset_symbol'], 'idx_balance_snapshots_wallet_asset');
    table.index(['wallet_group'], 'idx_balance_snapshots_group');
    table.index(['is_below_threshold'], 'idx_balance_snapshots_below');
    table.index(['is_above_threshold'], 'idx_balance_snapshots_above');
    table.index(['created_at'], 'idx_balance_snapshots_created');
    
    table.foreign('wallet_address').references('wallet_configs.address').onDelete('CASCADE');
    });
  }

  // Create gas_topup_jobs table
  if (!(await knex.schema.hasTable('gas_topup_jobs'))) {
    await knex.schema.createTable('gas_topup_jobs', (table) => {
    table.string('id', 128).primary().comment('Unique job identifier');
    table.string('target_wallet', 42).notNullable().comment('Target wallet to top up');
    table.string('from_wallet', 42).notNullable().comment('Source wallet (treasury)');
    table.string('amount_bnb', 50).notNullable().comment('BNB amount to send');
    table.string('status', 20).notNullable().defaultTo('pending').comment('Job status');
    table.string('tx_hash', 66).comment('Transaction hash');
    table.string('gas_used', 50).comment('Gas used for transaction');
    table.text('error_message').comment('Error message if failed');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Job creation timestamp');
    table.timestamp('completed_at').comment('Job completion timestamp');
    
    table.index(['target_wallet', 'status'], 'idx_gas_topup_target_status');
    table.index(['status', 'created_at'], 'idx_gas_topup_status_created');
    table.index(['tx_hash'], 'idx_gas_topup_tx_hash');
    
    table.foreign('target_wallet').references('wallet_configs.address').onDelete('CASCADE');
    table.foreign('from_wallet').references('wallet_configs.address').onDelete('CASCADE');
    });
  }

  // Create sweep_jobs table
  if (!(await knex.schema.hasTable('sweep_jobs'))) {
    await knex.schema.createTable('sweep_jobs', (table) => {
    table.string('id', 128).primary().comment('Unique job identifier');
    table.string('source_wallet', 42).notNullable().comment('Source wallet to sweep from');
    table.string('target_wallet', 42).notNullable().comment('Target wallet (treasury)');
    table.string('asset_symbol', 20).notNullable().comment('Asset to sweep');
    table.string('amount', 50).notNullable().comment('Amount to sweep');
    table.string('amount_usd', 50).comment('USD equivalent amount');
    table.string('leaving_amount', 50).defaultTo('0').comment('Amount to leave in source');
    table.string('status', 20).notNullable().defaultTo('pending').comment('Job status');
    table.string('tx_hash', 66).comment('Transaction hash');
    table.string('gas_used', 50).comment('Gas used for transaction');
    table.text('error_message').comment('Error message if failed');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Job creation timestamp');
    table.timestamp('completed_at').comment('Job completion timestamp');
    
    table.index(['source_wallet', 'status'], 'idx_sweep_jobs_source_status');
    table.index(['target_wallet'], 'idx_sweep_jobs_target');
    table.index(['asset_symbol'], 'idx_sweep_jobs_asset');
    table.index(['status', 'created_at'], 'idx_sweep_jobs_status_created');
    table.index(['tx_hash'], 'idx_sweep_jobs_tx_hash');
    
    table.foreign('source_wallet').references('wallet_configs.address').onDelete('CASCADE');
    table.foreign('target_wallet').references('wallet_configs.address').onDelete('CASCADE');
    });
  }

  // Create rebalance_jobs table
  if (!(await knex.schema.hasTable('rebalance_jobs'))) {
    await knex.schema.createTable('rebalance_jobs', (table) => {
    table.string('id', 128).primary().comment('Unique job identifier');
    table.string('wallet_group', 20).notNullable().comment('Wallet group to rebalance');
    table.json('target_allocation').notNullable().comment('Target asset allocation percentages');
    table.json('current_allocation').notNullable().comment('Current allocation at job creation');
    table.json('rebalance_actions').notNullable().comment('List of rebalance actions to execute');
    table.string('total_value_usd', 50).notNullable().comment('Total portfolio value in USD');
    table.string('status', 20).notNullable().defaultTo('pending').comment('Job status');
    table.text('error_message').comment('Error message if failed');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Job creation timestamp');
    table.timestamp('completed_at').comment('Job completion timestamp');
    
    table.index(['wallet_group', 'status'], 'idx_rebalance_jobs_group_status');
    table.index(['status', 'created_at'], 'idx_rebalance_jobs_status_created');
    });
  }

  // Create treasury_accounts table
  if (!(await knex.schema.hasTable('treasury_accounts'))) {
    await knex.schema.createTable('treasury_accounts', (table) => {
    table.string('id', 128).primary().comment('Unique treasury account identifier');
    table.string('address', 42).notNullable().unique().comment('Treasury wallet address');
    table.string('name', 100).notNullable().comment('Treasury account name');
    table.string('account_type', 20).notNullable().comment('Treasury account type');
    table.string('environment', 20).notNullable().comment('Network environment');
    table.boolean('is_active').defaultTo(true).comment('Whether account is active');
    table.string('balance_snapshot_id', 128).comment('Latest balance snapshot');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Last update timestamp');
    
    table.index(['account_type', 'is_active'], 'idx_treasury_accounts_type_active');
    table.index(['environment'], 'idx_treasury_accounts_environment');
    
    table.foreign('balance_snapshot_id').references('balance_snapshots.id').onDelete('SET NULL');
    });
  }

  // Create funds_alerts table
  if (!(await knex.schema.hasTable('funds_alerts'))) {
    await knex.schema.createTable('funds_alerts', (table) => {
    table.string('id', 128).primary().comment('Unique alert identifier');
    table.string('alert_type', 30).notNullable().comment('Type of alert');
    table.string('wallet_address', 42).comment('Related wallet address');
    table.string('asset_symbol', 20).comment('Related asset symbol');
    table.text('message').notNullable().comment('Alert message');
    table.string('severity', 10).notNullable().comment('Alert severity level');
    table.boolean('is_resolved').defaultTo(false).comment('Whether alert is resolved');
    table.json('metadata').comment('Additional alert metadata');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Alert creation timestamp');
    table.timestamp('resolved_at').comment('Alert resolution timestamp');
    
    table.index(['alert_type', 'is_resolved'], 'idx_funds_alerts_type_resolved');
    table.index(['wallet_address'], 'idx_funds_alerts_wallet');
    table.index(['severity', 'created_at'], 'idx_funds_alerts_severity_created');
    table.index(['is_resolved', 'created_at'], 'idx_funds_alerts_resolved_created');
    
    table.foreign('wallet_address').references('wallet_configs.address').onDelete('SET NULL');
    });
  }

  // Create balance_thresholds table
  if (!(await knex.schema.hasTable('balance_thresholds'))) {
    await knex.schema.createTable('balance_thresholds', (table) => {
    table.string('wallet_address', 42).notNullable().comment('Wallet address');
    table.string('asset_symbol', 20).notNullable().comment('Asset symbol');
    table.string('min_threshold', 50).comment('Minimum balance threshold');
    table.string('max_threshold', 50).comment('Maximum balance threshold');
    table.boolean('alert_enabled').defaultTo(true).comment('Whether to generate alerts');
    table.boolean('auto_action_enabled').defaultTo(false).comment('Whether to trigger auto actions');
    table.string('auto_action_type', 20).comment('Type of auto action to trigger');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Last update timestamp');
    
    table.primary(['wallet_address', 'asset_symbol'], 'pk_balance_thresholds');
    table.index(['alert_enabled'], 'idx_balance_thresholds_alert');
    table.index(['auto_action_enabled'], 'idx_balance_thresholds_auto');
    
    table.foreign('wallet_address').references('wallet_configs.address').onDelete('CASCADE');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('balance_thresholds');
  await knex.schema.dropTableIfExists('funds_alerts');
  await knex.schema.dropTableIfExists('treasury_accounts');
  await knex.schema.dropTableIfExists('rebalance_jobs');
  await knex.schema.dropTableIfExists('sweep_jobs');
  await knex.schema.dropTableIfExists('gas_topup_jobs');
  await knex.schema.dropTableIfExists('balance_snapshots');
  await knex.schema.dropTableIfExists('wallet_configs');
}