import { createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { bsc } from 'viem/chains';
import { configManager } from '../config';
import { logger } from '../utils/logger';
import { TokenService } from './token';
import { PANCAKE_V2_ROUTER_ABI } from './constants';

export interface QuoteRequest {
  tokenIn: string;  // Token address or symbol
  tokenOut: string; // Token address or symbol  
  amountIn: string; // Human readable amount (e.g., "1.5")
  slippage?: number; // Optional slippage (0.01 = 1%)
}

export interface QuoteResult {
  tokenIn: {
    address: string;
    symbol: string;
    amount: string;
    amountWei: bigint;
  };
  tokenOut: {
    address: string;
    symbol: string;
    amount: string;
    amountWei: bigint;
  };
  path: string[];
  priceImpact: number; // Percentage
  minimumReceived: string; // With slippage applied
  minimumReceivedWei: bigint;
  slippage: number;
  executionPrice: string; // tokenOut per tokenIn
}

export class PricingService {
  private publicClient: any;
  private tokenService: TokenService;
  private routerAddress: string;

  constructor() {
    const rpcUrls = configManager.rpcUrls;
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrls[0]),
    });
    
    this.tokenService = new TokenService();
    this.routerAddress = configManager.addresses.PANCAKE_V2_ROUTER;
  }

  async getQuote(request: QuoteRequest): Promise<QuoteResult> {
    try {
      const { tokenIn, tokenOut, amountIn, slippage = 0.005 } = request;

      // Get token info
      const [tokenInInfo, tokenOutInfo] = await Promise.all([
        this.tokenService.getTokenInfo(tokenIn),
        this.tokenService.getTokenInfo(tokenOut),
      ]);

      // Parse input amount
      const amountInWei = parseUnits(amountIn, tokenInInfo.decimals);

      // Build trading path
      const path = this.buildPath(tokenInInfo.address, tokenOutInfo.address);

      // Get quote from router
      const amounts = await this.publicClient.readContract({
        address: this.routerAddress as `0x${string}`,
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [amountInWei, path as `0x${string}`[]],
      });

      const amountOutWei = amounts[amounts.length - 1] as bigint;
      const amountOut = formatUnits(amountOutWei, tokenOutInfo.decimals);

      // Calculate price impact (simplified)
      const priceImpact = await this.calculatePriceImpact(
        tokenInInfo.address,
        tokenOutInfo.address,
        amountInWei,
        amountOutWei
      );

      // Apply slippage
      const minimumReceivedWei = amountOutWei - (amountOutWei * BigInt(Math.floor(slippage * 10000)) / BigInt(10000));
      const minimumReceived = formatUnits(minimumReceivedWei, tokenOutInfo.decimals);

      // Calculate execution price
      const executionPrice = (parseFloat(amountOut) / parseFloat(amountIn)).toString();

      const result: QuoteResult = {
        tokenIn: {
          address: tokenInInfo.address,
          symbol: tokenInInfo.symbol,
          amount: amountIn,
          amountWei: amountInWei,
        },
        tokenOut: {
          address: tokenOutInfo.address,
          symbol: tokenOutInfo.symbol,
          amount: amountOut,
          amountWei: amountOutWei,
        },
        path,
        priceImpact,
        minimumReceived,
        minimumReceivedWei,
        slippage,
        executionPrice,
      };

      logger.info({ 
        tokenIn: tokenInInfo.symbol,
        tokenOut: tokenOutInfo.symbol,
        amountIn,
        amountOut,
        priceImpact,
        slippage 
      }, 'Quote generated');

      return result;

    } catch (error) {
      logger.error({ error, request }, 'Failed to get quote');
      throw new Error(`Failed to get quote: ${error}`);
    }
  }

  async getReverseQuote(
    tokenIn: string,
    tokenOut: string, 
    amountOut: string,
    slippage = 0.005
  ): Promise<QuoteResult> {
    try {
      // Get token info
      const [tokenInInfo, tokenOutInfo] = await Promise.all([
        this.tokenService.getTokenInfo(tokenIn),
        this.tokenService.getTokenInfo(tokenOut),
      ]);

      // Parse output amount
      const amountOutWei = parseUnits(amountOut, tokenOutInfo.decimals);

      // Build trading path
      const path = this.buildPath(tokenInInfo.address, tokenOutInfo.address);

      // Get reverse quote from router
      const amounts = await this.publicClient.readContract({
        address: this.routerAddress as `0x${string}`,
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'getAmountsIn',
        args: [amountOutWei, path as `0x${string}`[]],
      });

      const amountInWei = amounts[0] as bigint;
      const amountIn = formatUnits(amountInWei, tokenInInfo.decimals);

      // Calculate price impact
      const priceImpact = await this.calculatePriceImpact(
        tokenInInfo.address,
        tokenOutInfo.address,
        amountInWei,
        amountOutWei
      );

      // Apply slippage (increase input amount needed)
      const maximumInputWei = amountInWei + (amountInWei * BigInt(Math.floor(slippage * 10000)) / BigInt(10000));
      
      // Calculate execution price
      const executionPrice = (parseFloat(amountOut) / parseFloat(amountIn)).toString();

      return {
        tokenIn: {
          address: tokenInInfo.address,
          symbol: tokenInInfo.symbol,
          amount: amountIn,
          amountWei: amountInWei,
        },
        tokenOut: {
          address: tokenOutInfo.address,
          symbol: tokenOutInfo.symbol,
          amount: amountOut,
          amountWei: amountOutWei,
        },
        path,
        priceImpact,
        minimumReceived: amountOut,
        minimumReceivedWei: amountOutWei,
        slippage,
        executionPrice,
      };

    } catch (error) {
      logger.error({ error, tokenIn, tokenOut, amountOut }, 'Failed to get reverse quote');
      throw new Error(`Failed to get reverse quote: ${error}`);
    }
  }

  private buildPath(tokenInAddress: string, tokenOutAddress: string): string[] {
    const wbnbAddress = this.tokenService.getWBNBAddress();

    // Direct pair
    if (tokenInAddress === 'BNB' && tokenOutAddress !== wbnbAddress) {
      return [wbnbAddress, tokenOutAddress];
    }
    if (tokenOutAddress === 'BNB' && tokenInAddress !== wbnbAddress) {
      return [tokenInAddress, wbnbAddress];
    }
    if (tokenInAddress !== 'BNB' && tokenOutAddress !== 'BNB' && 
        (tokenInAddress === wbnbAddress || tokenOutAddress === wbnbAddress)) {
      return [tokenInAddress, tokenOutAddress];
    }

    // If both tokens are not BNB/WBNB, route through WBNB
    if (tokenInAddress !== 'BNB' && tokenOutAddress !== 'BNB' &&
        tokenInAddress !== wbnbAddress && tokenOutAddress !== wbnbAddress) {
      return [tokenInAddress, wbnbAddress, tokenOutAddress];
    }

    // Direct pair for same tokens or WBNB pairs
    return [tokenInAddress === 'BNB' ? wbnbAddress : tokenInAddress, 
            tokenOutAddress === 'BNB' ? wbnbAddress : tokenOutAddress];
  }

  private async calculatePriceImpact(
    tokenInAddress: string,
    tokenOutAddress: string,
    amountInWei: bigint,
    amountOutWei: bigint
  ): Promise<number> {
    try {
      // Simplified price impact calculation
      // In a real implementation, you'd compare against spot price
      // For now, return a basic estimate based on trade size
      
      const amountInEther = Number(formatUnits(amountInWei, 18));
      
      // Basic heuristic: larger trades have higher price impact
      if (amountInEther > 100) return 0.03;      // 3%
      if (amountInEther > 50) return 0.02;       // 2%
      if (amountInEther > 10) return 0.01;       // 1%
      if (amountInEther > 1) return 0.005;       // 0.5%
      return 0.001; // 0.1%

    } catch (error) {
      logger.warn({ error }, 'Failed to calculate price impact, using default');
      return 0.01; // 1% default
    }
  }

  async getBestQuote(
    tokenIn: string,
    tokenOut: string, 
    amountIn: string,
    slippage = 0.005
  ): Promise<QuoteResult> {
    // For now, just return single quote from PancakeSwap V2
    // In future versions, this could compare quotes from V2, V3, and other DEXes
    return this.getQuote({
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
    });
  }

  async getCurrentPrice(tokenIn: string, tokenOut: string): Promise<string> {
    try {
      const quote = await this.getQuote({
        tokenIn,
        tokenOut,
        amountIn: '1',
      });
      
      return quote.executionPrice;
    } catch (error) {
      logger.error({ error, tokenIn, tokenOut }, 'Failed to get current price');
      throw new Error(`Failed to get current price: ${error}`);
    }
  }

  async validateTrade(quote: QuoteResult): Promise<{valid: boolean, reason?: string}> {
    // Price impact check
    if (quote.priceImpact > 0.05) { // 5%
      return { valid: false, reason: `Price impact too high: ${(quote.priceImpact * 100).toFixed(2)}%` };
    }

    // Minimum output check
    if (parseFloat(quote.tokenOut.amount) === 0) {
      return { valid: false, reason: 'Output amount is zero' };
    }

    // Slippage check
    if (quote.slippage > 0.1) { // 10%
      return { valid: false, reason: `Slippage too high: ${(quote.slippage * 100).toFixed(2)}%` };
    }

    return { valid: true };
  }
}