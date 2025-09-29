import { Command } from 'commander';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import { monitoringServer } from '../../monitor/server';
import { metricsCollector } from '../../monitor/metrics';
import { marketDataManager } from '../../market/manager';
import { healthMonitor } from '../../monitor/health';
import { getStrategyManager } from '../../strategy/StrategyManager';
import { getFundsManager } from '../../funds/FundsManager';
import { RiskManager } from '../../risk/RiskManager';
import { PositionManager } from '../../risk/PositionManager';
import { ethers } from 'ethers';

export function createBotCommands(): Command {
  const bot = new Command('bot');
  bot.description('Bot lifecycle management commands');

  // Start all bot services
  bot
    .command('start')
    .description('Start all bot services (monitoring + market data + strategies)')
    .option('--monitoring-only', 'Start only monitoring services')
    .option('--market-only', 'Start only market data services')
    .option('--no-strategies', 'Skip starting strategy services')
    .option('--no-funds', 'Skip starting funds management services')
    .option('--no-websocket', 'Disable WebSocket connections')
    .action(async (options) => {
      try {
        logger.info('🚀 Starting BSC Market Maker Bot...');

        // Initialize database
        console.log('📦 Initializing database...');
        await database.init();
        logger.info('Database initialized');

        if (!options.marketOnly) {
          // Start monitoring services
          console.log('📊 Starting monitoring services...');
          await metricsCollector.start();
          await monitoringServer.start();
          logger.info('Monitoring services started');
        }

        if (!options.monitoringOnly) {
          // Start market data services
          console.log('📈 Starting market data services...');
          await marketDataManager.start({ noWebsocket: options.noWebsocket });
          logger.info('Market data services started');
        }

        if (!options.noStrategies && !options.monitoringOnly && !options.marketOnly) {
          // Start strategy services
          console.log('🎯 Starting strategy services...');
          const strategyManager = getStrategyManager({
            max_concurrent_strategies: 10,
            default_execution_mode: 'paper',
            enable_conditional_orders: true,
            risk_check_interval: 30000 // 30 seconds
          });
          await strategyManager.start();
          logger.info('Strategy services started');
        }

        if (!options.noFunds && !options.monitoringOnly && !options.marketOnly) {
          try {
            // Start funds management services
            console.log('💰 Starting funds management services...');
            // Note: In production, these would come from environment variables or config file
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://bsc-dataseed1.binance.org/');
            const privateKey = process.env.TREASURY_PRIVATE_KEY;
            
            if (!privateKey) {
              console.log('⚠️  Treasury private key not found, skipping funds management');
              logger.warn('Treasury private key not configured, funds management disabled');
            } else {
              const signer = new ethers.Wallet(privateKey, provider);
              const treasuryAddress = await signer.getAddress();
              
              const fundsManager = getFundsManager({
                provider,
                signer,
                min_gas_bnb: 0.05,
                max_gas_bnb: 0.2,
                sweep_min: 0.01,
                rebalance_target: { BNB: 30, USDT: 50, WBNB: 20 },
                rebalance_band: 5,
                treasury_address: treasuryAddress,
                managed_wallet_groups: ['hot', 'strategy'],
                supported_assets: ['BNB', 'USDT', 'USDC', 'WBNB'],
                sweep_schedule_cron: '0 */6 * * *', // Every 6 hours
                rebalance_schedule_cron: '0 0 * * *', // Daily
                balance_check_interval: 60000, // 1 minute
                balance_snapshot_interval_ms: 60000,
                gas_drip: {
                  enabled: true,
                  check_interval_ms: 300000, // 5 minutes
                  max_concurrent_jobs: 5,
                  min_gas_bnb: '0.05',
                  max_gas_bnb: '0.2',
                  gas_buffer_bnb: '0.01',
                  treasury_address: treasuryAddress,
                  gas_price_multiplier: 1.1,
                  dry_run: process.env.NODE_ENV !== 'production'
                },
                sweeper: {
                  enabled: true,
                  check_interval_ms: 1800000, // 30 minutes
                  max_concurrent_jobs: 3,
                  sweep_min_threshold: '0.01',
                  leaving_amount: '0.005',
                  treasury_address: treasuryAddress,
                  gas_price_multiplier: 1.1,
                  dry_run: process.env.NODE_ENV !== 'production',
                  supported_assets: ['USDT', 'USDC', 'WBNB'],
                  whitelist_wallets: undefined,
                  blacklist_wallets: [treasuryAddress]
                },
                rebalancer: {
                  enabled: true,
                  check_interval_ms: 3600000, // 1 hour
                  target_allocation: { BNB: 30, USDT: 50, WBNB: 20 },
                  tolerance_band: 5,
                  min_rebalance_value_usd: 1000,
                  max_single_trade_usd: 10000,
                  dry_run: process.env.NODE_ENV !== 'production',
                  supported_assets: ['BNB', 'USDT', 'WBNB'],
                  wallet_groups: ['hot', 'strategy'],
                  slippage_tolerance: 0.5
                }
              });
              
              await fundsManager.start();
              logger.info('Funds management services started');

              // Start risk management services
              console.log('🛡️  Starting risk management services...');
              
              const riskManager = new RiskManager({
                assessment_interval_ms: 60000, // 1 minute risk assessment
                default_risk_limits: {
                  max_position_size_usd: parseFloat(process.env.RISK_MAX_POSITION_SIZE_USD || '50000'),
                  max_portfolio_exposure_pct: parseFloat(process.env.RISK_MAX_PORTFOLIO_EXPOSURE_PCT || '95'),
                  max_daily_loss_usd: parseFloat(process.env.RISK_MAX_DAILY_LOSS_USD || '5000'),
                  max_drawdown_pct: parseFloat(process.env.RISK_MAX_DRAWDOWN_PCT || '20'),
                  max_leverage: parseFloat(process.env.RISK_MAX_LEVERAGE || '2'),
                  stop_loss_pct: parseFloat(process.env.RISK_STOP_LOSS_PCT || '5'),
                  take_profit_pct: parseFloat(process.env.RISK_TAKE_PROFIT_PCT || '15'),
                  position_concentration_limit_pct: parseFloat(process.env.RISK_CONCENTRATION_LIMIT_PCT || '25'),
                  correlation_limit: parseFloat(process.env.RISK_CORRELATION_LIMIT || '0.7')
                },
                auto_action_enabled: process.env.RISK_AUTO_ACTIONS_ENABLED !== 'false',
                emergency_stop_enabled: process.env.RISK_EMERGENCY_STOP_ENABLED !== 'false',
                var_confidence_level: parseFloat(process.env.RISK_VAR_CONFIDENCE_LEVEL || '0.95'),
                lookback_days: parseInt(process.env.RISK_LOOKBACK_DAYS || '30'),
                correlation_threshold: parseFloat(process.env.RISK_CORRELATION_THRESHOLD || '0.8'),
                liquidity_threshold: parseFloat(process.env.RISK_LIQUIDITY_THRESHOLD || '50'),
                max_concurrent_actions: parseInt(process.env.RISK_MAX_CONCURRENT_ACTIONS || '5')
              });

              const positionManager = new PositionManager(
                {
                  method: (process.env.POSITION_SIZING_METHOD as any) || 'percentage',
                  base_size_usd: parseFloat(process.env.POSITION_BASE_SIZE_USD || '1000'),
                  max_size_usd: parseFloat(process.env.POSITION_MAX_SIZE_USD || '10000'),
                  portfolio_percentage: parseFloat(process.env.POSITION_PORTFOLIO_PERCENTAGE || '2.5'),
                  volatility_lookback: parseInt(process.env.POSITION_VOLATILITY_LOOKBACK || '30'),
                  kelly_lookback: parseInt(process.env.POSITION_KELLY_LOOKBACK || '100'),
                  risk_free_rate: parseFloat(process.env.POSITION_RISK_FREE_RATE || '0.02'),
                  max_leverage: parseFloat(process.env.POSITION_MAX_LEVERAGE || '1'),
                  size_multiplier: parseFloat(process.env.POSITION_SIZE_MULTIPLIER || '1')
                },
                {
                  max_pyramid_levels: parseInt(process.env.POSITION_MAX_PYRAMID_LEVELS || '3'),
                  pyramid_scale_factor: parseFloat(process.env.POSITION_PYRAMID_SCALE_FACTOR || '0.8'),
                  entry_spacing_pct: parseFloat(process.env.POSITION_ENTRY_SPACING_PCT || '2'),
                  partial_exit_levels: JSON.parse(process.env.POSITION_PARTIAL_EXIT_LEVELS || '[10, 20, 30]'),
                  stop_loss_pct: parseFloat(process.env.POSITION_STOP_LOSS_PCT || '5'),
                  take_profit_pct: parseFloat(process.env.POSITION_TAKE_PROFIT_PCT || '15'),
                  trailing_stop_pct: parseFloat(process.env.POSITION_TRAILING_STOP_PCT || '3'),
                  time_exit_hours: process.env.POSITION_TIME_EXIT_HOURS ? parseInt(process.env.POSITION_TIME_EXIT_HOURS) : undefined,
                  max_hold_time_hours: parseInt(process.env.POSITION_MAX_HOLD_TIME_HOURS || '720')
                },
                parseInt(process.env.POSITION_OPTIMIZATION_INTERVAL_MS || '300000') // 5 minutes
              );

              await Promise.all([
                riskManager.start(),
                positionManager.start()
              ]);

              // Store global references for status display
              (global as any).__riskManager = riskManager;
              (global as any).__positionManager = positionManager;

              logger.info('Risk management services started');
            }
          } catch (error) {
            logger.warn({ error }, 'Failed to start funds management, continuing without it');
            console.log('⚠️  Funds management failed to start, continuing without it');
          }
        }

        // Show status
        console.log('\n✅ BSC Market Maker Bot is running!');
        console.log('\n🔍 Service Status:');
        
        if (!options.marketOnly) {
          const metricsStatus = metricsCollector.getStatus();
          console.log(`  📊 Monitoring: Running (${metricsStatus.running ? 'Active' : 'Inactive'})`);
          console.log(`      - Metrics endpoint: http://localhost:3001/metrics`);
          console.log(`      - Health endpoint: http://localhost:3001/health`);
          console.log(`      - Prometheus: http://localhost:3001/prometheus`);
        }

        if (!options.monitoringOnly) {
          const marketStatus = marketDataManager.getStatus();
          console.log(`  📈 Market Data: Running (${marketStatus.running ? 'Active' : 'Inactive'})`);
          console.log(`      - API endpoint: http://localhost:${marketStatus.apiServer.port}/api/v1`);
          console.log(`      - WebSocket: ${marketStatus.websocket.connected ? 'Connected' : 'Disconnected'}`);
          console.log(`      - Event processing: ${marketStatus.eventProcessor.processing ? 'Active' : 'Inactive'}`);
        }

        if (!options.noStrategies && !options.monitoringOnly && !options.marketOnly) {
          try {
            const strategyManager = getStrategyManager();
            const strategyStatus = strategyManager.getManagerStatus();
            console.log(`  🎯 Strategy Manager: Running (${strategyStatus.running ? 'Active' : 'Inactive'})`);
            console.log(`      - Total Strategies: ${strategyStatus.totalStrategies}`);
            console.log(`      - Active Strategies: ${strategyStatus.activeStrategies}`);
            console.log(`      - Conditional Orders: ${strategyStatus.conditionalOrdersEnabled ? 'Enabled' : 'Disabled'}`);
          } catch (error) {
            console.log(`  🎯 Strategy Manager: Not initialized`);
          }
        }

        if (!options.noFunds && !options.monitoringOnly && !options.marketOnly) {
          try {
            const fundsManager = getFundsManager();
            const fundsStatus = fundsManager.getStatus();
            console.log(`  💰 Funds Manager: Running (${fundsStatus.running ? 'Active' : 'Inactive'})`);
            console.log(`      - Treasury: ${fundsStatus.config.treasuryAddress.substring(0, 10)}...`);
            console.log(`      - Managed Groups: ${fundsStatus.config.managedWalletGroups.join(', ')}`);
            console.log(`      - Gas Drip: ${fundsStatus.services.gasDrip.enabled ? 'Enabled' : 'Disabled'}`);
            console.log(`      - Sweeper: ${fundsStatus.services.sweeper.enabled ? 'Enabled' : 'Disabled'}`);
            console.log(`      - Rebalancer: ${fundsStatus.services.rebalancer.enabled ? 'Enabled' : 'Disabled'}`);

            // Show risk management status
            try {
              const riskManager = (global as any).__riskManager;
              const positionManager = (global as any).__positionManager;

              if (riskManager && positionManager) {
                const riskStatus = riskManager.getStatus();
                const positionStatus = positionManager.getStatus();
                
                console.log(`  🛡️  Risk Manager: Running (${riskStatus.running ? 'Active' : 'Inactive'})`);
                console.log(`      - Assessment Interval: ${riskStatus.config.assessment_interval_ms / 1000}s`);
                console.log(`      - Auto Actions: ${riskStatus.config.auto_action_enabled ? 'Enabled' : 'Disabled'}`);
                console.log(`      - Emergency Stop: ${riskStatus.config.emergency_stop_enabled ? 'Enabled' : 'Disabled'}`);
                console.log(`      - Pending Actions: ${riskStatus.pending_actions}`);
                
                console.log(`  📊 Position Manager: Running (${positionStatus.running ? 'Active' : 'Inactive'})`);
                console.log(`      - Sizing Method: ${positionStatus.sizing_config.method}`);
                console.log(`      - Max Pyramid Levels: ${positionStatus.entry_exit_rules.max_pyramid_levels}`);
                console.log(`      - Optimization Interval: ${positionStatus.optimization_interval_ms / 1000}s`);
              }
            } catch (error) {
              console.log(`  🛡️  Risk Manager: Not initialized`);
            }
          } catch (error) {
            console.log(`  💰 Funds Manager: Not initialized`);
          }
        }

        console.log('\n💡 Use Ctrl+C to stop all services gracefully');

        // Keep process alive and handle graceful shutdown
        process.on('SIGINT', async () => {
          console.log('\n🛑 Shutting down BSC Market Maker Bot...');
          
          if (!options.noFunds && !options.monitoringOnly && !options.marketOnly) {
            try {
              console.log('🛡️  Stopping risk management services...');
              const riskManager = (global as any).__riskManager;
              const positionManager = (global as any).__positionManager;

              if (riskManager && positionManager) {
                await Promise.all([
                  riskManager.stop(),
                  positionManager.stop()
                ]);
              }

              console.log('💰 Stopping funds management services...');
              const fundsManager = getFundsManager();
              await fundsManager.stop();
            } catch (error) {
              logger.warn({ error }, 'Error stopping funds management services');
            }
          }

          if (!options.noStrategies && !options.monitoringOnly && !options.marketOnly) {
            try {
              console.log('🎯 Stopping strategy services...');
              const strategyManager = getStrategyManager();
              await strategyManager.stop();
            } catch (error) {
              logger.warn({ error }, 'Error stopping strategy services');
            }
          }
          
          if (!options.monitoringOnly) {
            console.log('📈 Stopping market data services...');
            await marketDataManager.stop();
          }
          
          if (!options.marketOnly) {
            console.log('📊 Stopping monitoring services...');
            await monitoringServer.stop();
            await metricsCollector.stop();
          }
          
          logger.info('✅ BSC Market Maker Bot stopped gracefully');
          process.exit(0);
        });

        process.on('SIGTERM', async () => {
          console.log('\n🛑 Shutting down BSC Market Maker Bot...');
          
          if (!options.noFunds && !options.monitoringOnly && !options.marketOnly) {
            try {
              console.log('🛡️  Stopping risk management services...');
              const riskManager = (global as any).__riskManager;
              const positionManager = (global as any).__positionManager;

              if (riskManager && positionManager) {
                await Promise.all([
                  riskManager.stop(),
                  positionManager.stop()
                ]);
              }

              console.log('💰 Stopping funds management services...');
              const fundsManager = getFundsManager();
              await fundsManager.stop();
            } catch (error) {
              logger.warn({ error }, 'Error stopping funds management services');
            }
          }

          if (!options.noStrategies && !options.monitoringOnly && !options.marketOnly) {
            try {
              console.log('🎯 Stopping strategy services...');
              const strategyManager = getStrategyManager();
              await strategyManager.stop();
            } catch (error) {
              logger.warn({ error }, 'Error stopping strategy services');
            }
          }
          
          if (!options.monitoringOnly) {
            await marketDataManager.stop();
          }
          
          if (!options.marketOnly) {
            await monitoringServer.stop();
            await metricsCollector.stop();
          }
          
          logger.info('✅ BSC Market Maker Bot stopped gracefully');
          process.exit(0);
        });

      } catch (error) {
        logger.error({ error }, 'Failed to start BSC Market Maker Bot');
        console.error('❌ Bot startup failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Stop all bot services
  bot
    .command('stop')
    .description('Stop all bot services')
    .action(async () => {
      try {
        console.log('🛑 Stopping BSC Market Maker Bot...');

        // Stop funds management services
        try {
          console.log('💰 Stopping funds management services...');
          const fundsManager = getFundsManager();
          await fundsManager.stop();
        } catch (error) {
          logger.warn({ error }, 'Error stopping funds management services or not initialized');
        }

        // Stop strategy services
        try {
          console.log('🎯 Stopping strategy services...');
          const strategyManager = getStrategyManager();
          await strategyManager.stop();
        } catch (error) {
          logger.warn({ error }, 'Error stopping strategy services or not initialized');
        }

        // Stop market data services
        console.log('📈 Stopping market data services...');
        await marketDataManager.stop();

        // Stop monitoring services
        console.log('📊 Stopping monitoring services...');
        await monitoringServer.stop();
        await metricsCollector.stop();

        logger.info('✅ BSC Market Maker Bot stopped');
        console.log('✅ All services stopped successfully');
        process.exit(0);

      } catch (error) {
        logger.error({ error }, 'Failed to stop BSC Market Maker Bot');
        console.error('❌ Bot shutdown failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Show comprehensive bot status
  bot
    .command('status')
    .description('Show comprehensive bot status')
    .option('--json', 'Output status as JSON')
    .action(async (options) => {
      try {
        console.log('🔍 BSC Market Maker Bot Status\n');

        // System health
        const health = await healthMonitor.getSystemHealth();
        console.log('🏥 System Health:');
        console.log(`  Overall: ${health.overall}`);
        console.log(`  Uptime: ${Math.round(health.uptime / 1000)}s`);
        console.log(`  Emergency: ${health.emergency_status.active ? 'ACTIVE' : 'Normal'}`);

        // Monitoring status
        const metricsStatus = metricsCollector.getStatus();
        console.log('\n📊 Monitoring Services:');
        console.log(`  Metrics Collector: ${metricsStatus.running ? 'Running' : 'Stopped'}`);
        console.log(`  Metrics Count: ${metricsStatus.metricCount}`);
        console.log(`  Metric Names: ${metricsStatus.metricNames}`);

        // Market data status
        const marketStatus = marketDataManager.getStatus();
        console.log('\n📈 Market Data Services:');
        console.log(`  Manager: ${marketStatus.running ? 'Running' : 'Stopped'}`);
        console.log(`  WebSocket: ${marketStatus.websocket.connected ? 'Connected' : 'Disconnected'}`);
        console.log(`  Subscriptions: ${marketStatus.websocket.subscriptions}`);
        console.log(`  Event Processor: ${marketStatus.eventProcessor.processing ? 'Running' : 'Stopped'}`);
        console.log(`  Queue Size: ${marketStatus.eventProcessor.queueSize}`);
        console.log(`  API Server: ${marketStatus.apiServer.running ? 'Running' : 'Stopped'} (Port: ${marketStatus.apiServer.port})`);

        // Health checks
        console.log('\n🔍 Health Checks:');
        for (const check of health.checks) {
          const icon = check.status === 'healthy' ? '✅' : 
                      check.status === 'degraded' ? '⚠️' : '❌';
          console.log(`  ${icon} ${check.name}: ${check.status}`);
          if (check.error) {
            console.log(`      Error: ${check.error}`);
          }
        }

        // Processing metrics
        console.log('\n📊 Processing Metrics:');
        console.log(`  Events Processed: ${marketStatus.metrics.eventsProcessed}`);
        console.log(`  Processing Errors: ${marketStatus.metrics.processingErrors}`);
        console.log(`  Events Dropped: ${marketStatus.metrics.eventsDropped}`);
        console.log(`  Avg Processing Time: ${Math.round(marketStatus.metrics.avgProcessingTime)}ms`);

        // Strategy status
        try {
          const strategyManager = getStrategyManager();
          const strategyStatus = strategyManager.getManagerStatus();
          console.log('\n🎯 Strategy Services:');
          console.log(`  Manager: ${strategyStatus.running ? 'Running' : 'Stopped'}`);
          console.log(`  Total Strategies: ${strategyStatus.totalStrategies}`);
          console.log(`  Active Strategies: ${strategyStatus.activeStrategies}`);
          console.log(`  Paused Strategies: ${strategyStatus.pausedStrategies}`);
          console.log(`  Conditional Orders: ${strategyStatus.conditionalOrdersEnabled ? 'Enabled' : 'Disabled'}`);
        } catch (error) {
          console.log('\n🎯 Strategy Services: Not initialized');
        }

        // Funds management status
        try {
          const fundsManager = getFundsManager();
          const fundsStatus = fundsManager.getStatus();
          console.log('\n💰 Funds Management Services:');
          console.log(`  Manager: ${fundsStatus.running ? 'Running' : 'Stopped'}`);
          console.log(`  Treasury: ${fundsStatus.config.treasuryAddress}`);
          console.log(`  Gas Drip: ${fundsStatus.services.gasDrip.running ? 'Running' : 'Stopped'} (${fundsStatus.services.gasDrip.enabled ? 'Enabled' : 'Disabled'})`);
          console.log(`  Sweeper: ${fundsStatus.services.sweeper.running ? 'Running' : 'Stopped'} (${fundsStatus.services.sweeper.enabled ? 'Enabled' : 'Disabled'})`);
          console.log(`  Rebalancer: ${fundsStatus.services.rebalancer.running ? 'Running' : 'Stopped'} (${fundsStatus.services.rebalancer.enabled ? 'Enabled' : 'Disabled'})`);
          console.log(`  Supported Assets: ${fundsStatus.config.supportedAssets.join(', ')}`);
        } catch (error) {
          console.log('\n💰 Funds Management Services: Not initialized');
        }

        if (options.json) {
          let strategyStatus = null;
          try {
            const strategyManager = getStrategyManager();
            strategyStatus = strategyManager.getManagerStatus();
          } catch (error) {
            // Strategy manager not initialized
          }

          const status = {
            health,
            monitoring: metricsStatus,
            marketData: marketStatus,
            strategies: strategyStatus,
            timestamp: new Date().toISOString(),
          };
          console.log('\n📄 JSON Status:');
          console.log(JSON.stringify(status, null, 2));
        }

      } catch (error) {
        logger.error({ error }, 'Failed to get bot status');
        console.error('❌ Status check failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // Health check command
  bot
    .command('health')
    .description('Quick health check')
    .action(async () => {
      try {
        const isHealthy = await healthMonitor.isHealthy();
        const health = await healthMonitor.getSystemHealth();
        
        console.log(`🏥 Health Status: ${isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
        console.log(`   Overall: ${health.overall}`);
        console.log(`   Uptime: ${Math.round(health.uptime / 1000)}s`);
        
        if (!isHealthy) {
          console.log('\n❌ Issues detected:');
          health.checks
            .filter(check => check.status !== 'healthy')
            .forEach(check => {
              console.log(`  - ${check.name}: ${check.status}${check.error ? ` (${check.error})` : ''}`);
            });
          process.exit(1);
        }

        process.exit(0);

      } catch (error) {
        logger.error({ error }, 'Health check failed');
        console.error('❌ Health check failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return bot;
}