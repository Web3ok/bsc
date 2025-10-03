import { logger } from '../utils/logger';

/**
 * DexScreener API Integration
 * Free, reliable DEX data source for real-time volume and liquidity
 * No API key required
 */

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

export interface DexPairData {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  pairCreatedAt: number;
}

export class DexScreenerService {
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheDuration = 60 * 1000; // 1 minute cache

  /**
   * Get pair data by pair address
   */
  async getPairByAddress(pairAddress: string): Promise<DexPairData | null> {
    const cacheKey = `pair_${pairAddress}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    try {
      const response = await fetch(`${DEXSCREENER_API}/pairs/bsc/${pairAddress}`);

      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status}`);
      }

      const result = await response.json();
      const pairData = result.pair || null;

      if (pairData) {
        this.cache.set(cacheKey, { data: pairData, timestamp: Date.now() });
        logger.debug({ pairAddress }, 'Fetched pair data from DexScreener');
      }

      return pairData;
    } catch (error) {
      logger.error({ error, pairAddress }, 'Failed to fetch pair from DexScreener');
      return null;
    }
  }

  /**
   * Get multiple pairs data by addresses
   */
  async getPairsByAddresses(pairAddresses: string[]): Promise<DexPairData[]> {
    try {
      // DexScreener supports batch queries with comma-separated addresses
      const addresses = pairAddresses.join(',');
      const response = await fetch(`${DEXSCREENER_API}/pairs/bsc/${addresses}`);

      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status}`);
      }

      const result = await response.json();
      const pairs = result.pairs || [];

      logger.info({ count: pairs.length }, 'Fetched pairs data from DexScreener');
      return pairs;
    } catch (error) {
      logger.error({ error, pairAddresses }, 'Failed to fetch pairs from DexScreener');
      return [];
    }
  }

  /**
   * Search for pairs by token address
   */
  async searchByToken(tokenAddress: string): Promise<DexPairData[]> {
    const cacheKey = `token_${tokenAddress}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    try {
      const response = await fetch(`${DEXSCREENER_API}/tokens/${tokenAddress}`);

      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status}`);
      }

      const result = await response.json();
      const pairs = result.pairs || [];

      // Filter for BSC pairs only
      const bscPairs = pairs.filter((pair: DexPairData) => pair.chainId === 'bsc');

      this.cache.set(cacheKey, { data: bscPairs, timestamp: Date.now() });

      logger.info({ tokenAddress, count: bscPairs.length }, 'Fetched token pairs from DexScreener');
      return bscPairs;
    } catch (error) {
      logger.error({ error, tokenAddress }, 'Failed to search token on DexScreener');
      return [];
    }
  }

  /**
   * Get common BNB/CAKE trading pairs with real data
   */
  async getCommonPairsData(): Promise<Array<{
    symbol: string;
    address: string;
    price: number;
    volume_24h: number;
    liquidity: number;
  }>> {
    // Known PancakeSwap V2 pair addresses
    const pairAddresses = [
      '0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae', // WBNB/USDT
      '0x0eD7e52944161450477ee417DE9Cd3a859b14fD0', // CAKE/USDT
      '0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16', // WBNB/BUSD
    ];

    try {
      const pairs = await this.getPairsByAddresses(pairAddresses);

      if (pairs.length === 0) {
        logger.warn('No pairs data returned from DexScreener');
        return [];
      }

      const results = pairs.map((pair) => {
        // Determine which token is the base (non-stablecoin)
        const isBaseToken0 = !['USDT', 'BUSD', 'USDC'].includes(pair.baseToken.symbol);
        const baseSymbol = isBaseToken0 ? pair.baseToken.symbol : pair.quoteToken.symbol;
        const quoteSymbol = isBaseToken0 ? pair.quoteToken.symbol : pair.baseToken.symbol;

        return {
          symbol: `${baseSymbol}/${quoteSymbol}`,
          address: pair.pairAddress,
          price: parseFloat(pair.priceUsd) || 0,
          volume_24h: pair.volume?.h24 || 0,
          liquidity: pair.liquidity?.usd || 0,
        };
      });

      logger.info({ count: results.length }, 'Processed common pairs from DexScreener');
      return results;
    } catch (error) {
      logger.error({ error }, 'Failed to get common pairs from DexScreener');
      return [];
    }
  }

  /**
   * Get top trending pairs on BSC
   */
  async getTrendingPairs(limit = 10): Promise<DexPairData[]> {
    const cacheKey = `trending_${limit}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    try {
      // DexScreener doesn't have a direct trending endpoint, but we can search popular tokens
      const popularTokens = [
        '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // CAKE
      ];

      const allPairs: DexPairData[] = [];

      for (const token of popularTokens) {
        const pairs = await this.searchByToken(token);
        allPairs.push(...pairs);
      }

      // Sort by 24h volume descending
      const sorted = allPairs
        .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
        .slice(0, limit);

      this.cache.set(cacheKey, { data: sorted, timestamp: Date.now() });

      return sorted;
    } catch (error) {
      logger.error({ error }, 'Failed to get trending pairs from DexScreener');
      return [];
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('DexScreener cache cleared');
  }
}

// Export singleton instance
export const dexScreener = new DexScreenerService();
