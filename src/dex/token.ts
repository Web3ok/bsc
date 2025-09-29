import { createPublicClient, http, formatUnits, parseUnits, isAddress } from 'viem';
import { bsc } from 'viem/chains';
import { configManager } from '../config';
import { logger } from '../utils/logger';
import { ERC20_ABI, TOKEN_ADDRESSES } from './constants';

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isNative?: boolean;
}

export interface TokenBalance {
  address: string;
  symbol: string;
  decimals: number;
  balance: bigint;
  balanceFormatted: string;
}

export class TokenService {
  private publicClient: any;
  private tokenCache = new Map<string, TokenInfo>();

  constructor() {
    const rpcUrls = configManager.rpcUrls;
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrls[0]),
    });

    // Pre-populate cache with known tokens
    this.prePopulateCache();
  }

  private prePopulateCache(): void {
    const knownTokens: TokenInfo[] = [
      {
        address: 'BNB',
        symbol: 'BNB',
        name: 'BNB',
        decimals: 18,
        isNative: true,
      },
      {
        address: TOKEN_ADDRESSES.WBNB,
        symbol: 'WBNB',
        name: 'Wrapped BNB',
        decimals: 18,
      },
      {
        address: TOKEN_ADDRESSES.USDT,
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 18,
      },
      {
        address: TOKEN_ADDRESSES.BUSD,
        symbol: 'BUSD',
        name: 'Binance USD',
        decimals: 18,
      },
      {
        address: TOKEN_ADDRESSES.USDC,
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 18,
      },
      {
        address: TOKEN_ADDRESSES.CAKE,
        symbol: 'CAKE',
        name: 'PancakeSwap Token',
        decimals: 18,
      },
    ];

    knownTokens.forEach(token => {
      this.tokenCache.set(token.address.toLowerCase(), token);
      if (token.symbol !== token.address) {
        this.tokenCache.set(token.symbol.toLowerCase(), token);
      }
    });

    logger.info(`Pre-populated token cache with ${knownTokens.length} known tokens`);
  }

  async getTokenInfo(tokenAddressOrSymbol: string): Promise<TokenInfo> {
    const key = tokenAddressOrSymbol.toLowerCase();
    
    // Check cache first
    const cached = this.tokenCache.get(key);
    if (cached) {
      return cached;
    }

    // Handle BNB native token
    if (key === 'bnb' || key === 'native') {
      return this.tokenCache.get('bnb')!;
    }

    // Validate address format
    if (!isAddress(tokenAddressOrSymbol)) {
      throw new Error(`Invalid token address or unknown symbol: ${tokenAddressOrSymbol}`);
    }

    try {
      // Fetch token info from contract
      const [symbol, name, decimals] = await Promise.all([
        this.publicClient.readContract({
          address: tokenAddressOrSymbol as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
        this.publicClient.readContract({
          address: tokenAddressOrSymbol as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'name',
        }),
        this.publicClient.readContract({
          address: tokenAddressOrSymbol as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'decimals',
        }),
      ]);

      const tokenInfo: TokenInfo = {
        address: tokenAddressOrSymbol.toLowerCase(),
        symbol: symbol as string,
        name: name as string,
        decimals: Number(decimals),
      };

      // Cache the result
      this.tokenCache.set(tokenInfo.address, tokenInfo);
      this.tokenCache.set(tokenInfo.symbol.toLowerCase(), tokenInfo);

      logger.info(`Fetched token info: ${tokenInfo.symbol} (${tokenInfo.address})`);
      return tokenInfo;

    } catch (error) {
      logger.error({ error, token: tokenAddressOrSymbol }, 'Failed to fetch token info');
      throw new Error(`Failed to fetch token info for ${tokenAddressOrSymbol}: ${error}`);
    }
  }

  async getTokenBalance(tokenAddressOrSymbol: string, walletAddress: string): Promise<TokenBalance> {
    const tokenInfo = await this.getTokenInfo(tokenAddressOrSymbol);
    let balance: bigint;

    if (tokenInfo.isNative) {
      // Get BNB balance
      balance = await this.publicClient.getBalance({
        address: walletAddress as `0x${string}`,
      });
    } else {
      // Get ERC20 token balance
      balance = await this.publicClient.readContract({
        address: tokenInfo.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [walletAddress as `0x${string}`],
      });
    }

    return {
      address: tokenInfo.address,
      symbol: tokenInfo.symbol,
      decimals: tokenInfo.decimals,
      balance,
      balanceFormatted: formatUnits(balance, tokenInfo.decimals),
    };
  }

  async getAllowance(
    tokenAddress: string, 
    ownerAddress: string, 
    spenderAddress: string
  ): Promise<bigint> {
    const tokenInfo = await this.getTokenInfo(tokenAddress);
    
    if (tokenInfo.isNative) {
      // Native BNB doesn't require allowance
      return BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    }

    try {
      const allowance = await this.publicClient.readContract({
        address: tokenInfo.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [ownerAddress as `0x${string}`, spenderAddress as `0x${string}`],
      });

      return allowance as bigint;
    } catch (error) {
      logger.error({ 
        error, 
        token: tokenAddress, 
        owner: ownerAddress, 
        spender: spenderAddress 
      }, 'Failed to get allowance');
      return BigInt(0);
    }
  }

  parseAmount(amount: string, tokenAddressOrSymbol: string): Promise<{ parsed: bigint, decimals: number }> {
    return this.getTokenInfo(tokenAddressOrSymbol).then(tokenInfo => ({
      parsed: parseUnits(amount, tokenInfo.decimals),
      decimals: tokenInfo.decimals,
    }));
  }

  formatAmount(amount: bigint, tokenAddressOrSymbol: string): Promise<string> {
    return this.getTokenInfo(tokenAddressOrSymbol).then(tokenInfo => 
      formatUnits(amount, tokenInfo.decimals)
    );
  }

  isNativeToken(tokenAddressOrSymbol: string): boolean {
    const key = tokenAddressOrSymbol.toLowerCase();
    return key === 'bnb' || key === 'native';
  }

  getWBNBAddress(): string {
    return TOKEN_ADDRESSES.WBNB;
  }

  // Helper method to resolve token address (symbol -> address)
  async resolveTokenAddress(tokenAddressOrSymbol: string): Promise<string> {
    if (this.isNativeToken(tokenAddressOrSymbol)) {
      return 'BNB';
    }

    const tokenInfo = await this.getTokenInfo(tokenAddressOrSymbol);
    return tokenInfo.address;
  }

  // Helper method to validate if token is in whitelist
  async validateToken(tokenAddressOrSymbol: string): Promise<boolean> {
    try {
      const tokenInfo = await this.getTokenInfo(tokenAddressOrSymbol);
      
      // For now, accept all tokens that can be resolved
      // TODO: Implement whitelist/blacklist checking against config
      return true;
    } catch (error) {
      return false;
    }
  }

  // Get multiple token balances at once
  async getMultipleBalances(
    tokens: string[], 
    walletAddress: string
  ): Promise<TokenBalance[]> {
    const balancePromises = tokens.map(token => 
      this.getTokenBalance(token, walletAddress)
    );

    return Promise.all(balancePromises);
  }
}