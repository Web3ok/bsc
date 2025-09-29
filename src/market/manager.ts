import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { bscWebSocketClient } from './websocket';
import { marketEventProcessor } from './eventProcessor';
import { candlestickAggregator } from './candlestick';
import { marketDataAPI } from './api';
import { emergencyManager } from '../utils/emergency';

export class MarketDataManager extends EventEmitter {
  private static instance: MarketDataManager;
  private isRunning = false;

  private constructor() {
    super();
  }

  public static getInstance(): MarketDataManager {
    if (!MarketDataManager.instance) {
      MarketDataManager.instance = new MarketDataManager();
    }
    return MarketDataManager.instance;
  }

  async start(options: { noWebsocket?: boolean } = {}): Promise<void> {
    if (this.isRunning) {
      logger.warn('Market data manager already running');
      return;
    }

    logger.info('Starting market data manager');

    try {
      // Start event processor first
      await marketEventProcessor.start();
      
      // Start candlestick aggregator
      await candlestickAggregator.start();
      
      // Start API server
      await marketDataAPI.start();
      
      // Set up event handlers
      this.setupEventHandlers();
      
      // Start WebSocket client if not disabled
      if (!options.noWebsocket) {
        await bscWebSocketClient.start();
        logger.info('WebSocket client started');
      } else {
        logger.info('WebSocket client disabled by --no-websocket option');
      }
      
      this.isRunning = true;
      
      // Register emergency stop callback
      emergencyManager.registerStopCallback(async () => {
        await this.stop();
      });

      logger.info('Market data manager started successfully');
      this.emit('started');

    } catch (error) {
      logger.error({ error }, 'Failed to start market data manager');
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping market data manager');
    this.isRunning = false;

    try {
      // Stop WebSocket client first (stops new events)
      await bscWebSocketClient.stop();
      
      // Stop API server
      await marketDataAPI.stop();
      
      // Stop candlestick aggregator
      await candlestickAggregator.stop();
      
      // Stop event processor (processes remaining events)
      await marketEventProcessor.stop();
      
      // Remove event listeners
      this.removeAllEventListeners();
      
      logger.info('Market data manager stopped');
      this.emit('stopped');

    } catch (error) {
      logger.error({ error }, 'Error stopping market data manager');
    }
  }

  private setupEventHandlers(): void {
    // Handle WebSocket events
    bscWebSocketClient.on('swapEvent', (swapEvent) => {
      const queued = marketEventProcessor.queueEvent('swapEvent', swapEvent);
      if (!queued) {
        logger.warn({ eventId: swapEvent.id }, 'Failed to queue swap event');
      }
    });

    bscWebSocketClient.on('priceUpdate', (priceUpdate) => {
      const queued = marketEventProcessor.queueEvent('priceUpdate', priceUpdate);
      if (!queued) {
        logger.warn({ pair: priceUpdate.pair }, 'Failed to queue price update');
      }
      
      // Feed to candlestick aggregator
      candlestickAggregator.processPriceUpdate(priceUpdate.pair, {
        price: priceUpdate.price,
        volume: priceUpdate.volume24h,
        timestamp: priceUpdate.timestamp,
      }).catch(error => {
        logger.error({ error, pair: priceUpdate.pair }, 'Failed to process price update for candlestick');
      });
      
      // Also emit for real-time consumers
      this.emit('priceUpdate', priceUpdate);
    });

    bscWebSocketClient.on('connected', () => {
      logger.info('WebSocket connected');
      this.emit('websocketConnected');
    });

    bscWebSocketClient.on('disconnected', () => {
      logger.warn('WebSocket disconnected');
      this.emit('websocketDisconnected');
    });

    bscWebSocketClient.on('error', (error) => {
      logger.error({ error }, 'WebSocket error');
      this.emit('websocketError', error);
    });

    // Handle processed events
    marketEventProcessor.on('eventProcessed', (processedEvent) => {
      logger.debug({ 
        eventId: processedEvent.id, 
        type: processedEvent.type,
        processingTime: processedEvent.processing_time_ms 
      }, 'Event processed');
      
      this.emit('eventProcessed', processedEvent);
    });

    logger.debug('Event handlers set up');
  }

  private removeAllEventListeners(): void {
    bscWebSocketClient.removeAllListeners();
    marketEventProcessor.removeAllListeners();
  }

  // Health and status methods
  isHealthy(): boolean {
    return this.isRunning && 
           bscWebSocketClient.isHealthy() && 
           marketEventProcessor.isHealthy() &&
           candlestickAggregator.getStatus().running;
  }

  getStatus(): {
    running: boolean;
    healthy: boolean;
    websocket: ReturnType<typeof bscWebSocketClient.getStatus>;
    eventProcessor: ReturnType<typeof marketEventProcessor.getStatus>;
    candlestickAggregator: ReturnType<typeof candlestickAggregator.getStatus>;
    apiServer: { running: boolean; port: number };
    metrics: ReturnType<typeof marketEventProcessor.getMetrics>;
  } {
    return {
      running: this.isRunning,
      healthy: this.isHealthy(),
      websocket: bscWebSocketClient.getStatus(),
      eventProcessor: marketEventProcessor.getStatus(),
      candlestickAggregator: candlestickAggregator.getStatus(),
      apiServer: { 
        running: marketDataAPI.isRunning(),
        port: marketDataAPI.getPort()
      },
      metrics: marketEventProcessor.getMetrics(),
    };
  }

  // Manual control methods for testing/debugging
  async restartWebSocket(): Promise<void> {
    logger.info('Restarting WebSocket connection');
    
    await bscWebSocketClient.stop();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    await bscWebSocketClient.start();
    
    logger.info('WebSocket restarted');
  }

  async flushEventQueue(): Promise<void> {
    logger.info('Flushing event processor queue');
    
    // Stop and restart event processor to flush queue
    await marketEventProcessor.stop();
    await marketEventProcessor.start();
    
    logger.info('Event queue flushed');
  }
}

export const marketDataManager = MarketDataManager.getInstance();