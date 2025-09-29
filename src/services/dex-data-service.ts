import { logger } from '../utils/logger';

interface DEXTokenData {
  address: string;
  symbol: string;
  priceUSD: number;
  volume24hUSD: number;
  priceChange24h: number;
  lastUpdated: number;
}

interface PairData {
  pairAddress: string;
  token0: string;
  token1: string;
  priceUSD: number;
  volume24hUSD: number;
  liquidity: number;
}

export class DEXDataService {
  private static instance: DEXDataService;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute cache
  private readonly REQUEST_TIMEOUT = 10000; // 10 seconds
  private readonly MAX_RETRIES = 2;
  private rateLimitMap: Map<string, { count: number; resetTime: number }> = new Map();
  
  // PancakeSwap V2 Factory and common token addresses
  private readonly PANCAKE_V2_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
  private readonly TOKEN_ADDRESSES = {
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
  };

  private readonly FALLBACK_DATA = {
    BNB: { priceUSD: 300, volume24hUSD: 1250000, priceChange24h: 0 },
    BUSD: { priceUSD: 1.0, volume24hUSD: 85000000, priceChange24h: 0 },
    USDT: { priceUSD: 1.0, volume24hUSD: 120000000, priceChange24h: 0 },
    CAKE: { priceUSD: 2.5, volume24hUSD: 25000000, priceChange24h: 0 },
    USDC: { priceUSD: 1.0, volume24hUSD: 45000000, priceChange24h: 0 }
  };

  private constructor() {}

  public static getInstance(): DEXDataService {
    if (!DEXDataService.instance) {
      DEXDataService.instance = new DEXDataService();
    }
    return DEXDataService.instance;
  }

  private checkRateLimit(endpoint: string): boolean {
    const now = Date.now();
    const limit = this.rateLimitMap.get(endpoint);
    
    if (!limit || now > limit.resetTime) {
      this.rateLimitMap.set(endpoint, { count: 1, resetTime: now + 60000 }); // 1 minute window
      return true;
    }
    
    if (limit.count >= 30) { // Max 30 requests per minute
      logger.warn(`Rate limit exceeded for endpoint: ${endpoint}`);
      return false;
    }
    
    limit.count++;
    return true;
  }

  private async safeHttpRequest(url: string, retries = this.MAX_RETRIES): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);
    
    try {
      if (!this.checkRateLimit(new URL(url).hostname)) {
        throw new Error('Rate limit exceeded');
      }
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'BSC-Trading-Bot/1.0',
          'Accept': 'application/json',
        },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('API rate limit exceeded');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (retries > 0 && (error instanceof Error && error.name === 'AbortError')) {
        logger.warn(`Request timeout, retrying... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.safeHttpRequest(url, retries - 1);
      }
      
      throw error;
    }
  }

  async getTokenVolume(symbol: string): Promise<string> {
    const cacheKey = `volume_${symbol}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      // Try to get real data from DEX APIs
      const volume = await this.fetchRealTokenVolume(symbol);
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: volume,
        timestamp: Date.now()
      });
      
      return volume;
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to fetch token volume');
      
      // Use fallback data
      const fallback = this.FALLBACK_DATA[symbol as keyof typeof this.FALLBACK_DATA];
      return fallback?.volume24hUSD.toFixed(0) || '10000000';
    }
  }

  async getPriceChange24h(symbol: string): Promise<string> {
    const cacheKey = `price_change_${symbol}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      // Try to get real price change from CoinGecko or DEX APIs
      const priceChange = await this.fetchRealPriceChange(symbol);
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: priceChange,
        timestamp: Date.now()
      });
      
      return priceChange;
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to fetch price change');
      
      // Use fallback data
      const fallback = this.FALLBACK_DATA[symbol as keyof typeof this.FALLBACK_DATA];
      return fallback?.priceChange24h.toFixed(2) || '0.00';
    }
  }

  async getDEXVolume(): Promise<string> {
    const cacheKey = 'dex_volume';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      // Try to get real DEX volume
      const volume = await this.fetchRealDEXVolume();
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: volume,
        timestamp: Date.now()
      });
      
      return volume;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch DEX volume');
      return '1250000'; // Fallback volume
    }
  }

  private async fetchRealTokenVolume(symbol: string): Promise<string> {
    try {
      // Method 1: Try CoinGecko API for volume data
      const coinGeckoIds: Record<string, string> = {
        'BNB': 'binancecoin',
        'CAKE': 'pancakeswap-token',
        'BUSD': 'binance-usd',
        'USDT': 'tether',
        'USDC': 'usd-coin'
      };

      const coinId = coinGeckoIds[symbol];
      if (coinId) {
        const response = await this.safeHttpRequest(
          `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`
        );
        
        const data = await response.json();
        const volume24h = data.market_data?.total_volume?.usd;
        if (volume24h) {
          return Math.round(volume24h).toString();
        }
      }

      // Method 2: Try PancakeSwap Subgraph
      const subgraphData = await this.queryPancakeSwapSubgraph(symbol);
      if (subgraphData?.volume24hUSD) {
        return Math.round(subgraphData.volume24hUSD).toString();
      }

      throw new Error('No real data source available');
    } catch (error) {
      logger.debug({ error, symbol }, 'Real volume fetch failed, using fallback');
      throw error;
    }
  }

  private async fetchRealPriceChange(symbol: string): Promise<string> {
    try {
      // Method 1: Try CoinGecko API for price change
      const coinGeckoIds: Record<string, string> = {
        'BNB': 'binancecoin',
        'CAKE': 'pancakeswap-token',
        'BUSD': 'binance-usd',
        'USDT': 'tether',
        'USDC': 'usd-coin'
      };

      const coinId = coinGeckoIds[symbol];
      if (coinId) {
        const response = await this.safeHttpRequest(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`
        );
        
        const data = await response.json();
        const change24h = data[coinId]?.usd_24h_change;
        if (typeof change24h === 'number') {
          return change24h.toFixed(2);
        }
      }

      // Method 2: Calculate from historical DEX data
      const historicalData = await this.getHistoricalPrice(symbol);
      if (historicalData?.priceChange) {
        return historicalData.priceChange.toFixed(2);
      }

      throw new Error('No real price change data available');
    } catch (error) {
      logger.debug({ error, symbol }, 'Real price change fetch failed, using fallback');
      throw error;
    }
  }

  private async fetchRealDEXVolume(): Promise<string> {
    try {
      // Method 1: Query PancakeSwap total volume
      const pancakeData = await this.queryPancakeSwapGlobalData();
      if (pancakeData?.totalVolume24hUSD) {
        return Math.round(pancakeData.totalVolume24hUSD).toString();
      }

      // Method 2: Try aggregating top pairs
      const topPairsVolume = await this.aggregateTopPairsVolume();
      if (topPairsVolume) {
        return Math.round(topPairsVolume).toString();
      }

      throw new Error('No real DEX volume data available');
    } catch (error) {
      logger.debug({ error }, 'Real DEX volume fetch failed, using fallback');
      throw error;
    }
  }

  private async queryPancakeSwapSubgraph(symbol: string): Promise<any> {
    try {
      // PancakeSwap V3 Subgraph endpoint
      const subgraphUrl = 'https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-bsc';
      
      // Map token symbols to addresses for queries
      const tokenAddresses: Record<string, string> = {
        'BNB': this.TOKEN_ADDRESSES.WBNB,
        'WBNB': this.TOKEN_ADDRESSES.WBNB,
        'BUSD': this.TOKEN_ADDRESSES.BUSD,
        'USDT': this.TOKEN_ADDRESSES.USDT,
        'CAKE': this.TOKEN_ADDRESSES.CAKE,
        'USDC': this.TOKEN_ADDRESSES.USDC
      };

      const tokenAddress = tokenAddresses[symbol];
      if (!tokenAddress) {
        logger.debug({ symbol }, 'Token address not found for symbol');
        return null;
      }

      // GraphQL query to get token volume
      const query = `{
        token(id: "${tokenAddress.toLowerCase()}") {
          id
          symbol
          name
          volumeUSD
          txCount
          totalValueLocked
          tokenDayData(first: 1, orderBy: date, orderDirection: desc) {
            date
            volumeUSD
            priceUSD
          }
        }
      }`;

      // Make POST request for GraphQL
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);
      
      try {
        const response = await fetch(subgraphUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.data?.token) {
          const tokenData = data.data.token;
          const dayData = tokenData.tokenDayData?.[0];
          
          return {
            symbol: tokenData.symbol,
            volume24hUSD: dayData?.volumeUSD ? parseFloat(dayData.volumeUSD) : null,
            priceUSD: dayData?.priceUSD ? parseFloat(dayData.priceUSD) : null,
            tvl: tokenData.totalValueLocked ? parseFloat(tokenData.totalValueLocked) : null
          };
        }
        
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      logger.debug({ error, symbol }, 'PancakeSwap subgraph query failed');
      return null;
    }
  }

  private async queryPancakeSwapGlobalData(): Promise<any> {
    try {
      // PancakeSwap V3 Subgraph endpoint
      const subgraphUrl = 'https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-bsc';
      
      // GraphQL query to get global DEX statistics
      const query = `{
        pancakeFactories(first: 1) {
          id
          totalVolumeUSD
          totalValueLockedUSD
          txCount
          pairCount
        }
        pancakeDayDatas(first: 1, orderBy: date, orderDirection: desc) {
          date
          dailyVolumeUSD
          totalVolumeUSD
          totalLiquidityUSD
        }
      }`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.REQUEST_TIMEOUT);
      
      try {
        const response = await fetch(subgraphUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.data?.pancakeFactories?.[0] && data.data?.pancakeDayDatas?.[0]) {
          const factory = data.data.pancakeFactories[0];
          const dayData = data.data.pancakeDayDatas[0];
          
          return {
            totalVolume24hUSD: dayData.dailyVolumeUSD ? parseFloat(dayData.dailyVolumeUSD) : null,
            totalVolumeUSD: factory.totalVolumeUSD ? parseFloat(factory.totalVolumeUSD) : null,
            totalValueLockedUSD: factory.totalValueLockedUSD ? parseFloat(factory.totalValueLockedUSD) : null,
            pairCount: factory.pairCount ? parseInt(factory.pairCount) : null,
            txCount: factory.txCount ? parseInt(factory.txCount) : null
          };
        }
        
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      logger.debug({ error }, 'PancakeSwap global data query failed');
      return null;
    }
  }

  private async getHistoricalPrice(symbol: string): Promise<any> {
    try {
      // This would fetch historical price data to calculate change
      // For now, return null to use fallback data
      return null;
    } catch (error) {
      logger.debug({ error, symbol }, 'Historical price fetch failed');
      return null;
    }
  }

  private async aggregateTopPairsVolume(): Promise<number | null> {
    try {
      // This would aggregate volume from top trading pairs
      // For now, return null to use fallback data
      return null;
    } catch (error) {
      logger.debug({ error }, 'Top pairs volume aggregation failed');
      return null;
    }
  }

  // Clear cache manually if needed
  clearCache(): void {
    this.cache.clear();
    logger.info('DEX data cache cleared');
  }

  // Get cache statistics
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

export const dexDataService = DEXDataService.getInstance();