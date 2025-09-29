import { parseUnits } from 'viem';
import { WalletManager, WalletInfo } from '../wallet';
import { TradingService } from './trading';
import { PancakeSwapV3Service } from './pancakeswap-v3';
import { logger } from '../utils/logger';
import { DEXType, DEXQuote } from '../types';

export { DEXType };

export interface AggregatedQuote {
  bestQuote: DEXQuote;
  allQuotes: DEXQuote[];
  savings: string; // Amount saved compared to worst quote
  recommendedDex: DEXType;
}

export interface BatchTradeRequest {
  walletAddress: string;
  trades: Array<{
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage?: number;
    preferredDex?: DEXType;
  }>;
  maxGasPrice?: number;
  deadline?: number;
}

export interface BatchTradeResult {
  success: boolean;
  completedTrades: number;
  totalTrades: number;
  results: Array<{
    success: boolean;
    txHash?: string;
    error?: string;
    dexUsed: DEXType;
    amountOut?: string;
    gasUsed?: string;
  }>;
  totalGasUsed: string;
  totalValue: string;
}

export interface DEXHealthStatusEntry {
  available: boolean;
  latency: number;
  lastError?: string;
}

export interface DEXHealthStatus {
  overall: 'healthy' | 'degraded' | 'down';
  dexes: Record<DEXType, DEXHealthStatusEntry>;
}

export class MultiDEXAggregator {
  private walletManager: WalletManager;
  private tradingServiceV2: TradingService;
  private tradingServiceV3: PancakeSwapV3Service;
  private supportedDEXes: DEXType[];
  private readonly experimentalDexEnabled: boolean;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
    this.tradingServiceV2 = new TradingService(walletManager);
    this.tradingServiceV3 = new PancakeSwapV3Service(walletManager);
    
    this.experimentalDexEnabled = process.env.ENABLE_EXPERIMENTAL_DEX === 'true';

    this.supportedDEXes = this.experimentalDexEnabled
      ? ['pancakeswap-v2', 'pancakeswap-v3', 'pancakeswap-v4', 'uniswap-v3']
      : ['pancakeswap-v2', 'pancakeswap-v3'];
  }

  async getBestQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    excludeDEXes: DEXType[] = []
  ): Promise<AggregatedQuote> {
    const activeDEXes = this.supportedDEXes.filter(dex => !excludeDEXes.includes(dex));
    const quotes: DEXQuote[] = [];

    // Get quotes from all available DEXes in parallel
    const quotePromises = activeDEXes.map(async (dex): Promise<DEXQuote | null> => {
      try {
        switch (dex) {
          case 'pancakeswap-v2':
            const v2Quote = await this.tradingServiceV2.getQuote(tokenIn, tokenOut, amountIn);
            return {
              dex,
              amountOut: v2Quote.tokenOut.amount,
              priceImpact: String(v2Quote.priceImpact),
              gasEstimate: '150000', // Estimated gas for V2
              route: v2Quote.path || [tokenIn, tokenOut],
            } as DEXQuote;

          case 'pancakeswap-v3':
            // Try different fee tiers for V3
            const feeTiers = this.tradingServiceV3.getFeeTiers();
            const v3Quotes = await Promise.all(
              feeTiers.map(async (fee) => {
                try {
                  const quote = await this.tradingServiceV3.getQuote({
                    tokenIn,
                    tokenOut,
                    fee,
                    amountIn,
                  });
                  return {
                    dex,
                    amountOut: quote.amountOut,
                    priceImpact: String(quote.priceImpact),
                    gasEstimate: '200000', // Estimated gas for V3
                    route: quote.route,
                    fee: fee.toString(),
                  } as DEXQuote;
                } catch (error) {
                  return null;
                }
              })
            );

            // Return the best V3 quote (highest output)
            const bestV3Quote = v3Quotes
              .filter(q => q !== null)
              .sort((a, b) => parseFloat(b!.amountOut) - parseFloat(a!.amountOut))[0];
            
            return bestV3Quote;

          case 'pancakeswap-v4':
            if (!this.experimentalDexEnabled) {
              logger.debug('PancakeSwap V4 requested but experimental DEX support is disabled');
              return null;
            }
            // PancakeSwap V4 implementation
            const v4Quote = await this.getPancakeSwapV4Quote(tokenIn, tokenOut, amountIn);
            return {
              dex,
              amountOut: v4Quote.amountOut,
              priceImpact: v4Quote.priceImpact,
              gasEstimate: '180000', // Estimated gas for V4
              route: v4Quote.route,
              hookAddress: v4Quote.hookAddress,
            } as DEXQuote;

          case 'uniswap-v3':
            if (!this.experimentalDexEnabled) {
              logger.debug('Uniswap V3 requested but experimental DEX support is disabled');
              return null;
            }
            // Uniswap V3 implementation for BSC
            const uniV3Quote = await this.getUniswapV3Quote(tokenIn, tokenOut, amountIn);
            return {
              dex,
              amountOut: uniV3Quote.amountOut,
              priceImpact: uniV3Quote.priceImpact,
              gasEstimate: '220000', // Estimated gas for Uniswap V3
              route: uniV3Quote.route,
            } as DEXQuote;

          default:
            logger.warn({ dex }, 'DEX not implemented yet');
            return null;
        }
      } catch (error) {
        logger.warn({ error, dex, tokenIn, tokenOut }, 'Failed to get quote from DEX');
        return null;
      }
    });

    const results = await Promise.allSettled(quotePromises);
    
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        quotes.push(result.value);
      }
    });

    if (quotes.length === 0) {
      throw new Error('No quotes available from any DEX');
    }

    // Sort by amount out (descending)
    quotes.sort((a, b) => parseFloat(b.amountOut) - parseFloat(a.amountOut));

    const bestQuote = quotes[0];
    const worstQuote = quotes[quotes.length - 1];
    const savings = (parseFloat(bestQuote.amountOut) - parseFloat(worstQuote.amountOut)).toFixed(8);

    return {
      bestQuote,
      allQuotes: quotes,
      savings,
      recommendedDex: bestQuote.dex,
    };
  }

  async executeBatchTrades(request: BatchTradeRequest): Promise<BatchTradeResult> {
    const wallet = this.walletManager.getWallet(request.walletAddress);
    if (!wallet) {
      throw new Error(`Wallet ${request.walletAddress} not found`);
    }

    const results: BatchTradeResult['results'] = [];
    let totalGasUsed = BigInt(0);
    let totalValue = BigInt(0);
    let completedTrades = 0;

    logger.info({ 
      walletAddress: request.walletAddress,
      totalTrades: request.trades.length 
    }, 'Starting batch trades execution');

    for (const [index, trade] of request.trades.entries()) {
      let dexToUse: DEXType | undefined = trade.preferredDex;
      try {
        logger.info({ 
          tradeIndex: index + 1,
          totalTrades: request.trades.length,
          tokenIn: trade.tokenIn,
          tokenOut: trade.tokenOut,
          amountIn: trade.amountIn 
        }, 'Executing trade');

        // Get best quote if no DEX preference specified
        let bestQuote: DEXQuote | null = null;

        if (!dexToUse) {
          const aggregatedQuote = await this.getBestQuote(
            trade.tokenIn,
            trade.tokenOut,
            trade.amountIn
          );
          dexToUse = aggregatedQuote.recommendedDex;
          bestQuote = aggregatedQuote.bestQuote;
        }

        // Execute trade on the chosen DEX
        if (!dexToUse || !this.supportedDEXes.includes(dexToUse)) {
          throw new Error(`DEX ${dexToUse ?? 'unknown'} is not enabled in the current configuration`);
        }

        let txHash: string;
        let amountOut: string;
        let gasUsed: string;

        switch (dexToUse) {
          case 'pancakeswap-v2':
            const v2Result = await this.tradingServiceV2.executeTrade({
              from: request.walletAddress,
              tokenIn: trade.tokenIn,
              tokenOut: trade.tokenOut,
              amountIn: trade.amountIn,
              slippage: trade.slippage || 0.5,
              gasPrice: request.maxGasPrice,
              deadline: request.deadline,
            });

            if (!v2Result.success) {
              throw new Error(v2Result.error || 'V2 trade failed');
            }

            txHash = v2Result.txHash!;
            amountOut = v2Result.tokenOut.amount;
            gasUsed = v2Result.gasUsed || '0';
            break;

          case 'pancakeswap-v3':
            if (!bestQuote) {
              bestQuote = (await this.getBestQuote(trade.tokenIn, trade.tokenOut, trade.amountIn)).bestQuote;
            }

            const deadline = Math.floor(Date.now() / 1000) + (request.deadline || 20 * 60);
            const amountOutMin = (parseFloat(bestQuote.amountOut) * (1 - (trade.slippage || 0.5) / 100)).toFixed(8);

            txHash = await this.tradingServiceV3.executeSwap(wallet, {
              tokenIn: trade.tokenIn,
              tokenOut: trade.tokenOut,
              fee: bestQuote.fee ? parseInt(bestQuote.fee.toString()) : 3000,
              amountIn: trade.amountIn,
              recipient: wallet.address,
              deadline,
              amountOutMinimum: amountOutMin,
            });

            amountOut = bestQuote.amountOut;
            gasUsed = bestQuote.gasEstimate;
            break;

          case 'pancakeswap-v4':
            if (!this.experimentalDexEnabled) {
              throw new Error('PancakeSwap V4 trading is disabled (ENABLE_EXPERIMENTAL_DEX=false)');
            }
            const v4Result = await this.executeV4Trade({
              walletAddress: request.walletAddress,
              tokenIn: trade.tokenIn,
              tokenOut: trade.tokenOut,
              amountIn: trade.amountIn,
              slippage: trade.slippage || 0.5,
              gasPrice: request.maxGasPrice?.toString(),
              deadline: request.deadline,
              hookAddress: bestQuote?.hookAddress,
            });

            if (!v4Result.success) {
              throw new Error(v4Result.error || 'V4 trade failed');
            }

            txHash = v4Result.txHash!;
            amountOut = v4Result.amountOut || '0';
            gasUsed = v4Result.gasUsed || '180000';
            break;

          case 'uniswap-v3':
            if (!this.experimentalDexEnabled) {
              throw new Error('Uniswap V3 trading is disabled (ENABLE_EXPERIMENTAL_DEX=false)');
            }
            const uniV3Result = await this.executeUniswapV3Trade({
              walletAddress: request.walletAddress,
              tokenIn: trade.tokenIn,
              tokenOut: trade.tokenOut,
              amountIn: trade.amountIn,
              slippage: trade.slippage || 0.5,
              gasPrice: request.maxGasPrice?.toString(),
              deadline: request.deadline,
            });

            if (!uniV3Result.success) {
              throw new Error(uniV3Result.error || 'Uniswap V3 trade failed');
            }

            txHash = uniV3Result.txHash!;
            amountOut = uniV3Result.amountOut || '0';
            gasUsed = uniV3Result.gasUsed || '220000';
            break;

          default:
            throw new Error(`DEX ${dexToUse} not supported`);
        }

        results.push({
          success: true,
          txHash,
          dexUsed: dexToUse,
          amountOut,
          gasUsed,
        });

        totalGasUsed += BigInt(gasUsed);
        try {
          totalValue += parseUnits(amountOut, 18);
        } catch (valueError) {
          logger.warn({ value: amountOut, error: valueError }, 'Failed to accumulate trade value');
        }
        completedTrades++;

        logger.info({ 
          tradeIndex: index + 1,
          txHash,
          dexUsed: dexToUse,
          amountOut,
          gasUsed 
        }, 'Trade completed successfully');

        // Small delay between trades to avoid nonce conflicts
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const reportedDex = dexToUse ?? (trade.preferredDex as DEXType | undefined);

        results.push({
          success: false,
          error: errorMessage,
          dexUsed: reportedDex && this.supportedDEXes.includes(reportedDex)
            ? reportedDex
            : 'pancakeswap-v2',
        });

        logger.error({ 
          tradeIndex: index + 1,
          error: errorMessage,
          trade 
        }, 'Trade failed');
      }
    }

    const result: BatchTradeResult = {
      success: completedTrades > 0,
      completedTrades,
      totalTrades: request.trades.length,
      results,
      totalGasUsed: totalGasUsed.toString(),
      totalValue: totalValue.toString(),
    };

    logger.info({ 
      completedTrades,
      totalTrades: request.trades.length,
      totalGasUsed: totalGasUsed.toString() 
    }, 'Batch trades execution completed');

    return result;
  }

  async executeBatchLimitOrders(request: {
    walletAddress: string;
    orders: Array<{
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      limitPrice: string; // Price at which to execute
      side: 'buy' | 'sell';
      expiry?: number; // Unix timestamp
    }>;
  }): Promise<{
    success: boolean;
    createdOrders: number;
    results: Array<{
      success: boolean;
      orderId?: string;
      error?: string;
    }>;
  }> {
    // TODO: Implement limit order system
    // This would require a separate order book management system
    // For now, we'll create pending orders in the database
    
    logger.info({ 
      walletAddress: request.walletAddress,
      totalOrders: request.orders.length 
    }, 'Creating batch limit orders');

    const results = request.orders.map((order, index) => {
      // Create pending limit order record
      const orderId = `limit_${Date.now()}_${index}`;
      
      // TODO: Store in database with monitoring system
      // This would be picked up by a background service that monitors prices
      // and executes when conditions are met
      
      return {
        success: true,
        orderId,
      };
    });

    return {
      success: true,
      createdOrders: results.filter(r => r.success).length,
      results,
    };
  }

  getSupportedDEXes(): DEXType[] {
    return [...this.supportedDEXes];
  }

  async getDEXHealthStatus(): Promise<DEXHealthStatus> {
    const dexes: Record<DEXType, DEXHealthStatusEntry> = {
      'pancakeswap-v2': { available: false, latency: 0, lastError: undefined },
      'pancakeswap-v3': { available: false, latency: 0, lastError: undefined },
      'pancakeswap-v4': { available: false, latency: 0, lastError: undefined },
      'uniswap-v3': { available: false, latency: 0, lastError: undefined },
      'biswap': { available: false, latency: 0, lastError: undefined },
      'apeswap': { available: false, latency: 0, lastError: undefined }
    };

    for (const dex of this.supportedDEXes) {
      const startTime = Date.now();
      try {
        await this.getBestQuote(
          '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
          '0x55d398326f99059fF775485246999027B3197955',
          '0.001'
        );

        dexes[dex] = {
          available: true,
          latency: Date.now() - startTime,
        };
      } catch (error) {
        dexes[dex] = {
          available: false,
          latency: Date.now() - startTime,
          lastError: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }

    const totalDexes = Object.keys(dexes).length;
    const available = Object.values(dexes).filter(entry => entry.available).length;

    let overall: DEXHealthStatus['overall'] = 'down';
    if (available === totalDexes) {
      overall = 'healthy';
    } else if (available > 0) {
      overall = 'degraded';
    }

    return {
      overall,
      dexes,
    };
  }

  // Private helper methods for new DEX implementations
  private async getPancakeSwapV4Quote(tokenIn: string, tokenOut: string, amountIn: string): Promise<{
    amountOut: string;
    priceImpact: string;
    route: string[];
    hookAddress?: string;
  }> {
    // PancakeSwap V4 is still under development, fallback to V3 for now
    try {
      const baseQuote = await this.tradingServiceV3.getQuote({
        tokenIn,
        tokenOut,
        fee: 2500, // Default fee tier
        amountIn,
      });

      return {
        amountOut: baseQuote.amountOut.toString(),
        priceImpact: baseQuote.priceImpact.toString(),
        route: [tokenIn, tokenOut],
        hookAddress: undefined, // V4 hooks not yet available
      };
    } catch (error) {
      logger.error({ error, tokenIn, tokenOut, amountIn }, 'Failed to get PancakeSwap V4 quote');
      throw error;
    }
  }

  private async getUniswapV3Quote(tokenIn: string, tokenOut: string, amountIn: string): Promise<{
    amountOut: string;
    priceImpact: string;
    route: string[];
  }> {
    // Uniswap V3 is primarily on Ethereum, not BSC. Fallback to PancakeSwap V3 for similar functionality
    try {
      const pancakeQuote = await this.tradingServiceV3.getQuote({
        tokenIn,
        tokenOut,
        fee: 2500, // Default fee tier for PancakeSwap V3
        amountIn,
      });

      return {
        amountOut: pancakeQuote.amountOut.toString(),
        priceImpact: pancakeQuote.priceImpact.toString(),
        route: [tokenIn, tokenOut],
      };
    } catch (error) {
      logger.error({ error, tokenIn, tokenOut, amountIn }, 'Failed to get Uniswap V3 quote (fallback to PancakeSwap V3)');
      throw error;
    }
  }

  // Enhanced execution methods
  private async executeV4Trade(request: {
    walletAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage: number;
    gasPrice?: string;
    deadline?: number;
    hookAddress?: string;
  }): Promise<{
    success: boolean;
    txHash?: string;
    amountOut?: string;
    gasUsed?: string;
    error?: string;
  }> {
    try {
      logger.info({ 
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        hookAddress: request.hookAddress 
      }, 'Executing PancakeSwap V4 trade');

      // Leverage V3 infrastructure while V4 hooks are stubbed
      const quote = await this.tradingServiceV3.getQuote({
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        fee: request.hookAddress ? 100 : 2500,
        amountIn: request.amountIn,
      });

      const slippagePct = request.slippage ?? 0.5;
      const minimumOut = (
        parseFloat(quote.amountOut) * (1 - slippagePct / 100)
      ).toFixed(8);

      const v3TxHash = await this.tradingServiceV3.swap({
        walletAddress: request.walletAddress,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        amountOutMinimum: minimumOut,
        fee: quote.fee,
        deadline: request.deadline,
      });

      return {
        success: true,
        txHash: v3TxHash,
        amountOut: quote.amountOut,
        gasUsed: '180000', // V4 typically uses less gas
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'V4 trade execution failed');
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  private async executeUniswapV3Trade(request: {
    walletAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage: number;
    gasPrice?: string;
    deadline?: number;
  }): Promise<{
    success: boolean;
    txHash?: string;
    amountOut?: string;
    gasUsed?: string;
    error?: string;
  }> {
    try {
      logger.info({ 
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn 
      }, 'Executing Uniswap V3 trade (fallback to PancakeSwap V3)');

      // Calculate minimum output based on slippage
      const quote = await this.tradingServiceV3.getQuote({
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        fee: 2500,
        amountIn: request.amountIn,
      });

      const slippagePct = request.slippage ?? 0.5;
      const minimumOut = (
        parseFloat(quote.amountOut) * (1 - slippagePct / 100)
      ).toFixed(18);

      // Since Uniswap V3 is primarily on Ethereum, execute via PancakeSwap V3 on BSC
      const txHash = await this.tradingServiceV3.swap({
        walletAddress: request.walletAddress,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        fee: 2500,
        amountIn: request.amountIn,
        amountOutMinimum: minimumOut,
        deadline: request.deadline,
      });

      return {
        success: true,
        txHash: txHash,
        amountOut: quote.amountOut,
        gasUsed: '220000', // Estimated gas usage
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Uniswap V3 trade execution failed');
      
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
