import { logger } from '../utils/logger';
import { configManager } from '../config';

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

export class RetryManager {
  private static instance: RetryManager;
  private config: RetryConfig;

  private constructor() {
    this.config = {
      maxRetries: configManager.config.retry.max_retries,
      baseDelayMs: configManager.config.retry.base_delay_ms,
      maxDelayMs: configManager.config.retry.max_delay_ms,
      backoffMultiplier: configManager.config.retry.backoff_multiplier,
      retryableErrors: [
        // Network errors
        'NETWORK_ERROR',
        'TIMEOUT',
        'CONNECTION_ERROR',
        'ECONNRESET',
        'ENOTFOUND',
        
        // RPC errors
        'SERVER_ERROR',
        'INTERNAL_ERROR',
        'RATE_LIMITED',
        'TOO_MANY_REQUESTS',
        
        // Transaction errors (temporary)
        'NONCE_TOO_LOW',
        'REPLACEMENT_UNDERPRICED',
        'INSUFFICIENT_FUNDS_FOR_GAS',
        
        // BSC specific
        'execution reverted',
        'gas required exceeds allowance',
      ],
    };
  }

  public static getInstance(): RetryManager {
    if (!RetryManager.instance) {
      RetryManager.instance = new RetryManager();
    }
    return RetryManager.instance;
  }

  async execute<T>(
    operation: () => Promise<T>,
    operationName: string,
    customConfig?: Partial<RetryConfig>
  ): Promise<RetryResult<T>> {
    const config = { ...this.config, ...customConfig };
    let lastError: Error | undefined;
    let totalDelayMs = 0;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
      try {
        logger.debug({ 
          operation: operationName, 
          attempt, 
          maxAttempts: config.maxRetries + 1 
        }, 'Executing operation');

        const result = await operation();
        
        if (attempt > 1) {
          logger.info({ 
            operation: operationName, 
            attempt, 
            totalDelayMs: Date.now() - startTime 
          }, 'Operation succeeded after retry');
        }

        return {
          success: true,
          result,
          attempts: attempt,
          totalDelayMs: Date.now() - startTime,
        };

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        logger.debug({ 
          operation: operationName, 
          attempt, 
          error: lastError.message 
        }, 'Operation attempt failed');

        // Check if error is retryable
        const isRetryable = this.isRetryableError(lastError);
        const hasAttemptsLeft = attempt <= config.maxRetries;

        if (!isRetryable || !hasAttemptsLeft) {
          logger.error({ 
            operation: operationName, 
            attempts: attempt,
            isRetryable,
            hasAttemptsLeft,
            error: lastError.message 
          }, 'Operation failed - not retrying');
          
          break;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, config);
        totalDelayMs += delay;

        logger.warn({ 
          operation: operationName, 
          attempt, 
          delayMs: delay,
          nextAttempt: attempt + 1,
          error: lastError.message 
        }, 'Retrying operation after delay');

        await this.sleep(delay);
      }
    }

    return {
      success: false,
      error: lastError,
      attempts: config.maxRetries + 1,
      totalDelayMs: Date.now() - startTime,
    };
  }

  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    return this.config.retryableErrors.some(retryableError => 
      message.includes(retryableError.toLowerCase())
    );
  }

  private calculateDelay(attempt: number, config: RetryConfig): number {
    // Exponential backoff with jitter
    const baseDelay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
    
    // Add jitter (±25% random variation)
    const jitter = baseDelay * 0.25 * (Math.random() - 0.5) * 2;
    const delayWithJitter = baseDelay + jitter;
    
    // Cap at maximum delay
    return Math.min(delayWithJitter, config.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Utility method for retrying specific transaction operations
  async retryTransaction<T>(
    operation: () => Promise<T>,
    operationName: string,
    txHash?: string
  ): Promise<RetryResult<T>> {
    const customConfig: Partial<RetryConfig> = {
      maxRetries: 3, // More conservative for transactions
      baseDelayMs: 2000, // Longer delays for transactions
    };

    const result = await this.execute(operation, operationName, customConfig);
    
    if (txHash) {
      logger.info({ 
        operation: operationName,
        txHash,
        success: result.success,
        attempts: result.attempts,
        totalDelayMs: result.totalDelayMs
      }, 'Transaction retry completed');
    }

    return result;
  }

  // Utility method for retrying RPC calls
  async retryRpcCall<T>(
    operation: () => Promise<T>,
    methodName: string
  ): Promise<RetryResult<T>> {
    const customConfig: Partial<RetryConfig> = {
      maxRetries: 5, // More attempts for RPC
      baseDelayMs: 500, // Shorter delays for RPC
      maxDelayMs: 5000,
    };

    return this.execute(operation, `RPC:${methodName}`, customConfig);
  }

  // Check if an error should trigger a nonce repair
  shouldRepairNonce(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('nonce too low') || 
           message.includes('invalid nonce') ||
           message.includes('nonce has already been used');
  }

  // Check if an error suggests gas price is too low
  shouldIncreaseGasPrice(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('replacement underpriced') ||
           message.includes('gas price too low') ||
           message.includes('fee too low');
  }

  // Get retry statistics
  getRetryStats(): {
    config: RetryConfig;
    retryableErrorCount: number;
  } {
    return {
      config: this.config,
      retryableErrorCount: this.config.retryableErrors.length,
    };
  }

  // Update retry configuration
  updateConfig(updates: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...updates };
    logger.info({ config: this.config }, 'Updated retry configuration');
  }
}

export const retryManager = RetryManager.getInstance();