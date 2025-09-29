import { ethers } from 'ethers';
import { rpcManager } from '../blockchain/rpc';
import { configManager } from '../config';
import { logger } from '../utils/logger';

export interface TokenBalance {
  token: string;
  symbol: string;
  decimals: number;
  balance: string;
  valueUSD: string;
}

export interface WalletData {
  address: string;
  balance: string; // BNB balance in ether
  nonce: number;
  tokenBalances: TokenBalance[];
  transactions24h: number;
  lastActivity: string;
}

// ERC20 ABI for balanceOf function
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

// Common BSC tokens
const COMMON_TOKENS = [
  { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT' },
  { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD' },
  { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC' },
  { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE' },
  { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB' }
];

export class WalletService {
  private static instance: WalletService;
  private balanceCache: Map<string, { data: WalletData; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds
  
  private constructor() {}

  public static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  async getWalletData(address: string): Promise<WalletData> {
    // Check cache first
    const cached = this.balanceCache.get(address);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const provider = rpcManager.getProvider();
      
      // Get BNB balance
      const balance = await provider.getBalance(address);
      const balanceEther = ethers.formatEther(balance);
      
      // Get transaction count (nonce)
      const nonce = await provider.getTransactionCount(address);
      
      // Get token balances
      const tokenBalances = await this.getTokenBalances(address, provider);
      
      // Get recent transaction activity
      const { lastActivity, transactions24h } = await this.getTransactionActivity(address, provider);
      
      const walletData: WalletData = {
        address,
        balance: balanceEther,
        nonce,
        tokenBalances,
        transactions24h,
        lastActivity
      };

      // Cache the result
      this.balanceCache.set(address, {
        data: walletData,
        timestamp: Date.now()
      });

      return walletData;
      
    } catch (error) {
      logger.error({ error, address }, 'Failed to get wallet data');
      
      // Return fallback data with zeros instead of random numbers
      return {
        address,
        balance: '0',
        nonce: 0,
        tokenBalances: [],
        transactions24h: 0,
        lastActivity: new Date().toISOString()
      };
    }
  }

  private async getTokenBalances(address: string, provider: ethers.JsonRpcProvider): Promise<TokenBalance[]> {
    const tokenBalances: TokenBalance[] = [];

    for (const token of COMMON_TOKENS) {
      try {
        const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
        
        const [balance, decimals] = await Promise.all([
          contract.balanceOf(address),
          contract.decimals()
        ]);

        if (balance > BigInt(0)) {
          const balanceFormatted = ethers.formatUnits(balance, decimals);
          
          // Simple USD value calculation (would need price oracle in production)
          const valueUSD = this.estimateUSDValue(token.symbol, balanceFormatted);

          tokenBalances.push({
            token: token.address,
            symbol: token.symbol,
            decimals,
            balance: balanceFormatted,
            valueUSD
          });
        }
      } catch (error) {
        // Skip tokens that fail to load
        logger.debug({ error, token: token.symbol, address }, 'Failed to load token balance');
      }
    }

    return tokenBalances;
  }

  private async getTransactionActivity(address: string, provider: ethers.JsonRpcProvider): Promise<{ lastActivity: string; transactions24h: number }> {
    try {
      // Get current block number
      const currentBlock = await provider.getBlockNumber();
      
      // Calculate block range for last 24 hours (BSC has ~3 second block time, so ~28,800 blocks per day)
      const blocksIn24h = Math.floor(24 * 60 * 60 / 3); // ~28,800 blocks
      const fromBlock = Math.max(0, currentBlock - blocksIn24h);
      
      // Query actual transaction history using Transfer events and direct transactions
      const [incomingTransfers, outgoingTransfers, directTransactions] = await Promise.allSettled([
        // ERC20 Transfer events TO this address
        provider.getLogs({
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer(address,address,uint256)
            null, // from (any)
            ethers.zeroPadValue(address, 32) // to (this address)
          ],
          fromBlock,
          toBlock: 'latest'
        }),
        // ERC20 Transfer events FROM this address  
        provider.getLogs({
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer(address,address,uint256)
            ethers.zeroPadValue(address, 32), // from (this address)
            null // to (any)
          ],
          fromBlock,
          toBlock: 'latest'
        }),
        // Get nonce difference for direct transactions sent by this address
        provider.getTransactionCount(address, 'latest').then(async (currentNonce) => {
          const pastNonce = await provider.getTransactionCount(address, fromBlock);
          return Math.max(0, currentNonce - pastNonce);
        })
      ]);

      // Count successful results
      let totalTransactions = 0;
      let latestBlockNumber = 0;

      if (incomingTransfers.status === 'fulfilled') {
        totalTransactions += incomingTransfers.value.length;
        incomingTransfers.value.forEach(log => {
          latestBlockNumber = Math.max(latestBlockNumber, log.blockNumber);
        });
      }

      if (outgoingTransfers.status === 'fulfilled') {
        totalTransactions += outgoingTransfers.value.length;
        outgoingTransfers.value.forEach(log => {
          latestBlockNumber = Math.max(latestBlockNumber, log.blockNumber);
        });
      }

      if (directTransactions.status === 'fulfilled') {
        totalTransactions += directTransactions.value;
      }

      // Get actual timestamp of latest activity
      let lastActivity: string;
      if (latestBlockNumber > 0) {
        try {
          const latestBlock = await provider.getBlock(latestBlockNumber);
          lastActivity = new Date((latestBlock?.timestamp || 0) * 1000).toISOString();
        } catch {
          // Fallback if block lookup fails
          lastActivity = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
        }
      } else {
        // No recent activity found
        lastActivity = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ago
      }
      
      return { 
        lastActivity, 
        transactions24h: totalTransactions
      };
    } catch (error) {
      logger.debug({ error, address }, 'Failed to get transaction activity, using defaults');
      // Fallback to defaults if blockchain query fails
      return {
        lastActivity: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        transactions24h: 0
      };
    }
  }

  private estimateUSDValue(symbol: string, balance: string): string {
    // Simplified price estimation (would use real price oracle in production)
    const prices: Record<string, number> = {
      'USDT': 1.0,
      'BUSD': 1.0,
      'USDC': 1.0,
      'WBNB': 300, // Approximate BNB price
      'CAKE': 2.5
    };

    const price = prices[symbol] || 0;
    const value = parseFloat(balance) * price;
    return value.toFixed(2);
  }

  // Clear cache for specific address
  clearCache(address?: string): void {
    if (address) {
      this.balanceCache.delete(address);
    } else {
      this.balanceCache.clear();
    }
  }

  // Get cache stats
  getCacheStats(): { size: number; addresses: string[] } {
    return {
      size: this.balanceCache.size,
      addresses: Array.from(this.balanceCache.keys())
    };
  }
}

export const walletService = WalletService.getInstance();