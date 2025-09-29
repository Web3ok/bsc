import { logger } from '../utils/logger';
import { configManager } from '../config';
import { TokenService } from '../dex/token';
import { QuoteResult } from '../dex/pricing';

export interface RiskLimits {
  maxSlippage: number;           // Maximum allowed slippage (0.05 = 5%)
  maxPriceImpact: number;        // Maximum allowed price impact
  maxSingleTradeBNB: number;     // Maximum BNB value per single trade
  maxDailyVolumeBNB: number;     // Maximum BNB volume per day
  minLiquidityBNB: number;       // Minimum liquidity requirement
  maxPositionConcentration: number; // Max % of total balance in single token
}

export interface TradeValidationResult {
  allowed: boolean;
  reasons: string[];
  riskScore: number; // 0-100, higher = riskier
  warnings: string[];
}

export interface DailyStats {
  date: string;
  totalVolumeBNB: number;
  tradeCount: number;
  addresses: Set<string>;
  tokens: Set<string>;
}

export class RiskManager {
  private static instance: RiskManager;
  private tokenService: TokenService;
  private dailyStats = new Map<string, DailyStats>();
  private whitelist = new Set<string>();
  private blacklist = new Set<string>();
  private suspiciousAddresses = new Set<string>();
  
  // Default risk limits
  private limits: RiskLimits = {
    maxSlippage: 0.05,              // 5%
    maxPriceImpact: 0.03,           // 3%
    maxSingleTradeBNB: 10,          // 10 BNB
    maxDailyVolumeBNB: 100,         // 100 BNB
    minLiquidityBNB: 1,             // 1 BNB minimum liquidity
    maxPositionConcentration: 0.3,  // 30%
  };

  private constructor() {
    this.tokenService = new TokenService();
    this.loadConfiguration();
  }

  public static getInstance(): RiskManager {
    if (!RiskManager.instance) {
      RiskManager.instance = new RiskManager();
    }
    return RiskManager.instance;
  }

  private loadConfiguration(): void {
    try {
      const config = configManager.config.risk;
      
      this.limits = {
        maxSlippage: config.suspicious_slippage_threshold || 0.05,
        maxPriceImpact: 0.03,
        maxSingleTradeBNB: config.max_single_trade_bnb || 10,
        maxDailyVolumeBNB: config.max_daily_volume_bnb || 100,
        minLiquidityBNB: 1,
        maxPositionConcentration: 0.3,
      };

      // Load whitelist/blacklist from config
      if (config.enable_whitelist) {
        // TODO: Load from tokens.yml
        this.loadTokenLists();
      }

      logger.info({ limits: this.limits }, 'Risk manager initialized with limits');
    } catch (error) {
      logger.error({ error }, 'Failed to load risk configuration, using defaults');
    }
  }

  private async loadTokenLists(): Promise<void> {
    try {
      // This would load from configs/tokens.yml
      // For now, we'll use known safe tokens
      const safeTokens = [
        '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        '0x55d398326f99059fF775485246999027B3197955', // USDT
        '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
        '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', // USDC
        '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // CAKE
      ];

      safeTokens.forEach(token => this.whitelist.add(token.toLowerCase()));
      logger.info(`Loaded ${this.whitelist.size} whitelisted tokens`);
    } catch (error) {
      logger.error({ error }, 'Failed to load token lists');
    }
  }

  async validateTrade(
    walletAddress: string,
    quote: QuoteResult,
    tradeBNBValue: number
  ): Promise<TradeValidationResult> {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let riskScore = 0;

    // 1. Slippage check
    if (quote.slippage > this.limits.maxSlippage) {
      reasons.push(`Slippage too high: ${(quote.slippage * 100).toFixed(2)}% > ${(this.limits.maxSlippage * 100).toFixed(2)}%`);
      riskScore += 30;
    } else if (quote.slippage > this.limits.maxSlippage * 0.7) {
      warnings.push(`High slippage: ${(quote.slippage * 100).toFixed(2)}%`);
      riskScore += 15;
    }

    // 2. Price impact check
    if (quote.priceImpact > this.limits.maxPriceImpact) {
      reasons.push(`Price impact too high: ${(quote.priceImpact * 100).toFixed(2)}% > ${(this.limits.maxPriceImpact * 100).toFixed(2)}%`);
      riskScore += 25;
    } else if (quote.priceImpact > this.limits.maxPriceImpact * 0.7) {
      warnings.push(`High price impact: ${(quote.priceImpact * 100).toFixed(2)}%`);
      riskScore += 10;
    }

    // 3. Single trade size check
    if (tradeBNBValue > this.limits.maxSingleTradeBNB) {
      reasons.push(`Trade size too large: ${tradeBNBValue} BNB > ${this.limits.maxSingleTradeBNB} BNB`);
      riskScore += 20;
    } else if (tradeBNBValue > this.limits.maxSingleTradeBNB * 0.8) {
      warnings.push(`Large trade size: ${tradeBNBValue} BNB`);
      riskScore += 10;
    }

    // 4. Daily volume check
    const dailyVolume = this.getDailyVolume(walletAddress);
    if (dailyVolume + tradeBNBValue > this.limits.maxDailyVolumeBNB) {
      reasons.push(`Daily volume limit exceeded: ${(dailyVolume + tradeBNBValue).toFixed(2)} BNB > ${this.limits.maxDailyVolumeBNB} BNB`);
      riskScore += 15;
    }

    // 5. Token whitelist/blacklist check
    const tokenInCheck = await this.checkTokenSafety(quote.tokenIn.address);
    const tokenOutCheck = await this.checkTokenSafety(quote.tokenOut.address);

    if (!tokenInCheck.safe) {
      reasons.push(`Input token flagged: ${tokenInCheck.reason}`);
      riskScore += 40;
    }

    if (!tokenOutCheck.safe) {
      reasons.push(`Output token flagged: ${tokenOutCheck.reason}`);
      riskScore += 40;
    }

    if (tokenInCheck.warning) {
      warnings.push(`Input token warning: ${tokenInCheck.warning}`);
      riskScore += 5;
    }

    if (tokenOutCheck.warning) {
      warnings.push(`Output token warning: ${tokenOutCheck.warning}`);
      riskScore += 5;
    }

    // 6. Suspicious address check
    if (this.suspiciousAddresses.has(walletAddress.toLowerCase())) {
      reasons.push('Wallet address flagged as suspicious');
      riskScore += 50;
    }

    // 7. Rate limiting check
    const rateLimitCheck = this.checkRateLimit(walletAddress);
    if (!rateLimitCheck.allowed) {
      reasons.push(rateLimitCheck.reason);
      riskScore += 20;
    }

    const result: TradeValidationResult = {
      allowed: reasons.length === 0,
      reasons,
      riskScore: Math.min(riskScore, 100),
      warnings,
    };

    logger.debug({
      walletAddress,
      tokenIn: quote.tokenIn.symbol,
      tokenOut: quote.tokenOut.symbol,
      tradeBNBValue,
      result,
    }, 'Trade validation completed');

    return result;
  }

  private async checkTokenSafety(tokenAddress: string): Promise<{
    safe: boolean;
    reason?: string;
    warning?: string;
  }> {
    const lowerAddress = tokenAddress.toLowerCase();

    // Check blacklist first
    if (this.blacklist.has(lowerAddress)) {
      return { safe: false, reason: 'Token is blacklisted' };
    }

    // If whitelist is enabled, check if token is whitelisted
    if (configManager.config.risk.enable_whitelist && this.whitelist.size > 0) {
      if (!this.whitelist.has(lowerAddress) && tokenAddress !== 'BNB') {
        return { safe: false, reason: 'Token not in whitelist' };
      }
    }

    try {
      // Get token info to verify it exists
      const tokenInfo = await this.tokenService.getTokenInfo(tokenAddress);
      
      // Basic token safety checks
      if (tokenInfo.symbol.length > 20) {
        return { safe: false, reason: 'Suspicious token symbol length' };
      }

      if (tokenInfo.name.toLowerCase().includes('scam') || 
          tokenInfo.symbol.toLowerCase().includes('scam')) {
        return { safe: false, reason: 'Token name/symbol contains suspicious words' };
      }

      // Warning for new/unknown tokens
      if (!this.whitelist.has(lowerAddress) && tokenAddress !== 'BNB') {
        return { safe: true, warning: 'Unknown token - trade with caution' };
      }

      return { safe: true };

    } catch (error) {
      return { safe: false, reason: 'Failed to verify token contract' };
    }
  }

  private getDailyVolume(walletAddress: string): number {
    const today = new Date().toISOString().split('T')[0];
    const stats = this.dailyStats.get(`${walletAddress}-${today}`);
    return stats ? stats.totalVolumeBNB : 0;
  }

  private checkRateLimit(walletAddress: string): { allowed: boolean; reason: string } {
    const today = new Date().toISOString().split('T')[0];
    const stats = this.dailyStats.get(`${walletAddress}-${today}`);
    
    if (stats && stats.tradeCount >= 100) { // Max 100 trades per day
      return { allowed: false, reason: 'Daily trade limit exceeded (100 trades)' };
    }

    return { allowed: true, reason: '' };
  }

  recordTrade(
    walletAddress: string,
    tokenIn: string,
    tokenOut: string,
    volumeBNB: number
  ): void {
    const today = new Date().toISOString().split('T')[0];
    const key = `${walletAddress}-${today}`;
    
    let stats = this.dailyStats.get(key);
    if (!stats) {
      stats = {
        date: today,
        totalVolumeBNB: 0,
        tradeCount: 0,
        addresses: new Set(),
        tokens: new Set(),
      };
      this.dailyStats.set(key, stats);
    }

    stats.totalVolumeBNB += volumeBNB;
    stats.tradeCount += 1;
    stats.addresses.add(walletAddress.toLowerCase());
    stats.tokens.add(tokenIn.toLowerCase());
    stats.tokens.add(tokenOut.toLowerCase());

    logger.debug({
      walletAddress,
      date: today,
      tradeCount: stats.tradeCount,
      totalVolumeBNB: stats.totalVolumeBNB,
    }, 'Recorded trade in daily stats');
  }

  // Risk management utilities
  addToBlacklist(address: string): void {
    this.blacklist.add(address.toLowerCase());
    logger.info({ address }, 'Added address to blacklist');
  }

  addToWhitelist(address: string): void {
    this.whitelist.add(address.toLowerCase());
    logger.info({ address }, 'Added address to whitelist');
  }

  flagSuspiciousAddress(address: string, reason: string): void {
    this.suspiciousAddresses.add(address.toLowerCase());
    logger.warn({ address, reason }, 'Flagged address as suspicious');
  }

  updateLimits(newLimits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
    logger.info({ limits: this.limits }, 'Updated risk limits');
  }

  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  getDailyStats(walletAddress?: string): Map<string, DailyStats> {
    if (walletAddress) {
      const filtered = new Map<string, DailyStats>();
      for (const [key, stats] of this.dailyStats.entries()) {
        if (key.startsWith(walletAddress.toLowerCase())) {
          filtered.set(key, stats);
        }
      }
      return filtered;
    }
    return new Map(this.dailyStats);
  }

  // Clean up old daily stats (call periodically)
  cleanupOldStats(olderThanDays = 7): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const cutoffString = cutoff.toISOString().split('T')[0];

    let cleaned = 0;
    for (const [key, stats] of this.dailyStats.entries()) {
      if (stats.date < cutoffString) {
        this.dailyStats.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned, remaining: this.dailyStats.size }, 'Cleaned up old daily stats');
    }

    return cleaned;
  }

  // Emergency pause functionality
  private emergencyPaused = false;
  private emergencyReason = '';

  emergencyPause(reason: string): void {
    this.emergencyPaused = true;
    this.emergencyReason = reason;
    logger.error({ reason }, 'EMERGENCY PAUSE ACTIVATED');
  }

  emergencyResume(): void {
    this.emergencyPaused = false;
    this.emergencyReason = '';
    logger.info('Emergency pause lifted');
  }

  isEmergencyPaused(): { paused: boolean; reason?: string } {
    return {
      paused: this.emergencyPaused,
      reason: this.emergencyPaused ? this.emergencyReason : undefined,
    };
  }
}

export const riskManager = RiskManager.getInstance();