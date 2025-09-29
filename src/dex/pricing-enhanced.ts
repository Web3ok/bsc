import { ethers } from 'ethers';
import { configManager } from '../config';
import { rpcManager } from '../blockchain/rpc';
import { logger } from '../utils/logger';
import { pancakeSwapV2 } from './pancakeswap-v2';
import { PANCAKE_V2_ROUTER_ABI, TOKEN_ADDRESSES } from './constants';

export interface PriceData {
  tokenAddress: string;
  symbol: string;
  priceInBNB: string;
  priceInUSD: string;
  timestamp: number;
  volume24h?: string;
  change24h?: number;
  liquidity?: string;
}

export interface PriceImpactResult {
  impact: number;
  category: 'minimal' | 'low' | 'medium' | 'high' | 'very_high';
  recommendation: string;
}

export interface SlippageAnalysis {
  recommendedSlippage: number;
  minimumSlippage: number;
  maximumSlippage: number;
  reason: string;
}

export interface TradeQuote {
  tokenIn: {
    address: string;
    symbol: string;
    amount: string;
    amountWei: string;
  };
  tokenOut: {
    address: string;
    symbol: string;
    amount: string;
    amountWei: string;
  };
  path: string[];
  priceImpact: PriceImpactResult;
  slippageAnalysis: SlippageAnalysis;
  minimumReceived: string;
  minimumReceivedWei: string;
  executionPrice: string;
  gasEstimate: string;
  totalCostBNB: string;
  recommendation: string;
}

export class EnhancedPricingService {
  private static instance: EnhancedPricingService;
  private priceCache = new Map<string, PriceData>();
  private impactCache = new Map<string, PriceImpactResult>();
  private cacheExpiry = 30000; // 30 seconds
  private router: ethers.Contract;
  private provider: ethers.JsonRpcProvider;

  private constructor() {
    this.provider = rpcManager.getProvider();
    const pancakeConfig = configManager.getPancakeSwapConfig();
    this.router = new ethers.Contract(
      pancakeConfig.v2Router,
      PANCAKE_V2_ROUTER_ABI,
      this.provider
    );
  }

  public static getInstance(): EnhancedPricingService {
    if (!EnhancedPricingService.instance) {
      EnhancedPricingService.instance = new EnhancedPricingService();
    }
    return EnhancedPricingService.instance;
  }

  /**
   * Get comprehensive trade quote with all analysis
   */
  async getTradeQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    requestedSlippage?: number
  ): Promise<TradeQuote> {
    try {
      // Get basic quote from PancakeSwap
      const basicQuote = await pancakeSwapV2.getQuote({
        tokenIn,
        tokenOut,
        amountIn,
        slippageTolerance: requestedSlippage || 0.005
      });

      // Get token information
      const [tokenInInfo, tokenOutInfo] = await Promise.all([
        pancakeSwapV2.getTokenInfo(tokenIn),
        pancakeSwapV2.getTokenInfo(tokenOut)
      ]);

      // Calculate detailed price impact
      const priceImpact = await this.calculateDetailedPriceImpact(
        tokenIn,
        tokenOut,
        amountIn
      );

      // Analyze optimal slippage
      const slippageAnalysis = await this.analyzeOptimalSlippage(
        tokenIn,
        tokenOut,
        amountIn,
        priceImpact.impact
      );

      // Use requested slippage or recommended
      const finalSlippage = requestedSlippage || slippageAnalysis.recommendedSlippage;
      
      // Calculate minimum received with final slippage
      const slippageMultiplier = 1 - (finalSlippage / 100);
      const minimumReceivedWei = (BigInt(basicQuote.amountOut) * BigInt(Math.floor(slippageMultiplier * 10000))) / BigInt(10000);
      const minimumReceived = ethers.formatUnits(minimumReceivedWei, tokenOutInfo.decimals);

      // Calculate execution price
      const executionPrice = (
        parseFloat(ethers.formatUnits(basicQuote.amountOut, tokenOutInfo.decimals)) /
        parseFloat(ethers.formatUnits(amountIn, tokenInInfo.decimals))
      ).toString();

      // Estimate total cost including gas
      const gasEstimate = await this.estimateGasCost(tokenIn, tokenOut, amountIn);
      const totalCostBNB = await this.calculateTotalCostBNB(amountIn, gasEstimate, tokenIn);

      // Generate comprehensive recommendation
      const recommendation = this.generateTradeRecommendation(
        priceImpact,
        slippageAnalysis,
        parseFloat(totalCostBNB),
        requestedSlippage
      );

      const quote: TradeQuote = {
        tokenIn: {
          address: tokenIn,
          symbol: tokenInInfo.symbol,
          amount: ethers.formatUnits(amountIn, tokenInInfo.decimals),
          amountWei: amountIn
        },
        tokenOut: {
          address: tokenOut,
          symbol: tokenOutInfo.symbol,
          amount: ethers.formatUnits(basicQuote.amountOut, tokenOutInfo.decimals),
          amountWei: basicQuote.amountOut
        },
        path: basicQuote.path,
        priceImpact,
        slippageAnalysis,
        minimumReceived,
        minimumReceivedWei: minimumReceivedWei.toString(),
        executionPrice,
        gasEstimate,
        totalCostBNB,
        recommendation
      };

      logger.info({
        tokenIn: tokenInInfo.symbol,
        tokenOut: tokenOutInfo.symbol,
        amountIn: quote.tokenIn.amount,
        amountOut: quote.tokenOut.amount,
        priceImpact: priceImpact.impact,
        recommendedSlippage: slippageAnalysis.recommendedSlippage,
        totalCostBNB
      }, 'Generated comprehensive trade quote');

      return quote;

    } catch (error) {
      logger.error({ error, tokenIn, tokenOut, amountIn }, 'Failed to generate trade quote');
      throw new Error(`Trade quote failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Calculate detailed price impact with multiple reference points
   */
  private async calculateDetailedPriceImpact(
    tokenIn: string,
    tokenOut: string,
    amountIn: string
  ): Promise<PriceImpactResult> {
    const cacheKey = `${tokenIn}-${tokenOut}-${amountIn}`;
    const cached = this.impactCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached;
    }

    try {
      // Get multiple reference quotes with different sizes
      const referenceAmounts = [
        ethers.parseEther('0.001'), // Very small
        ethers.parseEther('0.01'),  // Small
        ethers.parseEther('0.1'),   // Medium
      ];

      const tradeAmount = BigInt(amountIn);
      const referencePrices: number[] = [];

      // Get reference prices
      for (const refAmount of referenceAmounts) {
        try {
          const quote = await pancakeSwapV2.getQuote({
            tokenIn,
            tokenOut,
            amountIn: refAmount.toString(),
            slippageTolerance: 0.001
          });
          
          const price = Number(BigInt(quote.amountOut) * BigInt(1e18) / refAmount) / 1e18;
          referencePrices.push(price);
        } catch (error) {
          logger.debug({ error, refAmount: refAmount.toString() }, 'Failed to get reference price');
        }
      }

      if (referencePrices.length === 0) {
        throw new Error('Could not get any reference prices');
      }

      // Use median reference price
      const sortedPrices = referencePrices.sort((a, b) => a - b);
      const referencePrice = sortedPrices[Math.floor(sortedPrices.length / 2)];

      // Get actual trade price
      const actualQuote = await pancakeSwapV2.getQuote({
        tokenIn,
        tokenOut,
        amountIn,
        slippageTolerance: 0.001
      });

      const actualPrice = Number(BigInt(actualQuote.amountOut) * BigInt(1e18) / tradeAmount) / 1e18;

      // Calculate impact
      const impact = Math.abs((referencePrice - actualPrice) / referencePrice) * 100;

      // Categorize impact and generate recommendation
      let category: PriceImpactResult['category'];
      let recommendation: string;

      if (impact < 0.1) {
        category = 'minimal';
        recommendation = 'Excellent - minimal price impact detected';
      } else if (impact < 1) {
        category = 'low';
        recommendation = 'Good - low price impact, trade can proceed';
      } else if (impact < 3) {
        category = 'medium';
        recommendation = 'Moderate impact - consider reducing trade size';
      } else if (impact < 5) {
        category = 'high';
        recommendation = 'High impact - strongly recommend reducing trade size';
      } else {
        category = 'very_high';
        recommendation = 'Very high impact - trade size may be too large for this pair';
      }

      const result: PriceImpactResult = {
        impact,
        category,
        recommendation
      };

      // Cache the result
      this.impactCache.set(cacheKey, { ...result, timestamp: Date.now() } as any);

      return result;

    } catch (error) {
      logger.error({ error, tokenIn, tokenOut, amountIn }, 'Failed to calculate price impact');
      return {
        impact: 0,
        category: 'minimal',
        recommendation: 'Could not calculate price impact - proceed with caution'
      };
    }
  }

  /**
   * Analyze optimal slippage based on multiple factors
   */
  private async analyzeOptimalSlippage(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    priceImpact: number
  ): Promise<SlippageAnalysis> {
    try {
      const tradingConfig = configManager.getTradingConfig();
      
      // Base slippage calculation
      let baseSlippage: number;
      if (priceImpact < 0.1) {
        baseSlippage = 0.5; // 0.5%
      } else if (priceImpact < 1) {
        baseSlippage = 1.0; // 1%
      } else if (priceImpact < 3) {
        baseSlippage = 2.0; // 2%
      } else {
        baseSlippage = Math.max(3.0, priceImpact * 1.2); // Price impact + buffer
      }

      // Volatility adjustment
      const volatilityMultiplier = await this.getVolatilityAdjustment(tokenIn, tokenOut);
      let recommendedSlippage = baseSlippage * volatilityMultiplier;

      // Liquidity adjustment
      const liquidityMultiplier = await this.getLiquidityAdjustment(tokenIn, tokenOut);
      recommendedSlippage *= liquidityMultiplier;

      // Network congestion adjustment (simplified)
      const gasPrice = await this.provider.getFeeData();
      if (gasPrice.gasPrice && gasPrice.gasPrice > ethers.parseUnits('10', 'gwei')) {
        recommendedSlippage *= 1.2; // Higher slippage during congestion
      }

      // Apply bounds
      const minimumSlippage = 0.1;
      const maximumSlippage = Math.min(tradingConfig.maxSlippage, 15);
      recommendedSlippage = Math.max(minimumSlippage, Math.min(recommendedSlippage, maximumSlippage));

      // Generate reason
      let reason = `Base slippage: ${baseSlippage.toFixed(1)}%`;
      if (volatilityMultiplier > 1.1) {
        reason += `, volatility adjusted (+${((volatilityMultiplier - 1) * 100).toFixed(1)}%)`;
      }
      if (liquidityMultiplier > 1.1) {
        reason += `, liquidity adjusted (+${((liquidityMultiplier - 1) * 100).toFixed(1)}%)`;
      }

      return {
        recommendedSlippage,
        minimumSlippage,
        maximumSlippage,
        reason
      };

    } catch (error) {
      logger.error({ error }, 'Slippage analysis failed, using defaults');
      const tradingConfig = configManager.getTradingConfig();
      
      return {
        recommendedSlippage: tradingConfig.defaultSlippage,
        minimumSlippage: 0.1,
        maximumSlippage: tradingConfig.maxSlippage,
        reason: 'Using default values due to analysis failure'
      };
    }
  }

  /**
   * Get volatility adjustment multiplier
   */
  private async getVolatilityAdjustment(tokenIn: string, tokenOut: string): Promise<number> {
    const stablecoins = [TOKEN_ADDRESSES.USDT, TOKEN_ADDRESSES.BUSD, TOKEN_ADDRESSES.USDC];
    const majorTokens = [TOKEN_ADDRESSES.WBNB, TOKEN_ADDRESSES.ETH, TOKEN_ADDRESSES.CAKE];

    const isStablePair = stablecoins.includes(tokenIn) && stablecoins.includes(tokenOut);
    const isMajorPair = majorTokens.includes(tokenIn) || majorTokens.includes(tokenOut);

    if (isStablePair) return 0.8; // Lower volatility
    if (isMajorPair) return 1.0; // Normal volatility
    return 1.3; // Higher volatility for unknown tokens
  }

  /**
   * Get liquidity adjustment multiplier
   */
  private async getLiquidityAdjustment(tokenIn: string, tokenOut: string): Promise<number> {
    try {
      // Simplified liquidity check - test with small amounts
      const testAmount = ethers.parseEther('0.001');
      
      try {
        await pancakeSwapV2.getQuote({
          tokenIn,
          tokenOut,
          amountIn: testAmount.toString(),
          slippageTolerance: 0.001
        });
        return 1.0; // Good liquidity
      } catch (error) {
        return 1.5; // Poor liquidity, need higher slippage
      }
    } catch (error) {
      return 1.2; // Default adjustment
    }
  }

  /**
   * Estimate gas cost for the trade
   */
  private async estimateGasCost(tokenIn: string, tokenOut: string, amountIn: string): Promise<string> {
    try {
      // Use pancakeSwapV2's gas estimation (from our enhanced implementation)
      const quote = await pancakeSwapV2.getQuote({
        tokenIn,
        tokenOut,
        amountIn,
        slippageTolerance: 0.005
      });
      
      return quote.gasEstimate;
    } catch (error) {
      logger.warn({ error }, 'Gas estimation failed, using default');
      return '200000'; // Default gas limit
    }
  }

  /**
   * Calculate total cost in BNB (trade amount + gas)
   */
  private async calculateTotalCostBNB(
    amountIn: string,
    gasEstimate: string,
    tokenIn: string
  ): Promise<string> {
    try {
      // Get gas cost in BNB
      const gasPrice = await this.provider.getFeeData();
      const gasCostWei = BigInt(gasEstimate) * (gasPrice.gasPrice || ethers.parseUnits('5', 'gwei'));
      
      // Convert trade amount to BNB if necessary
      let tradeAmountInBNB = '0';
      if (tokenIn.toLowerCase() === TOKEN_ADDRESSES.WBNB.toLowerCase()) {
        tradeAmountInBNB = amountIn;
      } else {
        try {
          const bnbQuote = await pancakeSwapV2.getQuote({
            tokenIn,
            tokenOut: TOKEN_ADDRESSES.WBNB,
            amountIn,
            slippageTolerance: 0.001
          });
          tradeAmountInBNB = bnbQuote.amountOut;
        } catch (error) {
          // If can't convert, just return gas cost
          return ethers.formatEther(gasCostWei);
        }
      }

      const totalCostWei = BigInt(tradeAmountInBNB) + gasCostWei;
      return ethers.formatEther(totalCostWei);

    } catch (error) {
      logger.warn({ error }, 'Total cost calculation failed');
      return '0';
    }
  }

  /**
   * Generate comprehensive trade recommendation
   */
  private generateTradeRecommendation(
    priceImpact: PriceImpactResult,
    slippageAnalysis: SlippageAnalysis,
    totalCostBNB: number,
    requestedSlippage?: number
  ): string {
    const recommendations: string[] = [];

    // Price impact recommendations
    if (priceImpact.category === 'high' || priceImpact.category === 'very_high') {
      recommendations.push('⚠️ Consider reducing trade size due to high price impact');
    }

    // Slippage recommendations
    if (requestedSlippage && requestedSlippage < slippageAnalysis.recommendedSlippage) {
      recommendations.push(`💡 Increase slippage to ${slippageAnalysis.recommendedSlippage.toFixed(1)}% to avoid transaction failure`);
    }

    // Cost recommendations
    if (totalCostBNB > 1) {
      recommendations.push('💰 High total cost - ensure trade value justifies expenses');
    }

    // General recommendations
    if (priceImpact.category === 'minimal' || priceImpact.category === 'low') {
      recommendations.push('✅ Trade conditions look good');
    }

    return recommendations.length > 0 
      ? recommendations.join(' | ') 
      : '✅ Trade analysis complete - no specific recommendations';
  }

  /**
   * Validate trade parameters
   */
  validateTradeParameters(quote: TradeQuote): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Price impact validation
    if (quote.priceImpact.impact > 5) {
      issues.push(`Price impact too high: ${quote.priceImpact.impact.toFixed(2)}%`);
    }

    // Slippage validation
    if (quote.slippageAnalysis.recommendedSlippage > 10) {
      issues.push(`Recommended slippage very high: ${quote.slippageAnalysis.recommendedSlippage.toFixed(1)}%`);
    }

    // Minimum received validation
    if (parseFloat(quote.minimumReceived) <= 0) {
      issues.push('Minimum received amount is zero or negative');
    }

    // Gas cost validation
    const gasCostBNB = parseFloat(ethers.formatEther(quote.gasEstimate)) * parseFloat(quote.totalCostBNB);
    if (gasCostBNB > parseFloat(quote.tokenOut.amount) * 0.1) { // Gas > 10% of output
      issues.push('Gas cost is more than 10% of output amount');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache(): void {
    const now = Date.now();
    let cleared = 0;

    // Clear price cache
    for (const [key, data] of this.priceCache.entries()) {
      if (now - data.timestamp > this.cacheExpiry) {
        this.priceCache.delete(key);
        cleared++;
      }
    }

    // Clear impact cache
    for (const [key, data] of this.impactCache.entries()) {
      if (now - (data as any).timestamp > this.cacheExpiry) {
        this.impactCache.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      logger.debug({ cleared }, 'Cleared expired cache entries');
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { 
    priceCache: number; 
    impactCache: number; 
    totalSize: number 
  } {
    return {
      priceCache: this.priceCache.size,
      impactCache: this.impactCache.size,
      totalSize: this.priceCache.size + this.impactCache.size
    };
  }
}

export const enhancedPricingService = EnhancedPricingService.getInstance();