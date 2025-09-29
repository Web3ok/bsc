import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create strategies table
  if (!(await knex.schema.hasTable('strategies'))) {
    await knex.schema.createTable('strategies', (table) => {
    table.string('id', 128).primary().comment('Unique strategy identifier');
    table.string('name', 100).notNullable().comment('Strategy name');
    table.string('type', 50).notNullable().comment('Strategy type (grid, dca, etc.)');
    table.text('description').comment('Strategy description');
    table.string('symbol', 20).notNullable().comment('Trading pair symbol');
    table.string('status', 20).notNullable().defaultTo('inactive').comment('Strategy status');
    table.string('execution_mode', 20).notNullable().defaultTo('paper').comment('Execution mode');
    table.json('risk_limits').notNullable().comment('Risk management limits');
    table.json('parameters').notNullable().comment('Strategy-specific parameters');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Last update timestamp');
    
    table.index(['type', 'status'], 'idx_strategies_type_status');
    table.index(['symbol'], 'idx_strategies_symbol');
    table.index(['created_at'], 'idx_strategies_created');
    });
  }

  // Create orders table
  if (!(await knex.schema.hasTable('orders'))) {
    await knex.schema.createTable('orders', (table) => {
    table.string('id', 128).primary().comment('Unique order identifier');
    table.string('strategy_id', 128).notNullable().comment('Associated strategy ID');
    table.string('symbol', 20).notNullable().comment('Trading pair symbol');
    table.string('side', 10).notNullable().comment('Order side (buy/sell)');
    table.string('type', 20).notNullable().comment('Order type (market/limit/stop)');
    table.string('status', 20).notNullable().defaultTo('pending').comment('Order status');
    table.string('amount', 50).notNullable().comment('Order amount in base currency');
    table.string('price', 50).comment('Order price (for limit orders)');
    table.string('stop_price', 50).comment('Stop price (for stop orders)');
    table.string('filled_amount', 50).defaultTo('0').comment('Amount filled');
    table.string('average_price', 50).comment('Average fill price');
    table.string('fee_paid', 50).defaultTo('0').comment('Fee paid');
    table.string('fee_asset', 10).comment('Fee asset');
    table.string('time_in_force', 10).comment('Time in force (GTC/IOC/FOK)');
    table.timestamp('expire_time').comment('Order expiry time');
    table.boolean('reduce_only').defaultTo(false).comment('Reduce only flag');
    table.json('metadata').comment('Additional order metadata');
    table.string('tx_hash', 66).comment('Transaction hash');
    table.text('error_message').comment('Error message if failed');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Last update timestamp');
    table.timestamp('submitted_at').comment('Submission timestamp');
    table.timestamp('filled_at').comment('Fill timestamp');
    
    table.index(['strategy_id', 'status'], 'idx_orders_strategy_status');
    table.index(['symbol', 'side'], 'idx_orders_symbol_side');
    table.index(['status', 'created_at'], 'idx_orders_status_created');
    table.index(['tx_hash'], 'idx_orders_tx_hash');
    
    table.foreign('strategy_id').references('strategies.id').onDelete('CASCADE');
    });
  }

  // Create positions table
  if (!(await knex.schema.hasTable('positions'))) {
    await knex.schema.createTable('positions', (table) => {
    table.string('id', 128).primary().comment('Unique position identifier');
    table.string('strategy_id', 128).notNullable().comment('Associated strategy ID');
    table.string('symbol', 20).notNullable().comment('Trading pair symbol');
    table.string('side', 10).notNullable().comment('Position side (long/short/neutral)');
    table.string('size', 50).notNullable().comment('Position size (signed)');
    table.string('entry_price', 50).notNullable().comment('Average entry price');
    table.string('mark_price', 50).notNullable().comment('Current mark price');
    table.string('unrealized_pnl', 50).defaultTo('0').comment('Unrealized PnL');
    table.string('realized_pnl', 50).defaultTo('0').comment('Realized PnL');
    table.string('margin_used', 50).defaultTo('0').comment('Margin used');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Last update timestamp');
    
    table.index(['strategy_id'], 'idx_positions_strategy');
    table.index(['symbol'], 'idx_positions_symbol');
    table.index(['side'], 'idx_positions_side');
    
    table.foreign('strategy_id').references('strategies.id').onDelete('CASCADE');
    });
  }

  // Create strategy_metrics table
  if (!(await knex.schema.hasTable('strategy_metrics'))) {
    await knex.schema.createTable('strategy_metrics', (table) => {
    table.string('strategy_id', 128).primary().comment('Strategy ID');
    table.integer('total_trades').defaultTo(0).comment('Total number of trades');
    table.integer('winning_trades').defaultTo(0).comment('Number of winning trades');
    table.integer('losing_trades').defaultTo(0).comment('Number of losing trades');
    table.decimal('win_rate', 5, 4).defaultTo(0).comment('Win rate percentage');
    table.string('total_pnl', 50).defaultTo('0').comment('Total PnL');
    table.string('realized_pnl', 50).defaultTo('0').comment('Realized PnL');
    table.string('unrealized_pnl', 50).defaultTo('0').comment('Unrealized PnL');
    table.string('max_drawdown', 50).defaultTo('0').comment('Maximum drawdown');
    table.decimal('sharpe_ratio', 8, 4).comment('Sharpe ratio');
    table.decimal('sortino_ratio', 8, 4).comment('Sortino ratio');
    table.string('max_position_size', 50).defaultTo('0').comment('Maximum position size');
    table.string('volume_traded', 50).defaultTo('0').comment('Total volume traded');
    table.string('fees_paid', 50).defaultTo('0').comment('Total fees paid');
    table.timestamp('start_time').notNullable().comment('Strategy start time');
    table.timestamp('end_time').comment('Strategy end time');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Last update timestamp');
    
    table.foreign('strategy_id').references('strategies.id').onDelete('CASCADE');
    });
  }

  // Create grid_levels table (for grid strategies)
  if (!(await knex.schema.hasTable('grid_levels'))) {
    await knex.schema.createTable('grid_levels', (table) => {
    table.string('id', 128).primary().comment('Unique grid level identifier');
    table.string('strategy_id', 128).notNullable().comment('Associated strategy ID');
    table.integer('level').notNullable().comment('Grid level index');
    table.string('price', 50).notNullable().comment('Grid level price');
    table.string('side', 10).notNullable().comment('Order side (buy/sell)');
    table.string('amount', 50).notNullable().comment('Order amount');
    table.string('order_id', 128).comment('Associated order ID');
    table.boolean('filled').defaultTo(false).comment('Whether level is filled');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Last update timestamp');
    
    table.index(['strategy_id', 'level'], 'idx_grid_levels_strategy_level');
    table.index(['price'], 'idx_grid_levels_price');
    table.index(['filled'], 'idx_grid_levels_filled');
    
    table.foreign('strategy_id').references('strategies.id').onDelete('CASCADE');
    table.foreign('order_id').references('orders.id').onDelete('SET NULL');
    });
  }

  // Create conditional_orders table
  if (!(await knex.schema.hasTable('conditional_orders'))) {
    await knex.schema.createTable('conditional_orders', (table) => {
    table.string('id', 128).primary().comment('Unique conditional order identifier');
    table.string('strategy_id', 128).comment('Associated strategy ID (optional)');
    table.json('trigger_condition').notNullable().comment('Trigger condition parameters');
    table.json('order_request').notNullable().comment('Order to execute when triggered');
    table.string('status', 20).notNullable().defaultTo('active').comment('Conditional order status');
    table.timestamp('triggered_at').comment('When condition was triggered');
    table.string('triggered_order_id', 128).comment('ID of order created when triggered');
    table.timestamp('expire_time').comment('Expiry time');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('updated_at').defaultTo(knex.fn.now()).comment('Last update timestamp');
    
    table.index(['status'], 'idx_conditional_orders_status');
    table.index(['expire_time'], 'idx_conditional_orders_expire');
    table.index(['strategy_id'], 'idx_conditional_orders_strategy');
    
    table.foreign('strategy_id').references('strategies.id').onDelete('CASCADE');
    table.foreign('triggered_order_id').references('orders.id').onDelete('SET NULL');
    });
  }

  // Create strategy_signals table
  if (!(await knex.schema.hasTable('strategy_signals'))) {
    await knex.schema.createTable('strategy_signals', (table) => {
    table.string('id', 128).primary().comment('Unique signal identifier');
    table.string('strategy_id', 128).notNullable().comment('Associated strategy ID');
    table.string('type', 20).notNullable().comment('Signal type (buy/sell/hold/close/adjust)');
    table.decimal('confidence', 3, 2).notNullable().comment('Signal confidence (0-1)');
    table.string('price', 50).notNullable().comment('Signal price');
    table.string('amount', 50).notNullable().comment('Signal amount');
    table.text('reason').notNullable().comment('Signal reason/description');
    table.json('metadata').comment('Additional signal metadata');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    
    table.index(['strategy_id', 'created_at'], 'idx_signals_strategy_time');
    table.index(['type'], 'idx_signals_type');
    
    table.foreign('strategy_id').references('strategies.id').onDelete('CASCADE');
    });
  }

  // Create strategy_actions table
  if (!(await knex.schema.hasTable('strategy_actions'))) {
    await knex.schema.createTable('strategy_actions', (table) => {
    table.string('id', 128).primary().comment('Unique action identifier');
    table.string('strategy_id', 128).notNullable().comment('Associated strategy ID');
    table.string('signal_id', 128).comment('Associated signal ID');
    table.string('type', 50).notNullable().comment('Action type');
    table.json('parameters').notNullable().comment('Action parameters');
    table.string('status', 20).notNullable().defaultTo('pending').comment('Action status');
    table.json('result').comment('Action result');
    table.text('error').comment('Error message if failed');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('executed_at').comment('Execution timestamp');
    
    table.index(['strategy_id', 'status'], 'idx_actions_strategy_status');
    table.index(['type'], 'idx_actions_type');
    table.index(['created_at'], 'idx_actions_created');
    
    table.foreign('strategy_id').references('strategies.id').onDelete('CASCADE');
    table.foreign('signal_id').references('strategy_signals.id').onDelete('SET NULL');
    });
  }

  // Create backtests table
  if (!(await knex.schema.hasTable('backtests'))) {
    await knex.schema.createTable('backtests', (table) => {
    table.string('id', 128).primary().comment('Unique backtest identifier');
    table.string('name', 100).notNullable().comment('Backtest name');
    table.json('strategy_config').notNullable().comment('Strategy configuration used');
    table.timestamp('start_date').notNullable().comment('Backtest start date');
    table.timestamp('end_date').notNullable().comment('Backtest end date');
    table.json('initial_balance').notNullable().comment('Initial balance for backtest');
    table.string('data_source', 20).notNullable().comment('Data source (historical/generated)');
    table.string('slippage_model', 20).notNullable().comment('Slippage model used');
    table.decimal('commission_rate', 6, 4).notNullable().comment('Commission rate');
    table.decimal('price_impact', 6, 4).notNullable().comment('Price impact factor');
    table.decimal('total_return', 10, 6).comment('Total return percentage');
    table.decimal('annualized_return', 10, 6).comment('Annualized return percentage');
    table.decimal('max_drawdown', 10, 6).comment('Maximum drawdown percentage');
    table.decimal('sharpe_ratio', 8, 4).comment('Sharpe ratio');
    table.decimal('sortino_ratio', 8, 4).comment('Sortino ratio');
    table.decimal('win_rate', 5, 4).comment('Win rate percentage');
    table.integer('total_trades').comment('Total number of trades');
    table.decimal('avg_trade_return', 8, 4).comment('Average trade return');
    table.decimal('profit_factor', 8, 4).comment('Profit factor');
    table.decimal('calmar_ratio', 8, 4).comment('Calmar ratio');
    table.json('daily_returns').comment('Daily returns array');
    table.json('equity_curve').comment('Equity curve data');
    table.string('status', 20).notNullable().defaultTo('running').comment('Backtest status');
    table.timestamp('created_at').defaultTo(knex.fn.now()).comment('Creation timestamp');
    table.timestamp('completed_at').comment('Completion timestamp');
    
    table.index(['status'], 'idx_backtests_status');
    table.index(['created_at'], 'idx_backtests_created');
    table.index(['start_date', 'end_date'], 'idx_backtests_date_range');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('backtests');
  await knex.schema.dropTableIfExists('strategy_actions');
  await knex.schema.dropTableIfExists('strategy_signals');
  await knex.schema.dropTableIfExists('conditional_orders');
  await knex.schema.dropTableIfExists('grid_levels');
  await knex.schema.dropTableIfExists('strategy_metrics');
  await knex.schema.dropTableIfExists('positions');
  await knex.schema.dropTableIfExists('orders');
  await knex.schema.dropTableIfExists('strategies');
}