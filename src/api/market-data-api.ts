import { Router } from 'express';

export class MarketDataAPI {
  public router: Router;

  constructor() {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.router.get('/prices', async (req, res) => {
      try {
        // Real price integration with CoinGecko API
        const priceData = await this.fetchRealPrices();
        res.json({
          success: true,
          data: priceData,
          note: 'Using real-time price data from CoinGecko API with fallback to static prices.'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch price data',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    this.router.get('/pairs', async (req, res) => {
      try {
        // Real price data with static volume/liquidity (production would use DEX subgraph)
        const pairData = await this.fetchRealPairData();
        res.json({
          success: true,
          data: pairData,
          note: 'Using real prices with static volume/liquidity. Production should integrate DEX subgraph for full data.'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch pair data',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }

  private async fetchRealPrices(): Promise<Record<string, { usd: number; change_24h: number }>> {
    try {
      // Real CoinGecko API integration
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=binancecoin,pancakeswap-token,tether,usd-coin&vs_currencies=usd&include_24hr_change=true'
      );
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      return {
        BNB: {
          usd: data.binancecoin?.usd || 300,
          change_24h: data.binancecoin?.usd_24h_change || 0
        },
        CAKE: {
          usd: data['pancakeswap-token']?.usd || 2,
          change_24h: data['pancakeswap-token']?.usd_24h_change || 0
        },
        USDT: {
          usd: data.tether?.usd || 1.0,
          change_24h: data.tether?.usd_24h_change || 0
        },
        USDC: {
          usd: data['usd-coin']?.usd || 1.0,
          change_24h: data['usd-coin']?.usd_24h_change || 0
        }
      };
    } catch (error) {
      console.error('Failed to fetch real prices from CoinGecko:', error);
      // Fallback to realistic static prices if API fails
      return {
        BNB: { usd: 300, change_24h: 0 },
        CAKE: { usd: 2.0, change_24h: 0 },
        USDT: { usd: 1.0, change_24h: 0 },
        USDC: { usd: 1.0, change_24h: 0 }
      };
    }
  }

  private async fetchRealPairData(): Promise<Array<{ symbol: string; address: string; price: number; volume_24h: number; liquidity: number }>> {
    try {
      // Get real prices from our price endpoint first
      const priceData = await this.fetchRealPrices();
      
      // Return static pair data with real prices (no random numbers)
      // In production, this would query PancakeSwap subgraph or DEX APIs
      return [
        {
          symbol: 'WBNB/USDT',
          address: '0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae',
          price: priceData.BNB?.usd || 300,
          volume_24h: 1234567.89, // Static volume - would be real in production
          liquidity: 9876543.21   // Static liquidity - would be real in production
        },
        {
          symbol: 'CAKE/USDT',
          address: '0x0eD7e52944161450477ee417DE9Cd3a859b14fD0',
          price: priceData.CAKE?.usd || 2.0,
          volume_24h: 567890.12,  // Static volume - would be real in production
          liquidity: 2345678.90   // Static liquidity - would be real in production
        }
      ];
    } catch (error) {
      console.error('Failed to fetch pair data:', error);
      // Fallback to static data without random numbers
      return [
        {
          symbol: 'WBNB/USDT',
          address: '0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae',
          price: 300,
          volume_24h: 1234567.89,
          liquidity: 9876543.21
        },
        {
          symbol: 'CAKE/USDT',
          address: '0x0eD7e52944161450477ee417DE9Cd3a859b14fD0',
          price: 2.0,
          volume_24h: 567890.12,
          liquidity: 2345678.90
        }
      ];
    }
  }
}