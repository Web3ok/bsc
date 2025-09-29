import { Command } from 'commander';
import { logger } from '../../utils/logger';
import { getStrategyManager } from '../../strategy/StrategyManager';
import { conditionalOrderManager } from '../../strategy/triggers/ConditionalOrderManager';
import { 
  StrategyConfig, 
  StrategyType, 
  ExecutionMode, 
  GridStrategyParams,
  ConditionalOrderParams,
  OrderType
} from '../../strategy/types';

const strategyCommand = new Command('strategy');

// Strategy management commands
strategyCommand
  .command('create')
  .description('Create a new trading strategy')
  .requiredOption('-t, --type <type>', 'Strategy type (grid)')
  .requiredOption('-s, --symbol <symbol>', 'Trading symbol (e.g., BTC/USDT)')
  .requiredOption('-n, --name <name>', 'Strategy name')
  .option('-d, --description <description>', 'Strategy description')
  .option('-m, --mode <mode>', 'Execution mode (live|paper|backtest)', 'paper')
  .option('-p, --parameters <json>', 'Strategy parameters as JSON string')
  .action(async (options) => {
    try {
      const strategyManager = getStrategyManager();
      
      const strategyId = `${options.type}_${options.symbol.replace('/', '')}_${Date.now()}`;
      
      let parameters: any = {};
      if (options.parameters) {
        try {
          parameters = JSON.parse(options.parameters);
        } catch (error) {
          logger.error('Invalid JSON in parameters option');
          process.exit(1);
        }
      } else if (options.type === 'grid') {
        // Provide default grid strategy parameters
        parameters = {
          grid_count: 10,
          grid_spacing: '2.0', // 2% spacing
          base_order_size: '100',
          upper_price: '110000',
          lower_price: '90000',
          rebalance_threshold: 10
        } as GridStrategyParams;
      }

      const config: StrategyConfig = {
        id: strategyId,
        name: options.name,
        type: options.type as StrategyType,
        description: options.description || `${options.type} strategy for ${options.symbol}`,
        symbol: options.symbol,
        status: 'inactive',
        execution_mode: options.mode as ExecutionMode,
        risk_limits: {
          max_position_size: '10000',
          max_daily_volume: '50000',
          max_slippage_percent: 5,
          max_concurrent_orders: 10,
          max_drawdown_percent: 20
        },
        parameters,
        created_at: new Date(),
        updated_at: new Date()
      };

      await strategyManager.createStrategy(config);
      
      logger.info({ strategyId, type: options.type, symbol: options.symbol }, 'Strategy created successfully');
      console.log(`✅ Strategy created: ${strategyId}`);
      
    } catch (error) {
      logger.error({ error }, 'Failed to create strategy');
      console.error('❌ Failed to create strategy:', (error as Error).message);
      process.exit(1);
    }
  });

strategyCommand
  .command('start <strategyId>')
  .description('Start a strategy')
  .action(async (strategyId) => {
    try {
      const strategyManager = getStrategyManager();
      await strategyManager.startStrategy(strategyId);
      
      logger.info({ strategyId }, 'Strategy started');
      console.log(`✅ Strategy ${strategyId} started`);
      
    } catch (error) {
      logger.error({ error, strategyId }, 'Failed to start strategy');
      console.error('❌ Failed to start strategy:', (error as Error).message);
      process.exit(1);
    }
  });

strategyCommand
  .command('stop <strategyId>')
  .description('Stop a strategy')
  .action(async (strategyId) => {
    try {
      const strategyManager = getStrategyManager();
      await strategyManager.stopStrategy(strategyId);
      
      logger.info({ strategyId }, 'Strategy stopped');
      console.log(`✅ Strategy ${strategyId} stopped`);
      
    } catch (error) {
      logger.error({ error, strategyId }, 'Failed to stop strategy');
      console.error('❌ Failed to stop strategy:', (error as Error).message);
      process.exit(1);
    }
  });

strategyCommand
  .command('pause <strategyId>')
  .description('Pause a strategy')
  .action(async (strategyId) => {
    try {
      const strategyManager = getStrategyManager();
      await strategyManager.pauseStrategy(strategyId);
      
      logger.info({ strategyId }, 'Strategy paused');
      console.log(`✅ Strategy ${strategyId} paused`);
      
    } catch (error) {
      logger.error({ error, strategyId }, 'Failed to pause strategy');
      console.error('❌ Failed to pause strategy:', (error as Error).message);
      process.exit(1);
    }
  });

strategyCommand
  .command('resume <strategyId>')
  .description('Resume a paused strategy')
  .action(async (strategyId) => {
    try {
      const strategyManager = getStrategyManager();
      await strategyManager.resumeStrategy(strategyId);
      
      logger.info({ strategyId }, 'Strategy resumed');
      console.log(`✅ Strategy ${strategyId} resumed`);
      
    } catch (error) {
      logger.error({ error, strategyId }, 'Failed to resume strategy');
      console.error('❌ Failed to resume strategy:', (error as Error).message);
      process.exit(1);
    }
  });

strategyCommand
  .command('delete <strategyId>')
  .description('Delete a strategy')
  .option('-f, --force', 'Force delete without confirmation')
  .action(async (strategyId, options) => {
    try {
      if (!options.force) {
        // In a real CLI, you'd use a prompt library here
        console.log('Use --force to confirm deletion');
        return;
      }

      const strategyManager = getStrategyManager();
      await strategyManager.deleteStrategy(strategyId);
      
      logger.info({ strategyId }, 'Strategy deleted');
      console.log(`✅ Strategy ${strategyId} deleted`);
      
    } catch (error) {
      logger.error({ error, strategyId }, 'Failed to delete strategy');
      console.error('❌ Failed to delete strategy:', (error as Error).message);
      process.exit(1);
    }
  });

strategyCommand
  .command('list')
  .description('List all strategies')
  .option('-s, --status <status>', 'Filter by status')
  .option('-t, --type <type>', 'Filter by type')
  .action(async (options) => {
    try {
      const strategyManager = getStrategyManager();
      const strategies = strategyManager.getAllStrategies();
      
      if (strategies.size === 0) {
        console.log('No strategies found');
        return;
      }

      console.log('\n📊 Strategies:');
      console.log('─'.repeat(80));
      console.log('ID'.padEnd(25) + 'Name'.padEnd(20) + 'Type'.padEnd(10) + 'Status'.padEnd(10) + 'Symbol');
      console.log('─'.repeat(80));

      for (const [id, strategy] of strategies) {
        const status = strategy.getStatus();
        const config = strategy.getConfig();
        
        // Apply filters
        if (options.status && status.status !== options.status) continue;
        if (options.type && config.type !== options.type) continue;
        
        const statusIcon = {
          active: '🟢',
          paused: '🟡',
          stopped: '🔴',
          error: '❌',
          inactive: '⚪'
        }[status.status] || '❓';

        console.log(
          id.padEnd(25) + 
          config.name.padEnd(20) + 
          config.type.padEnd(10) + 
          `${statusIcon} ${status.status}`.padEnd(10) + 
          config.symbol
        );
      }
      console.log('─'.repeat(80));
      
    } catch (error) {
      logger.error({ error }, 'Failed to list strategies');
      console.error('❌ Failed to list strategies:', (error as Error).message);
      process.exit(1);
    }
  });

strategyCommand
  .command('status <strategyId>')
  .description('Show detailed strategy status')
  .action(async (strategyId) => {
    try {
      const strategyManager = getStrategyManager();
      const strategy = strategyManager.getStrategy(strategyId);
      
      if (!strategy) {
        console.error(`❌ Strategy ${strategyId} not found`);
        process.exit(1);
      }

      const status = strategy.getStatus();
      const config = strategy.getConfig();
      const metrics = await strategyManager.getStrategyMetrics(strategyId);

      console.log(`\n📊 Strategy Status: ${strategyId}`);
      console.log('─'.repeat(50));
      console.log(`Name: ${config.name}`);
      console.log(`Type: ${config.type}`);
      console.log(`Symbol: ${config.symbol}`);
      console.log(`Status: ${status.status}`);
      console.log(`Running: ${status.isRunning ? '✅' : '❌'}`);
      console.log(`Execution Mode: ${config.execution_mode}`);
      console.log(`Last Execution: ${status.lastExecution ? status.lastExecution.toISOString() : 'Never'}`);

      if (metrics) {
        console.log('\n📈 Performance Metrics:');
        console.log('─'.repeat(30));
        console.log(`Total Trades: ${metrics.total_trades}`);
        console.log(`Win Rate: ${(metrics.win_rate * 100).toFixed(2)}%`);
        console.log(`Total PnL: ${metrics.total_pnl}`);
        console.log(`Max Drawdown: ${(parseFloat(metrics.max_drawdown) * 100).toFixed(2)}%`);
        console.log(`Volume Traded: ${metrics.volume_traded}`);
      }

      // Show grid-specific status for grid strategies
      if (config.type === 'grid' && 'getGridStatus' in strategy) {
        const gridStatus = await (strategy as any).getGridStatus();
        console.log('\n🔷 Grid Status:');
        console.log('─'.repeat(25));
        console.log(`Total Levels: ${gridStatus.levels.length}`);
        console.log(`Filled Levels: ${gridStatus.filledLevels}`);
        console.log(`Active Levels: ${gridStatus.activeLevels}`);
        console.log(`Pending Orders: ${gridStatus.pendingOrders}`);
      }
      
    } catch (error) {
      logger.error({ error, strategyId }, 'Failed to get strategy status');
      console.error('❌ Failed to get strategy status:', (error as Error).message);
      process.exit(1);
    }
  });

// Conditional order commands
strategyCommand
  .command('conditional')
  .description('Manage conditional orders')
  .addCommand(
    new Command('create')
      .description('Create a conditional order')
      .requiredOption('-s, --symbol <symbol>', 'Trading symbol')
      .requiredOption('-t, --trigger <type>', 'Trigger type (price_above|price_below|rsi_above|rsi_below|volume_above|time_based)')
      .requiredOption('-v, --value <value>', 'Trigger value')
      .requiredOption('--side <side>', 'Order side (buy|sell)')
      .requiredOption('--amount <amount>', 'Order amount')
      .requiredOption('--price <price>', 'Order price')
      .option('--timeframe <timeframe>', 'Timeframe for indicator-based triggers (1m|5m|15m|1h|4h|1d)')
      .option('--expire <expire>', 'Expiry time (ISO string)')
      .option('--strategy-id <strategyId>', 'Associated strategy ID')
      .action(async (options) => {
        try {
          const triggerCondition = {
            type: options.trigger,
            symbol: options.symbol,
            value: ['rsi_above', 'rsi_below'].includes(options.trigger) 
              ? parseFloat(options.value) 
              : options.value,
            timeframe: options.timeframe
          };

          const orderRequest = {
            id: `cond_order_${Date.now()}`,
            strategy_id: options.strategyId,
            symbol: options.symbol,
            side: options.side,
            type: 'limit' as OrderType,
            amount: options.amount,
            price: options.price,
            status: 'pending',
            filled_amount: '0',
            created_at: new Date(),
            updated_at: new Date()
          };

          const params: ConditionalOrderParams = {
            trigger_condition: triggerCondition,
            order_request: orderRequest
          };

          const conditionalOrder = await conditionalOrderManager.createConditionalOrder(params);
          
          logger.info({ 
            conditionalOrderId: conditionalOrder.id,
            trigger: options.trigger,
            symbol: options.symbol 
          }, 'Conditional order created');
          
          console.log(`✅ Conditional order created: ${conditionalOrder.id}`);
          
        } catch (error) {
          logger.error({ error }, 'Failed to create conditional order');
          console.error('❌ Failed to create conditional order:', (error as Error).message);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('list')
      .description('List conditional orders')
      .option('-s, --status <status>', 'Filter by status')
      .option('--symbol <symbol>', 'Filter by symbol')
      .option('--strategy-id <strategyId>', 'Filter by strategy ID')
      .action(async (options) => {
        try {
          const filters = {
            status: options.status,
            symbol: options.symbol,
            strategy_id: options.strategyId
          };

          const orders = await conditionalOrderManager.getConditionalOrders(filters);
          
          if (orders.length === 0) {
            console.log('No conditional orders found');
            return;
          }

          console.log('\n🎯 Conditional Orders:');
          console.log('─'.repeat(80));
          console.log('ID'.padEnd(20) + 'Symbol'.padEnd(12) + 'Trigger'.padEnd(15) + 'Status'.padEnd(10) + 'Created');
          console.log('─'.repeat(80));

          for (const order of orders) {
            const statusIcon = {
              active: '🟢',
              triggered: '✅',
              expired: '⏰',
              cancelled: '❌'
            }[order.status] || '❓';

            console.log(
              order.id.substring(0, 18).padEnd(20) + 
              order.trigger_condition.symbol.padEnd(12) + 
              order.trigger_condition.type.padEnd(15) + 
              `${statusIcon} ${order.status}`.padEnd(10) + 
              order.created_at.toISOString().substring(0, 10)
            );
          }
          console.log('─'.repeat(80));
          
        } catch (error) {
          logger.error({ error }, 'Failed to list conditional orders');
          console.error('❌ Failed to list conditional orders:', (error as Error).message);
          process.exit(1);
        }
      })
  )
  .addCommand(
    new Command('cancel <orderId>')
      .description('Cancel a conditional order')
      .action(async (orderId) => {
        try {
          const success = await conditionalOrderManager.cancelConditionalOrder(orderId);
          
          if (success) {
            logger.info({ orderId }, 'Conditional order cancelled');
            console.log(`✅ Conditional order ${orderId} cancelled`);
          } else {
            console.error(`❌ Conditional order ${orderId} not found`);
            process.exit(1);
          }
          
        } catch (error) {
          logger.error({ error, orderId }, 'Failed to cancel conditional order');
          console.error('❌ Failed to cancel conditional order:', (error as Error).message);
          process.exit(1);
        }
      })
  );

export { strategyCommand };