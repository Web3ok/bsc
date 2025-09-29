import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { database } from '../persistence/database';
import { emergencyManager } from '../utils/emergency';
import { SwapEvent, PriceUpdate } from './websocket';

export interface ProcessedEvent {
  id: string;
  type: 'swap' | 'price_update';
  data: SwapEvent | PriceUpdate;
  processed_at: Date;
  processing_time_ms: number;
}

export class MarketEventProcessor extends EventEmitter {
  private static instance: MarketEventProcessor;
  private processing = false;
  private eventQueue: Array<{ type: string; data: any }> = [];
  private maxQueueSize = 10000;
  private batchSize = 100;
  private processingInterval: NodeJS.Timeout | null = null;
  private metrics = {
    eventsProcessed: 0,
    eventsDropped: 0,
    processingErrors: 0,
    lastProcessedAt: null as Date | null,
    avgProcessingTime: 0,
  };

  private constructor() {
    super();
  }

  public static getInstance(): MarketEventProcessor {
    if (!MarketEventProcessor.instance) {
      MarketEventProcessor.instance = new MarketEventProcessor();
    }
    return MarketEventProcessor.instance;
  }

  async start(): Promise<void> {
    if (this.processing) {
      logger.warn('Event processor already running');
      return;
    }

    logger.info('Starting market event processor');
    this.processing = true;

    // Start batch processing
    this.processingInterval = setInterval(() => {
      this.processBatch().catch(error => {
        logger.error({ error }, 'Batch processing failed');
        this.metrics.processingErrors++;
      });
    }, 1000); // Process every second

    // Register emergency stop callback
    emergencyManager.registerStopCallback(async () => {
      await this.stop();
    });

    logger.info('Market event processor started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping market event processor');
    this.processing = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Process remaining events in queue
    if (this.eventQueue.length > 0) {
      logger.info({ queueSize: this.eventQueue.length }, 'Processing remaining events before shutdown');
      await this.processBatch();
    }

    logger.info('Market event processor stopped');
  }

  // Add event to processing queue
  queueEvent(type: string, data: any): boolean {
    // Check emergency status
    const emergencyStatus = emergencyManager.checkEmergencyStatus();
    if (!emergencyStatus.allowed) {
      logger.debug('Dropping event - emergency stop active');
      this.metrics.eventsDropped++;
      return false;
    }

    // Check queue size
    if (this.eventQueue.length >= this.maxQueueSize) {
      logger.warn({ queueSize: this.eventQueue.length }, 'Event queue full - dropping oldest events');
      this.eventQueue.splice(0, this.batchSize); // Remove oldest events
      this.metrics.eventsDropped += this.batchSize;
    }

    this.eventQueue.push({ type, data });
    return true;
  }

  private async processBatch(): Promise<void> {
    if (!this.processing || this.eventQueue.length === 0) {
      return;
    }

    const batchStart = Date.now();
    const batch = this.eventQueue.splice(0, this.batchSize);
    
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      await database.connection!.transaction(async (trx) => {
        for (const event of batch) {
          await this.processEvent(event, trx);
        }
      });

      const processingTime = Date.now() - batchStart;
      this.metrics.eventsProcessed += batch.length;
      this.metrics.lastProcessedAt = new Date();
      this.updateAvgProcessingTime(processingTime);

      logger.debug({ 
        batchSize: batch.length, 
        processingTime,
        queueSize: this.eventQueue.length 
      }, 'Processed event batch');

    } catch (error) {
      logger.error({ error, batchSize: batch.length }, 'Failed to process event batch');
      this.metrics.processingErrors++;
      
      // Re-queue events on failure (with limit)
      if (batch.length < 50) {
        this.eventQueue.unshift(...batch);
      } else {
        this.metrics.eventsDropped += batch.length;
      }
    }
  }

  private async processEvent(event: { type: string; data: any }, trx: any): Promise<void> {
    try {
      switch (event.type) {
        case 'swapEvent':
          await this.processSwapEvent(event.data as SwapEvent, trx);
          break;
        case 'priceUpdate':
          await this.processPriceUpdate(event.data as PriceUpdate, trx);
          break;
        default:
          logger.warn({ eventType: event.type }, 'Unknown event type');
      }
    } catch (error) {
      logger.error({ error, eventType: event.type }, 'Failed to process individual event');
      throw error;
    }
  }

  private async processSwapEvent(swapEvent: SwapEvent, trx: any): Promise<void> {
    try {
      // Check if event already exists (idempotency)
      const existing = await trx('swap_events')
        .where({ event_id: swapEvent.id })
        .first();

      if (existing) {
        logger.debug({ eventId: swapEvent.id }, 'Swap event already processed');
        return;
      }

      // Insert swap event
      await trx('swap_events').insert({
        event_id: swapEvent.id,
        transaction_hash: swapEvent.transactionHash,
        block_number: swapEvent.blockNumber.toString(),
        log_index: swapEvent.logIndex,
        pair_address: swapEvent.address,
        sender: swapEvent.sender,
        recipient: swapEvent.to,
        amount_0_in: swapEvent.amount0In.toString(),
        amount_1_in: swapEvent.amount1In.toString(),
        amount_0_out: swapEvent.amount0Out.toString(),
        amount_1_out: swapEvent.amount1Out.toString(),
        timestamp: swapEvent.timestamp,
        processed_at: new Date(),
      });

      // Emit processed event
      this.emit('eventProcessed', {
        id: swapEvent.id,
        type: 'swap',
        data: swapEvent,
        processed_at: new Date(),
        processing_time_ms: Date.now() - swapEvent.timestamp.getTime(),
      });

      logger.debug({ eventId: swapEvent.id }, 'Swap event processed and stored');

    } catch (error) {
      logger.error({ error, eventId: swapEvent.id }, 'Failed to process swap event');
      throw error;
    }
  }

  private async processPriceUpdate(priceUpdate: PriceUpdate, trx: any): Promise<void> {
    try {
      // Insert price update
      await trx('price_updates').insert({
        pair: priceUpdate.pair,
        token_0: priceUpdate.token0,
        token_1: priceUpdate.token1,
        price: priceUpdate.price,
        volume_24h: priceUpdate.volume24h || null,
        timestamp: priceUpdate.timestamp,
        created_at: new Date(),
      });

      // Update latest price in a separate table for quick lookups
      await trx('latest_prices').insert({
        pair: priceUpdate.pair,
        price: priceUpdate.price,
        updated_at: priceUpdate.timestamp,
      }).onConflict('pair').merge(['price', 'updated_at']);

      // Emit processed event
      this.emit('eventProcessed', {
        id: `price-${priceUpdate.pair}-${priceUpdate.timestamp.getTime()}`,
        type: 'price_update',
        data: priceUpdate,
        processed_at: new Date(),
        processing_time_ms: Date.now() - priceUpdate.timestamp.getTime(),
      });

      logger.debug({ pair: priceUpdate.pair, price: priceUpdate.price }, 'Price update processed and stored');

    } catch (error) {
      logger.error({ error, pair: priceUpdate.pair }, 'Failed to process price update');
      throw error;
    }
  }

  private updateAvgProcessingTime(processingTime: number): void {
    if (this.metrics.avgProcessingTime === 0) {
      this.metrics.avgProcessingTime = processingTime;
    } else {
      // Exponential moving average
      this.metrics.avgProcessingTime = (this.metrics.avgProcessingTime * 0.9) + (processingTime * 0.1);
    }
  }

  // Health and metrics methods
  isHealthy(): boolean {
    return this.processing && 
           this.eventQueue.length < this.maxQueueSize * 0.8 && 
           this.metrics.processingErrors < 100; // Allow some errors
  }

  getMetrics(): typeof this.metrics & { queueSize: number } {
    return {
      ...this.metrics,
      queueSize: this.eventQueue.length,
    };
  }

  getStatus(): {
    processing: boolean;
    queueSize: number;
    maxQueueSize: number;
    healthy: boolean;
  } {
    return {
      processing: this.processing,
      queueSize: this.eventQueue.length,
      maxQueueSize: this.maxQueueSize,
      healthy: this.isHealthy(),
    };
  }

  // Manual event injection for testing
  async injectTestEvent(type: string, data: any): Promise<boolean> {
    if (!this.processing) {
      throw new Error('Event processor not running');
    }
    return this.queueEvent(type, data);
  }
}

export const marketEventProcessor = MarketEventProcessor.getInstance();