import { database } from '../persistence/database';
import { logger } from '../utils/logger';

interface TradingStats {
  totalTrades24h: number;
  pnl24h: string;
  volume24h: string;
  successRate: string;
  avgTradeTime: string;
}

interface TradingMetrics {
  activeTrades: number;
  pendingOrders: number;
  completedTrades24h: number;
  pnl: {
    '1h': string;
    '24h': string;
    '7d': string;
  };
  winRate: string;
  sharpeRatio: string;
}

interface RiskMetrics {
  score: number;
  level: 'low' | 'medium' | 'high';
  maxDrawdown: string;
}

export class TradingStatsService {
  private static instance: TradingStatsService;
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds cache

  private constructor() {}

  public static getInstance(): TradingStatsService {
    if (!TradingStatsService.instance) {
      TradingStatsService.instance = new TradingStatsService();
    }
    return TradingStatsService.instance;
  }

  async getTradingStats(): Promise<TradingStats> {
    const cacheKey = 'trading_stats_24h';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      await database.ensureConnection();
      
      if (!database.connection) {
        throw new Error('Database connection not available');
      }

      // Query real trading data from database
      const stats = await this.queryTradingStats();
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: stats,
        timestamp: Date.now()
      });
      
      return stats;
    } catch (error) {
      logger.error({ error }, 'Failed to get trading stats');
      
      // Return empty stats for new system
      return {
        totalTrades24h: 0,
        pnl24h: '0.00',
        volume24h: '0.00',
        successRate: '0.0',
        avgTradeTime: '0.0s'
      };
    }
  }

  async getTradingMetrics(): Promise<TradingMetrics> {
    const cacheKey = 'trading_metrics';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      await database.ensureConnection();
      
      if (!database.connection) {
        throw new Error('Database connection not available');
      }

      // Query real metrics from database
      const metrics = await this.queryTradingMetrics();
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: metrics,
        timestamp: Date.now()
      });
      
      return metrics;
    } catch (error) {
      logger.error({ error }, 'Failed to get trading metrics');
      
      // Return empty metrics for new system
      return {
        activeTrades: 0,
        pendingOrders: 0,
        completedTrades24h: 0,
        pnl: {
          '1h': '0.00',
          '24h': '0.00',
          '7d': '0.00'
        },
        winRate: '0.0%',
        sharpeRatio: '0.00'
      };
    }
  }

  async getRiskMetrics(): Promise<RiskMetrics> {
    const cacheKey = 'risk_metrics';
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      await database.ensureConnection();
      
      if (!database.connection) {
        throw new Error('Database connection not available');
      }

      // Query real risk metrics from database
      const riskMetrics = await this.queryRiskMetrics();
      
      // Cache the result
      this.cache.set(cacheKey, {
        data: riskMetrics,
        timestamp: Date.now()
      });
      
      return riskMetrics;
    } catch (error) {
      logger.error({ error }, 'Failed to get risk metrics');
      
      // Return safe defaults for new system
      return {
        score: 0,
        level: 'low',
        maxDrawdown: '0.0%'
      };
    }
  }

  private async queryTradingStats(): Promise<TradingStats> {
    try {
      const db = database.connection!;
      
      // Query trades from last 24 hours
      const trades24h = await db('trades')
        .where('created_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .select('*');

      if (trades24h.length === 0) {
        return {
          totalTrades24h: 0,
          pnl24h: '0.00',
          volume24h: '0.00',
          successRate: '0.0',
          avgTradeTime: '0.0s'
        };
      }

      // Calculate actual stats
      const totalTrades = trades24h.length;
      const successfulTrades = trades24h.filter(t => t.status === 'completed' && parseFloat(t.pnl || '0') > 0).length;
      const totalPnl = trades24h.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);
      const totalVolume = trades24h.reduce((sum, t) => sum + parseFloat(t.volume || '0'), 0);
      const successRate = totalTrades > 0 ? (successfulTrades / totalTrades * 100) : 0;
      
      // Calculate average trade time
      const completedTrades = trades24h.filter(t => t.status === 'completed' && t.completed_at);
      const avgTradeTimeMs = completedTrades.length > 0 
        ? completedTrades.reduce((sum, t) => {
            const duration = new Date(t.completed_at).getTime() - new Date(t.created_at).getTime();
            return sum + duration;
          }, 0) / completedTrades.length
        : 0;
      
      const avgTradeTimeSeconds = Math.round(avgTradeTimeMs / 1000);

      return {
        totalTrades24h: totalTrades,
        pnl24h: totalPnl.toFixed(2),
        volume24h: totalVolume.toFixed(2),
        successRate: successRate.toFixed(1),
        avgTradeTime: `${avgTradeTimeSeconds}s`
      };
    } catch (error) {
      logger.debug({ error }, 'Failed to query trading stats from database');
      throw error;
    }
  }

  private async queryTradingMetrics(): Promise<TradingMetrics> {
    try {
      const db = database.connection!;
      
      // Query active trades
      const activeTrades = await db('trades')
        .where('status', 'active')
        .count('* as count');

      // Query pending orders
      const pendingOrders = await db('orders')
        .where('status', 'pending')
        .count('* as count');

      // Query completed trades in last 24h
      const completedTrades24h = await db('trades')
        .where('status', 'completed')
        .andWhere('completed_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .count('* as count');

      // Query PnL for different timeframes
      const pnl1h = await this.calculatePnL(1);
      const pnl24h = await this.calculatePnL(24);
      const pnl7d = await this.calculatePnL(24 * 7);

      // Calculate win rate
      const winRate = await this.calculateWinRate();

      // Calculate Sharpe ratio (simplified)
      const sharpeRatio = await this.calculateSharpeRatio();

      return {
        activeTrades: Number(activeTrades[0]?.count || 0),
        pendingOrders: Number(pendingOrders[0]?.count || 0),
        completedTrades24h: Number(completedTrades24h[0]?.count || 0),
        pnl: {
          '1h': pnl1h.toFixed(2),
          '24h': pnl24h.toFixed(2),
          '7d': pnl7d.toFixed(2)
        },
        winRate: `${winRate.toFixed(1)}%`,
        sharpeRatio: sharpeRatio.toFixed(2)
      };
    } catch (error) {
      logger.debug({ error }, 'Failed to query trading metrics from database');
      throw error;
    }
  }

  private async queryRiskMetrics(): Promise<RiskMetrics> {
    try {
      const db = database.connection!;
      
      // Calculate risk score based on recent performance
      const riskScore = await this.calculateRiskScore();
      
      // Determine risk level
      let level: 'low' | 'medium' | 'high' = 'low';
      if (riskScore > 70) level = 'high';
      else if (riskScore > 30) level = 'medium';

      // Calculate max drawdown
      const maxDrawdown = await this.calculateMaxDrawdown();

      return {
        score: Math.round(riskScore),
        level,
        maxDrawdown: `${maxDrawdown.toFixed(1)}%`
      };
    } catch (error) {
      logger.debug({ error }, 'Failed to query risk metrics from database');
      throw error;
    }
  }

  private async calculatePnL(hoursBack: number): Promise<number> {
    try {
      const db = database.connection!;
      
      const result = await db('trades')
        .where('status', 'completed')
        .andWhere('completed_at', '>=', new Date(Date.now() - hoursBack * 60 * 60 * 1000))
        .sum('pnl as total_pnl');

      return Number(result[0]?.total_pnl || 0);
    } catch (error) {
      return 0;
    }
  }

  private async calculateWinRate(): Promise<number> {
    try {
      const db = database.connection!;
      
      const totalTrades = await db('trades')
        .where('status', 'completed')
        .andWhere('completed_at', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .count('* as count');

      const winningTrades = await db('trades')
        .where('status', 'completed')
        .andWhere('pnl', '>', 0)
        .andWhere('completed_at', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
        .count('* as count');

      const total = Number(totalTrades[0]?.count || 0);
      const wins = Number(winningTrades[0]?.count || 0);

      return total > 0 ? (wins / total * 100) : 0;
    } catch (error) {
      return 0;
    }
  }

  private async calculateSharpeRatio(): Promise<number> {
    try {
      const db = database.connection!;
      
      // Get daily returns for last 30 days
      const trades = await db('trades')
        .where('status', 'completed')
        .andWhere('completed_at', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .select('pnl', 'completed_at');

      if (trades.length < 10) return 0; // Need minimum data

      const returns = trades.map(t => parseFloat(t.pnl || '0'));
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const stdDev = Math.sqrt(returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length);

      return stdDev > 0 ? avgReturn / stdDev : 0;
    } catch (error) {
      return 0;
    }
  }

  private async calculateRiskScore(): Promise<number> {
    try {
      // Risk score based on various factors
      const winRate = await this.calculateWinRate();
      const maxDrawdown = await this.calculateMaxDrawdown();
      const volatility = await this.calculateVolatility();

      // Simple risk scoring (0-100, higher = more risky)
      let score = 0;
      
      // Lower win rate = higher risk
      score += (100 - winRate) * 0.3;
      
      // Higher drawdown = higher risk
      score += Math.min(maxDrawdown * 2, 50) * 0.4;
      
      // Higher volatility = higher risk
      score += Math.min(volatility, 50) * 0.3;

      return Math.max(0, Math.min(100, score));
    } catch (error) {
      return 0;
    }
  }

  private async calculateMaxDrawdown(): Promise<number> {
    try {
      const db = database.connection!;
      
      const trades = await db('trades')
        .where('status', 'completed')
        .andWhere('completed_at', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .orderBy('completed_at', 'asc')
        .select('pnl');

      if (trades.length === 0) return 0;

      let runningBalance = 0;
      let peak = 0;
      let maxDrawdown = 0;

      for (const trade of trades) {
        runningBalance += parseFloat(trade.pnl || '0');
        if (runningBalance > peak) {
          peak = runningBalance;
        }
        const drawdown = ((peak - runningBalance) / Math.max(peak, 1)) * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
      }

      return maxDrawdown;
    } catch (error) {
      return 0;
    }
  }

  private async calculateVolatility(): Promise<number> {
    try {
      const db = database.connection!;
      
      const trades = await db('trades')
        .where('status', 'completed')
        .andWhere('completed_at', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .select('pnl');

      if (trades.length < 5) return 0;

      const returns = trades.map(t => parseFloat(t.pnl || '0'));
      const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
      const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
      
      return Math.sqrt(variance);
    } catch (error) {
      return 0;
    }
  }

  // Clear cache manually if needed
  clearCache(): void {
    this.cache.clear();
    logger.info('Trading stats cache cleared');
  }

  // Get cache statistics
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

export const tradingStatsService = TradingStatsService.getInstance();