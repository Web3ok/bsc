import { ethers } from 'ethers';
import { configManager } from '../config';
import { logger } from '../utils/logger';
import { pancakeSwapV2 } from '../dex/pancakeswap-v2';
import { enhancedPricingService } from '../dex/pricing-enhanced';

export interface TokenRule {
  address: string;
  symbol: string;
  status: 'whitelisted' | 'blacklisted' | 'restricted';
  maxTradeAmount?: string; // in wei
  minTradeAmount?: string; // in wei
  maxSlippage?: number; // percentage
  note?: string;
  addedAt: Date;
  updatedAt: Date;
}

export interface WalletRule {
  address: string;
  label?: string;
  status: 'enabled' | 'disabled' | 'restricted';
  maxDailyTradingVolume?: string; // in BNB
  maxTransactionAmount?: string; // in BNB
  allowedTokens?: string[]; // token addresses
  note?: string;
  addedAt: Date;
  updatedAt: Date;
}

export interface TradingLimits {
  maxPositionSizeBNB: number;
  maxDailyVolumeBNB: number;
  maxConcurrentTransactions: number;
  maxSlippagePercent: number;
  minTransactionIntervalMs: number;
  emergencyStopLossPercent: number;
  maxPriceImpactPercent: number;
}

export interface RiskViolation {
  id: string;
  type: 'token_blacklisted' | 'wallet_disabled' | 'amount_exceeded' | 'slippage_exceeded' | 
        'daily_limit_exceeded' | 'price_impact_high' | 'emergency_stop' | 'rate_limit';
  severity: 'warning' | 'error' | 'critical';
  entity: string; // token address or wallet address
  message: string;
  currentValue?: number;
  limitValue?: number;
  timestamp: Date;
  blockTransaction: boolean;
}

export interface TradeRequest {
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageTolerance: number;
  priceImpact?: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  violations: RiskViolation[];
  warnings: RiskViolation[];
  adjustedSlippage?: number;
  recommendedAction?: string;
}

export interface DailyStats {
  walletAddress: string;
  date: string;
  transactionCount: number;
  totalVolumeBNB: string;
  largestTransactionBNB: string;
  averageSlippage: number;
  lastTransactionTime: Date;
}

export class EnhancedRiskManager {
  private static instance: EnhancedRiskManager;
  private tokenRules = new Map<string, TokenRule>();
  private walletRules = new Map<string, WalletRule>();
  private dailyStats = new Map<string, DailyStats>();
  private recentTransactions = new Map<string, number[]>(); // wallet -> timestamps
  private emergencyStop = false;
  private tradingLimits: TradingLimits;

  private constructor() {
    const limitsConfig = configManager.getLimitsConfig();
    const tradingConfig = configManager.getTradingConfig();
    
    this.tradingLimits = {
      maxPositionSizeBNB: limitsConfig.maxPositionSizeBnb,
      maxDailyVolumeBNB: limitsConfig.maxDailyVolumeBnb,
      maxConcurrentTransactions: limitsConfig.maxConcurrentTransactions,
      maxSlippagePercent: tradingConfig.maxSlippage,
      minTransactionIntervalMs: 1000, // 1 second minimum between trades
      emergencyStopLossPercent: 10, // 10% emergency stop loss
      maxPriceImpactPercent: 5 // 5% maximum price impact
    };

    this.initializeDefaultRules();
  }

  public static getInstance(): EnhancedRiskManager {
    if (!EnhancedRiskManager.instance) {
      EnhancedRiskManager.instance = new EnhancedRiskManager();
    }
    return EnhancedRiskManager.instance;
  }

  /**
   * Initialize default whitelist and blacklist
   */
  private initializeDefaultRules(): void {
    // Add major tokens to whitelist
    const majorTokens = [
      { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB' },
      { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT' },
      { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD' },
      { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC' },
      { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE' },
      { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH' }
    ];

    for (const token of majorTokens) {
      this.addTokenRule({
        address: token.address,
        symbol: token.symbol,
        status: 'whitelisted',
        maxSlippage: 5, // 5% max slippage for major tokens
        note: 'Major token - auto whitelisted',
        addedAt: new Date(),
        updatedAt: new Date()
      });
    }

    logger.info({ count: majorTokens.length }, 'Initialized default token whitelist');
  }

  /**
   * Perform comprehensive risk check for a trade
   */
  async checkTradeRisk(request: TradeRequest): Promise<RiskCheckResult> {
    const violations: RiskViolation[] = [];
    const warnings: RiskViolation[] = [];

    try {
      // 1. Check emergency stop
      if (this.emergencyStop) {
        violations.push({
          id: `emergency_${Date.now()}`,
          type: 'emergency_stop',
          severity: 'critical',
          entity: 'system',
          message: 'Emergency stop is active - all trading suspended',
          timestamp: new Date(),
          blockTransaction: true
        });
      }

      // 2. Check wallet status
      const walletCheck = this.checkWalletRisk(request.walletAddress, request.amountIn);
      violations.push(...walletCheck.violations);
      warnings.push(...walletCheck.warnings);

      // 3. Check token status
      const tokenInCheck = this.checkTokenRisk(request.tokenIn, request.amountIn, request.slippageTolerance);
      const tokenOutCheck = this.checkTokenRisk(request.tokenOut, '0', request.slippageTolerance);
      
      violations.push(...tokenInCheck.violations, ...tokenOutCheck.violations);
      warnings.push(...tokenInCheck.warnings, ...tokenOutCheck.warnings);

      // 4. Check trading limits
      const limitsCheck = await this.checkTradingLimits(request);
      violations.push(...limitsCheck.violations);
      warnings.push(...limitsCheck.warnings);

      // 5. Check rate limits
      const rateCheck = this.checkRateLimit(request.walletAddress);
      violations.push(...rateCheck.violations);
      warnings.push(...rateCheck.warnings);

      // 6. Check price impact
      if (request.priceImpact !== undefined) {
        const impactCheck = this.checkPriceImpact(request.priceImpact);
        violations.push(...impactCheck.violations);
        warnings.push(...impactCheck.warnings);
      }

      // 7. Generate recommendations
      const adjustedSlippage = this.calculateOptimalSlippage(request, warnings);
      const recommendedAction = this.generateRecommendedAction(violations, warnings);

      const result: RiskCheckResult = {
        allowed: violations.filter(v => v.blockTransaction).length === 0,
        violations,
        warnings,
        adjustedSlippage,
        recommendedAction
      };

      logger.debug({
        wallet: request.walletAddress,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        allowed: result.allowed,
        violationCount: violations.length,
        warningCount: warnings.length
      }, 'Risk check completed');

      return result;

    } catch (error) {
      logger.error({ error, request }, 'Risk check failed');
      
      // Return conservative result on error
      return {
        allowed: false,
        violations: [{
          id: `error_${Date.now()}`,
          type: 'emergency_stop',
          severity: 'critical',
          entity: 'system',
          message: `Risk check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date(),
          blockTransaction: true
        }],
        warnings: []
      };
    }
  }

  /**
   * Check wallet-specific risks
   */
  private checkWalletRisk(walletAddress: string, amountIn: string): { violations: RiskViolation[]; warnings: RiskViolation[] } {
    const violations: RiskViolation[] = [];
    const warnings: RiskViolation[] = [];

    const walletRule = this.walletRules.get(walletAddress.toLowerCase());
    
    if (walletRule) {
      // Check if wallet is disabled
      if (walletRule.status === 'disabled') {
        violations.push({
          id: `wallet_disabled_${Date.now()}`,
          type: 'wallet_disabled',
          severity: 'error',
          entity: walletAddress,
          message: `Wallet is disabled: ${walletRule.note || 'No reason provided'}`,
          timestamp: new Date(),
          blockTransaction: true
        });
      }

      // Check transaction amount limit
      if (walletRule.maxTransactionAmount) {
        const amountBNB = parseFloat(ethers.formatEther(amountIn));
        const maxAmount = parseFloat(ethers.formatEther(walletRule.maxTransactionAmount));
        
        if (amountBNB > maxAmount) {
          violations.push({
            id: `amount_exceeded_${Date.now()}`,
            type: 'amount_exceeded',
            severity: 'error',
            entity: walletAddress,
            message: `Transaction amount ${amountBNB.toFixed(4)} BNB exceeds wallet limit ${maxAmount.toFixed(4)} BNB`,
            currentValue: amountBNB,
            limitValue: maxAmount,
            timestamp: new Date(),
            blockTransaction: true
          });
        }
      }

      // Check daily volume limit
      if (walletRule.maxDailyTradingVolume) {
        const dailyStats = this.getDailyStats(walletAddress);
        const currentVolume = parseFloat(ethers.formatEther(dailyStats.totalVolumeBNB));
        const newVolume = currentVolume + parseFloat(ethers.formatEther(amountIn));
        const maxVolume = parseFloat(ethers.formatEther(walletRule.maxDailyTradingVolume));
        
        if (newVolume > maxVolume) {
          violations.push({
            id: `daily_limit_exceeded_${Date.now()}`,
            type: 'daily_limit_exceeded',
            severity: 'error',
            entity: walletAddress,
            message: `Daily trading volume would exceed limit: ${newVolume.toFixed(4)} > ${maxVolume.toFixed(4)} BNB`,
            currentValue: newVolume,
            limitValue: maxVolume,
            timestamp: new Date(),
            blockTransaction: true
          });
        } else if (newVolume > maxVolume * 0.8) {
          warnings.push({
            id: `daily_limit_warning_${Date.now()}`,
            type: 'daily_limit_exceeded',
            severity: 'warning',
            entity: walletAddress,
            message: `Daily trading volume approaching limit: ${newVolume.toFixed(4)} / ${maxVolume.toFixed(4)} BNB`,
            currentValue: newVolume,
            limitValue: maxVolume,
            timestamp: new Date(),
            blockTransaction: false
          });
        }
      }
    }

    return { violations, warnings };
  }

  /**
   * Check token-specific risks
   */
  private checkTokenRisk(tokenAddress: string, amount: string, slippage: number): { violations: RiskViolation[]; warnings: RiskViolation[] } {
    const violations: RiskViolation[] = [];
    const warnings: RiskViolation[] = [];

    const tokenRule = this.tokenRules.get(tokenAddress.toLowerCase());
    
    if (tokenRule) {
      // Check if token is blacklisted
      if (tokenRule.status === 'blacklisted') {
        violations.push({
          id: `token_blacklisted_${Date.now()}`,
          type: 'token_blacklisted',
          severity: 'critical',
          entity: tokenAddress,
          message: `Token ${tokenRule.symbol} is blacklisted: ${tokenRule.note || 'No reason provided'}`,
          timestamp: new Date(),
          blockTransaction: true
        });
      }

      // Check minimum trade amount
      if (tokenRule.minTradeAmount && amount !== '0') {
        const tradeAmount = BigInt(amount);
        const minAmount = BigInt(tokenRule.minTradeAmount);
        
        if (tradeAmount < minAmount) {
          violations.push({
            id: `min_amount_${Date.now()}`,
            type: 'amount_exceeded',
            severity: 'error',
            entity: tokenAddress,
            message: `Trade amount below minimum for ${tokenRule.symbol}`,
            timestamp: new Date(),
            blockTransaction: true
          });
        }
      }

      // Check maximum trade amount
      if (tokenRule.maxTradeAmount && amount !== '0') {
        const tradeAmount = BigInt(amount);
        const maxAmount = BigInt(tokenRule.maxTradeAmount);
        
        if (tradeAmount > maxAmount) {
          violations.push({
            id: `max_amount_${Date.now()}`,
            type: 'amount_exceeded',
            severity: 'error',
            entity: tokenAddress,
            message: `Trade amount exceeds maximum for ${tokenRule.symbol}`,
            timestamp: new Date(),
            blockTransaction: true
          });
        }
      }

      // Check slippage limits
      if (tokenRule.maxSlippage && slippage > tokenRule.maxSlippage) {
        violations.push({
          id: `slippage_exceeded_${Date.now()}`,
          type: 'slippage_exceeded',
          severity: 'error',
          entity: tokenAddress,
          message: `Slippage ${slippage.toFixed(2)}% exceeds maximum ${tokenRule.maxSlippage.toFixed(2)}% for ${tokenRule.symbol}`,
          currentValue: slippage,
          limitValue: tokenRule.maxSlippage,
          timestamp: new Date(),
          blockTransaction: true
        });
      }
    } else {
      // Token not in rules - check if whitelist is enforced
      const riskConfig = configManager.getRiskConfig();
      if (riskConfig.enableWhitelist) {
        warnings.push({
          id: `token_not_whitelisted_${Date.now()}`,
          type: 'token_blacklisted',
          severity: 'warning',
          entity: tokenAddress,
          message: 'Token not in whitelist - proceed with caution',
          timestamp: new Date(),
          blockTransaction: false
        });
      }
    }

    return { violations, warnings };
  }

  /**
   * Check trading limits
   */
  private async checkTradingLimits(request: TradeRequest): Promise<{ violations: RiskViolation[]; warnings: RiskViolation[] }> {
    const violations: RiskViolation[] = [];
    const warnings: RiskViolation[] = [];

    try {
      // Convert amount to BNB value
      let amountBNB: number;
      if (request.tokenIn.toLowerCase() === '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c') {
        amountBNB = parseFloat(ethers.formatEther(request.amountIn));
      } else {
        // Get BNB equivalent value
        try {
          const quote = await enhancedPricingService.getTradeQuote(
            request.tokenIn,
            '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
            request.amountIn,
            0.005
          );
          amountBNB = parseFloat(quote.tokenOut.amount);
        } catch (error) {
          amountBNB = 0;
        }
      }

      // Check position size limit
      if (amountBNB > this.tradingLimits.maxPositionSizeBNB) {
        violations.push({
          id: `position_size_${Date.now()}`,
          type: 'amount_exceeded',
          severity: 'error',
          entity: request.walletAddress,
          message: `Position size ${amountBNB.toFixed(4)} BNB exceeds maximum ${this.tradingLimits.maxPositionSizeBNB} BNB`,
          currentValue: amountBNB,
          limitValue: this.tradingLimits.maxPositionSizeBNB,
          timestamp: new Date(),
          blockTransaction: true
        });
      }

      // Check slippage limits
      if (request.slippageTolerance > this.tradingLimits.maxSlippagePercent) {
        violations.push({
          id: `slippage_${Date.now()}`,
          type: 'slippage_exceeded',
          severity: 'error',
          entity: request.walletAddress,
          message: `Slippage ${request.slippageTolerance.toFixed(2)}% exceeds maximum ${this.tradingLimits.maxSlippagePercent.toFixed(2)}%`,
          currentValue: request.slippageTolerance,
          limitValue: this.tradingLimits.maxSlippagePercent,
          timestamp: new Date(),
          blockTransaction: true
        });
      }

    } catch (error) {
      logger.warn({ error }, 'Failed to check trading limits');
    }

    return { violations, warnings };
  }

  /**
   * Check rate limits
   */
  private checkRateLimit(walletAddress: string): { violations: RiskViolation[]; warnings: RiskViolation[] } {
    const violations: RiskViolation[] = [];
    const warnings: RiskViolation[] = [];

    const recentTxs = this.recentTransactions.get(walletAddress) || [];
    const now = Date.now();
    
    // Remove old transactions (older than 1 minute)
    const validTxs = recentTxs.filter(tx => now - tx < 60000);
    this.recentTransactions.set(walletAddress, validTxs);

    // Check minimum interval between transactions
    if (validTxs.length > 0) {
      const lastTx = Math.max(...validTxs);
      const timeSinceLastTx = now - lastTx;
      
      if (timeSinceLastTx < this.tradingLimits.minTransactionIntervalMs) {
        violations.push({
          id: `rate_limit_${Date.now()}`,
          type: 'rate_limit',
          severity: 'error',
          entity: walletAddress,
          message: `Transaction too soon after previous trade. Wait ${((this.tradingLimits.minTransactionIntervalMs - timeSinceLastTx) / 1000).toFixed(1)} seconds`,
          currentValue: timeSinceLastTx,
          limitValue: this.tradingLimits.minTransactionIntervalMs,
          timestamp: new Date(),
          blockTransaction: true
        });
      }
    }

    // Check transaction frequency
    if (validTxs.length >= 10) {
      warnings.push({
        id: `high_frequency_${Date.now()}`,
        type: 'rate_limit',
        severity: 'warning',
        entity: walletAddress,
        message: `High transaction frequency detected: ${validTxs.length} transactions in last minute`,
        currentValue: validTxs.length,
        limitValue: 10,
        timestamp: new Date(),
        blockTransaction: false
      });
    }

    return { violations, warnings };
  }

  /**
   * Check price impact
   */
  private checkPriceImpact(priceImpact: number): { violations: RiskViolation[]; warnings: RiskViolation[] } {
    const violations: RiskViolation[] = [];
    const warnings: RiskViolation[] = [];

    if (priceImpact > this.tradingLimits.maxPriceImpactPercent) {
      violations.push({
        id: `price_impact_${Date.now()}`,
        type: 'price_impact_high',
        severity: 'error',
        entity: 'trade',
        message: `Price impact ${priceImpact.toFixed(2)}% exceeds maximum ${this.tradingLimits.maxPriceImpactPercent.toFixed(2)}%`,
        currentValue: priceImpact,
        limitValue: this.tradingLimits.maxPriceImpactPercent,
        timestamp: new Date(),
        blockTransaction: true
      });
    } else if (priceImpact > this.tradingLimits.maxPriceImpactPercent * 0.7) {
      warnings.push({
        id: `price_impact_warning_${Date.now()}`,
        type: 'price_impact_high',
        severity: 'warning',
        entity: 'trade',
        message: `High price impact detected: ${priceImpact.toFixed(2)}%`,
        currentValue: priceImpact,
        limitValue: this.tradingLimits.maxPriceImpactPercent,
        timestamp: new Date(),
        blockTransaction: false
      });
    }

    return { violations, warnings };
  }

  /**
   * Calculate optimal slippage based on warnings
   */
  private calculateOptimalSlippage(request: TradeRequest, warnings: RiskViolation[]): number | undefined {
    let adjustedSlippage = request.slippageTolerance;

    // Increase slippage if high price impact detected
    const priceImpactWarning = warnings.find(w => w.type === 'price_impact_high');
    if (priceImpactWarning && priceImpactWarning.currentValue) {
      adjustedSlippage = Math.max(adjustedSlippage, priceImpactWarning.currentValue * 1.2);
    }

    // Cap at maximum allowed slippage
    adjustedSlippage = Math.min(adjustedSlippage, this.tradingLimits.maxSlippagePercent);

    return adjustedSlippage !== request.slippageTolerance ? adjustedSlippage : undefined;
  }

  /**
   * Generate recommended action
   */
  private generateRecommendedAction(violations: RiskViolation[], warnings: RiskViolation[]): string | undefined {
    if (violations.length > 0) {
      const critical = violations.filter(v => v.severity === 'critical');
      if (critical.length > 0) {
        return 'BLOCK: Critical violations detected';
      }
      return 'BLOCK: Risk violations detected';
    }

    if (warnings.length > 0) {
      const highWarnings = warnings.filter(w => w.severity === 'warning' && w.type === 'price_impact_high');
      if (highWarnings.length > 0) {
        return 'CAUTION: Consider reducing trade size due to high price impact';
      }
      return 'PROCEED WITH CAUTION: Warnings detected';
    }

    return undefined;
  }

  /**
   * Record successful transaction for tracking
   */
  recordTransaction(walletAddress: string, amountBNB: string, slippage: number): void {
    // Update recent transactions for rate limiting
    const recentTxs = this.recentTransactions.get(walletAddress) || [];
    recentTxs.push(Date.now());
    this.recentTransactions.set(walletAddress, recentTxs);

    // Update daily stats
    const today = new Date().toISOString().split('T')[0];
    const statsKey = `${walletAddress}_${today}`;
    const existingStats = this.dailyStats.get(statsKey) || {
      walletAddress,
      date: today,
      transactionCount: 0,
      totalVolumeBNB: '0',
      largestTransactionBNB: '0',
      averageSlippage: 0,
      lastTransactionTime: new Date()
    };

    existingStats.transactionCount++;
    existingStats.totalVolumeBNB = (BigInt(existingStats.totalVolumeBNB) + BigInt(amountBNB)).toString();
    existingStats.largestTransactionBNB = BigInt(amountBNB) > BigInt(existingStats.largestTransactionBNB) ? 
      amountBNB : existingStats.largestTransactionBNB;
    existingStats.averageSlippage = (existingStats.averageSlippage * (existingStats.transactionCount - 1) + slippage) / 
      existingStats.transactionCount;
    existingStats.lastTransactionTime = new Date();

    this.dailyStats.set(statsKey, existingStats);
  }

  /**
   * Get daily stats for a wallet
   */
  getDailyStats(walletAddress: string): DailyStats {
    const today = new Date().toISOString().split('T')[0];
    const statsKey = `${walletAddress}_${today}`;
    
    return this.dailyStats.get(statsKey) || {
      walletAddress,
      date: today,
      transactionCount: 0,
      totalVolumeBNB: '0',
      largestTransactionBNB: '0',
      averageSlippage: 0,
      lastTransactionTime: new Date()
    };
  }

  /**
   * Token management methods
   */
  addTokenRule(rule: Omit<TokenRule, 'updatedAt'>): void {
    const tokenRule: TokenRule = {
      ...rule,
      updatedAt: new Date()
    };
    
    this.tokenRules.set(rule.address.toLowerCase(), tokenRule);
    
    logger.info({
      address: rule.address,
      symbol: rule.symbol,
      status: rule.status
    }, 'Token rule added');
  }

  removeTokenRule(tokenAddress: string): boolean {
    const removed = this.tokenRules.delete(tokenAddress.toLowerCase());
    
    if (removed) {
      logger.info({ address: tokenAddress }, 'Token rule removed');
    }
    
    return removed;
  }

  getTokenRule(tokenAddress: string): TokenRule | undefined {
    return this.tokenRules.get(tokenAddress.toLowerCase());
  }

  getTokenRules(): TokenRule[] {
    return Array.from(this.tokenRules.values());
  }

  /**
   * Wallet management methods
   */
  addWalletRule(rule: Omit<WalletRule, 'updatedAt'>): void {
    const walletRule: WalletRule = {
      ...rule,
      updatedAt: new Date()
    };
    
    this.walletRules.set(rule.address.toLowerCase(), walletRule);
    
    logger.info({
      address: rule.address,
      label: rule.label,
      status: rule.status
    }, 'Wallet rule added');
  }

  removeWalletRule(walletAddress: string): boolean {
    const removed = this.walletRules.delete(walletAddress.toLowerCase());
    
    if (removed) {
      logger.info({ address: walletAddress }, 'Wallet rule removed');
    }
    
    return removed;
  }

  getWalletRule(walletAddress: string): WalletRule | undefined {
    return this.walletRules.get(walletAddress.toLowerCase());
  }

  getWalletRules(): WalletRule[] {
    return Array.from(this.walletRules.values());
  }

  /**
   * Emergency controls
   */
  activateEmergencyStop(reason: string): void {
    this.emergencyStop = true;
    logger.error({ reason }, 'Emergency stop activated');
  }

  deactivateEmergencyStop(): void {
    this.emergencyStop = false;
    logger.info('Emergency stop deactivated');
  }

  isEmergencyStopActive(): boolean {
    return this.emergencyStop;
  }

  /**
   * Configuration methods
   */
  updateTradingLimits(limits: Partial<TradingLimits>): void {
    this.tradingLimits = { ...this.tradingLimits, ...limits };
    logger.info({ limits }, 'Trading limits updated');
  }

  getTradingLimits(): TradingLimits {
    return { ...this.tradingLimits };
  }

  /**
   * Bulk operations
   */
  addTokensToWhitelist(tokens: Array<{ address: string; symbol: string; maxSlippage?: number }>): void {
    for (const token of tokens) {
      this.addTokenRule({
        address: token.address,
        symbol: token.symbol,
        status: 'whitelisted',
        maxSlippage: token.maxSlippage || 5,
        note: 'Bulk whitelist addition',
        addedAt: new Date()
      });
    }
    
    logger.info({ count: tokens.length }, 'Bulk whitelist operation completed');
  }

  addTokensToBlacklist(tokens: Array<{ address: string; symbol: string; reason: string }>): void {
    for (const token of tokens) {
      this.addTokenRule({
        address: token.address,
        symbol: token.symbol,
        status: 'blacklisted',
        note: token.reason,
        addedAt: new Date()
      });
    }
    
    logger.info({ count: tokens.length }, 'Bulk blacklist operation completed');
  }

  /**
   * Statistics and reporting
   */
  getRiskSummary(): {
    tokenRules: { whitelisted: number; blacklisted: number; restricted: number };
    walletRules: { enabled: number; disabled: number; restricted: number };
    emergencyStop: boolean;
    dailyStats: DailyStats[];
  } {
    const tokenStats = { whitelisted: 0, blacklisted: 0, restricted: 0 };
    for (const rule of this.tokenRules.values()) {
      tokenStats[rule.status]++;
    }

    const walletStats = { enabled: 0, disabled: 0, restricted: 0 };
    for (const rule of this.walletRules.values()) {
      walletStats[rule.status]++;
    }

    return {
      tokenRules: tokenStats,
      walletRules: walletStats,
      emergencyStop: this.emergencyStop,
      dailyStats: Array.from(this.dailyStats.values())
    };
  }

  /**
   * Cleanup old data
   */
  cleanup(): void {
    const now = Date.now();
    const oldCutoff = now - (24 * 60 * 60 * 1000); // 24 hours ago

    // Clean up old transaction records
    for (const [wallet, transactions] of this.recentTransactions.entries()) {
      const validTxs = transactions.filter(tx => tx > oldCutoff);
      if (validTxs.length === 0) {
        this.recentTransactions.delete(wallet);
      } else {
        this.recentTransactions.set(wallet, validTxs);
      }
    }

    // Clean up old daily stats (keep last 30 days)
    const daysCutoff = new Date();
    daysCutoff.setDate(daysCutoff.getDate() - 30);
    const dateCutoff = daysCutoff.toISOString().split('T')[0];

    for (const [key, stats] of this.dailyStats.entries()) {
      if (stats.date < dateCutoff) {
        this.dailyStats.delete(key);
      }
    }

    logger.debug('Risk manager data cleanup completed');
  }
}

export const enhancedRiskManager = EnhancedRiskManager.getInstance();