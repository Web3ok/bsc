/**
 * Risk Management Tables Migration
 * 
 * Creates database tables for advanced risk controls and position management:
 * - Risk limits and thresholds per entity
 * - Position and portfolio risk assessments
 * - Risk alerts and automated actions
 * - Position adjustments and optimization history
 */

import { Knex } from 'knex';
import { logger } from '../../utils/logger';

export async function up(knex: Knex): Promise<void> {
  logger.info('Creating risk management tables...');

  // Risk limits configuration table
  if (!(await knex.schema.hasTable('risk_limits'))) {
    await knex.schema.createTable('risk_limits', (table) => {
    table.string('entity_id', 128).primary();
    table.string('entity_type', 20).notNullable(); // 'strategy', 'portfolio', 'global'
    table.decimal('max_position_size_usd', 18, 8).notNullable();
    table.decimal('max_portfolio_exposure_pct', 5, 2).notNullable();
    table.decimal('max_daily_loss_usd', 18, 8).notNullable();
    table.decimal('max_drawdown_pct', 5, 2).notNullable();
    table.decimal('max_leverage', 8, 4).notNullable();
    table.decimal('stop_loss_pct', 5, 2).nullable();
    table.decimal('take_profit_pct', 5, 2).nullable();
    table.decimal('position_concentration_limit_pct', 5, 2).notNullable();
    table.decimal('correlation_limit', 5, 2).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index(['entity_type', 'entity_id']);
    table.comment('Risk limits configuration per entity (strategy/portfolio/global)');
    });
  }

  // Position risk assessments
  if (!(await knex.schema.hasTable('position_risks'))) {
    await knex.schema.createTable('position_risks', (table) => {
    table.string('position_id', 128).primary();
    table.string('symbol', 20).notNullable();
    table.decimal('current_size_usd', 18, 8).notNullable();
    table.decimal('unrealized_pnl_usd', 18, 8).notNullable();
    table.decimal('risk_score', 5, 2).notNullable(); // 0-100 risk score
    table.decimal('var_1d_usd', 18, 8).notNullable(); // Value at Risk 1 day
    table.decimal('exposure_pct', 5, 2).notNullable(); // % of portfolio
    table.decimal('max_drawdown_pct', 5, 2).notNullable();
    table.decimal('correlation_score', 5, 2).notNullable();
    table.decimal('liquidity_score', 5, 2).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.foreign('position_id').references('id').inTable('positions').onDelete('CASCADE');
    table.index(['symbol', 'updated_at']);
    table.index(['risk_score', 'updated_at']);
    table.comment('Real-time risk assessment for individual positions');
    });
  }

  // Portfolio risk assessments
  if (!(await knex.schema.hasTable('portfolio_risks'))) {
    await knex.schema.createTable('portfolio_risks', (table) => {
    table.string('portfolio_id', 128).primary();
    table.decimal('total_exposure_usd', 18, 8).notNullable();
    table.decimal('total_var_1d_usd', 18, 8).notNullable();
    table.decimal('portfolio_beta', 8, 4).notNullable();
    table.decimal('sharpe_ratio', 8, 4).notNullable();
    table.decimal('max_drawdown_pct', 5, 2).notNullable();
    table.decimal('concentration_risk', 5, 2).notNullable();
    table.decimal('correlation_risk', 5, 2).notNullable();
    table.decimal('liquidity_risk', 5, 2).notNullable();
    table.decimal('overall_risk_score', 5, 2).notNullable();
    table.integer('breach_count').defaultTo(0);
    table.timestamp('last_assessment').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index(['last_assessment']);
    table.index(['overall_risk_score', 'last_assessment']);
    table.comment('Portfolio-wide risk metrics and assessments');
    });
  }

  // Risk alerts and notifications
  if (!(await knex.schema.hasTable('risk_alerts'))) {
    await knex.schema.createTable('risk_alerts', (table) => {
    table.string('id', 128).primary();
    table.string('alert_type', 50).notNullable(); // position_limit, drawdown, exposure, etc.
    table.string('severity', 20).notNullable(); // low, medium, high, critical
    table.string('entity_id', 128).notNullable(); // position_id or portfolio_id
    table.string('entity_type', 20).notNullable(); // position, portfolio, strategy
    table.text('message').notNullable();
    table.decimal('current_value', 18, 8).notNullable();
    table.decimal('limit_value', 18, 8).notNullable();
    table.string('recommended_action', 50).notNullable(); // monitor, reduce, close, hedge, emergency_stop
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('resolved_at').nullable();
    table.string('resolved_by', 100).nullable();
    
    table.index(['entity_id', 'alert_type', 'created_at']);
    table.index(['severity', 'resolved_at']);
    table.index(['created_at']);
    table.comment('Risk alerts and breach notifications');
    });
  }

  // Risk actions and responses
  if (!(await knex.schema.hasTable('risk_actions'))) {
    await knex.schema.createTable('risk_actions', (table) => {
    table.string('id', 128).primary();
    table.string('trigger_alert_id', 128).notNullable();
    table.string('action_type', 50).notNullable(); // position_reduce, position_close, hedge_add, strategy_pause, emergency_stop
    table.json('parameters').notNullable();
    table.string('status', 20).notNullable().defaultTo('pending'); // pending, executing, completed, failed, cancelled
    table.timestamp('execution_time').nullable();
    table.json('result').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.foreign('trigger_alert_id').references('id').inTable('risk_alerts');
    table.index(['trigger_alert_id', 'status']);
    table.index(['action_type', 'created_at']);
    table.index(['status', 'created_at']);
    table.comment('Automated risk management actions and execution results');
    });
  }

  // Position adjustments and optimizations
  if (!(await knex.schema.hasTable('position_adjustments'))) {
    await knex.schema.createTable('position_adjustments', (table) => {
    table.string('id', 128).primary();
    table.string('position_id', 128).notNullable();
    table.string('adjustment_type', 50).notNullable(); // size_increase, size_decrease, stop_adjustment, target_adjustment, close
    table.decimal('size_change_usd', 18, 8).nullable();
    table.decimal('new_stop_loss', 18, 8).nullable();
    table.decimal('new_take_profit', 18, 8).nullable();
    table.text('reason').notNullable();
    table.decimal('confidence_score', 5, 2).notNullable(); // 0-100 confidence
    table.decimal('risk_reward_ratio', 8, 4).notNullable();
    table.string('status', 20).notNullable().defaultTo('pending');
    table.timestamp('executed_at').nullable();
    table.json('execution_result').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.foreign('position_id').references('id').inTable('positions').onDelete('CASCADE');
    table.index(['position_id', 'created_at']);
    table.index(['adjustment_type', 'created_at']);
    table.index(['status', 'created_at']);
    table.comment('Position optimization adjustments and execution history');
    });
  }

  // Position metrics history
  if (!(await knex.schema.hasTable('position_metrics_history'))) {
    await knex.schema.createTable('position_metrics_history', (table) => {
    table.string('id', 128).primary();
    table.string('position_id', 128).notNullable();
    table.string('symbol', 20).notNullable();
    table.timestamp('snapshot_time').notNullable();
    table.decimal('hold_duration_hours', 8, 2).notNullable();
    table.decimal('current_size_usd', 18, 8).notNullable();
    table.decimal('avg_entry_price', 18, 8).notNullable();
    table.decimal('current_price', 18, 8).notNullable();
    table.decimal('unrealized_pnl_usd', 18, 8).notNullable();
    table.decimal('unrealized_pnl_pct', 8, 4).notNullable();
    table.decimal('realized_pnl_usd', 18, 8).notNullable();
    table.decimal('max_favorable_excursion', 8, 4).notNullable();
    table.decimal('max_adverse_excursion', 8, 4).notNullable();
    table.decimal('efficiency_ratio', 8, 4).notNullable();
    table.decimal('win_rate', 5, 2).notNullable();
    table.decimal('profit_factor', 8, 4).notNullable();
    table.decimal('sharpe_ratio', 8, 4).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.foreign('position_id').references('id').inTable('positions').onDelete('CASCADE');
    table.index(['position_id', 'snapshot_time']);
    table.index(['symbol', 'snapshot_time']);
    table.index(['efficiency_ratio', 'snapshot_time']);
    table.comment('Historical position performance metrics');
    });
  }

  // Portfolio metrics history
  if (!(await knex.schema.hasTable('portfolio_metrics_history'))) {
    await knex.schema.createTable('portfolio_metrics_history', (table) => {
    table.string('id', 128).primary();
    table.string('portfolio_id', 128).notNullable();
    table.timestamp('snapshot_time').notNullable();
    table.decimal('total_value_usd', 18, 8).notNullable();
    table.decimal('total_pnl_usd', 18, 8).notNullable();
    table.decimal('total_pnl_pct', 8, 4).notNullable();
    table.integer('number_of_positions').notNullable();
    table.decimal('avg_position_size_usd', 18, 8).notNullable();
    table.decimal('largest_position_pct', 5, 2).notNullable();
    table.decimal('concentration_ratio', 8, 4).notNullable(); // HHI
    table.decimal('correlation_score', 5, 2).notNullable();
    table.decimal('portfolio_beta', 8, 4).notNullable();
    table.decimal('volatility_annualized', 8, 4).notNullable();
    table.decimal('sharpe_ratio', 8, 4).notNullable();
    table.decimal('sortino_ratio', 8, 4).notNullable();
    table.decimal('max_drawdown_pct', 5, 2).notNullable();
    table.decimal('recovery_factor', 8, 4).notNullable();
    table.decimal('profit_factor', 8, 4).notNullable();
    table.decimal('win_rate', 5, 2).notNullable();
    table.decimal('avg_win_pct', 5, 2).notNullable();
    table.decimal('avg_loss_pct', 5, 2).notNullable();
    table.decimal('largest_win_pct', 5, 2).notNullable();
    table.decimal('largest_loss_pct', 5, 2).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index(['portfolio_id', 'snapshot_time']);
    table.index(['snapshot_time']);
    table.index(['sharpe_ratio', 'snapshot_time']);
    table.comment('Historical portfolio performance metrics');
    });
  }

  // Position sizing configurations
  if (!(await knex.schema.hasTable('position_sizing_configs'))) {
    await knex.schema.createTable('position_sizing_configs', (table) => {
    table.string('id', 128).primary();
    table.string('entity_id', 128).notNullable(); // strategy_id or 'global'
    table.string('entity_type', 20).notNullable(); // 'strategy' or 'global'
    table.string('sizing_method', 20).notNullable(); // fixed, percentage, volatility, kelly, risk_parity
    table.decimal('base_size_usd', 18, 8).notNullable();
    table.decimal('max_size_usd', 18, 8).notNullable();
    table.decimal('portfolio_percentage', 5, 2).notNullable();
    table.integer('volatility_lookback').notNullable().defaultTo(30);
    table.integer('kelly_lookback').notNullable().defaultTo(100);
    table.decimal('risk_free_rate', 5, 4).notNullable().defaultTo(0.02);
    table.decimal('max_leverage', 8, 4).notNullable().defaultTo(1);
    table.decimal('size_multiplier', 8, 4).notNullable().defaultTo(1);
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index(['entity_id', 'entity_type']);
    table.index(['sizing_method']);
    table.comment('Position sizing configurations per strategy or global');
    });
  }

  // Entry/Exit rules configurations
  if (!(await knex.schema.hasTable('entry_exit_rules'))) {
    await knex.schema.createTable('entry_exit_rules', (table) => {
    table.string('id', 128).primary();
    table.string('entity_id', 128).notNullable(); // strategy_id or 'global'
    table.string('entity_type', 20).notNullable(); // 'strategy' or 'global'
    table.integer('max_pyramid_levels').notNullable().defaultTo(3);
    table.decimal('pyramid_scale_factor', 5, 2).notNullable().defaultTo(0.8);
    table.decimal('entry_spacing_pct', 5, 2).notNullable().defaultTo(2.0);
    table.json('partial_exit_levels').notNullable(); // Array of profit levels for partial exits
    table.decimal('stop_loss_pct', 5, 2).nullable();
    table.decimal('take_profit_pct', 5, 2).nullable();
    table.decimal('trailing_stop_pct', 5, 2).nullable();
    table.integer('time_exit_hours').nullable();
    table.integer('max_hold_time_hours').nullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index(['entity_id', 'entity_type']);
    table.comment('Entry/exit rules configurations per strategy or global');
    });
  }

  // Risk action execution plans
  if (!(await knex.schema.hasTable('execution_plans'))) {
    await knex.schema.createTable('execution_plans', (table) => {
    table.string('id', 128).primary();
    table.string('risk_action_id', 128).notNullable();
    table.string('plan_type', 50).notNullable(); // position_reduce, position_close, strategy_pause, emergency_stop
    table.string('strategy_id', 128).nullable();
    table.string('position_id', 128).nullable();
    table.json('orders').notNullable();
    table.string('status', 20).notNullable(); // pending, executing, completed, failed, cancelled, expired
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable();
    table.json('execution_result').nullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.foreign('risk_action_id').references('id').inTable('risk_actions');
    table.index(['risk_action_id', 'status']);
    table.index(['status', 'expires_at']);
    table.comment('Risk management execution plans and order coordination');
    });
  }

  // Risk action execution orders
  if (!(await knex.schema.hasTable('execution_orders'))) {
    await knex.schema.createTable('execution_orders', (table) => {
    table.string('id', 128).primary();
    table.string('order_type', 20).notNullable(); // market_sell, market_buy, cancel, update
    table.string('symbol', 20).notNullable();
    table.string('side', 10).notNullable(); // buy, sell
    table.decimal('amount', 18, 8).notNullable();
    table.decimal('price', 18, 8).nullable();
    table.decimal('stop_price', 18, 8).nullable();
    table.string('time_in_force', 10).notNullable(); // GTC, IOC, FOK
    table.boolean('reduce_only').notNullable().defaultTo(false);
    table.string('strategy_id', 128).notNullable();
    table.string('position_id', 128).nullable();
    table.string('execution_status', 20).notNullable(); // pending, submitted, filled, cancelled, failed
    table.string('transaction_hash', 128).nullable();
    table.decimal('filled_amount', 18, 8).nullable();
    table.decimal('average_price', 18, 8).nullable();
    table.decimal('fees', 18, 8).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index(['strategy_id', 'execution_status']);
    table.index(['symbol', 'created_at']);
    table.index(['execution_status', 'created_at']);
    table.comment('Individual order execution records for risk actions');
    });
  }

  // Insert default global configurations
  await knex('position_sizing_configs').insert({
    id: 'global_sizing_config',
    entity_id: 'global',
    entity_type: 'global',
    sizing_method: 'percentage',
    base_size_usd: 1000,
    max_size_usd: 10000,
    portfolio_percentage: 2.5,
    volatility_lookback: 30,
    kelly_lookback: 100,
    risk_free_rate: 0.02,
    max_leverage: 1,
    size_multiplier: 1,
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  });

  await knex('entry_exit_rules').insert({
    id: 'global_entry_exit_rules',
    entity_id: 'global',
    entity_type: 'global',
    max_pyramid_levels: 3,
    pyramid_scale_factor: 0.8,
    entry_spacing_pct: 2.0,
    partial_exit_levels: JSON.stringify([10, 20, 30]), // Partial exits at 10%, 20%, 30% profit
    stop_loss_pct: 5.0,
    take_profit_pct: 15.0,
    trailing_stop_pct: 3.0,
    time_exit_hours: null,
    max_hold_time_hours: 720, // 30 days max hold
    created_at: knex.fn.now(),
    updated_at: knex.fn.now()
  });

  await knex('risk_limits').insert({
    entity_id: 'global',
    entity_type: 'global',
    max_position_size_usd: 50000,
    max_portfolio_exposure_pct: 95.0,
    max_daily_loss_usd: 5000,
    max_drawdown_pct: 20.0,
    max_leverage: 2.0,
    stop_loss_pct: 5.0,
    take_profit_pct: 15.0,
    position_concentration_limit_pct: 25.0,
    correlation_limit: 0.7,
    updated_at: knex.fn.now()
  });

  logger.info('✅ Risk management tables created successfully');
}

export async function down(knex: Knex): Promise<void> {
  logger.info('Dropping risk management tables...');

  // Drop tables in reverse order to handle foreign keys
  const tables = [
    'execution_orders',
    'execution_plans',
    'portfolio_metrics_history',
    'position_metrics_history', 
    'entry_exit_rules',
    'position_sizing_configs',
    'position_adjustments',
    'risk_actions',
    'risk_alerts',
    'portfolio_risks',
    'position_risks',
    'risk_limits'
  ];

  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }

  logger.info('✅ Risk management tables dropped successfully');
}