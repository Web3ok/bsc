import { ethers, formatUnits, parseUnits } from 'ethers';
import { configManager } from '../config';
import { logger } from '../utils/logger';
import { rpcManager } from '../blockchain/rpc';

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedCost: bigint; // in wei
  estimatedCostBNB: string; // formatted BNB amount
}

export interface GasOptions {
  gasLimit?: bigint;
  gasPrice?: number; // in gwei
  maxFeePerGas?: number; // in gwei
  maxPriorityFeePerGas?: number; // in gwei
  speed?: 'slow' | 'standard' | 'fast';
}

export class GasManager {
  private static instance: GasManager;
  private gasCache = new Map<string, { estimate: GasEstimate; timestamp: number }>();
  private cacheExpiry = 30000; // 30 seconds
  private gasPriceHistory: Array<{ price: bigint; timestamp: number }> = [];
  private maxHistorySize = 100;

  private constructor() {
    // Initialize with RPC manager
    rpcManager.initialize();
  }

  public static getInstance(): GasManager {
    if (!GasManager.instance) {
      GasManager.instance = new GasManager();
    }
    return GasManager.instance;
  }

  async getCurrentGasPrice(): Promise<bigint> {
    try {
      const provider = rpcManager.getProvider();
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || parseUnits('5', 'gwei'); // 5 gwei fallback
      
      // Store in history for trend analysis
      this.gasPriceHistory.push({ price: gasPrice, timestamp: Date.now() });
      if (this.gasPriceHistory.length > this.maxHistorySize) {
        this.gasPriceHistory.shift();
      }
      
      return gasPrice;
    } catch (error) {
      logger.warn({ error }, 'Failed to get current gas price, using fallback');
      const gasConfig = configManager.getGasConfig();
      return parseUnits(gasConfig.priorityFeeGwei.toString(), 'gwei');
    }
  }

  async getGasEstimate(
    to: string,
    data: string,
    value: bigint = BigInt(0),
    from?: string,
    options?: GasOptions
  ): Promise<GasEstimate> {
    const cacheKey = `${to}-${data}-${value.toString()}-${from || 'none'}`;
    
    // Check cache first
    const cached = this.gasCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      logger.debug({ cacheKey }, 'Using cached gas estimate');
      return cached.estimate;
    }

    try {
      // Estimate gas limit
      let gasLimit: bigint;
      if (options?.gasLimit) {
        gasLimit = options.gasLimit;
      } else {
        try {
          const provider = rpcManager.getProvider();
          
          const estimatedGas = await provider.estimateGas({
            to,
            data,
            value,
            from
          });
          
          // Add buffer for safety using gas multiplier from config
          const gasConfig = configManager.getGasConfig();
          const multiplier = Math.floor(gasConfig.gasMultiplier * 100);
          gasLimit = estimatedGas + (estimatedGas * BigInt(multiplier) / BigInt(100));
        } catch (error) {
          logger.warn({ error }, 'Gas estimation failed, using default');
          gasLimit = BigInt(200000); // Default gas limit
        }
      }

      // Get current gas price
      const currentGasPrice = await this.getCurrentGasPrice();
      
      // Calculate gas prices based on speed or explicit options
      let gasPrice: bigint;
      let maxFeePerGas: bigint;
      let maxPriorityFeePerGas: bigint;

      const gasConfig = configManager.getGasConfig();
      
      if (options?.gasPrice) {
        gasPrice = parseUnits(options.gasPrice.toString(), 'gwei');
        maxFeePerGas = gasPrice;
        maxPriorityFeePerGas = parseUnits(gasConfig.priorityFeeGwei.toString(), 'gwei');
      } else if (options?.maxFeePerGas && options?.maxPriorityFeePerGas) {
        maxFeePerGas = parseUnits(options.maxFeePerGas.toString(), 'gwei');
        maxPriorityFeePerGas = parseUnits(options.maxPriorityFeePerGas.toString(), 'gwei');
        gasPrice = maxFeePerGas;
      } else {
        // Calculate based on speed
        const multiplier = this.getSpeedMultiplier(options?.speed || 'standard');
        gasPrice = currentGasPrice + (currentGasPrice * BigInt(multiplier) / BigInt(100));
        
        // Cap at maximum
        const maxGasPrice = parseUnits(gasConfig.maxGasPriceGwei.toString(), 'gwei');
        gasPrice = gasPrice > maxGasPrice ? maxGasPrice : gasPrice;
        
        maxFeePerGas = gasPrice;
        maxPriorityFeePerGas = parseUnits(gasConfig.priorityFeeGwei.toString(), 'gwei');
      }

      const estimatedCost = gasLimit * gasPrice;
      const estimatedCostBNB = (Number(estimatedCost) / 1e18).toFixed(6);

      const estimate: GasEstimate = {
        gasLimit,
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
        estimatedCost,
        estimatedCostBNB,
      };

      // Cache the result
      this.gasCache.set(cacheKey, { estimate, timestamp: Date.now() });

      logger.debug({
        gasLimit: gasLimit.toString(),
        gasPrice: formatUnits(gasPrice, 'gwei'),
        estimatedCostBNB,
      }, 'Generated gas estimate');

      return estimate;

    } catch (error) {
      logger.error({ error }, 'Failed to get gas estimate');
      
      // Fallback estimate
      const gasConfig = configManager.getGasConfig();
      const fallbackGasPrice = parseUnits(gasConfig.priorityFeeGwei.toString(), 'gwei');
      const fallbackGasLimit = BigInt(200000);
      
      return {
        gasLimit: fallbackGasLimit,
        gasPrice: fallbackGasPrice,
        maxFeePerGas: fallbackGasPrice,
        maxPriorityFeePerGas: fallbackGasPrice,
        estimatedCost: fallbackGasLimit * fallbackGasPrice,
        estimatedCostBNB: (Number(fallbackGasLimit * fallbackGasPrice) / 1e18).toFixed(6),
      };
    }
  }

  private getSpeedMultiplier(speed: 'slow' | 'standard' | 'fast'): number {
    switch (speed) {
      case 'slow':
        return 0; // Use current gas price
      case 'standard':
        return 10; // +10%
      case 'fast':
        return 25; // +25%
      default:
        return 10;
    }
  }

  async getOptimalGasPrice(targetConfirmationMinutes = 3): Promise<bigint> {
    try {
      const currentGasPrice = await this.getCurrentGasPrice();
      
      // For BSC, transactions usually confirm within 3 seconds
      // So we don't need complex prediction algorithms
      if (targetConfirmationMinutes <= 1) {
        return currentGasPrice + (currentGasPrice * BigInt(25) / BigInt(100)); // +25%
      } else if (targetConfirmationMinutes <= 3) {
        return currentGasPrice + (currentGasPrice * BigInt(10) / BigInt(100)); // +10%
      } else {
        return currentGasPrice; // Use current price for longer timeframes
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get optimal gas price');
      const gasConfig = configManager.getGasConfig();
      return parseUnits(gasConfig.priorityFeeGwei.toString(), 'gwei');
    }
  }

  validateGasPrice(gasPrice: bigint): { valid: boolean; reason?: string } {
    const gasConfig = configManager.getGasConfig();
    const maxGasPrice = parseUnits(gasConfig.maxGasPriceGwei.toString(), 'gwei');
    const minGasPrice = parseUnits('1', 'gwei'); // 1 gwei minimum

    if (gasPrice < minGasPrice) {
      return { valid: false, reason: `Gas price too low: ${formatUnits(gasPrice, 'gwei')} < 1 gwei` };
    }

    if (gasPrice > maxGasPrice) {
      return { 
        valid: false, 
        reason: `Gas price too high: ${formatUnits(gasPrice, 'gwei')} > ${formatUnits(maxGasPrice, 'gwei')}` 
      };
    }

    return { valid: true };
  }

  // Clean up old cache entries
  clearCache(): void {
    this.gasCache.clear();
    logger.debug('Cleared gas estimate cache');
  }

  // Get current cache size
  getCacheSize(): number {
    return this.gasCache.size;
  }

  // Calculate replacement gas price for stuck transactions
  getReplacementGasPrice(originalGasPrice: bigint): bigint {
    // BSC requires at least 10% increase for replacement
    const minIncrease = originalGasPrice * BigInt(10) / BigInt(100);
    const newGasPrice = originalGasPrice + minIncrease;
    
    const gasConfig = configManager.getGasConfig();
    const maxGasPrice = parseUnits(gasConfig.maxGasPriceGwei.toString(), 'gwei');
    return newGasPrice > maxGasPrice ? maxGasPrice : newGasPrice;
  }

  // Get gas price trend analysis
  getGasPriceTrend(): { trend: 'rising' | 'falling' | 'stable'; percentage: number } {
    if (this.gasPriceHistory.length < 2) {
      return { trend: 'stable', percentage: 0 };
    }

    const recent = this.gasPriceHistory.slice(-10); // Last 10 prices
    const first = recent[0].price;
    const last = recent[recent.length - 1].price;
    
    const percentage = Number((last - first) * BigInt(100) / first);
    
    if (percentage > 5) return { trend: 'rising', percentage };
    if (percentage < -5) return { trend: 'falling', percentage };
    return { trend: 'stable', percentage };
  }

  // Get average gas price over time period
  getAverageGasPrice(minutes: number = 5): bigint {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const recentPrices = this.gasPriceHistory
      .filter(entry => entry.timestamp > cutoff)
      .map(entry => entry.price);
    
    if (recentPrices.length === 0) {
      const gasConfig = configManager.getGasConfig();
      return parseUnits(gasConfig.priorityFeeGwei.toString(), 'gwei');
    }
    
    const sum = recentPrices.reduce((acc, price) => acc + price, BigInt(0));
    return sum / BigInt(recentPrices.length);
  }

  // Estimate total transaction cost including gas
  async estimateTransactionCost(
    to: string,
    data: string,
    value: bigint = BigInt(0),
    from?: string,
    options?: GasOptions
  ): Promise<{ gasCost: bigint; totalCost: bigint; gasCostBNB: string; totalCostBNB: string }> {
    const gasEstimate = await this.getGasEstimate(to, data, value, from, options);
    
    const gasCost = gasEstimate.estimatedCost;
    const totalCost = gasCost + value;
    
    return {
      gasCost,
      totalCost,
      gasCostBNB: gasEstimate.estimatedCostBNB,
      totalCostBNB: (Number(totalCost) / 1e18).toFixed(6),
    };
  }
}

export const gasManager = GasManager.getInstance();