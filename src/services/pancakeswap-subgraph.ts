import { logger } from '../utils/logger';

/**
 * PancakeSwap Subgraph Integration Service
 * Fetches real-time DEX data including trading volume, liquidity, and pair info
 */

const PANCAKESWAP_V2_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v2';
const PANCAKESWAP_V3_SUBGRAPH = 'https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3';

export interface PairData {
  id: string;
  token0: {
    id: string;
    symbol: string;
    name: string;
  };
  token1: {
    id: string;
    symbol: string;
    name: string;
  };
  reserve0: string;
  reserve1: string;
  reserveUSD: string;
  volumeUSD: string;
  txCount: string;
}

export interface TokenDayData {
  date: number;
  dailyVolumeUSD: string;
  totalLiquidityUSD: string;
  priceUSD: string;
}

export class PancakeSwapSubgraphService {
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheDuration = 60 * 1000; // 1 minute cache

  /**
   * Query PancakeSwap V2 Subgraph
   */
  private async querySubgraph(query: string, useV3 = false): Promise<any> {
    const endpoint = useV3 ? PANCAKESWAP_V3_SUBGRAPH : PANCAKESWAP_V2_SUBGRAPH;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error(`Subgraph query failed: ${response.status}`);
      }

      const result = await response.json();

      if (result.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
      }

      return result.data;
    } catch (error) {
      logger.error({ error, endpoint }, 'Failed to query PancakeSwap subgraph');
      throw error;
    }
  }

  /**
   * Get pair data by token addresses
   */
  async getPairData(token0Address: string, token1Address: string): Promise<PairData | null> {
    const cacheKey = `pair_${token0Address}_${token1Address}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    const query = `
      {
        pairs(
          where: {
            token0: "${token0Address.toLowerCase()}"
            token1: "${token1Address.toLowerCase()}"
          }
          orderBy: reserveUSD
          orderDirection: desc
          first: 1
        ) {
          id
          token0 {
            id
            symbol
            name
          }
          token1 {
            id
            symbol
            name
          }
          reserve0
          reserve1
          reserveUSD
          volumeUSD
          txCount
        }
      }
    `;

    try {
      const data = await this.querySubgraph(query);
      const pairData = data.pairs?.[0] || null;

      if (pairData) {
        this.cache.set(cacheKey, { data: pairData, timestamp: Date.now() });
      }

      return pairData;
    } catch (error) {
      logger.error({ error, token0Address, token1Address }, 'Failed to fetch pair data');
      return null;
    }
  }

  /**
   * Get top pairs by liquidity
   */
  async getTopPairs(limit = 10): Promise<PairData[]> {
    const cacheKey = `top_pairs_${limit}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    const query = `
      {
        pairs(
          first: ${limit}
          orderBy: reserveUSD
          orderDirection: desc
        ) {
          id
          token0 {
            id
            symbol
            name
          }
          token1 {
            id
            symbol
            name
          }
          reserve0
          reserve1
          reserveUSD
          volumeUSD
          txCount
        }
      }
    `;

    try {
      const data = await this.querySubgraph(query);
      const pairs = data.pairs || [];

      this.cache.set(cacheKey, { data: pairs, timestamp: Date.now() });

      logger.info({ count: pairs.length }, 'Fetched top pairs from subgraph');
      return pairs;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch top pairs');
      return [];
    }
  }

  /**
   * Get token day data (historical data)
   */
  async getTokenDayData(tokenAddress: string, days = 7): Promise<TokenDayData[]> {
    const cacheKey = `token_day_${tokenAddress}_${days}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }

    const timestampFrom = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

    const query = `
      {
        tokenDayDatas(
          where: {
            token: "${tokenAddress.toLowerCase()}"
            date_gte: ${timestampFrom}
          }
          orderBy: date
          orderDirection: desc
          first: ${days}
        ) {
          date
          dailyVolumeUSD
          totalLiquidityUSD
          priceUSD
        }
      }
    `;

    try {
      const data = await this.querySubgraph(query);
      const dayData = data.tokenDayDatas || [];

      this.cache.set(cacheKey, { data: dayData, timestamp: Date.now() });

      return dayData;
    } catch (error) {
      logger.error({ error, tokenAddress }, 'Failed to fetch token day data');
      return [];
    }
  }

  /**
   * Get real-time pair statistics for common trading pairs
   */
  async getCommonPairsStats(): Promise<Array<{
    symbol: string;
    address: string;
    price: number;
    volume_24h: number;
    liquidity: number;
  }>> {
    // Common BSC token addresses
    const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
    const USDT = '0x55d398326f99059fF775485246999027B3197955';
    const BUSD = '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56';
    const CAKE = '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82';

    try {
      // Query multiple pairs at once
      const query = `
        {
          pairs(
            where: {
              id_in: [
                "0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae"
                "0x0ed7e52944161450477ee417de9cd3a859b14fd0"
                "0x58f876857a02d6762e0101bb5c46a8c1ed44dc16"
              ]
            }
          ) {
            id
            token0 {
              id
              symbol
            }
            token1 {
              id
              symbol
            }
            reserve0
            reserve1
            reserveUSD
            volumeUSD
            txCount
          }
        }
      `;

      const data = await this.querySubgraph(query);
      const pairs = data.pairs || [];

      const results = pairs.map((pair: any) => {
        const symbol = `${pair.token0.symbol}/${pair.token1.symbol}`;
        const reserveUSD = parseFloat(pair.reserveUSD || '0');
        const volumeUSD = parseFloat(pair.volumeUSD || '0');

        // Calculate price from reserves
        const reserve0 = parseFloat(pair.reserve0 || '0');
        const reserve1 = parseFloat(pair.reserve1 || '0');
        const price = reserve1 > 0 ? reserve0 / reserve1 : 0;

        return {
          symbol,
          address: pair.id,
          price,
          volume_24h: volumeUSD,
          liquidity: reserveUSD,
        };
      });

      logger.info({ count: results.length }, 'Fetched common pairs stats from subgraph');
      return results;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch common pairs stats');
      return [];
    }
  }

  /**
   * Get 24h volume for a specific pair
   */
  async getPair24hVolume(pairAddress: string): Promise<number> {
    const query = `
      {
        pair(id: "${pairAddress.toLowerCase()}") {
          volumeUSD
        }
      }
    `;

    try {
      const data = await this.querySubgraph(query);
      const volumeUSD = parseFloat(data.pair?.volumeUSD || '0');
      return volumeUSD;
    } catch (error) {
      logger.error({ error, pairAddress }, 'Failed to fetch pair 24h volume');
      return 0;
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Subgraph cache cleared');
  }
}

// Export singleton instance
export const pancakeSwapSubgraph = new PancakeSwapSubgraphService();
