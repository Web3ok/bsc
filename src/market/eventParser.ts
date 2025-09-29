import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { rpcManager } from '../blockchain/rpc';
import { 
  PANCAKE_V2_PAIR_ABI,
  PANCAKE_V2_PAIR_CONTRACT_ABI,
  ERC20_ABI,
  SWAP_EVENT_TOPIC,
  BSC_TOKEN_ADDRESSES
} from './abi';

export interface ParsedSwapEvent {
  id: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
  address: string;
  sender: string;
  to: string;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  timestamp: Date;
  processed: boolean;
  
  // Additional parsed info
  token0Address: string;
  token1Address: string;
  token0Symbol?: string;
  token1Symbol?: string;
  token0Decimals?: number;
  token1Decimals?: number;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  name: string;
}

export interface PairInfo {
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
  pair: string; // e.g., "WBNB/USDT"
}

export class EventParser {
  private static instance: EventParser;
  private swapEventInterface: ethers.Interface;
  private pairContractInterface: ethers.Interface;
  private tokenContractInterface: ethers.Interface;
  private tokenInfoCache = new Map<string, TokenInfo>();
  private pairInfoCache = new Map<string, PairInfo>();

  private constructor() {
    this.swapEventInterface = new ethers.Interface(PANCAKE_V2_PAIR_ABI);
    this.pairContractInterface = new ethers.Interface(PANCAKE_V2_PAIR_CONTRACT_ABI);
    this.tokenContractInterface = new ethers.Interface(ERC20_ABI);
  }

  public static getInstance(): EventParser {
    if (!EventParser.instance) {
      EventParser.instance = new EventParser();
    }
    return EventParser.instance;
  }

  /**
   * Parse a raw swap event log into a structured swap event
   */
  async parseSwapEvent(logData: any): Promise<ParsedSwapEvent | null> {
    try {
      // Verify this is a Swap event
      if (!logData.topics || logData.topics[0] !== SWAP_EVENT_TOPIC) {
        return null;
      }

      // Decode the swap event
      const decodedEvent = this.swapEventInterface.parseLog({
        topics: logData.topics,
        data: logData.data
      });

      if (!decodedEvent || decodedEvent.name !== 'Swap') {
        return null;
      }

      const eventId = `${logData.transactionHash}-${logData.logIndex}`;
      
      // Get pair info (token addresses, symbols, decimals)
      const pairInfo = await this.getPairInfo(logData.address);
      if (!pairInfo) {
        logger.warn({ pairAddress: logData.address }, 'Could not get pair info for swap event');
        return null;
      }

      // Get block timestamp
      const blockNumber = parseInt(logData.blockNumber, 16);
      const timestamp = await this.getBlockTimestamp(blockNumber);

      return {
        id: eventId,
        blockNumber: BigInt(blockNumber),
        transactionHash: logData.transactionHash,
        logIndex: parseInt(logData.logIndex, 16),
        address: logData.address.toLowerCase(),
        sender: decodedEvent.args.sender.toLowerCase(),
        to: decodedEvent.args.to.toLowerCase(),
        amount0In: BigInt(decodedEvent.args.amount0In.toString()),
        amount1In: BigInt(decodedEvent.args.amount1In.toString()),
        amount0Out: BigInt(decodedEvent.args.amount0Out.toString()),
        amount1Out: BigInt(decodedEvent.args.amount1Out.toString()),
        timestamp,
        processed: false,
        
        // Additional info from pair lookup
        token0Address: pairInfo.token0.address,
        token1Address: pairInfo.token1.address,
        token0Symbol: pairInfo.token0.symbol,
        token1Symbol: pairInfo.token1.symbol,
        token0Decimals: pairInfo.token0.decimals,
        token1Decimals: pairInfo.token1.decimals,
      };

    } catch (error) {
      logger.error({ error, logData }, 'Failed to parse swap event');
      return null;
    }
  }

  /**
   * Calculate price update from a parsed swap event
   */
  calculatePriceUpdate(swapEvent: ParsedSwapEvent): {
    price: number;
    inversePrice: number;
    volume: number;
    token0Volume: number;
    token1Volume: number;
  } | null {
    try {
      const { 
        amount0In, amount1In, amount0Out, amount1Out,
        token0Decimals = 18, token1Decimals = 18 
      } = swapEvent;

      // Calculate actual amounts exchanged
      const token0Amount = amount0In > 0n ? amount0In : amount0Out;
      const token1Amount = amount1In > 0n ? amount1In : amount1Out;

      if (token0Amount === 0n || token1Amount === 0n) {
        return null;
      }

      // Use ethers.formatUnits for precise decimal conversion
      const token0Decimal = parseFloat(ethers.formatUnits(token0Amount, token0Decimals));
      const token1Decimal = parseFloat(ethers.formatUnits(token1Amount, token1Decimals));

      // Calculate price as token1/token0 (how many token1 per token0)
      const price = token1Decimal / token0Decimal;
      const inversePrice = token0Decimal / token1Decimal;

      // Calculate volume in terms of both tokens
      const token0Volume = token0Decimal;
      const token1Volume = token1Decimal;

      // For overall volume, use the larger of the two amounts in USD terms
      // This is a simplified approach - in practice, you'd want to convert to a stable unit
      const volume = Math.max(token0Volume, token1Volume);

      return {
        price,
        inversePrice,
        volume,
        token0Volume,
        token1Volume,
      };

    } catch (error) {
      logger.error({ error, swapEvent }, 'Failed to calculate price update');
      return null;
    }
  }

  /**
   * Get detailed information about a trading pair
   */
  private async getPairInfo(pairAddress: string): Promise<PairInfo | null> {
    const normalizedAddress = pairAddress.toLowerCase();
    
    // Check cache first
    if (this.pairInfoCache.has(normalizedAddress)) {
      return this.pairInfoCache.get(normalizedAddress)!;
    }

    try {
      const provider = rpcManager.getProvider();
      const pairContract = new ethers.Contract(pairAddress, this.pairContractInterface, provider);

      // Get token addresses
      const [token0Address, token1Address] = await Promise.all([
        pairContract.token0(),
        pairContract.token1()
      ]);

      // Get token info
      const [token0Info, token1Info] = await Promise.all([
        this.getTokenInfo(token0Address),
        this.getTokenInfo(token1Address)
      ]);

      if (!token0Info || !token1Info) {
        return null;
      }

      const pairInfo: PairInfo = {
        address: normalizedAddress,
        token0: token0Info,
        token1: token1Info,
        pair: `${token0Info.symbol}/${token1Info.symbol}`
      };

      // Cache the result
      this.pairInfoCache.set(normalizedAddress, pairInfo);
      
      return pairInfo;

    } catch (error) {
      logger.error({ error, pairAddress }, 'Failed to get pair info');
      return null;
    }
  }

  /**
   * Get detailed information about a token
   */
  private async getTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    const normalizedAddress = tokenAddress.toLowerCase();
    
    // Check cache first
    if (this.tokenInfoCache.has(normalizedAddress)) {
      return this.tokenInfoCache.get(normalizedAddress)!;
    }

    try {
      const provider = rpcManager.getProvider();
      const tokenContract = new ethers.Contract(tokenAddress, this.tokenContractInterface, provider);

      // Get token details
      const [symbol, decimals, name] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals(),
        tokenContract.name()
      ]);

      const tokenInfo: TokenInfo = {
        address: normalizedAddress,
        symbol,
        decimals: Number(decimals),
        name
      };

      // Cache the result
      this.tokenInfoCache.set(normalizedAddress, tokenInfo);
      
      return tokenInfo;

    } catch (error) {
      logger.error({ error, tokenAddress }, 'Failed to get token info');
      return null;
    }
  }

  /**
   * Get block timestamp
   */
  private async getBlockTimestamp(blockNumber: number): Promise<Date> {
    try {
      const provider = rpcManager.getProvider();
      const block = await provider.getBlock(blockNumber);
      return new Date((block?.timestamp || 0) * 1000);
    } catch (error) {
      logger.error({ error, blockNumber }, 'Failed to get block timestamp');
      return new Date(); // Fallback to current time
    }
  }

  /**
   * Clear caches (useful for testing or memory management)
   */
  clearCaches(): void {
    this.tokenInfoCache.clear();
    this.pairInfoCache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { tokenCacheSize: number; pairCacheSize: number } {
    return {
      tokenCacheSize: this.tokenInfoCache.size,
      pairCacheSize: this.pairInfoCache.size
    };
  }
}

export const eventParser = EventParser.getInstance();