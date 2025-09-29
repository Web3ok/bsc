import { ethers } from 'ethers';
import { configManager } from '../config';
import { rpcManager } from '../blockchain/rpc';
import { gasManager } from '../tx/gas';
import { nonceManager } from '../tx/nonce';
import { pancakeSwapV2 } from '../dex/pancakeswap-v2';
import { enhancedPricingService } from '../dex/pricing-enhanced';
import { logger } from '../utils/logger';

export interface BatchTradeParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string; // per wallet
  slippageTolerance: number;
  deadline?: number;
  maxGasPrice?: string; // in gwei
  priorityLevel?: 'low' | 'medium' | 'high';
}

export interface WalletConfig {
  privateKey: string;
  label?: string;
  maxAmount?: string; // maximum amount this wallet can trade
  enabled?: boolean;
}

export interface BatchTradeRequest {
  trades: BatchTradeParams[];
  wallets: WalletConfig[];
  executionStrategy: 'sequential' | 'parallel' | 'staggered';
  failureStrategy: 'stop_on_first_failure' | 'continue_on_failure' | 'retry_failed';
  maxConcurrency?: number; // for parallel execution
  delayBetweenTrades?: number; // milliseconds, for staggered execution
  retryAttempts?: number;
  dryRun?: boolean;
}

export interface BatchTradeResult {
  requestId: string;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  totalGasUsed: string;
  totalGasCost: string;
  executionTimeMs: number;
  results: TradeExecutionResult[];
  summary: {
    totalAmountIn: string;
    totalAmountOut: string;
    averagePrice: string;
    totalSlippage: number;
  };
}

export interface TradeExecutionResult {
  walletAddress: string;
  walletLabel?: string;
  tradeIndex: number;
  status: 'success' | 'failed' | 'skipped';
  txHash?: string;
  amountIn: string;
  amountOut?: string;
  gasUsed?: string;
  gasCost?: string;
  executionPrice?: string;
  slippage?: number;
  error?: string;
  executionTimeMs: number;
  nonce?: number;
}

export class BatchTradeEngine {
  private static instance: BatchTradeEngine;
  private activeRequests = new Map<string, BatchTradeRequest>();
  private requestResults = new Map<string, BatchTradeResult>();
  private executionQueue: Array<{ requestId: string; priority: number }> = [];
  private isProcessing = false;

  private constructor() {}

  public static getInstance(): BatchTradeEngine {
    if (!BatchTradeEngine.instance) {
      BatchTradeEngine.instance = new BatchTradeEngine();
    }
    return BatchTradeEngine.instance;
  }

  /**
   * Submit batch trade request
   */
  async submitBatchTrade(request: BatchTradeRequest): Promise<string> {
    const requestId = this.generateRequestId();
    
    // Validate request
    const validation = await this.validateBatchRequest(request);
    if (!validation.valid) {
      throw new Error(`Invalid batch request: ${validation.errors.join(', ')}`);
    }

    // Store request
    this.activeRequests.set(requestId, request);

    // Add to execution queue
    const priority = this.calculateRequestPriority(request);
    this.executionQueue.push({ requestId, priority });
    this.executionQueue.sort((a, b) => b.priority - a.priority);

    logger.info({
      requestId,
      totalTrades: request.trades.length,
      totalWallets: request.wallets.length,
      strategy: request.executionStrategy,
      priority
    }, 'Batch trade request submitted');

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }

    return requestId;
  }

  /**
   * Execute batch trade request
   */
  private async executeBatchTrade(requestId: string): Promise<BatchTradeResult> {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    const startTime = Date.now();
    
    logger.info({
      requestId,
      strategy: request.executionStrategy,
      walletCount: request.wallets.length,
      tradeCount: request.trades.length
    }, 'Starting batch trade execution');

    const results: TradeExecutionResult[] = [];
    let totalGasUsed = BigInt(0);
    let totalGasCost = BigInt(0);
    
    try {
      // Filter enabled wallets
      const enabledWallets = request.wallets.filter(w => w.enabled !== false);
      
      if (enabledWallets.length === 0) {
        throw new Error('No enabled wallets found');
      }

      // Execute trades based on strategy
      switch (request.executionStrategy) {
        case 'sequential':
          await this.executeSequential(request, enabledWallets, results);
          break;
        case 'parallel':
          await this.executeParallel(request, enabledWallets, results);
          break;
        case 'staggered':
          await this.executeStaggered(request, enabledWallets, results);
          break;
      }

      // Calculate totals
      for (const result of results) {
        if (result.gasUsed) {
          totalGasUsed += BigInt(result.gasUsed);
        }
        if (result.gasCost) {
          totalGasCost += BigInt(result.gasCost);
        }
      }

      // Generate summary
      const summary = this.generateSummary(results, request.trades);

      const batchResult: BatchTradeResult = {
        requestId,
        totalTrades: results.length,
        successfulTrades: results.filter(r => r.status === 'success').length,
        failedTrades: results.filter(r => r.status === 'failed').length,
        totalGasUsed: totalGasUsed.toString(),
        totalGasCost: totalGasCost.toString(),
        executionTimeMs: Date.now() - startTime,
        results,
        summary
      };

      // Store result
      this.requestResults.set(requestId, batchResult);

      logger.info({
        requestId,
        successful: batchResult.successfulTrades,
        failed: batchResult.failedTrades,
        executionTimeMs: batchResult.executionTimeMs,
        totalGasCost: ethers.formatEther(totalGasCost)
      }, 'Batch trade execution completed');

      return batchResult;

    } catch (error) {
      logger.error({ error, requestId }, 'Batch trade execution failed');
      throw error;
    } finally {
      // Clean up
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Execute trades sequentially
   */
  private async executeSequential(
    request: BatchTradeRequest,
    wallets: WalletConfig[],
    results: TradeExecutionResult[]
  ): Promise<void> {
    for (let i = 0; i < wallets.length; i++) {
      const wallet = wallets[i];
      
      for (let j = 0; j < request.trades.length; j++) {
        const trade = request.trades[j];
        
        if (this.shouldStopExecution(request, results)) {
          break;
        }

        const result = await this.executeSingleTrade(wallet, trade, i * request.trades.length + j, request.dryRun);
        results.push(result);

        // Delay between trades if specified
        if (request.delayBetweenTrades && request.delayBetweenTrades > 0) {
          await new Promise(resolve => setTimeout(resolve, request.delayBetweenTrades));
        }
      }
    }
  }

  /**
   * Execute trades in parallel
   */
  private async executeParallel(
    request: BatchTradeRequest,
    wallets: WalletConfig[],
    results: TradeExecutionResult[]
  ): Promise<void> {
    const maxConcurrency = request.maxConcurrency || Math.min(5, wallets.length);
    const semaphore = new Array(maxConcurrency).fill(0);
    
    const allTrades: Array<{ wallet: WalletConfig; trade: BatchTradeParams; index: number }> = [];
    
    // Build complete trade list
    wallets.forEach((wallet, walletIndex) => {
      request.trades.forEach((trade, tradeIndex) => {
        allTrades.push({
          wallet,
          trade,
          index: walletIndex * request.trades.length + tradeIndex
        });
      });
    });

    // Execute with concurrency control
    const executeWithSemaphore = async (tradeItem: typeof allTrades[0]): Promise<TradeExecutionResult> => {
      // Wait for available slot
      await this.waitForSemaphore(semaphore);
      
      try {
        return await this.executeSingleTrade(
          tradeItem.wallet,
          tradeItem.trade,
          tradeItem.index,
          request.dryRun
        );
      } finally {
        // Release semaphore slot
        this.releaseSemaphore(semaphore);
      }
    };

    const promises = allTrades.map(executeWithSemaphore);
    const parallelResults = await Promise.allSettled(promises);

    // Process results
    parallelResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          walletAddress: 'unknown',
          tradeIndex: index,
          status: 'failed',
          error: result.reason?.message || 'Unknown error',
          executionTimeMs: 0,
          amountIn: '0'
        });
      }
    });
  }

  /**
   * Execute trades with staggered timing
   */
  private async executeStaggered(
    request: BatchTradeRequest,
    wallets: WalletConfig[],
    results: TradeExecutionResult[]
  ): Promise<void> {
    const delay = request.delayBetweenTrades || 1000; // 1 second default
    const promises: Promise<TradeExecutionResult>[] = [];

    let tradeIndex = 0;
    for (const wallet of wallets) {
      for (const trade of request.trades) {
        const currentIndex = tradeIndex++;
        const currentDelay = currentIndex * delay;

        const promise = new Promise<TradeExecutionResult>((resolve) => {
          setTimeout(async () => {
            try {
              const result = await this.executeSingleTrade(wallet, trade, currentIndex, request.dryRun);
              resolve(result);
            } catch (error) {
              resolve({
                walletAddress: new ethers.Wallet(wallet.privateKey).address,
                walletLabel: wallet.label,
                tradeIndex: currentIndex,
                status: 'failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                executionTimeMs: 0,
                amountIn: trade.amountIn
              });
            }
          }, currentDelay);
        });

        promises.push(promise);
      }
    }

    const staggeredResults = await Promise.all(promises);
    results.push(...staggeredResults);
  }

  /**
   * Execute single trade
   */
  private async executeSingleTrade(
    walletConfig: WalletConfig,
    trade: BatchTradeParams,
    tradeIndex: number,
    dryRun?: boolean
  ): Promise<TradeExecutionResult> {
    const startTime = Date.now();
    const wallet = new ethers.Wallet(walletConfig.privateKey);
    
    logger.debug({
      wallet: wallet.address,
      tradeIndex,
      tokenIn: trade.tokenIn,
      tokenOut: trade.tokenOut,
      amountIn: trade.amountIn,
      dryRun
    }, 'Executing single trade');

    try {
      // Validate wallet balance and allowances
      await this.validateWalletForTrade(wallet.address, trade);

      if (dryRun) {
        // Simulate trade
        const quote = await enhancedPricingService.getTradeQuote(
          trade.tokenIn,
          trade.tokenOut,
          trade.amountIn,
          trade.slippageTolerance
        );

        return {
          walletAddress: wallet.address,
          walletLabel: walletConfig.label,
          tradeIndex,
          status: 'success',
          amountIn: trade.amountIn,
          amountOut: quote.tokenOut.amountWei,
          executionPrice: quote.executionPrice,
          slippage: 0,
          executionTimeMs: Date.now() - startTime
        };
      }

      // Execute real trade
      const swapResult = await pancakeSwapV2.executeSwap({
        tokenIn: trade.tokenIn,
        tokenOut: trade.tokenOut,
        amountIn: trade.amountIn,
        slippageTolerance: trade.slippageTolerance,
        deadline: trade.deadline
      }, walletConfig.privateKey);

      return {
        walletAddress: wallet.address,
        walletLabel: walletConfig.label,
        tradeIndex,
        status: 'success',
        txHash: swapResult.txHash,
        amountIn: swapResult.amountIn,
        amountOut: swapResult.amountOut,
        gasUsed: swapResult.gasUsed,
        gasCost: swapResult.gasCost,
        executionPrice: swapResult.effectivePrice,
        slippage: parseFloat(swapResult.priceImpact),
        executionTimeMs: Date.now() - startTime
      };

    } catch (error) {
      logger.warn({
        error,
        wallet: wallet.address,
        tradeIndex
      }, 'Single trade execution failed');

      return {
        walletAddress: wallet.address,
        walletLabel: walletConfig.label,
        tradeIndex,
        status: 'failed',
        amountIn: trade.amountIn,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Validate wallet for trade execution
   */
  private async validateWalletForTrade(walletAddress: string, trade: BatchTradeParams): Promise<void> {
    try {
      // Check token balance
      const balance = await pancakeSwapV2.getTokenBalance(trade.tokenIn, walletAddress);
      if (BigInt(balance) < BigInt(trade.amountIn)) {
        throw new Error(`Insufficient ${trade.tokenIn} balance: ${balance} < ${trade.amountIn}`);
      }

      // Additional validations can be added here
      // - Check allowances
      // - Check gas balance
      // - Check if tokens are whitelisted
      
    } catch (error) {
      throw new Error(`Wallet validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate batch request
   */
  private async validateBatchRequest(request: BatchTradeRequest): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Basic validation
    if (!request.trades || request.trades.length === 0) {
      errors.push('No trades specified');
    }

    if (!request.wallets || request.wallets.length === 0) {
      errors.push('No wallets specified');
    }

    // Validate execution strategy
    if (!['sequential', 'parallel', 'staggered'].includes(request.executionStrategy)) {
      errors.push('Invalid execution strategy');
    }

    // Validate trades
    for (let i = 0; i < request.trades.length; i++) {
      const trade = request.trades[i];
      
      if (!trade.tokenIn || !trade.tokenOut) {
        errors.push(`Trade ${i}: Missing token addresses`);
      }
      
      if (!trade.amountIn || BigInt(trade.amountIn) <= 0) {
        errors.push(`Trade ${i}: Invalid amount`);
      }
      
      if (trade.slippageTolerance <= 0 || trade.slippageTolerance > 0.5) {
        errors.push(`Trade ${i}: Invalid slippage tolerance`);
      }
    }

    // Validate wallets
    for (let i = 0; i < request.wallets.length; i++) {
      const wallet = request.wallets[i];
      
      if (!wallet.privateKey) {
        errors.push(`Wallet ${i}: Missing private key`);
      } else {
        try {
          new ethers.Wallet(wallet.privateKey);
        } catch (error) {
          errors.push(`Wallet ${i}: Invalid private key`);
        }
      }
    }

    // Check limits
    const limitsConfig = configManager.getLimitsConfig();
    const totalTrades = request.trades.length * request.wallets.filter(w => w.enabled !== false).length;
    
    if (totalTrades > limitsConfig.batchSizeLimit) {
      errors.push(`Too many trades: ${totalTrades} > ${limitsConfig.batchSizeLimit}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Helper methods for concurrency control
   */
  private async waitForSemaphore(semaphore: number[]): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const index = semaphore.findIndex(slot => slot === 0);
        if (index >= 0) {
          semaphore[index] = 1; // Acquire slot
          resolve();
        } else {
          setTimeout(check, 100); // Check again in 100ms
        }
      };
      check();
    });
  }

  private releaseSemaphore(semaphore: number[]): void {
    const index = semaphore.findIndex(slot => slot === 1);
    if (index >= 0) {
      semaphore[index] = 0; // Release slot
    }
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(results: TradeExecutionResult[], trades: BatchTradeParams[]): BatchTradeResult['summary'] {
    const successfulResults = results.filter(r => r.status === 'success' && r.amountOut);
    
    if (successfulResults.length === 0) {
      return {
        totalAmountIn: '0',
        totalAmountOut: '0',
        averagePrice: '0',
        totalSlippage: 0
      };
    }

    const totalAmountIn = successfulResults.reduce((sum, r) => sum + BigInt(r.amountIn), BigInt(0));
    const totalAmountOut = successfulResults.reduce((sum, r) => sum + BigInt(r.amountOut || '0'), BigInt(0));
    
    const averagePrice = totalAmountOut > 0 ? 
      (Number(totalAmountOut) / Number(totalAmountIn)).toString() : '0';
    
    const totalSlippage = successfulResults.reduce((sum, r) => sum + (r.slippage || 0), 0) / 
      successfulResults.length;

    return {
      totalAmountIn: totalAmountIn.toString(),
      totalAmountOut: totalAmountOut.toString(),
      averagePrice,
      totalSlippage
    };
  }

  /**
   * Utility methods
   */
  private generateRequestId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateRequestPriority(request: BatchTradeRequest): number {
    // Higher priority for smaller batches and dry runs
    let priority = 100;
    
    if (request.dryRun) priority += 50;
    
    const totalTrades = request.trades.length * request.wallets.length;
    priority -= Math.min(totalTrades, 50); // Decrease priority for larger batches
    
    return priority;
  }

  private shouldStopExecution(request: BatchTradeRequest, results: TradeExecutionResult[]): boolean {
    if (request.failureStrategy === 'stop_on_first_failure') {
      return results.some(r => r.status === 'failed');
    }
    return false;
  }

  /**
   * Process execution queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.executionQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.executionQueue.length > 0) {
        const { requestId } = this.executionQueue.shift()!;
        
        try {
          await this.executeBatchTrade(requestId);
        } catch (error) {
          logger.error({ error, requestId }, 'Batch trade execution failed');
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Get batch trade result
   */
  getBatchResult(requestId: string): BatchTradeResult | undefined {
    return this.requestResults.get(requestId);
  }

  /**
   * Get batch trade status
   */
  getBatchStatus(requestId: string): 'pending' | 'processing' | 'completed' | 'not_found' {
    if (this.requestResults.has(requestId)) {
      return 'completed';
    }
    if (this.activeRequests.has(requestId)) {
      return 'processing';
    }
    if (this.executionQueue.some(item => item.requestId === requestId)) {
      return 'pending';
    }
    return 'not_found';
  }

  /**
   * Cancel pending batch trade
   */
  cancelBatchTrade(requestId: string): boolean {
    const queueIndex = this.executionQueue.findIndex(item => item.requestId === requestId);
    if (queueIndex >= 0) {
      this.executionQueue.splice(queueIndex, 1);
      this.activeRequests.delete(requestId);
      return true;
    }
    return false;
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    pendingRequests: number;
    isProcessing: boolean;
    activeRequests: number;
  } {
    return {
      pendingRequests: this.executionQueue.length,
      isProcessing: this.isProcessing,
      activeRequests: this.activeRequests.size
    };
  }
}

export const batchTradeEngine = BatchTradeEngine.getInstance();