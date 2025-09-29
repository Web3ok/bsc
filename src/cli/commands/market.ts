import { Command } from 'commander';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import { marketDataManager } from '../../market/manager';
import { candlestickAggregator } from '../../market/candlestick';
import { marketDataAPI } from '../../market/api';

export function createMarketCommands(): Command {
  const market = new Command('market');
  market.description('Market data and WebSocket commands');

  // Start market data services
  market
    .command('start')
    .description('Start market data WebSocket, processing, and API services')
    .option('--api-port <port>', 'API server port', '3002')
    .option('--no-websocket', 'Disable WebSocket connection')
    .action(async (options) => {
      try {
        logger.info('Starting market data services...');

        // Initialize database
        await database.init();
        logger.info('Database initialized');

        // Start market data manager (includes all components)
        await marketDataManager.start({ noWebsocket: options.noWebsocket });
        
        const status = marketDataManager.getStatus();
        logger.info('✅ All market data services started successfully');
        
        console.log('\n📊 Market Data Services Status:');
        console.log(`  Running: ${status.running}`);
        console.log(`  Healthy: ${status.healthy}`);
        console.log(`  WebSocket connected: ${status.websocket.connected}`);
        console.log(`  WebSocket subscriptions: ${status.websocket.subscriptions}`);
        console.log(`  Event processor running: ${status.eventProcessor.processing}`);
        console.log(`  Event queue size: ${status.eventProcessor.queueSize}`);
        console.log(`  Candlestick aggregator running: ${status.candlestickAggregator.running}`);
        console.log(`  Active candles: ${status.candlestickAggregator.activeCandlesCount}`);
        console.log(`  API server running: ${status.apiServer.running}`);
        console.log(`  API server port: ${status.apiServer.port}`);

        logger.info('Available API endpoints:');
        logger.info(`  - GET http://localhost:${status.apiServer.port}/api/v1/candles?pair=BNB/USDT&interval=1h`);
        logger.info(`  - GET http://localhost:${status.apiServer.port}/api/v1/ticker?pair=BNB/USDT`);
        logger.info(`  - GET http://localhost:${status.apiServer.port}/api/v1/pairs`);
        logger.info(`  - GET http://localhost:${status.apiServer.port}/api/v1/summary`);
        logger.info(`  - GET http://localhost:${status.apiServer.port}/api/v1/recent-trades`);

        // Keep process alive
        process.on('SIGINT', async () => {
          logger.info('Shutting down market data services...');
          await marketDataManager.stop();
          logger.info('Market data services stopped');
          process.exit(0);
        });

        process.on('SIGTERM', async () => {
          logger.info('Shutting down market data services...');
          await marketDataManager.stop();
          logger.info('Market data services stopped');
          process.exit(0);
        });

      } catch (error) {
        logger.error({ error }, 'Failed to start market data services');
        process.exit(1);
      }
    });

  // Stop market data services
  market
    .command('stop')
    .description('Stop market data services')
    .action(async () => {
      try {
        logger.info('Stopping market data services...');

        await marketDataManager.stop();
        logger.info('Market data manager stopped');

        logger.info('✅ All market data services stopped');
        process.exit(0);

      } catch (error) {
        logger.error({ error }, 'Failed to stop market data services');
        process.exit(1);
      }
    });

  // Show market data status
  market
    .command('status')
    .description('Show market data services status')
    .action(async () => {
      try {
        const status = marketDataManager.getStatus();
        
        console.log('\n📊 Market Data Manager:');
        console.log(`  Running: ${status.running}`);
        console.log(`  Healthy: ${status.healthy}`);

        console.log('\n🔌 WebSocket Status:');
        console.log(`  Connected: ${status.websocket.connected}`);
        console.log(`  Subscriptions: ${status.websocket.subscriptions}`);
        console.log(`  Reconnect attempts: ${status.websocket.reconnectAttempts}`);
        console.log(`  Buffer size: ${status.websocket.bufferSize}`);

        console.log('\n⚙️  Event Processor:');
        console.log(`  Processing: ${status.eventProcessor.processing}`);
        console.log(`  Queue size: ${status.eventProcessor.queueSize}`);
        console.log(`  Max queue size: ${status.eventProcessor.maxQueueSize}`);
        console.log(`  Healthy: ${status.eventProcessor.healthy}`);

        console.log('\n📈 Candlestick Aggregator:');
        console.log(`  Running: ${status.candlestickAggregator.running}`);
        console.log(`  Active candles: ${status.candlestickAggregator.activeCandlesCount}`);
        console.log(`  Supported intervals: ${status.candlestickAggregator.supportedIntervals.join(', ')}`);

        console.log('\n🌐 API Server:');
        console.log(`  Running: ${status.apiServer.running}`);
        console.log(`  Port: ${status.apiServer.port}`);

        console.log('\n📊 Processing Metrics:');
        console.log(`  Events processed: ${status.metrics.eventsProcessed}`);
        console.log(`  Processing errors: ${status.metrics.processingErrors}`);
        console.log(`  Events dropped: ${status.metrics.eventsDropped}`);
        console.log(`  Avg processing time: ${Math.round(status.metrics.avgProcessingTime)}ms`);
        
        if (status.metrics.lastProcessedAt) {
          console.log(`  Last processed: ${status.metrics.lastProcessedAt}`);
        }

      } catch (error) {
        logger.error({ error }, 'Failed to get market data status');
        process.exit(1);
      }
    });

  // Test market data functionality
  market
    .command('test')
    .description('Test market data functionality')
    .action(async () => {
      try {
        logger.info('Running market data tests...');

        // Initialize database
        await database.init();

        console.log('\n1. Testing candlestick aggregator...');
        await candlestickAggregator.start();
        
        // Generate test data
        const testPair = 'TEST/USDT';
        await candlestickAggregator.processPriceUpdate(testPair, {
          price: '100.50',
          volume: '1000',
          timestamp: new Date(),
        });
        console.log('✅ Test price update processed');

        // Test API
        console.log('\n2. Testing market data API...');
        await marketDataAPI.start();
        console.log(`✅ API server started on port ${marketDataAPI.getPort()}`);
        
        await marketDataAPI.stop();
        await candlestickAggregator.stop();
        
        console.log('\n✅ All market data tests passed!');

      } catch (error) {
        logger.error({ error }, 'Market data tests failed');
        process.exit(1);
      }
    });

  // Candles subcommand for querying historical data
  market
    .command('candles')
    .description('Query candlestick data')
    .requiredOption('-p, --pair <pair>', 'Trading pair (e.g., BNB/USDT)')
    .option('-i, --interval <interval>', 'Time interval', '1h')
    .option('-l, --limit <limit>', 'Number of candles to fetch', '100')
    .action(async (options) => {
      try {
        await database.init();
        await candlestickAggregator.start();

        const candles = await candlestickAggregator.getCandles(
          options.pair,
          options.interval,
          undefined,
          undefined,
          parseInt(options.limit)
        );

        console.log(`\n📊 Candlestick data for ${options.pair} (${options.interval}):`)
        console.log(`Found ${candles.length} candles\n`);

        if (candles.length > 0) {
          console.log('Time                 | Open     | High     | Low      | Close    | Volume   | Trades');
          console.log('---------------------|----------|----------|----------|----------|----------|--------');
          
          candles.forEach(candle => {
            const time = candle.timestamp.toISOString().substring(0, 16).replace('T', ' ');
            const open = parseFloat(candle.openPrice).toFixed(2).padStart(8);
            const high = parseFloat(candle.highPrice).toFixed(2).padStart(8);
            const low = parseFloat(candle.lowPrice).toFixed(2).padStart(8);
            const close = parseFloat(candle.closePrice).toFixed(2).padStart(8);
            const volume = parseFloat(candle.volume).toFixed(0).padStart(8);
            const trades = candle.tradeCount.toString().padStart(6);
            
            console.log(`${time} | ${open} | ${high} | ${low} | ${close} | ${volume} | ${trades}`);
          });
        } else {
          console.log('No candlestick data found for the specified parameters.');
        }

        await candlestickAggregator.stop();

      } catch (error) {
        logger.error({ error }, 'Failed to query candlestick data');
        process.exit(1);
      }
    });

  return market;
}