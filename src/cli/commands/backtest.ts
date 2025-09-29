import { Command } from 'commander';
import pino from 'pino';

const logger = pino({ name: 'BacktestCommand' });
import { database } from '../../persistence/database';
import { BacktestEngine } from '../../strategy/backtesting/BacktestEngine';
import { 
  BacktestConfig, 
  StrategyConfig, 
  StrategyType, 
  GridStrategyParams 
} from '../../strategy/types';

const backtestCommand = new Command('backtest');
backtestCommand.description('Backtesting and simulation commands');

// Create a new backtest
backtestCommand
  .command('create')
  .description('Create a new backtest')
  .requiredOption('-n, --name <name>', 'Backtest name')
  .requiredOption('-s, --strategy <json>', 'Strategy configuration as JSON string')
  .requiredOption('--start-date <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--end-date <date>', 'End date (YYYY-MM-DD)')
  .option('--initial-balance <balance>', 'Initial balance as JSON (e.g., \'{"USDT": "10000", "BTC": "0"}\'))', '{"USDT": "10000"}')
  .option('--data-source <source>', 'Data source (historical|generated)', 'historical')
  .option('--slippage-model <model>', 'Slippage model (none|linear|impact)', 'linear')
  .option('--commission-rate <rate>', 'Commission rate (0-1)', '0.001')
  .option('--price-impact <impact>', 'Price impact factor (0-1)', '0.001')
  .option('--run-immediately', 'Start backtest immediately after creation')
  .action(async (options) => {
    try {
      let strategyConfig: StrategyConfig;
      
      try {
        strategyConfig = JSON.parse(options.strategy);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('❌ Invalid JSON in strategy option:', errorMsg);
        process.exit(1);
      }

      let initialBalance: Record<string, string>;
      try {
        initialBalance = JSON.parse(options.initialBalance);
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('❌ Invalid JSON in initial-balance option:', errorMsg);
        process.exit(1);
      }

      const backtestId = `backtest_${Date.now()}`;
      const config: BacktestConfig = {
        id: backtestId,
        name: options.name,
        strategy_config: strategyConfig,
        start_date: new Date(options.startDate),
        end_date: new Date(options.endDate),
        initial_balance: initialBalance,
        data_source: options.dataSource,
        slippage_model: options.slippageModel,
        commission_rate: parseFloat(options.commissionRate),
        price_impact: parseFloat(options.priceImpact)
      };

      // Validate dates
      if (config.start_date >= config.end_date) {
        console.error('❌ Start date must be before end date');
        process.exit(1);
      }

      const engine = new BacktestEngine(config);
      
      if (options.runImmediately) {
        console.log(`🚀 Creating and running backtest: ${backtestId}`);
        const result = await engine.run();
        
        console.log(`✅ Backtest completed successfully`);
        console.log(`📊 Results:`);
        console.log(`   Total Return: ${(result.total_return * 100).toFixed(2)}%`);
        console.log(`   Annualized Return: ${(result.annualized_return * 100).toFixed(2)}%`);
        console.log(`   Max Drawdown: ${(result.max_drawdown * 100).toFixed(2)}%`);
        console.log(`   Sharpe Ratio: ${result.sharpe_ratio?.toFixed(4) || 'N/A'}`);
        console.log(`   Win Rate: ${(result.win_rate * 100).toFixed(2)}%`);
        console.log(`   Total Trades: ${result.total_trades}`);
      } else {
        await engine.initialize();
        console.log(`✅ Backtest created: ${backtestId}`);
        console.log(`💡 Use 'backtest run ${backtestId}' to start the backtest`);
      }

      logger.info({ backtestId, name: options.name }, 'Backtest created');
      
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMsg }, 'Failed to create backtest');
      console.error('❌ Failed to create backtest:', errorMsg);
      process.exit(1);
    }
  });

// Create a quick grid strategy backtest
backtestCommand
  .command('quick-grid')
  .description('Create a quick grid strategy backtest with default parameters')
  .requiredOption('-s, --symbol <symbol>', 'Trading symbol (e.g., BTC/USDT)')
  .option('-n, --name <name>', 'Backtest name (auto-generated if not provided)')
  .option('--days <days>', 'Number of days to backtest', '30')
  .option('--grid-count <count>', 'Number of grid levels', '10')
  .option('--grid-spacing <spacing>', 'Grid spacing percentage', '2.0')
  .option('--base-size <size>', 'Base order size', '100')
  .action(async (options) => {
    try {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (parseInt(options.days) * 24 * 60 * 60 * 1000));
      
      const backtestName = options.name || `Grid_${options.symbol.replace('/', '')}_${options.days}d_${Date.now()}`;
      
      const gridParams: GridStrategyParams = {
        grid_count: parseInt(options.gridCount),
        grid_spacing: options.gridSpacing.toString(),
        base_order_size: options.baseSize.toString(),
        upper_price: '110000',
        lower_price: '90000',
        rebalance_threshold: 10,
        inventory_target: 0.5
      };

      const strategyConfig: StrategyConfig = {
        id: `grid_${Date.now()}`,
        name: `Grid Strategy for ${options.symbol}`,
        type: 'grid',
        description: `Quick grid strategy backtest for ${options.symbol}`,
        symbol: options.symbol,
        status: 'inactive',
        execution_mode: 'backtest',
        risk_limits: {
          max_position_size: '10000',
          max_daily_volume: '50000',
          max_slippage_percent: 5,
          max_concurrent_orders: 10,
          max_drawdown_percent: 20
        },
        parameters: gridParams,
        created_at: new Date(),
        updated_at: new Date()
      };

      const backtestId = `backtest_${Date.now()}`;
      const config: BacktestConfig = {
        id: backtestId,
        name: backtestName,
        strategy_config: strategyConfig,
        start_date: startDate,
        end_date: endDate,
        initial_balance: { USDT: '10000', [options.symbol.split('/')[0]]: '0' },
        data_source: 'generated', // Use synthetic data for quick testing
        slippage_model: 'linear',
        commission_rate: 0.001,
        price_impact: 0.001
      };

      console.log(`🚀 Running quick grid backtest: ${backtestName}`);
      console.log(`📅 Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
      console.log(`🔷 Grid: ${options.gridCount} levels with ${options.gridSpacing}% spacing`);

      const engine = new BacktestEngine(config);
      const result = await engine.run();
      
      console.log(`\n✅ Quick backtest completed!`);
      console.log(`📊 Performance Summary:`);
      console.log(`   Total Return: ${(result.total_return * 100).toFixed(2)}%`);
      console.log(`   Annualized Return: ${(result.annualized_return * 100).toFixed(2)}%`);
      console.log(`   Max Drawdown: ${(result.max_drawdown * 100).toFixed(2)}%`);
      console.log(`   Sharpe Ratio: ${result.sharpe_ratio?.toFixed(4) || 'N/A'}`);
      console.log(`   Sortino Ratio: ${result.sortino_ratio?.toFixed(4) || 'N/A'}`);
      console.log(`   Win Rate: ${(result.win_rate * 100).toFixed(2)}%`);
      console.log(`   Total Trades: ${result.total_trades}`);
      console.log(`   Avg Trade Return: ${(result.avg_trade_return * 100).toFixed(2)}%`);
      console.log(`   Profit Factor: ${result.profit_factor?.toFixed(2) || 'N/A'}`);

      logger.info({ backtestId, result }, 'Quick grid backtest completed');
      
    } catch (error) {
      logger.error({ error }, 'Failed to run quick grid backtest');
      console.error('❌ Failed to run quick grid backtest:', (error as Error).message);
      process.exit(1);
    }
  });

// Run an existing backtest
backtestCommand
  .command('run <backtestId>')
  .description('Run an existing backtest')
  .action(async (backtestId) => {
    try {
      // Load backtest from database
      if (!database.connection) {
        console.error('❌ Database connection not available');
        process.exit(1);
      }
      const row = await database.connection('backtests').where('id', backtestId).first();
      
      if (!row) {
        console.error(`❌ Backtest ${backtestId} not found`);
        process.exit(1);
      }

      const config: BacktestConfig = {
        id: row.id,
        name: row.name,
        strategy_config: JSON.parse(row.strategy_config),
        start_date: new Date(row.start_date),
        end_date: new Date(row.end_date),
        initial_balance: JSON.parse(row.initial_balance),
        data_source: row.data_source,
        slippage_model: row.slippage_model,
        commission_rate: row.commission_rate,
        price_impact: row.price_impact
      };

      console.log(`🚀 Running backtest: ${config.name}`);
      
      const engine = new BacktestEngine(config);
      const result = await engine.run();
      
      console.log(`✅ Backtest completed successfully`);
      console.log(`📊 Results:`);
      console.log(`   Total Return: ${(result.total_return * 100).toFixed(2)}%`);
      console.log(`   Annualized Return: ${(result.annualized_return * 100).toFixed(2)}%`);
      console.log(`   Max Drawdown: ${(result.max_drawdown * 100).toFixed(2)}%`);
      console.log(`   Sharpe Ratio: ${result.sharpe_ratio?.toFixed(4) || 'N/A'}`);
      console.log(`   Win Rate: ${(result.win_rate * 100).toFixed(2)}%`);
      console.log(`   Total Trades: ${result.total_trades}`);
      
      logger.info({ backtestId, result }, 'Backtest completed');
      
    } catch (error) {
      logger.error({ error, backtestId }, 'Failed to run backtest');
      console.error('❌ Failed to run backtest:', (error as Error).message);
      process.exit(1);
    }
  });

// List backtests
backtestCommand
  .command('list')
  .description('List all backtests')
  .option('-s, --status <status>', 'Filter by status')
  .option('--limit <limit>', 'Limit number of results', '20')
  .action(async (options) => {
    try {
      if (!database.connection) {
        console.error('❌ Database connection not available');
        process.exit(1);
      }
      let query = database.connection('backtests')
        .orderBy('created_at', 'desc')
        .limit(parseInt(options.limit));

      if (options.status) {
        query = query.where('status', options.status);
      }

      const backtests = await query;
      
      if (backtests.length === 0) {
        console.log('No backtests found');
        return;
      }

      console.log('\n🧪 Backtests:');
      console.log('─'.repeat(100));
      console.log('ID'.padEnd(20) + 'Name'.padEnd(25) + 'Status'.padEnd(12) + 'Return'.padEnd(10) + 'Drawdown'.padEnd(10) + 'Created');
      console.log('─'.repeat(100));

      for (const bt of backtests) {
        const statusIconMap = {
          running: '🔄',
          completed: '✅',
          failed: '❌',
          cancelled: '⏹️'
        } as const;
        const statusIcon = statusIconMap[bt.status as keyof typeof statusIconMap] || '❓';

        const returnStr = bt.total_return ? `${(bt.total_return * 100).toFixed(1)}%` : 'N/A';
        const drawdownStr = bt.max_drawdown ? `${(bt.max_drawdown * 100).toFixed(1)}%` : 'N/A';
        const createdStr = new Date(bt.created_at).toISOString().split('T')[0];

        console.log(
          bt.id.substring(0, 18).padEnd(20) + 
          bt.name.substring(0, 23).padEnd(25) + 
          `${statusIcon} ${bt.status}`.padEnd(12) + 
          returnStr.padEnd(10) + 
          drawdownStr.padEnd(10) + 
          createdStr
        );
      }
      console.log('─'.repeat(100));
      
    } catch (error) {
      logger.error({ error }, 'Failed to list backtests');
      console.error('❌ Failed to list backtests:', (error as Error).message);
      process.exit(1);
    }
  });

// Show backtest details
backtestCommand
  .command('show <backtestId>')
  .description('Show detailed backtest results')
  .option('--json', 'Output as JSON')
  .action(async (backtestId, options) => {
    try {
      if (!database.connection) {
        console.error('❌ Database connection not available');
        process.exit(1);
      }
      const row = await database.connection('backtests').where('id', backtestId).first();
      
      if (!row) {
        console.error(`❌ Backtest ${backtestId} not found`);
        process.exit(1);
      }

      if (options.json) {
        console.log(JSON.stringify(row, null, 2));
        return;
      }

      const strategyConfig = JSON.parse(row.strategy_config);
      const initialBalance = JSON.parse(row.initial_balance);

      console.log(`\n🧪 Backtest Details: ${row.name}`);
      console.log('─'.repeat(60));
      console.log(`ID: ${row.id}`);
      console.log(`Status: ${row.status}`);
      console.log(`Strategy: ${strategyConfig.type} (${strategyConfig.symbol})`);
      console.log(`Period: ${new Date(row.start_date).toISOString().split('T')[0]} to ${new Date(row.end_date).toISOString().split('T')[0]}`);
      console.log(`Initial Balance: ${JSON.stringify(initialBalance)}`);
      console.log(`Data Source: ${row.data_source}`);
      console.log(`Slippage Model: ${row.slippage_model}`);
      console.log(`Commission Rate: ${(row.commission_rate * 100).toFixed(3)}%`);

      if (row.status === 'completed') {
        console.log('\n📊 Performance Results:');
        console.log('─'.repeat(40));
        console.log(`Total Return: ${(row.total_return * 100).toFixed(2)}%`);
        console.log(`Annualized Return: ${(row.annualized_return * 100).toFixed(2)}%`);
        console.log(`Max Drawdown: ${(row.max_drawdown * 100).toFixed(2)}%`);
        console.log(`Sharpe Ratio: ${row.sharpe_ratio?.toFixed(4) || 'N/A'}`);
        console.log(`Sortino Ratio: ${row.sortino_ratio?.toFixed(4) || 'N/A'}`);
        console.log(`Win Rate: ${(row.win_rate * 100).toFixed(2)}%`);
        console.log(`Total Trades: ${row.total_trades}`);
        console.log(`Avg Trade Return: ${(row.avg_trade_return * 100).toFixed(3)}%`);
        console.log(`Profit Factor: ${row.profit_factor?.toFixed(2) || 'N/A'}`);
        console.log(`Calmar Ratio: ${row.calmar_ratio?.toFixed(4) || 'N/A'}`);

        if (row.daily_returns) {
          const dailyReturns = JSON.parse(row.daily_returns);
          console.log(`\n📈 Daily Statistics:`);
          console.log(`   Best Day: ${Math.max(...dailyReturns).toFixed(3)}%`);
          console.log(`   Worst Day: ${Math.min(...dailyReturns).toFixed(3)}%`);
          console.log(`   Avg Daily: ${(dailyReturns.reduce((a: number, b: number) => a + b, 0) / dailyReturns.length).toFixed(3)}%`);
        }
      }

      console.log('\n⏰ Timing:');
      console.log(`Created: ${new Date(row.created_at).toISOString()}`);
      if (row.completed_at) {
        console.log(`Completed: ${new Date(row.completed_at).toISOString()}`);
        const duration = new Date(row.completed_at).getTime() - new Date(row.created_at).getTime();
        console.log(`Duration: ${Math.round(duration / 1000)}s`);
      }
      
    } catch (error) {
      logger.error({ error, backtestId }, 'Failed to show backtest details');
      console.error('❌ Failed to show backtest details:', (error as Error).message);
      process.exit(1);
    }
  });

// Delete backtest
backtestCommand
  .command('delete <backtestId>')
  .description('Delete a backtest')
  .option('-f, --force', 'Force delete without confirmation')
  .action(async (backtestId, options) => {
    try {
      if (!options.force) {
        console.log('Use --force to confirm deletion');
        return;
      }

      if (!database.connection) {
        console.error('❌ Database connection not available');
        process.exit(1);
      }
      const result = await database.connection('backtests').where('id', backtestId).delete();
      
      if (result === 0) {
        console.error(`❌ Backtest ${backtestId} not found`);
        process.exit(1);
      }

      console.log(`✅ Backtest ${backtestId} deleted`);
      logger.info({ backtestId }, 'Backtest deleted');
      
    } catch (error) {
      logger.error({ error, backtestId }, 'Failed to delete backtest');
      console.error('❌ Failed to delete backtest:', (error as Error).message);
      process.exit(1);
    }
  });

export { backtestCommand };