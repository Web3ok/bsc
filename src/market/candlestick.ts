import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { database } from '../persistence/database';
import { emergencyManager } from '../utils/emergency';

export interface CandlestickData {
  id?: number;
  pair: string;
  interval: string;
  timestamp: Date;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  tradeCount: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PricePoint {
  price: string;
  volume?: string;
  timestamp: Date;
}

export class CandlestickAggregator extends EventEmitter {
  private static instance: CandlestickAggregator;
  private isRunning = false;
  private intervals = ['1m', '5m', '15m', '1h', '4h', '1d'];
  private activeCandles = new Map<string, CandlestickData>(); // key: pair-interval-timestamp
  private aggregationTimer: NodeJS.Timeout | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): CandlestickAggregator {
    if (!CandlestickAggregator.instance) {
      CandlestickAggregator.instance = new CandlestickAggregator();
    }
    return CandlestickAggregator.instance;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Candlestick aggregator already running');
      return;
    }

    logger.info('Starting candlestick aggregator');
    this.isRunning = true;

    // Start periodic aggregation (every 10 seconds)
    this.aggregationTimer = setInterval(() => {
      this.flushActiveCandles().catch(error => {
        logger.error({ error }, 'Failed to flush active candles');
      });
    }, 10000);

    // Register emergency stop callback
    emergencyManager.registerStopCallback(async () => {
      await this.stop();
    });

    logger.info('Candlestick aggregator started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping candlestick aggregator');
    this.isRunning = false;

    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }

    // Flush any remaining candles
    await this.flushActiveCandles();
    this.activeCandles.clear();

    logger.info('Candlestick aggregator stopped');
  }

  // Process price update into candlestick data
  async processPriceUpdate(pair: string, pricePoint: PricePoint): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Generate candles for all intervals
      for (const interval of this.intervals) {
        await this.updateCandle(pair, interval, pricePoint);
      }
    } catch (error) {
      logger.error({ error, pair, pricePoint }, 'Failed to process price update');
    }
  }

  private async updateCandle(pair: string, interval: string, pricePoint: PricePoint): Promise<void> {
    const intervalStart = this.getIntervalStart(pricePoint.timestamp, interval);
    const candleKey = `${pair}-${interval}-${intervalStart.getTime()}`;

    // Get or create active candle
    let candle = this.activeCandles.get(candleKey);
    
    if (!candle) {
      candle = {
        pair,
        interval,
        timestamp: intervalStart,
        openPrice: pricePoint.price,
        highPrice: pricePoint.price,
        lowPrice: pricePoint.price,
        closePrice: pricePoint.price,
        volume: pricePoint.volume || '0',
        tradeCount: 1,
      };
      this.activeCandles.set(candleKey, candle);
    } else {
      // Update existing candle
      const price = parseFloat(pricePoint.price);
      const currentHigh = parseFloat(candle.highPrice);
      const currentLow = parseFloat(candle.lowPrice);

      if (price > currentHigh) {
        candle.highPrice = pricePoint.price;
      }
      if (price < currentLow) {
        candle.lowPrice = pricePoint.price;
      }
      
      candle.closePrice = pricePoint.price;
      candle.tradeCount++;
      
      // Add volume if provided
      if (pricePoint.volume) {
        const currentVolume = parseFloat(candle.volume);
        const additionalVolume = parseFloat(pricePoint.volume);
        candle.volume = (currentVolume + additionalVolume).toString();
      }
    }

    // Emit real-time candle update
    this.emit('candleUpdate', { ...candle });
  }

  private getIntervalStart(timestamp: Date, interval: string): Date {
    const date = new Date(timestamp);
    
    switch (interval) {
      case '1m':
        date.setSeconds(0, 0);
        return date;
      case '5m':
        date.setMinutes(Math.floor(date.getMinutes() / 5) * 5, 0, 0);
        return date;
      case '15m':
        date.setMinutes(Math.floor(date.getMinutes() / 15) * 15, 0, 0);
        return date;
      case '1h':
        date.setMinutes(0, 0, 0);
        return date;
      case '4h':
        date.setHours(Math.floor(date.getHours() / 4) * 4, 0, 0, 0);
        return date;
      case '1d':
        date.setHours(0, 0, 0, 0);
        return date;
      default:
        throw new Error(`Unsupported interval: ${interval}`);
    }
  }

  private async flushActiveCandles(): Promise<void> {
    if (this.activeCandles.size === 0) return;

    const now = new Date();
    const candlesToFlush: Array<{ key: string; candle: CandlestickData }> = [];

    // Find candles that should be closed (older than their interval)
    for (const [key, candle] of this.activeCandles.entries()) {
      const nextIntervalStart = this.getNextIntervalStart(candle.timestamp, candle.interval);
      
      if (now >= nextIntervalStart) {
        candlesToFlush.push({ key, candle });
      }
    }

    if (candlesToFlush.length === 0) return;

    try {
      // Save to database in transaction
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      await database.connection!.transaction(async (trx) => {
        for (const { key, candle } of candlesToFlush) {
          await trx('candlestick_data').insert({
            pair: candle.pair,
            interval: candle.interval,
            timestamp: candle.timestamp,
            open_price: candle.openPrice,
            high_price: candle.highPrice,
            low_price: candle.lowPrice,
            close_price: candle.closePrice,
            volume: candle.volume,
            trade_count: candle.tradeCount,
            created_at: new Date(),
            updated_at: new Date(),
          }).onConflict(['pair', 'interval', 'timestamp']).merge(['close_price', 'high_price', 'low_price', 'volume', 'trade_count', 'updated_at']);
        }
      });

      // Remove flushed candles from memory
      for (const { key, candle } of candlesToFlush) {
        this.activeCandles.delete(key);
        this.emit('candleCompleted', candle);
      }

      logger.debug({ count: candlesToFlush.length }, 'Flushed completed candles');

    } catch (error) {
      logger.error({ error, count: candlesToFlush.length }, 'Failed to flush candles to database');
    }
  }

  private getNextIntervalStart(timestamp: Date, interval: string): Date {
    const current = new Date(timestamp);
    
    switch (interval) {
      case '1m':
        return new Date(current.getTime() + 60 * 1000);
      case '5m':
        return new Date(current.getTime() + 5 * 60 * 1000);
      case '15m':
        return new Date(current.getTime() + 15 * 60 * 1000);
      case '1h':
        return new Date(current.getTime() + 60 * 60 * 1000);
      case '4h':
        return new Date(current.getTime() + 4 * 60 * 60 * 1000);
      case '1d':
        return new Date(current.getTime() + 24 * 60 * 60 * 1000);
      default:
        throw new Error(`Unsupported interval: ${interval}`);
    }
  }

  // Query methods
  async getCandles(
    pair: string, 
    interval: string, 
    startTime?: Date, 
    endTime?: Date, 
    limit = 100
  ): Promise<CandlestickData[]> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      let query = database.connection!('candlestick_data')
        .where({ pair, interval })
        .orderBy('timestamp', 'asc')
        .limit(limit);

      if (startTime) {
        query = query.where('timestamp', '>=', startTime);
      }
      
      if (endTime) {
        query = query.where('timestamp', '<=', endTime);
      }

      const results = await query;
      
      return results.map(row => ({
        id: row.id,
        pair: row.pair,
        interval: row.interval,
        timestamp: new Date(row.timestamp),
        openPrice: row.open_price,
        highPrice: row.high_price,
        lowPrice: row.low_price,
        closePrice: row.close_price,
        volume: row.volume,
        tradeCount: row.trade_count,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
      }));

    } catch (error) {
      logger.error({ error, pair, interval }, 'Failed to query candles');
      throw error;
    }
  }

  async getLatestCandle(pair: string, interval: string): Promise<CandlestickData | null> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const result = await database.connection!('candlestick_data')
        .where({ pair, interval })
        .orderBy('timestamp', 'desc')
        .first();

      if (!result) return null;

      return {
        id: result.id,
        pair: result.pair,
        interval: result.interval,
        timestamp: new Date(result.timestamp),
        openPrice: result.open_price,
        highPrice: result.high_price,
        lowPrice: result.low_price,
        closePrice: result.close_price,
        volume: result.volume,
        tradeCount: result.trade_count,
        createdAt: new Date(result.created_at),
        updatedAt: new Date(result.updated_at),
      };

    } catch (error) {
      logger.error({ error, pair, interval }, 'Failed to get latest candle');
      return null;
    }
  }

  // Get market summary
  async getMarketSummary(pair: string): Promise<{
    lastPrice: string;
    change24h: string;
    changePercent24h: string;
    volume24h: string;
    high24h: string;
    low24h: string;
  } | null> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const candles = await this.getCandles(pair, '1h', oneDayAgo, new Date(), 24);
      
      if (candles.length === 0) return null;

      const firstCandle = candles[0];
      const lastCandle = candles[candles.length - 1];
      
      const lastPrice = lastCandle.closePrice;
      const firstPrice = firstCandle.openPrice;
      const change24h = (parseFloat(lastPrice) - parseFloat(firstPrice)).toString();
      const changePercent24h = ((parseFloat(change24h) / parseFloat(firstPrice)) * 100).toFixed(2);
      
      // Calculate 24h high, low, volume
      let high24h = parseFloat(candles[0].highPrice);
      let low24h = parseFloat(candles[0].lowPrice);
      let volume24h = 0;
      
      for (const candle of candles) {
        const high = parseFloat(candle.highPrice);
        const low = parseFloat(candle.lowPrice);
        const volume = parseFloat(candle.volume);
        
        if (high > high24h) high24h = high;
        if (low < low24h) low24h = low;
        volume24h += volume;
      }

      return {
        lastPrice,
        change24h,
        changePercent24h,
        volume24h: volume24h.toString(),
        high24h: high24h.toString(),
        low24h: low24h.toString(),
      };

    } catch (error) {
      logger.error({ error, pair }, 'Failed to get market summary');
      return null;
    }
  }

  // Status methods
  getStatus(): {
    running: boolean;
    activeCandlesCount: number;
    supportedIntervals: string[];
  } {
    return {
      running: this.isRunning,
      activeCandlesCount: this.activeCandles.size,
      supportedIntervals: this.intervals,
    };
  }
}

export const candlestickAggregator = CandlestickAggregator.getInstance();