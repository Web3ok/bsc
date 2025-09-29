import * as http from 'http';
import * as url from 'url';
import { logger } from '../utils/logger';
import { configManager } from '../config';
import { candlestickAggregator } from './candlestick';
import { database } from '../persistence/database';
import { emergencyManager } from '../utils/emergency';

export class MarketDataAPI {
  private static instance: MarketDataAPI;
  private server: http.Server | null = null;
  private port: number;

  private constructor() {
    this.port = configManager.config.monitoring.api_port || 3002;
  }

  public static getInstance(): MarketDataAPI {
    if (!MarketDataAPI.instance) {
      MarketDataAPI.instance = new MarketDataAPI();
    }
    return MarketDataAPI.instance;
  }

  async start(): Promise<void> {
    if (this.server) {
      logger.warn('Market data API server already running');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.port, () => {
        logger.info({ port: this.port }, 'Market data API server started');
        resolve();
      });

      this.server.on('error', (error) => {
        logger.error({ error, port: this.port }, 'Market data API server error');
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Market data API server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '';
    const query = parsedUrl.query;
    const method = req.method || 'GET';

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      // Check emergency status
      const emergencyStatus = emergencyManager.checkEmergencyStatus();
      if (!emergencyStatus.allowed) {
        this.sendError(res, 503, 'Service temporarily unavailable', { reason: emergencyStatus.reason });
        return;
      }

      // Route requests
      if (pathname === '/api/v1/candles' && method === 'GET') {
        await this.handleGetCandles(req, res, query);
      } else if (pathname === '/api/v1/ticker' && method === 'GET') {
        await this.handleGetTicker(req, res, query);
      } else if (pathname === '/api/v1/pairs' && method === 'GET') {
        await this.handleGetPairs(req, res);
      } else if (pathname === '/api/v1/summary' && method === 'GET') {
        await this.handleGetSummary(req, res, query);
      } else if (pathname === '/api/v1/recent-trades' && method === 'GET') {
        await this.handleGetRecentTrades(req, res, query);
      } else {
        this.handle404(res);
      }

    } catch (error) {
      logger.error({ error, pathname, method }, 'API request handling error');
      this.sendError(res, 500, 'Internal server error');
    }
  }

  private async handleGetCandles(req: http.IncomingMessage, res: http.ServerResponse, query: any): Promise<void> {
    const pair = query.pair as string;
    const interval = query.interval as string;
    const startTime = query.startTime ? new Date(parseInt(query.startTime as string)) : undefined;
    const endTime = query.endTime ? new Date(parseInt(query.endTime as string)) : undefined;
    const limit = parseInt(query.limit as string) || 100;

    if (!pair || !interval) {
      this.sendError(res, 400, 'Missing required parameters: pair, interval');
      return;
    }

    try {
      const candles = await candlestickAggregator.getCandles(pair, interval, startTime, endTime, Math.min(limit, 1000));
      
      this.sendJSON(res, {
        pair,
        interval,
        data: candles.map(candle => ({
          timestamp: candle.timestamp.getTime(),
          open: candle.openPrice,
          high: candle.highPrice,
          low: candle.lowPrice,
          close: candle.closePrice,
          volume: candle.volume,
          tradeCount: candle.tradeCount,
        })),
        count: candles.length,
      });

    } catch (error) {
      logger.error({ error, pair, interval }, 'Failed to get candles');
      this.sendError(res, 500, 'Failed to retrieve candlestick data');
    }
  }

  private async handleGetTicker(req: http.IncomingMessage, res: http.ServerResponse, query: any): Promise<void> {
    const pair = query.pair as string;

    if (!pair) {
      this.sendError(res, 400, 'Missing required parameter: pair');
      return;
    }

    try {
      // Get latest price from latest_prices table
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const latestPrice = await database.connection!('latest_prices')
        .where({ pair })
        .first();

      if (!latestPrice) {
        this.sendError(res, 404, 'Pair not found');
        return;
      }

      // Get market summary
      const summary = await candlestickAggregator.getMarketSummary(pair);

      this.sendJSON(res, {
        pair,
        lastPrice: latestPrice.price,
        lastUpdate: latestPrice.updated_at,
        summary: summary || {
          change24h: '0',
          changePercent24h: '0',
          volume24h: '0',
          high24h: latestPrice.price,
          low24h: latestPrice.price,
        },
      });

    } catch (error) {
      logger.error({ error, pair }, 'Failed to get ticker');
      this.sendError(res, 500, 'Failed to retrieve ticker data');
    }
  }

  private async handleGetPairs(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      // Get all available pairs from latest_prices table
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const pairs = await database.connection!('latest_prices')
        .select('pair', 'price', 'updated_at')
        .orderBy('pair');

      this.sendJSON(res, {
        pairs: pairs.map(p => ({
          pair: p.pair,
          lastPrice: p.price,
          lastUpdate: p.updated_at,
        })),
        count: pairs.length,
      });

    } catch (error) {
      logger.error({ error }, 'Failed to get pairs');
      this.sendError(res, 500, 'Failed to retrieve pairs data');
    }
  }

  private async handleGetSummary(req: http.IncomingMessage, res: http.ServerResponse, query: any): Promise<void> {
    const pair = query.pair as string;

    if (!pair) {
      // Return summary for all pairs
      try {
        if (!database.connection) {
          throw new Error('Database connection not available');
        }
        const pairs = await database.connection!('latest_prices').select();
        const summaries = await Promise.allSettled(
          pairs.map(async p => {
            const summary = await candlestickAggregator.getMarketSummary(p.pair);
            return {
              pair: p.pair,
              lastPrice: p.price,
              ...summary,
            };
          })
        );

        const results = summaries
          .filter(result => result.status === 'fulfilled')
          .map(result => (result as PromiseFulfilledResult<any>).value);

        this.sendJSON(res, { summaries: results });
        
      } catch (error) {
        logger.error({ error }, 'Failed to get all summaries');
        this.sendError(res, 500, 'Failed to retrieve market summaries');
      }
    } else {
      // Return summary for specific pair
      try {
        const summary = await candlestickAggregator.getMarketSummary(pair);
        
        if (!summary) {
          this.sendError(res, 404, 'Pair not found or no data available');
          return;
        }

        this.sendJSON(res, { pair, ...summary });

      } catch (error) {
        logger.error({ error, pair }, 'Failed to get pair summary');
        this.sendError(res, 500, 'Failed to retrieve market summary');
      }
    }
  }

  private async handleGetRecentTrades(req: http.IncomingMessage, res: http.ServerResponse, query: any): Promise<void> {
    const pair = query.pair as string;
    const limit = parseInt(query.limit as string) || 50;

    try {
      // Get recent swap events from the database
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      let dbQuery = database.connection!('swap_events')
        .orderBy('timestamp', 'desc')
        .limit(Math.min(limit, 200));

      if (pair) {
        // Convert pair to address if needed - for now just filter by pair_address
        dbQuery = dbQuery.where('pair_address', 'like', `%${pair.toLowerCase()}%`);
      }

      const trades = await dbQuery;

      this.sendJSON(res, {
        pair: pair || 'all',
        trades: trades.map(trade => ({
          id: trade.event_id,
          timestamp: trade.timestamp,
          transactionHash: trade.transaction_hash,
          sender: trade.sender,
          recipient: trade.recipient,
          amount0In: trade.amount_0_in,
          amount1In: trade.amount_1_in,
          amount0Out: trade.amount_0_out,
          amount1Out: trade.amount_1_out,
        })),
        count: trades.length,
      });

    } catch (error) {
      logger.error({ error, pair }, 'Failed to get recent trades');
      this.sendError(res, 500, 'Failed to retrieve recent trades');
    }
  }

  private handle404(res: http.ServerResponse): void {
    this.sendJSON(res, {
      error: 'Not Found',
      available_endpoints: [
        'GET /api/v1/candles?pair=BNB/USDT&interval=1h&limit=100',
        'GET /api/v1/ticker?pair=BNB/USDT',
        'GET /api/v1/pairs',
        'GET /api/v1/summary?pair=BNB/USDT',
        'GET /api/v1/recent-trades?pair=BNB/USDT&limit=50',
      ],
    }, 404);
  }

  private sendJSON(res: http.ServerResponse, data: any, statusCode = 200): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  private sendError(res: http.ServerResponse, statusCode: number, message: string, details?: any): void {
    const error = {
      error: message,
      statusCode,
      timestamp: new Date().toISOString(),
      ...(details && { details }),
    };
    this.sendJSON(res, error, statusCode);
  }

  // Status methods
  isRunning(): boolean {
    return this.server !== null;
  }

  getPort(): number {
    return this.port;
  }
}

export const marketDataAPI = MarketDataAPI.getInstance();