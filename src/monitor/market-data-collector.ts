import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { metricsCollector } from './metrics';
import { PricingService } from '../dex/pricing';

export interface TokenPrice {
  address: string;
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap?: number;
  lastUpdated: Date;
}

export interface MarketMetrics {
  totalValueLocked: number;
  dailyVolume: number;
  activePairs: number;
  priceMovements: {
    gainers: TokenPrice[];
    losers: TokenPrice[];
  };
  marketTrends: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
}

export class MarketDataCollector extends EventEmitter {
  private static instance: MarketDataCollector;
  private isRunning = false;
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private metricsUpdateInterval: NodeJS.Timeout | null = null;
  private priceCache = new Map<string, TokenPrice>();
  private lastMetricsUpdate = 0;
  private readonly enableMockData: boolean;
  private readonly pricingService: PricingService;

  // Common BSC token addresses for monitoring
  private readonly monitoredTokens = [
    { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB' },
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT' },
    { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE' },
    { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD' },
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC' },
    { address: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', symbol: 'XRP' },
    { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB' },
    { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH' },
  ];

  private constructor() {
    super();
    this.enableMockData = process.env.ENABLE_MOCK_MARKET_DATA === 'true';
    this.pricingService = new PricingService();
  }

  static getInstance(): MarketDataCollector {
    if (!MarketDataCollector.instance) {
      MarketDataCollector.instance = new MarketDataCollector();
    }
    return MarketDataCollector.instance;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Market data collector already running');
      return;
    }

    logger.info('Starting market data collector');
    this.isRunning = true;

    // Initialize price data
    await this.updateTokenPrices();

    // Start price updates every 30 seconds
    this.priceUpdateInterval = setInterval(async () => {
      try {
        await this.updateTokenPrices();
      } catch (error) {
        logger.error({ error }, 'Failed to update token prices');
      }
    }, 30000);

    // Start metrics collection every 60 seconds
    this.metricsUpdateInterval = setInterval(async () => {
      try {
        await this.collectMarketMetrics();
      } catch (error) {
        logger.error({ error }, 'Failed to collect market metrics');
      }
    }, 60000);

    logger.info('Market data collector started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping market data collector');
    this.isRunning = false;

    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }

    if (this.metricsUpdateInterval) {
      clearInterval(this.metricsUpdateInterval);
      this.metricsUpdateInterval = null;
    }

    logger.info('Market data collector stopped');
  }

  private async updateTokenPrices(): Promise<void> {
    try {
      for (const token of this.monitoredTokens) {
        const tokenPrice = await this.fetchTokenPrice(token.symbol, token.address);
        if (!tokenPrice) {
          continue;
        }

        // Update cache
        this.priceCache.set(token.address, tokenPrice);

        // Record metrics
        metricsCollector.recordMetric(
          'token_price_usd',
          tokenPrice.price,
          { symbol: token.symbol, address: token.address },
          'gauge'
        );

        metricsCollector.recordMetric(
          'token_price_change_24h_pct',
          tokenPrice.priceChange24h,
          { symbol: token.symbol },
          'gauge'
        );

        metricsCollector.recordMetric(
          'token_volume_24h_usd',
          tokenPrice.volume24h,
          { symbol: token.symbol },
          'gauge'
        );

        // Emit price update event
        this.emit('priceUpdate', tokenPrice);
      }

      // Record total update metric
      metricsCollector.recordMetric('market_price_updates_total', this.priceCache.size, undefined, 'counter');

      logger.debug(`Updated prices for ${this.monitoredTokens.length} tokens`);

    } catch (error) {
      logger.error({ error }, 'Failed to update token prices');
      metricsCollector.recordMetric('market_price_update_errors_total', 1, undefined, 'counter');
    }
  }

  private async fetchTokenPrice(symbol: string, address: string): Promise<TokenPrice | null> {
    const now = new Date();
    try {
      const amountIn = '1';
      const fromToken = symbol === 'WBNB' ? 'BNB' : symbol;
      const quote = await this.pricingService.getQuote({
        tokenIn: fromToken,
        tokenOut: 'USDT',
        amountIn,
      });

      const price = parseFloat(quote.tokenOut.amount);
      if (!Number.isFinite(price)) {
        throw new Error('Received non-finite price');
      }

      return {
        address,
        symbol,
        price,
        priceChange24h: 0,
        volume24h: 0,
        marketCap: undefined,
        lastUpdated: now,
      };
    } catch (error) {
      logger.warn({ error, symbol }, 'Failed to fetch token price from pricing service');

      if (this.enableMockData) {
        const fallbackPrice = this.getFallbackPrice(symbol);
        return {
          address,
          symbol,
          price: fallbackPrice,
          priceChange24h: 0,
          volume24h: 0,
          marketCap: undefined,
          lastUpdated: now,
        };
      }

      return null;
    }
  }

  private getFallbackPrice(symbol: string): number {
    const basePrices: Record<string, number> = {
      WBNB: 250,
      BNB: 250,
      USDT: 1,
      BUSD: 1,
      USDC: 1,
      CAKE: 2.5,
      XRP: 0.6,
      BTCB: 43000,
      ETH: 2300,
    };

    return basePrices[symbol.toUpperCase()] ?? 1;
  }

  private async collectMarketMetrics(): Promise<void> {
    try {
      const now = Date.now();
      
      // Calculate market metrics
      const prices = Array.from(this.priceCache.values());
      const totalVolume = prices.reduce((sum, token) => sum + token.volume24h, 0);
      
      const gainers = prices.filter(p => p.priceChange24h > 0).length;
      const losers = prices.filter(p => p.priceChange24h < 0).length;
      const neutral = prices.length - gainers - losers;
      
      // Record market metrics
      metricsCollector.recordMetric('market_total_volume_24h_usd', totalVolume, undefined, 'gauge');
      metricsCollector.recordMetric('market_active_tokens', prices.length, undefined, 'gauge');
      metricsCollector.recordMetric('market_gainers_count', gainers, undefined, 'gauge');
      metricsCollector.recordMetric('market_losers_count', losers, undefined, 'gauge');
      metricsCollector.recordMetric('market_neutral_count', neutral, undefined, 'gauge');
      
      // Calculate market sentiment
      const denominator = prices.length || 1;
      const bullishPct = (gainers / denominator) * 100;
      const bearishPct = (losers / denominator) * 100;
      const neutralPct = 100 - bullishPct - bearishPct;
      
      metricsCollector.recordMetric('market_sentiment_bullish_pct', bullishPct, undefined, 'gauge');
      metricsCollector.recordMetric('market_sentiment_bearish_pct', bearishPct, undefined, 'gauge');
      metricsCollector.recordMetric('market_sentiment_neutral_pct', neutralPct, undefined, 'gauge');
      
      // Mock liquidity metrics
      const totalLiquidityUSD = prices.reduce((sum, token) => sum + (token.marketCap ?? 0), 0);
      metricsCollector.recordMetric('market_total_liquidity_usd', totalLiquidityUSD, undefined, 'gauge');
      
      // Emit market metrics update
      const marketMetrics: MarketMetrics = {
        totalValueLocked: totalLiquidityUSD,
        dailyVolume: totalVolume,
        activePairs: prices.length,
        priceMovements: {
          gainers: prices.filter(p => p.priceChange24h > 0).slice(0, 5),
          losers: prices.filter(p => p.priceChange24h < 0).slice(0, 5),
        },
        marketTrends: {
          bullish: bullishPct,
          bearish: bearishPct,
          neutral: neutralPct,
        },
      };
      
      this.emit('marketMetricsUpdate', marketMetrics);
      this.lastMetricsUpdate = now;
      
      logger.debug('Market metrics collected and updated');

    } catch (error) {
      logger.error({ error }, 'Failed to collect market metrics');
      metricsCollector.recordMetric('market_metrics_collection_errors_total', 1, undefined, 'counter');
    }
  }

  // Public methods for getting market data
  getTokenPrice(tokenAddress: string): TokenPrice | null {
    return this.priceCache.get(tokenAddress) || null;
  }

  getAllTokenPrices(): TokenPrice[] {
    return Array.from(this.priceCache.values());
  }

  async getCurrentMarketMetrics(): Promise<MarketMetrics> {
    const prices = Array.from(this.priceCache.values());
    const totalVolume = prices.reduce((sum, token) => sum + token.volume24h, 0);
    
    const gainers = prices.filter(p => p.priceChange24h > 0);
    const losers = prices.filter(p => p.priceChange24h < 0);
    
    return {
      totalValueLocked: prices.reduce((sum, token) => sum + (token.marketCap ?? 0), 0),
      dailyVolume: totalVolume,
      activePairs: prices.length,
      priceMovements: {
        gainers: gainers.slice(0, 5),
        losers: losers.slice(0, 5),
      },
      marketTrends: {
        bullish: prices.length ? (gainers.length / prices.length) * 100 : 0,
        bearish: prices.length ? (losers.length / prices.length) * 100 : 0,
        neutral: prices.length ? ((prices.length - gainers.length - losers.length) / prices.length) * 100 : 0,
      },
    };
  }

  async getHistoricalPrices(tokenAddress: string, hours: number = 24): Promise<Array<{
    timestamp: Date;
    price: number;
    volume: number;
  }>> {
    const current = this.getTokenPrice(tokenAddress);
    if (!current) {
      return [];
    }

    const data = [];
    for (let i = hours; i >= 0; i--) {
      data.push({
        timestamp: new Date(Date.now() - i * 60 * 60 * 1000),
        price: current.price,
        volume: 0,
      });
    }

    return data;
  }

  getStatus(): {
    running: boolean;
    monitoredTokens: number;
    lastUpdate: Date | null;
    cacheSize: number;
  } {
    return {
      running: this.isRunning,
      monitoredTokens: this.monitoredTokens.length,
      lastUpdate: this.priceCache.size > 0 ? 
        Array.from(this.priceCache.values())[0].lastUpdated : null,
      cacheSize: this.priceCache.size,
    };
  }
}

export const marketDataCollector = MarketDataCollector.getInstance();
