import { logger } from '../utils/logger';
import { monitoringService } from './monitoring-service';

interface PriceData {
  symbol: string;
  priceUSD: number;
  priceChange24h: number;
  volume24hUSD: number;
  lastUpdated: Date;
  isStale?: boolean;
  dataSource?: 'coingecko_live' | 'cached_recent' | 'cached_stale' | 'fallback_static';
}

interface CoinGeckoResponse {
  [coinId: string]: {
    usd: number;
    usd_24h_change: number;
    usd_24h_vol: number;
  };
}

class PriceService {
  private static instance: PriceService;
  private cache = new Map<string, { data: PriceData; timestamp: number }>();
  private readonly CACHE_TTL = 60000; // 1 minute cache
  private readonly REQUEST_TIMEOUT = 5000; // 5 seconds

  // CoinGecko API mapping
  private readonly COINGECKO_IDS: Record<string, string> = {
    'BNB': 'binancecoin',
    'WBNB': 'wbnb',
    'CAKE': 'pancakeswap-token',
    'BUSD': 'binance-usd',
    'USDT': 'tether',
    'USDC': 'usd-coin',
    'ETH': 'ethereum',
    'BTC': 'bitcoin'
  };

  private constructor() {}

  public static getInstance(): PriceService {
    if (!PriceService.instance) {
      PriceService.instance = new PriceService();
    }
    return PriceService.instance;
  }

  async getPrice(symbol: string): Promise<PriceData | null> {
    const cacheKey = `price_${symbol.toUpperCase()}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      const cacheAge = Date.now() - cached.timestamp;
      if (cacheAge < this.CACHE_TTL) {
        // Return fresh cached data
        const cachedData = { ...cached.data };
        cachedData.dataSource = 'cached_recent';
        return cachedData;
      } else {
        // Return stale cached data but try to refresh in background
        const staleData = { ...cached.data };
        staleData.dataSource = 'cached_stale';
        staleData.isStale = true;
        
        // Try to refresh in background (don't await)
        this.fetchRealPrice(symbol).then(newData => {
          if (newData) {
            this.cache.set(cacheKey, {
              data: newData,
              timestamp: Date.now()
            });
          }
        }).catch(() => {});
        
        return staleData;
      }
    }

    try {
      const priceData = await this.fetchRealPrice(symbol);
      
      if (priceData) {
        this.cache.set(cacheKey, {
          data: priceData,
          timestamp: Date.now()
        });
        
        logger.info({ symbol, price: priceData.priceUSD }, 'Successfully fetched real price data');
        return priceData;
      }
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to fetch real price data');
    }

    return null;
  }

  async getMultiplePrices(symbols: string[]): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();
    const symbolsToFetch: string[] = [];
    
    // Check cache first for each symbol
    for (const symbol of symbols) {
      const cacheKey = `price_${symbol.toUpperCase()}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        const cacheAge = Date.now() - cached.timestamp;
        if (cacheAge < this.CACHE_TTL) {
          // Use fresh cached data
          const cachedData = { ...cached.data };
          cachedData.dataSource = 'cached_recent';
          results.set(symbol, cachedData);
        } else {
          // Use stale cached data but add to fetch list
          const staleData = { ...cached.data };
          staleData.dataSource = 'cached_stale';
          staleData.isStale = true;
          results.set(symbol, staleData);
          symbolsToFetch.push(symbol);
        }
      } else {
        // No cache, need to fetch
        symbolsToFetch.push(symbol);
      }
    }
    
    // Fetch fresh data for symbols not in cache or with stale cache
    if (symbolsToFetch.length > 0) {
      const batchSize = 10;
      for (let i = 0; i < symbolsToFetch.length; i += batchSize) {
        const batch = symbolsToFetch.slice(i, i + batchSize);
        const batchResults = await this.fetchMultiplePrices(batch);
        
        for (const [symbol, priceData] of batchResults) {
          if (priceData) {
            // Cache the new data
            const cacheKey = `price_${symbol.toUpperCase()}`;
            this.cache.set(cacheKey, {
              data: priceData,
              timestamp: Date.now()
            });
            // Update results with fresh data
            results.set(symbol, priceData);
          }
        }
        
        // Small delay between batches
        if (i + batchSize < symbolsToFetch.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
    
    return results;
  }

  private async fetchRealPrice(symbol: string): Promise<PriceData | null> {
    const coinId = this.COINGECKO_IDS[symbol.toUpperCase()];
    if (!coinId) {
      logger.warn({ symbol }, 'No CoinGecko ID found for symbol');
      return this.getFallbackPrice(symbol);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);

      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'BSC-Trading-Bot/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.warn({ status: response.status, statusText: response.statusText, symbol }, 'CoinGecko API response error');
        monitoringService.recordServiceHealth('price-service', false, { type: 'api_error', status: response.status });
        return this.getFallbackPrice(symbol);
      }

      const data: CoinGeckoResponse = await response.json();
      const coinData = data[coinId];

      if (coinData && coinData.usd) {
        monitoringService.recordServiceHealth('price-service', true);
        return {
          symbol: symbol.toUpperCase(),
          priceUSD: coinData.usd || 0,
          priceChange24h: coinData.usd_24h_change || 0,
          volume24hUSD: coinData.usd_24h_vol || 0,
          lastUpdated: new Date(),
          dataSource: 'coingecko_live'
        };
      }

      logger.debug({ symbol, coinId }, 'No price data returned from CoinGecko');
      return this.getFallbackPrice(symbol);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.warn({ symbol }, 'CoinGecko API request timed out');
        monitoringService.recordServiceHealth('price-service', false, { type: 'timeout', symbol });
      } else {
        logger.debug({ error: error.message, symbol }, 'CoinGecko API request failed');
        monitoringService.recordServiceHealth('price-service', false, { type: 'api_failure', error: error.message });
      }
      return this.getFallbackPrice(symbol);
    }
  }

  private async fetchMultiplePrices(symbols: string[]): Promise<Map<string, PriceData | null>> {
    const results = new Map<string, PriceData | null>();
    
    // Map symbols to coin IDs
    const coinIds: string[] = [];
    const symbolToCoinId = new Map<string, string>();
    
    for (const symbol of symbols) {
      const coinId = this.COINGECKO_IDS[symbol.toUpperCase()];
      if (coinId) {
        coinIds.push(coinId);
        symbolToCoinId.set(coinId, symbol.toUpperCase());
      } else {
        results.set(symbol, null);
      }
    }

    if (coinIds.length === 0) {
      return results;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);

      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'BSC-Trading-Bot/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: CoinGeckoResponse = await response.json();

      for (const [coinId, coinData] of Object.entries(data)) {
        const symbol = symbolToCoinId.get(coinId);
        if (symbol) {
          results.set(symbol, {
            symbol,
            priceUSD: coinData.usd || 0,
            priceChange24h: coinData.usd_24h_change || 0,
            volume24hUSD: coinData.usd_24h_vol || 0,
            lastUpdated: new Date(),
            dataSource: 'coingecko_live'
          });
        }
      }

      logger.info({ count: Object.keys(data).length }, 'Successfully fetched batch price data');
      return results;
    } catch (error: any) {
      logger.warn({ error: error.message, symbols }, 'Batch price fetch failed, trying fallbacks');
      
      // Try to get fallback prices for failed symbols
      for (const symbol of symbols) {
        if (!results.has(symbol) || results.get(symbol) === null) {
          const fallbackPrice = this.getFallbackPrice(symbol);
          results.set(symbol, fallbackPrice);
        }
      }
      
      return results;
    }
  }

  // Get historical price for calculating changes
  async getHistoricalPrice(symbol: string, daysBack: number = 1): Promise<number | null> {
    const coinId = this.COINGECKO_IDS[symbol.toUpperCase()];
    if (!coinId) {
      return null;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT * 2);

      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${this.getDateString(daysBack)}&localization=false`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'BSC-Trading-Bot/1.0'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data.market_data?.current_price?.usd || null;
    } catch (error) {
      logger.debug({ error, symbol, daysBack }, 'Historical price fetch failed');
      return null;
    }
  }

  private getDateString(daysBack: number): string {
    const date = new Date();
    date.setDate(date.getDate() - daysBack);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
    logger.info('Price service cache cleared');
  }

  // Get cache stats
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  // Get fallback price for when API fails
  private getFallbackPrice(symbol: string): PriceData | null {
    const fallbackPrices: Record<string, number> = {
      'BNB': 300.00,
      'BUSD': 1.00,
      'USDT': 1.00,
      'USDC': 1.00,
      'CAKE': 2.50,
      'WBNB': 300.00,
      'ETH': 2400.00,
      'BTC': 43000.00
    };

    const price = fallbackPrices[symbol.toUpperCase()];
    if (price) {
      logger.warn({ symbol, price }, 'Using fallback price - API unavailable');
      monitoringService.recordFallbackUsage('price-service', `No real data for ${symbol}, using fallback`);
      return {
        symbol: symbol.toUpperCase(),
        priceUSD: price,
        priceChange24h: 0,
        volume24hUSD: 0,
        lastUpdated: new Date(),
        isStale: true,
        dataSource: 'fallback_static'
      };
    }

    return null;
  }
}

export const priceService = PriceService.getInstance();
export type { PriceData };