import { ethers } from 'ethers';
import { DEXIntegration } from '../dex/DEXIntegration';
import { RiskManager } from '../risk/RiskManager';
import { BatchExecutor } from '../batch/BatchExecutor';
import pino from 'pino';

const logger = pino({ name: 'TradingEngine' });

export interface TradingEngineConfig {
  rpcUrl: string;
  chainId: number;
  routerAddress: string;
  maxSlippage: number;
  gasLimit: number;
  retryAttempts: number;
}

export interface TradeRequest {
  type: 'buy' | 'sell';
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage: number;
  walletAddress: string;
  priority?: 'low' | 'normal' | 'high';
}

export interface QuoteResult {
  tokenOut: {
    amount: string;
  };
  priceImpact: {
    impact: number;
  };
  slippageAnalysis: {
    recommendedSlippage: number;
  };
  minimumReceived: string;
}

export interface RiskCheckResult {
  allowed: boolean;
  risk: 'low' | 'medium' | 'high' | 'critical';
  reason?: string;
}

export interface GasEstimate {
  gasPrice: number;
  gasLimit: number;
  totalCostBNB: string;
}

export interface TradingMetrics {
  totalTrades: number;
  successRate: number;
  averageExecutionTime: number;
}

export interface TradeResult {
  success: boolean;
  txHash?: string;
  gasUsed?: string;
  actualAmountOut?: string;
  priceImpact?: number;
  executionTime?: number;
  error?: string;
  tradeIndex?: number;
}

export class TradingEngine {
  private config: TradingEngineConfig;
  private provider: ethers.JsonRpcProvider;
  private dexIntegration: DEXIntegration;
  private riskManager: RiskManager;
  private batchExecutor: BatchExecutor;
  private metrics: TradingMetrics;
  private tradeHistory: Map<string, any[]> = new Map();

  constructor(config: TradingEngineConfig) {
    this.config = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.dexIntegration = new DEXIntegration(config);
    this.riskManager = new RiskManager();
    this.batchExecutor = new BatchExecutor();
    
    this.metrics = {
      totalTrades: 0,
      successRate: 0,
      averageExecutionTime: 0
    };

    logger.info({ config }, 'TradingEngine initialized');
  }

  async getQuote(request: TradeRequest): Promise<QuoteResult> {
    logger.debug({ request }, 'Getting quote');

    try {
      // 验证输入
      this.validateTradeRequest(request);

      // 使用DEX集成获取报价
      const quote = await this.dexIntegration.getQuote(request);
      
      // 计算价格影响
      const priceImpact = await this.calculatePriceImpact(request);
      
      // 分析滑点
      const slippageAnalysis = this.analyzeSlippage(request, quote);
      
      // 计算最小接收量
      const minimumReceived = this.calculateMinimumReceived(quote, request.slippage);

      const result: QuoteResult = {
        tokenOut: {
          amount: quote.amountOut
        },
        priceImpact: {
          impact: priceImpact
        },
        slippageAnalysis: {
          recommendedSlippage: slippageAnalysis.recommended
        },
        minimumReceived: minimumReceived
      };

      logger.debug({ result }, 'Quote calculated');
      return result;
    } catch (error) {
      logger.error({ error, request }, 'Failed to get quote');
      throw error;
    }
  }

  async checkRisk(request: TradeRequest): Promise<RiskCheckResult> {
    logger.debug({ request }, 'Checking risk');

    try {
      // 检查交易金额风险
      const amountRisk = this.assessAmountRisk(request);
      
      // 检查滑点风险
      const slippageRisk = this.assessSlippageRisk(request);
      
      // 检查冷却期
      const cooldownCheck = this.checkCooldown(request.walletAddress);
      
      // 检查代币有效性
      const tokenValidation = await this.validateToken(request.tokenOut);

      // 综合风险评估
      const overallRisk = this.calculateOverallRisk(amountRisk, slippageRisk);
      
      const result: RiskCheckResult = {
        allowed: overallRisk !== 'critical' && cooldownCheck.allowed && tokenValidation.valid,
        risk: overallRisk,
        reason: !cooldownCheck.allowed ? cooldownCheck.reason : 
                !tokenValidation.valid ? tokenValidation.reason : undefined
      };

      logger.debug({ result }, 'Risk check completed');
      return result;
    } catch (error) {
      logger.error({ error, request }, 'Risk check failed');
      return {
        allowed: false,
        risk: 'critical',
        reason: 'Risk assessment failed'
      };
    }
  }

  async estimateGas(request: TradeRequest): Promise<GasEstimate> {
    logger.debug({ request }, 'Estimating gas');

    try {
      // 获取当前gas价格
      const feeData = await this.provider.getFeeData();
      let gasPrice = Number(feeData.gasPrice || 0);

      // 根据优先级调整gas价格
      if (request.priority === 'high') {
        gasPrice = Math.floor(gasPrice * 1.2); // 提高20%
      } else if (request.priority === 'low') {
        gasPrice = Math.floor(gasPrice * 0.8); // 降低20%
      }

      // 估算gas限制
      const gasLimit = this.config.gasLimit;
      
      // 计算总成本
      const totalCostWei = BigInt(gasPrice) * BigInt(gasLimit);
      const totalCostBNB = ethers.formatEther(totalCostWei);

      const result: GasEstimate = {
        gasPrice,
        gasLimit,
        totalCostBNB
      };

      logger.debug({ result }, 'Gas estimated');
      return result;
    } catch (error) {
      logger.error({ error, request }, 'Gas estimation failed');
      throw error;
    }
  }

  async recordTrade(request: TradeRequest, status: 'success' | 'failed'): Promise<void> {
    const walletHistory = this.tradeHistory.get(request.walletAddress) || [];
    walletHistory.push({
      timestamp: Date.now(),
      request,
      status
    });
    this.tradeHistory.set(request.walletAddress, walletHistory);
    
    this.metrics.totalTrades++;
    logger.debug({ walletAddress: request.walletAddress, status }, 'Trade recorded');
  }

  async getMetrics(): Promise<TradingMetrics> {
    return { ...this.metrics };
  }

  // 私有辅助方法
  private validateTradeRequest(request: TradeRequest): void {
    if (!ethers.isAddress(request.tokenIn)) {
      throw new Error(`Invalid tokenIn address: ${request.tokenIn}`);
    }
    if (!ethers.isAddress(request.tokenOut)) {
      throw new Error(`Invalid tokenOut address: ${request.tokenOut}`);
    }
    if (!ethers.isAddress(request.walletAddress)) {
      throw new Error(`Invalid wallet address: ${request.walletAddress}`);
    }
    if (parseFloat(request.amountIn) <= 0) {
      throw new Error(`Invalid amount: ${request.amountIn}`);
    }
  }

  private async calculatePriceImpact(request: TradeRequest): Promise<number> {
    // 简化的价格影响计算
    const amount = parseFloat(request.amountIn);
    if (amount < 0.01) return 0.1; // 小额交易低影响
    if (amount < 0.1) return 0.5;
    if (amount < 1) return 1.5;
    return 3.0; // 大额交易高影响
  }

  private analyzeSlippage(request: TradeRequest, quote: any): { recommended: number } {
    // 基于价格影响推荐滑点
    const baseSlippage = request.slippage;
    const amount = parseFloat(request.amountIn);
    
    let recommended = baseSlippage;
    if (amount > 1) {
      recommended = Math.max(baseSlippage, 2.0); // 大额交易建议更高滑点
    }
    
    return { recommended };
  }

  private calculateMinimumReceived(quote: any, slippage: number): string {
    const amount = parseFloat(quote.amountOut);
    const minimumAmount = amount * (1 - slippage / 100);
    return minimumAmount.toString();
  }

  private assessAmountRisk(request: TradeRequest): 'low' | 'medium' | 'high' | 'critical' {
    const amount = parseFloat(request.amountIn);
    if (amount < 0.01) return 'low';
    if (amount < 0.1) return 'medium';
    if (amount < 10) return 'high';
    return 'critical';
  }

  private assessSlippageRisk(request: TradeRequest): 'low' | 'medium' | 'high' | 'critical' {
    if (request.slippage < 1) return 'low';
    if (request.slippage < 5) return 'medium';
    if (request.slippage < 10) return 'high';
    return 'critical';
  }

  private checkCooldown(walletAddress: string): { allowed: boolean; reason?: string } {
    const history = this.tradeHistory.get(walletAddress) || [];
    const recentTrades = history.filter(trade => 
      Date.now() - trade.timestamp < 60000 // 1分钟冷却期
    );
    
    if (recentTrades.length > 0) {
      return {
        allowed: false,
        reason: 'Trade cooldown period active'
      };
    }
    
    return { allowed: true };
  }

  private async validateToken(tokenAddress: string): Promise<{ valid: boolean; reason?: string }> {
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      return {
        valid: false,
        reason: 'Invalid token address'
      };
    }
    
    return { valid: true };
  }

  private calculateOverallRisk(
    amountRisk: 'low' | 'medium' | 'high' | 'critical',
    slippageRisk: 'low' | 'medium' | 'high' | 'critical'
  ): 'low' | 'medium' | 'high' | 'critical' {
    const riskLevels = { low: 1, medium: 2, high: 3, critical: 4 };
    const maxRisk = Math.max(riskLevels[amountRisk], riskLevels[slippageRisk]);
    
    const levelMap = { 1: 'low', 2: 'medium', 3: 'high', 4: 'critical' } as const;
    return levelMap[maxRisk as keyof typeof levelMap];
  }
}