import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { configManager } from '../config';
import { priceService, PriceData } from './price-service';

interface TokenBalance {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  decimals: number;
  priceUSD?: number;
  valueUSD?: string;
}

interface WalletBalances {
  address: string;
  nativeBalance: string; // BNB balance
  nativeBalanceFormatted: string;
  totalValueUSD: string;
  tokens: TokenBalance[];
  lastUpdated: Date;
}

// ERC20 ABI for balance queries
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)'
];

export class WalletBalanceService {
  private static instance: WalletBalanceService;
  private provider: ethers.JsonRpcProvider;
  private cache: Map<string, { data: WalletBalances; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds cache for balance queries

  // Common BSC token addresses
  private readonly COMMON_TOKENS = {
    BUSD: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56',
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    CAKE: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
    WBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
  };

  private constructor() {
    const config = configManager.config;
    this.provider = new ethers.JsonRpcProvider(config.rpc.primary_urls[0]);
  }

  public static getInstance(): WalletBalanceService {
    if (!WalletBalanceService.instance) {
      WalletBalanceService.instance = new WalletBalanceService();
    }
    return WalletBalanceService.instance;
  }

  async getWalletBalances(address: string, includeTokens: string[] = []): Promise<WalletBalances> {
    const cacheKey = `${address}_${includeTokens.join(',')}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      // Get native BNB balance
      const nativeBalance = await this.provider.getBalance(address);
      const nativeBalanceFormatted = ethers.formatEther(nativeBalance);

      // Get token balances
      const tokenList = includeTokens.length > 0 ? includeTokens : Object.values(this.COMMON_TOKENS);
      const tokens = await this.getTokenBalances(address, tokenList);

      // Calculate total USD value using real price data
      let bnbPriceUSD = 0;
      const bnbPrice = await priceService.getPrice('BNB');
      if (bnbPrice) {
        bnbPriceUSD = bnbPrice.priceUSD;
      }

      const nativeValueUSD = parseFloat(nativeBalanceFormatted) * bnbPriceUSD;
      const tokensValueUSD = tokens.reduce((sum, token) => {
        return sum + (parseFloat(token.valueUSD || '0'));
      }, 0);

      const balances: WalletBalances = {
        address,
        nativeBalance: nativeBalance.toString(),
        nativeBalanceFormatted,
        totalValueUSD: (nativeValueUSD + tokensValueUSD).toFixed(2),
        tokens,
        lastUpdated: new Date()
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: balances,
        timestamp: Date.now()
      });

      logger.debug({ address, tokenCount: tokens.length }, 'Wallet balances retrieved');
      
      return balances;
    } catch (error) {
      logger.error({ error, address }, 'Failed to get wallet balances');
      throw new Error('Failed to retrieve wallet balances');
    }
  }

  private async getTokenBalances(walletAddress: string, tokenAddresses: string[]): Promise<TokenBalance[]> {
    const balances: TokenBalance[] = [];

    // Process tokens in batches to avoid overwhelming the RPC
    const batchSize = 5;
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      const batch = tokenAddresses.slice(i, i + batchSize);
      const batchPromises = batch.map(tokenAddress => 
        this.getTokenBalance(walletAddress, tokenAddress).catch(error => {
          logger.warn({ error, tokenAddress, walletAddress }, 'Failed to get token balance');
          return null;
        })
      );

      const batchResults = await Promise.all(batchPromises);
      const validResults = batchResults.filter((result): result is TokenBalance => result !== null);
      balances.push(...validResults);

      // Small delay between batches
      if (i + batchSize < tokenAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return balances;
  }

  private async getTokenBalance(walletAddress: string, tokenAddress: string): Promise<TokenBalance | null> {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);

      // Get token info and balance in parallel
      const [balance, symbol, name, decimals] = await Promise.all([
        contract.balanceOf(walletAddress),
        contract.symbol().catch(() => 'UNKNOWN'),
        contract.name().catch(() => 'Unknown Token'),
        contract.decimals().catch(() => 18)
      ]);

      const balanceFormatted = ethers.formatUnits(balance, decimals);

      // Skip tokens with zero balance
      if (balance === BigInt(0)) {
        return null;
      }

      // Get real price from price service
      const priceData = await priceService.getPrice(symbol);
      const priceUSD = priceData?.priceUSD || 0;
      const valueUSD = priceUSD ? (parseFloat(balanceFormatted) * priceUSD).toFixed(2) : '0.00';

      return {
        address: tokenAddress,
        symbol,
        name,
        balance: balance.toString(),
        balanceFormatted,
        decimals: Number(decimals),
        priceUSD,
        valueUSD
      };
    } catch (error) {
      logger.debug({ error, tokenAddress, walletAddress }, 'Token balance query failed');
      return null;
    }
  }


  async getNativeBalance(address: string): Promise<{ balance: string; balanceFormatted: string }> {
    try {
      const balance = await this.provider.getBalance(address);
      return {
        balance: balance.toString(),
        balanceFormatted: ethers.formatEther(balance)
      };
    } catch (error) {
      logger.error({ error, address }, 'Failed to get native balance');
      throw new Error('Failed to retrieve native balance');
    }
  }

  async getSingleTokenBalance(walletAddress: string, tokenAddress: string): Promise<TokenBalance | null> {
    const cacheKey = `token_${walletAddress}_${tokenAddress}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data.tokens.find(token => token.address === tokenAddress) || null;
    }

    return this.getTokenBalance(walletAddress, tokenAddress);
  }

  async getMultipleWalletBalances(addresses: string[]): Promise<Map<string, WalletBalances>> {
    const results = new Map<string, WalletBalances>();
    
    // Process wallets in parallel but limit concurrency
    const batchSize = 3;
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      const batchPromises = batch.map(async address => {
        try {
          const balances = await this.getWalletBalances(address);
          return { address, balances };
        } catch (error) {
          logger.warn({ error, address }, 'Failed to get wallet balance in batch');
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      for (const result of batchResults) {
        if (result) {
          results.set(result.address, result.balances);
        }
      }

      // Small delay between batches
      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return results;
  }

  clearCache(): void {
    this.cache.clear();
    logger.info('Wallet balance cache cleared');
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

export const walletBalanceService = WalletBalanceService.getInstance();