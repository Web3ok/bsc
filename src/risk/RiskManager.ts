import pino from 'pino';

const logger = pino({ name: 'RiskManager' });

export interface RiskConfig {
  maxTradeAmountBNB: number;
  maxSlippagePercent: number;
  cooldownPeriodMs: number;
  maxTradesPerHour: number;
  blacklistedTokens: string[];
  whitelistedTokens: string[];
}

export interface RiskAssessment {
  level: 'low' | 'medium' | 'high' | 'critical';
  allowed: boolean;
  reason?: string;
  score: number;
}

export interface TradeRequest {
  type: 'buy' | 'sell';
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage: number;
  walletAddress: string;
}

export class RiskManager {
  private config: RiskConfig;
  private tradeHistory: Map<string, any[]> = new Map();
  private blacklistedAddresses: Set<string> = new Set();

  constructor(config?: Partial<RiskConfig>) {
    this.config = {
      maxTradeAmountBNB: 10, // 最大交易金额 10 BNB
      maxSlippagePercent: 5, // 最大滑点 5%
      cooldownPeriodMs: 60000, // 冷却期 1分钟
      maxTradesPerHour: 20, // 每小时最大交易次数
      blacklistedTokens: [
        '0x0000000000000000000000000000000000000000' // 无效地址
      ],
      whitelistedTokens: [
        '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', // WBNB testnet
        '0x7ef95a0FEE0Dd31b22626fF2E1d9aFAE5a581a86', // BUSD testnet
        '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7'  // USDT testnet
      ],
      ...config
    };

    logger.info({ config: this.config }, 'RiskManager initialized');
  }

  async assessRisk(request: TradeRequest): Promise<RiskAssessment> {
    logger.debug({ request }, 'Assessing trade risk');

    try {
      const assessments = [
        this.assessAmountRisk(request),
        this.assessSlippageRisk(request),
        this.assessTokenRisk(request),
        this.assessFrequencyRisk(request),
        this.assessCooldownRisk(request)
      ];

      // 计算综合风险分数
      const totalScore = assessments.reduce((sum, assessment) => sum + assessment.score, 0);
      const averageScore = totalScore / assessments.length;

      // 确定风险等级
      const level = this.determineRiskLevel(averageScore);
      
      // 检查是否允许交易
      const blockedAssessments = assessments.filter(a => !a.allowed);
      const allowed = blockedAssessments.length === 0;
      
      const result: RiskAssessment = {
        level,
        allowed,
        reason: blockedAssessments.length > 0 ? blockedAssessments[0].reason : undefined,
        score: averageScore
      };

      logger.debug({ result, assessments }, 'Risk assessment completed');
      return result;

    } catch (error) {
      logger.error({ error, request }, 'Risk assessment failed');
      
      return {
        level: 'critical',
        allowed: false,
        reason: 'Risk assessment failed',
        score: 100
      };
    }
  }

  async recordTrade(request: TradeRequest, result: 'success' | 'failed'): Promise<void> {
    const walletHistory = this.tradeHistory.get(request.walletAddress) || [];
    
    walletHistory.push({
      timestamp: Date.now(),
      request,
      result,
      amount: parseFloat(request.amountIn)
    });

    this.tradeHistory.set(request.walletAddress, walletHistory);
    
    logger.debug({ 
      walletAddress: request.walletAddress, 
      result, 
      totalTrades: walletHistory.length 
    }, 'Trade recorded');
  }

  async getWalletRiskProfile(walletAddress: string): Promise<{
    totalTrades: number;
    successRate: number;
    averageTradeSize: number;
    lastTradeTime: number | null;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
  }> {
    const history = this.tradeHistory.get(walletAddress) || [];
    
    if (history.length === 0) {
      return {
        totalTrades: 0,
        successRate: 0,
        averageTradeSize: 0,
        lastTradeTime: null,
        riskLevel: 'low'
      };
    }

    const successfulTrades = history.filter(t => t.result === 'success').length;
    const successRate = successfulTrades / history.length;
    const averageTradeSize = history.reduce((sum, t) => sum + t.amount, 0) / history.length;
    const lastTradeTime = Math.max(...history.map(t => t.timestamp));

    // 基于历史数据评估风险等级
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    if (successRate < 0.5) riskLevel = 'high';
    else if (successRate < 0.7) riskLevel = 'medium';
    if (averageTradeSize > this.config.maxTradeAmountBNB / 2) {
      riskLevel = riskLevel === 'low' ? 'medium' : 'high';
    }

    return {
      totalTrades: history.length,
      successRate,
      averageTradeSize,
      lastTradeTime,
      riskLevel
    };
  }

  addToBlacklist(address: string): void {
    this.blacklistedAddresses.add(address.toLowerCase());
    logger.info({ address }, 'Address added to blacklist');
  }

  removeFromBlacklist(address: string): void {
    this.blacklistedAddresses.delete(address.toLowerCase());
    logger.info({ address }, 'Address removed from blacklist');
  }

  isBlacklisted(address: string): boolean {
    return this.blacklistedAddresses.has(address.toLowerCase());
  }

  // 私有风险评估方法
  private assessAmountRisk(request: TradeRequest): RiskAssessment {
    const amount = parseFloat(request.amountIn);
    const maxAmount = this.config.maxTradeAmountBNB;

    let score = 0;
    let level: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let allowed = true;

    if (amount > maxAmount) {
      score = 100;
      level = 'critical';
      allowed = false;
    } else if (amount > maxAmount * 0.8) {
      score = 80;
      level = 'high';
    } else if (amount > maxAmount * 0.5) {
      score = 50;
      level = 'medium';
    } else {
      score = (amount / maxAmount) * 30;
      level = 'low';
    }

    return {
      level,
      allowed,
      reason: !allowed ? `Trade amount ${amount} BNB exceeds maximum ${maxAmount} BNB` : undefined,
      score
    };
  }

  private assessSlippageRisk(request: TradeRequest): RiskAssessment {
    const slippage = request.slippage;
    const maxSlippage = this.config.maxSlippagePercent;

    let score = 0;
    let level: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let allowed = true;

    if (slippage > maxSlippage) {
      score = 100;
      level = 'critical';
      allowed = false;
    } else if (slippage > maxSlippage * 0.8) {
      score = 70;
      level = 'high';
    } else if (slippage > maxSlippage * 0.5) {
      score = 40;
      level = 'medium';
    } else {
      score = (slippage / maxSlippage) * 25;
      level = 'low';
    }

    return {
      level,
      allowed,
      reason: !allowed ? `Slippage ${slippage}% exceeds maximum ${maxSlippage}%` : undefined,
      score
    };
  }

  private assessTokenRisk(request: TradeRequest): RiskAssessment {
    const { tokenIn, tokenOut } = request;

    // 检查黑名单
    if (this.config.blacklistedTokens.includes(tokenIn) || 
        this.config.blacklistedTokens.includes(tokenOut)) {
      return {
        level: 'critical',
        allowed: false,
        reason: 'Token is blacklisted',
        score: 100
      };
    }

    // 检查钱包是否被拉黑
    if (this.isBlacklisted(request.walletAddress)) {
      return {
        level: 'critical',
        allowed: false,
        reason: 'Wallet address is blacklisted',
        score: 100
      };
    }

    // 检查白名单（如果启用）
    if (this.config.whitelistedTokens.length > 0) {
      const tokenInWhitelisted = this.config.whitelistedTokens.includes(tokenIn);
      const tokenOutWhitelisted = this.config.whitelistedTokens.includes(tokenOut);
      
      if (!tokenInWhitelisted || !tokenOutWhitelisted) {
        return {
          level: 'medium',
          allowed: true,
          reason: 'Token not in whitelist',
          score: 50
        };
      }
    }

    return {
      level: 'low',
      allowed: true,
      score: 10
    };
  }

  private assessFrequencyRisk(request: TradeRequest): RiskAssessment {
    const history = this.tradeHistory.get(request.walletAddress) || [];
    const oneHourAgo = Date.now() - 3600000; // 1小时前
    
    const recentTrades = history.filter(trade => trade.timestamp > oneHourAgo);
    const tradeCount = recentTrades.length;
    const maxTrades = this.config.maxTradesPerHour;

    if (tradeCount >= maxTrades) {
      return {
        level: 'high',
        allowed: false,
        reason: `Too many trades: ${tradeCount}/${maxTrades} in the last hour`,
        score: 90
      };
    }

    const score = (tradeCount / maxTrades) * 60;
    const level = score > 40 ? 'medium' : 'low';

    return {
      level,
      allowed: true,
      score
    };
  }

  private assessCooldownRisk(request: TradeRequest): RiskAssessment {
    const history = this.tradeHistory.get(request.walletAddress) || [];
    
    if (history.length === 0) {
      return {
        level: 'low',
        allowed: true,
        score: 0
      };
    }

    const lastTrade = history[history.length - 1];
    const timeSinceLastTrade = Date.now() - lastTrade.timestamp;
    const cooldownPeriod = this.config.cooldownPeriodMs;

    if (timeSinceLastTrade < cooldownPeriod) {
      const remainingTime = cooldownPeriod - timeSinceLastTrade;
      return {
        level: 'medium',
        allowed: false,
        reason: `Cooldown period active, ${Math.ceil(remainingTime / 1000)}s remaining`,
        score: 60
      };
    }

    return {
      level: 'low',
      allowed: true,
      score: 0
    };
  }

  private determineRiskLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 80) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  }
}