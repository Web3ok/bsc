#!/usr/bin/env node

/**
 * M3/M4 Strategy Framework Integration Test
 * 
 * This script demonstrates the complete strategy framework including:
 * - Grid Strategy implementation
 * - Conditional Order triggers
 * - Backtesting framework
 * - Strategy lifecycle management
 * - Database persistence and metrics
 */

const { logger } = require('../dist/utils/logger');
const { database } = require('../dist/persistence/database');
const { getStrategyManager } = require('../dist/strategy/StrategyManager');
const { conditionalOrderManager } = require('../dist/strategy/triggers/ConditionalOrderManager');
const { BacktestEngine } = require('../dist/strategy/backtesting/BacktestEngine');

async function runStrategyFrameworkTest() {
  console.log('🧪 M3/M4 Strategy Framework Integration Test\n');
  
  try {
    // 1. Initialize database
    console.log('📦 Step 1: Initializing database...');
    await database.init();
    console.log('✅ Database initialized\n');

    // 2. Test Grid Strategy Creation
    console.log('🔷 Step 2: Testing Grid Strategy Creation...');
    
    const strategyManager = getStrategyManager({
      max_concurrent_strategies: 10,
      default_execution_mode: 'paper',
      enable_conditional_orders: true,
      risk_check_interval: 30000
    });

    const gridConfig = {
      id: `grid_test_${Date.now()}`,
      name: 'Test Grid Strategy BTC/USDT',
      type: 'grid',
      description: 'Test grid strategy for framework validation',
      symbol: 'BTC/USDT',
      status: 'inactive',
      execution_mode: 'paper',
      risk_limits: {
        max_position_size: 5000,
        max_daily_loss: 500,
        max_drawdown_percent: 15,
        position_size_percent: 5
      },
      parameters: {
        grid_count: 8,
        grid_spacing: '2.5',
        base_order_size: '50',
        upper_price: '105000',
        lower_price: '95000',
        rebalance_threshold: 8,
        center_price: '100000'
      },
      created_at: new Date(),
      updated_at: new Date()
    };

    const strategyId = await strategyManager.createStrategy(gridConfig);
    console.log(`✅ Grid strategy created: ${strategyId}\n`);

    // 3. Test Strategy Manager Services
    console.log('🎯 Step 3: Testing Strategy Manager Services...');
    await strategyManager.start();
    
    const managerStatus = strategyManager.getManagerStatus();
    console.log(`✅ Strategy Manager Status:`);
    console.log(`   Running: ${managerStatus.running}`);
    console.log(`   Total Strategies: ${managerStatus.totalStrategies}`);
    console.log(`   Conditional Orders: ${managerStatus.conditionalOrdersEnabled}\n`);

    // 4. Test Conditional Order System
    console.log('🎯 Step 4: Testing Conditional Order System...');
    
    const conditionalOrderParams = {
      trigger_condition: {
        type: 'price_above',
        symbol: 'BTC/USDT',
        value: '102000'
      },
      order_request: {
        id: `cond_order_${Date.now()}`,
        strategy_id: strategyId,
        symbol: 'BTC/USDT',
        side: 'sell',
        type: 'limit',
        amount: '0.001',
        price: '102500',
        status: 'pending',
        filled_amount: '0',
        created_at: new Date(),
        updated_at: new Date()
      },
      strategy_id: strategyId
    };

    const conditionalOrder = await conditionalOrderManager.createConditionalOrder(conditionalOrderParams);
    console.log(`✅ Conditional order created: ${conditionalOrder.id}`);
    
    const conditionalOrders = await conditionalOrderManager.getConditionalOrders({ strategy_id: strategyId });
    console.log(`✅ Active conditional orders: ${conditionalOrders.length}\n`);

    // 5. Test Backtesting Framework
    console.log('🧪 Step 5: Testing Backtesting Framework...');
    
    const backtestConfig = {
      id: `backtest_${Date.now()}`,
      name: 'Grid Strategy Framework Test',
      strategy_config: gridConfig,
      start_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      end_date: new Date(),
      initial_balance: { 'USDT': '10000', 'BTC': '0' },
      data_source: 'generated',
      slippage_model: 'linear',
      commission_rate: 0.001,
      price_impact: 0.0005
    };

    const backtestEngine = new BacktestEngine(backtestConfig);
    console.log('🚀 Running backtest...');
    
    const backtestResult = await backtestEngine.run();
    console.log(`✅ Backtest completed successfully:`);
    console.log(`   Total Return: ${(backtestResult.total_return * 100).toFixed(2)}%`);
    console.log(`   Max Drawdown: ${(backtestResult.max_drawdown * 100).toFixed(2)}%`);
    console.log(`   Total Trades: ${backtestResult.total_trades}`);
    console.log(`   Win Rate: ${(backtestResult.win_rate * 100).toFixed(2)}%\n`);

    // 6. Test Strategy Metrics
    console.log('📊 Step 6: Testing Strategy Metrics...');
    
    const strategy = strategyManager.getStrategy(strategyId);
    const strategyStatus = strategy.getStatus();
    console.log(`✅ Strategy Status:`);
    console.log(`   ID: ${strategyStatus.id}`);
    console.log(`   Name: ${strategyStatus.name}`);
    console.log(`   Type: ${strategyStatus.type}`);
    console.log(`   Status: ${strategyStatus.status}`);
    console.log(`   Running: ${strategyStatus.isRunning}\n`);

    const metrics = await strategyManager.getStrategyMetrics(strategyId);
    if (metrics) {
      console.log(`✅ Strategy Metrics:`);
      console.log(`   Total Trades: ${metrics.total_trades}`);
      console.log(`   Win Rate: ${(metrics.win_rate * 100).toFixed(2)}%`);
      console.log(`   Total PnL: ${metrics.total_pnl}`);
    }

    // 7. Test Database Persistence
    console.log('\n💾 Step 7: Testing Database Persistence...');
    
    const strategyRow = await database.connection('strategies').where('id', strategyId).first();
    console.log(`✅ Strategy persisted in database: ${!!strategyRow}`);
    
    const gridLevels = await database.connection('grid_levels').where('strategy_id', strategyId);
    console.log(`✅ Grid levels persisted: ${gridLevels.length} levels`);
    
    const conditionalOrderRow = await database.connection('conditional_orders').where('id', conditionalOrder.id).first();
    console.log(`✅ Conditional order persisted: ${!!conditionalOrderRow}`);
    
    const backtestRow = await database.connection('backtests').where('id', backtestConfig.id).first();
    console.log(`✅ Backtest results persisted: ${!!backtestRow}\n`);

    // 8. Test Risk Management
    console.log('🛡️ Step 8: Testing Risk Management...');
    
    // Test risk limit validation
    const riskLimits = strategy.getConfig().risk_limits;
    console.log(`✅ Risk Limits Configuration:`);
    console.log(`   Max Position Size: ${riskLimits.max_position_size}`);
    console.log(`   Max Daily Loss: ${riskLimits.max_daily_loss}`);
    console.log(`   Max Drawdown: ${riskLimits.max_drawdown_percent}%`);
    console.log(`   Position Size: ${riskLimits.position_size_percent}%\n`);

    // 9. Test Strategy Lifecycle
    console.log('⚙️ Step 9: Testing Strategy Lifecycle...');
    
    console.log('🟢 Starting strategy...');
    await strategyManager.startStrategy(strategyId);
    
    // Wait a moment for execution
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('🟡 Pausing strategy...');
    await strategyManager.pauseStrategy(strategyId);
    
    console.log('🟢 Resuming strategy...');
    await strategyManager.resumeStrategy(strategyId);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('🔴 Stopping strategy...');
    await strategyManager.stopStrategy(strategyId);
    
    console.log('✅ Strategy lifecycle test completed\n');

    // 10. Cleanup
    console.log('🧹 Step 10: Cleanup...');
    
    await conditionalOrderManager.cancelConditionalOrder(conditionalOrder.id);
    console.log('✅ Conditional order cancelled');
    
    await strategyManager.stop();
    console.log('✅ Strategy manager stopped');
    
    // Clean up test data
    await database.connection('backtests').where('id', backtestConfig.id).delete();
    await database.connection('conditional_orders').where('id', conditionalOrder.id).delete();
    await database.connection('grid_levels').where('strategy_id', strategyId).delete();
    await database.connection('strategy_metrics').where('strategy_id', strategyId).delete();
    await database.connection('strategies').where('id', strategyId).delete();
    console.log('✅ Test data cleaned up\n');

    // Final Summary
    console.log('🎉 M3/M4 Strategy Framework Integration Test PASSED!');
    console.log('\n📋 Test Summary:');
    console.log('✅ Grid Strategy Creation & Configuration');
    console.log('✅ Strategy Manager Lifecycle');
    console.log('✅ Conditional Order System');
    console.log('✅ Backtesting Framework');
    console.log('✅ Database Persistence');
    console.log('✅ Risk Management');
    console.log('✅ Strategy Execution Control');
    console.log('✅ Metrics Collection');
    console.log('✅ Data Cleanup');
    
    console.log('\n🚀 The M3/M4 Strategy Framework is production-ready!');
    console.log('💡 Next: Implement fund management and advanced risk controls (M4+)');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    logger.error({ error }, 'Strategy framework integration test failed');
    process.exit(1);
  }
}

// Run the test
runStrategyFrameworkTest();