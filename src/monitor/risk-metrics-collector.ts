import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { metricsCollector } from './metrics';
import { marketDataCollector, TokenPrice, MarketMetrics } from './market-data-collector';

export interface RiskMetrics {
  overall: {
    riskScore: number; // 0-100
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    lastAssessment: Date;
  };
  portfolio: {
    totalExposure: number;
    maxDrawdown: number;
    var1Day: number; // Value at Risk 1 day
    sharpeRatio: number;
    beta: number;
  };
  liquidity: {
    availableLiquidity: number;
    liquidityRatio: number;
    slippageRisk: number;
  };
  market: {
    volatility: number;
    correlationRisk: number;
    concentrationRisk: number;
  };
  operational: {
    systemHealth: number;
    executionRisk: number;
    connectivityRisk: number;
  };
}

export interface PositionRisk {
  tokenAddress: string;
  symbol: string;
  exposure: number;
  riskScore: number;
  volatility: number;
  liquidity: number;
  correlation: number;
}

export class RiskMetricsCollector extends EventEmitter {
  private static instance: RiskMetricsCollector;
  private isRunning = false;
  private assessmentInterval: NodeJS.Timeout | null = null;
  private riskHistory: RiskMetrics[] = [];
  private maxHistorySize = 1000;
  private currentMetrics: RiskMetrics | null = null;

  private constructor() {
    super();
  }

  static getInstance(): RiskMetricsCollector {
    if (!RiskMetricsCollector.instance) {
      RiskMetricsCollector.instance = new RiskMetricsCollector();
    }
    return RiskMetricsCollector.instance;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Risk metrics collector already running');
      return;
    }

    logger.info('Starting risk metrics collector');
    this.isRunning = true;

    // Initial assessment
    await this.assessRiskMetrics();

    // Start periodic assessment every 2 minutes
    this.assessmentInterval = setInterval(async () => {
      try {
        await this.assessRiskMetrics();
      } catch (error) {
        logger.error({ error }, 'Failed to assess risk metrics');
      }
    }, 120000);

    logger.info('Risk metrics collector started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping risk metrics collector');
    this.isRunning = false;

    if (this.assessmentInterval) {
      clearInterval(this.assessmentInterval);
      this.assessmentInterval = null;
    }

    logger.info('Risk metrics collector stopped');
  }

  private async assessRiskMetrics(): Promise<void> {
    try {
      // Get market data
      const tokenPrices = marketDataCollector.getAllTokenPrices();
      const marketMetrics = await marketDataCollector.getCurrentMarketMetrics();
      
      // Calculate portfolio metrics
      const portfolioMetrics = await this.calculatePortfolioRisk(tokenPrices);
      
      // Calculate liquidity metrics
      const liquidityMetrics = await this.calculateLiquidityRisk(marketMetrics);
      
      // Calculate market risk metrics
      const marketRiskMetrics = await this.calculateMarketRisk(tokenPrices);
      
      // Calculate operational risk metrics
      const operationalMetrics = await this.calculateOperationalRisk();
      
      // Calculate overall risk score
      const overallRisk = this.calculateOverallRiskScore({
        portfolio: portfolioMetrics,
        liquidity: liquidityMetrics,
        market: marketRiskMetrics,
        operational: operationalMetrics,
      });

      // Create comprehensive risk metrics
      const riskMetrics: RiskMetrics = {
        overall: overallRisk,
        portfolio: portfolioMetrics,
        liquidity: liquidityMetrics,
        market: marketRiskMetrics,
        operational: operationalMetrics,
      };

      // Update current metrics
      this.currentMetrics = riskMetrics;

      // Add to history
      this.riskHistory.push(riskMetrics);
      if (this.riskHistory.length > this.maxHistorySize) {
        this.riskHistory.shift();
      }

      // Record metrics for monitoring
      this.recordRiskMetrics(riskMetrics);

      // Emit risk assessment event
      this.emit('riskAssessment', riskMetrics);

      logger.debug({ 
        riskScore: overallRisk.riskScore, 
        riskLevel: overallRisk.riskLevel 
      }, 'Risk metrics assessed');

    } catch (error) {
      logger.error({ error }, 'Failed to assess risk metrics');
      metricsCollector.recordMetric('risk_assessment_errors_total', 1, undefined, 'counter');
    }
  }

  private async calculatePortfolioRisk(tokenPrices: TokenPrice[]): Promise<RiskMetrics['portfolio']> {
    const totalExposure = tokenPrices.reduce((sum, token) => sum + token.price, 0);
    const volatilities = tokenPrices.map(token => Math.abs(token.priceChange24h));
    const avgVolatility = volatilities.length ? volatilities.reduce((sum, vol) => sum + vol, 0) / volatilities.length : 0;

    const maxDrawdown = Number(avgVolatility.toFixed(2));
    const var1Day = totalExposure * (avgVolatility / 100);
    const sharpeRatio = avgVolatility > 0 ? Math.max(0, 2 - avgVolatility / 50) : 0;
    const beta = 1;

    return {
      totalExposure,
      maxDrawdown,
      var1Day,
      sharpeRatio,
      beta,
    };
  }

  private async calculateLiquidityRisk(marketMetrics: MarketMetrics): Promise<RiskMetrics['liquidity']> {
    const totalValueLocked = marketMetrics.totalValueLocked ?? 0;
    const availableLiquidity = totalValueLocked * 0.1;
    const liquidityRatio = totalValueLocked > 0 ? (availableLiquidity / totalValueLocked) * 100 : 0;
    const bullish = marketMetrics.marketTrends?.bullish ?? 0;
    const slippageRisk = Math.max(0, 100 - bullish);

    return {
      availableLiquidity,
      liquidityRatio,
      slippageRisk,
    };
  }

  private async calculateMarketRisk(tokenPrices: TokenPrice[]): Promise<RiskMetrics['market']> {
    if (tokenPrices.length === 0) {
      return { volatility: 0, correlationRisk: 0, concentrationRisk: 0 };
    }

    const volatilities = tokenPrices.map(token => Math.abs(token.priceChange24h));
    const avgVolatility = volatilities.reduce((sum, vol) => sum + vol, 0) / volatilities.length;

    const totalPrice = tokenPrices.reduce((sum, token) => sum + Math.max(token.price, 0), 0);
    const maxPrice = tokenPrices.reduce((max, token) => Math.max(max, token.price), 0);
    const concentrationRisk = totalPrice > 0 ? (maxPrice / totalPrice) * 100 : 0;

    return {
      volatility: avgVolatility,
      correlationRisk: avgVolatility,
      concentrationRisk,
    };
  }

  private async calculateOperationalRisk(): Promise<RiskMetrics['operational']> {
    try {
      // Get system health metrics
      const { healthMonitor } = await import('./health');
      const systemHealth = await healthMonitor.getSystemHealth();
      
      const healthScore = systemHealth.overall === 'healthy' ? 100 : 
                         systemHealth.overall === 'degraded' ? 70 : 30;
      
      // Mock execution risk based on system performance
      const executionRisk = 100 - healthScore + (Math.random() * 10 - 5); // Add some noise
      
      // Mock connectivity risk
      const connectivityRisk = Math.random() * 20 + 5; // 5-25%

      return {
        systemHealth: healthScore,
        executionRisk: Math.max(0, Math.min(100, executionRisk)),
        connectivityRisk,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to calculate operational risk');
      return {
        systemHealth: 50,
        executionRisk: 50,
        connectivityRisk: 50,
      };
    }
  }

  private calculateOverallRiskScore(components: {
    portfolio: RiskMetrics['portfolio'];
    liquidity: RiskMetrics['liquidity'];
    market: RiskMetrics['market'];
    operational: RiskMetrics['operational'];
  }): RiskMetrics['overall'] {
    // Weighted risk score calculation
    const weights = {
      portfolio: 0.3,
      liquidity: 0.2,
      market: 0.3,
      operational: 0.2,
    };

    // Normalize each component to 0-100 scale
    const portfolioScore = Math.min(100, components.portfolio.maxDrawdown * 2);
    const liquidityScore = Math.max(0, 100 - components.liquidity.liquidityRatio);
    const marketScore = components.market.volatility * 2;
    const operationalScore = 100 - components.operational.systemHealth;

    // Calculate weighted average
    const riskScore = Math.min(100, Math.max(0,
      portfolioScore * weights.portfolio +
      liquidityScore * weights.liquidity +
      marketScore * weights.market +
      operationalScore * weights.operational
    ));

    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    if (riskScore < 25) riskLevel = 'low';
    else if (riskScore < 50) riskLevel = 'medium';
    else if (riskScore < 75) riskLevel = 'high';
    else riskLevel = 'critical';

    return {
      riskScore: Math.round(riskScore),
      riskLevel,
      lastAssessment: new Date(),
    };
  }

  private recordRiskMetrics(metrics: RiskMetrics): void {
    // Record overall risk metrics
    metricsCollector.recordMetric('risk_score_overall', metrics.overall.riskScore, undefined, 'gauge');
    metricsCollector.recordMetric('risk_level_numeric', this.riskLevelToNumeric(metrics.overall.riskLevel), undefined, 'gauge');
    
    // Record portfolio metrics
    metricsCollector.recordMetric('risk_portfolio_exposure_usd', metrics.portfolio.totalExposure, undefined, 'gauge');
    metricsCollector.recordMetric('risk_portfolio_max_drawdown_pct', metrics.portfolio.maxDrawdown, undefined, 'gauge');
    metricsCollector.recordMetric('risk_portfolio_var_1d_usd', metrics.portfolio.var1Day, undefined, 'gauge');
    metricsCollector.recordMetric('risk_portfolio_sharpe_ratio', metrics.portfolio.sharpeRatio, undefined, 'gauge');
    metricsCollector.recordMetric('risk_portfolio_beta', metrics.portfolio.beta, undefined, 'gauge');
    
    // Record liquidity metrics
    metricsCollector.recordMetric('risk_liquidity_available_usd', metrics.liquidity.availableLiquidity, undefined, 'gauge');
    metricsCollector.recordMetric('risk_liquidity_ratio', metrics.liquidity.liquidityRatio, undefined, 'gauge');
    metricsCollector.recordMetric('risk_slippage_risk_pct', metrics.liquidity.slippageRisk, undefined, 'gauge');
    
    // Record market metrics
    metricsCollector.recordMetric('risk_market_volatility_pct', metrics.market.volatility, undefined, 'gauge');
    metricsCollector.recordMetric('risk_market_correlation', metrics.market.correlationRisk, undefined, 'gauge');
    metricsCollector.recordMetric('risk_market_concentration_pct', metrics.market.concentrationRisk, undefined, 'gauge');
    
    // Record operational metrics
    metricsCollector.recordMetric('risk_operational_system_health', metrics.operational.systemHealth, undefined, 'gauge');
    metricsCollector.recordMetric('risk_operational_execution', metrics.operational.executionRisk, undefined, 'gauge');
    metricsCollector.recordMetric('risk_operational_connectivity', metrics.operational.connectivityRisk, undefined, 'gauge');
  }

  private riskLevelToNumeric(level: 'low' | 'medium' | 'high' | 'critical'): number {
    switch (level) {
      case 'low': return 1;
      case 'medium': return 2;
      case 'high': return 3;
      case 'critical': return 4;
      default: return 0;
    }
  }

  // Public methods for accessing risk data
  getCurrentRiskMetrics(): RiskMetrics | null {
    return this.currentMetrics;
  }

  getRiskHistory(hours: number = 24): RiskMetrics[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return this.riskHistory.filter(metrics => 
      metrics.overall.lastAssessment >= cutoff
    );
  }

  async getPositionRisks(): Promise<PositionRisk[]> {
    // Mock position risks - in production this would calculate from actual positions
    const tokenPrices = marketDataCollector.getAllTokenPrices();
    
    return tokenPrices.slice(0, 5).map(token => ({
      tokenAddress: token.address,
      symbol: token.symbol,
      exposure: token.price,
      riskScore: Math.min(100, Math.abs(token.priceChange24h)),
      volatility: Math.abs(token.priceChange24h),
      liquidity: token.volume24h,
      correlation: 0,
    }));
  }

  getStatus(): {
    running: boolean;
    lastAssessment: Date | null;
    historySize: number;
    currentRiskLevel: string | null;
  } {
    return {
      running: this.isRunning,
      lastAssessment: this.currentMetrics?.overall.lastAssessment || null,
      historySize: this.riskHistory.length,
      currentRiskLevel: this.currentMetrics?.overall.riskLevel || null,
    };
  }
}

export const riskMetricsCollector = RiskMetricsCollector.getInstance();
