/**
 * Advanced Position Management System
 * 
 * Provides sophisticated position sizing, entry/exit logic,
 * and portfolio optimization capabilities.
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { database } from '../persistence/database';
import { EventEmitter } from 'events';

export interface PositionSizingConfig {
  method: 'fixed' | 'percentage' | 'volatility' | 'kelly' | 'risk_parity';
  base_size_usd: number;
  max_size_usd: number;
  portfolio_percentage: number;
  volatility_lookback: number;
  kelly_lookback: number;
  risk_free_rate: number;
  max_leverage: number;
  size_multiplier: number;
}

export interface EntryExitRules {
  max_pyramid_levels: number;
  pyramid_scale_factor: number;
  entry_spacing_pct: number;
  partial_exit_levels: number[];
  stop_loss_pct?: number;
  take_profit_pct?: number;
  trailing_stop_pct?: number;
  time_exit_hours?: number;
  max_hold_time_hours?: number;
}

export interface PositionMetrics {
  position_id: string;
  symbol: string;
  entry_time: Date;
  hold_duration_hours: number;
  current_size_usd: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pnl_usd: number;
  unrealized_pnl_pct: number;
  realized_pnl_usd: number;
  max_favorable_excursion: number;
  max_adverse_excursion: number;
  efficiency_ratio: number;
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
}

export interface PortfolioMetrics {
  total_value_usd: number;
  total_pnl_usd: number;
  total_pnl_pct: number;
  number_of_positions: number;
  avg_position_size_usd: number;
  largest_position_pct: number;
  concentration_ratio: number;
  correlation_score: number;
  portfolio_beta: number;
  volatility_annualized: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown_pct: number;
  recovery_factor: number;
  profit_factor: number;
  win_rate: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  largest_win_pct: number;
  largest_loss_pct: number;
}

export interface PositionAdjustment {
  position_id: string;
  adjustment_type: 'size_increase' | 'size_decrease' | 'stop_adjustment' | 'target_adjustment' | 'close';
  size_change_usd?: number;
  new_stop_loss?: number;
  new_take_profit?: number;
  reason: string;
  confidence_score: number;
  risk_reward_ratio: number;
}

export class PositionManager extends EventEmitter {
  private running: boolean = false;
  private optimizationTimer?: NodeJS.Timeout;

  constructor(
    private sizingConfig: PositionSizingConfig,
    private entryExitRules: EntryExitRules,
    private optimizationIntervalMs: number = 300000 // 5 minutes
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    logger.info('Starting Position Manager...');
    this.running = true;

    // Start position optimization
    this.startPositionOptimization();

    logger.info('Position Manager started successfully');
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    logger.info('Stopping Position Manager...');

    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = undefined;
    }

    this.running = false;
    logger.info('Position Manager stopped');
    this.emit('stopped');
  }

  private startPositionOptimization(): void {
    this.optimizationTimer = setInterval(async () => {
      try {
        await this.optimizePositions();
      } catch (error) {
        logger.error({ error }, 'Position optimization failed');
        this.emit('optimization_error', error);
      }
    }, this.optimizationIntervalMs);
  }

  async calculatePositionSize(
    symbol: string,
    entryPrice: number,
    stopLoss?: number,
    confidence?: number
  ): Promise<number> {
    const portfolioValue = await this.getPortfolioValue();
    let sizeUsd = 0;

    switch (this.sizingConfig.method) {
      case 'fixed':
        sizeUsd = this.sizingConfig.base_size_usd;
        break;

      case 'percentage':
        sizeUsd = portfolioValue * (this.sizingConfig.portfolio_percentage / 100);
        break;

      case 'volatility':
        const volatility = await this.calculateVolatility(symbol, this.sizingConfig.volatility_lookback);
        const targetRisk = portfolioValue * 0.02; // 2% portfolio risk
        sizeUsd = targetRisk / volatility;
        break;

      case 'kelly':
        const kellyFraction = await this.calculateKellyFraction(symbol, this.sizingConfig.kelly_lookback);
        sizeUsd = portfolioValue * kellyFraction * 0.25; // Quarter Kelly for safety
        break;

      case 'risk_parity':
        const riskContribution = await this.calculateRiskParitySize(symbol, portfolioValue);
        sizeUsd = riskContribution;
        break;
    }

    // Apply stop loss risk adjustment
    if (stopLoss && entryPrice) {
      const riskPerShare = Math.abs(entryPrice - stopLoss) / entryPrice;
      const maxRiskUsd = portfolioValue * 0.02; // 2% max risk per trade
      const maxSizeByRisk = maxRiskUsd / riskPerShare;
      sizeUsd = Math.min(sizeUsd, maxSizeByRisk);
    }

    // Apply confidence adjustment
    if (confidence !== undefined) {
      sizeUsd *= Math.min(confidence / 100, 1.0);
    }

    // Apply limits
    sizeUsd = Math.max(this.sizingConfig.base_size_usd * 0.1, sizeUsd); // Min 10% of base
    sizeUsd = Math.min(this.sizingConfig.max_size_usd, sizeUsd);
    sizeUsd = Math.min(portfolioValue * 0.2, sizeUsd); // Max 20% of portfolio

    return sizeUsd;
  }

  async shouldAddToPosition(
    positionId: string,
    currentPrice: number,
    signal_strength?: number
  ): Promise<{ should_add: boolean; size_usd: number; reason: string }> {
    const position = await this.getPosition(positionId);
    if (!position) {
      return { should_add: false, size_usd: 0, reason: 'Position not found' };
    }

    // Check pyramid limits
    const currentLevels = await this.getPositionLevels(positionId);
    if (currentLevels >= this.entryExitRules.max_pyramid_levels) {
      return { should_add: false, size_usd: 0, reason: 'Max pyramid levels reached' };
    }

    // Check entry spacing
    const avgEntry = parseFloat(position.avg_entry_price);
    const priceChange = Math.abs((currentPrice - avgEntry) / avgEntry);
    const requiredSpacing = this.entryExitRules.entry_spacing_pct / 100;

    if (priceChange < requiredSpacing) {
      return { should_add: false, size_usd: 0, reason: 'Insufficient price spacing for pyramid' };
    }

    // Check position direction and price movement
    const isLong = parseFloat(position.quantity) > 0;
    const favorableMove = isLong ? currentPrice < avgEntry : currentPrice > avgEntry;

    if (!favorableMove) {
      return { should_add: false, size_usd: 0, reason: 'Price movement not favorable for adding' };
    }

    // Calculate size for additional entry
    const baseSize = await this.calculatePositionSize(position.symbol, currentPrice);
    const scaleFactor = Math.pow(this.entryExitRules.pyramid_scale_factor, currentLevels);
    const additionalSize = baseSize * scaleFactor;

    // Apply signal strength adjustment
    const adjustedSize = signal_strength 
      ? additionalSize * Math.min(signal_strength / 100, 1.0)
      : additionalSize;

    return {
      should_add: true,
      size_usd: adjustedSize,
      reason: `Pyramid level ${currentLevels + 1}, favorable price movement ${priceChange.toFixed(3)}`
    };
  }

  async shouldExitPosition(
    positionId: string,
    currentPrice: number,
    marketConditions?: any
  ): Promise<{ should_exit: boolean; exit_percentage: number; reason: string }> {
    const position = await this.getPosition(positionId);
    if (!position) {
      return { should_exit: false, exit_percentage: 0, reason: 'Position not found' };
    }

    const metrics = await this.calculatePositionMetrics(positionId);
    const holdTime = metrics.hold_duration_hours;

    // Time-based exit
    if (this.entryExitRules.time_exit_hours && holdTime >= this.entryExitRules.time_exit_hours) {
      return { should_exit: true, exit_percentage: 100, reason: 'Time exit reached' };
    }

    // Max hold time exit
    if (this.entryExitRules.max_hold_time_hours && holdTime >= this.entryExitRules.max_hold_time_hours) {
      return { should_exit: true, exit_percentage: 100, reason: 'Max hold time exceeded' };
    }

    // Stop loss
    if (this.entryExitRules.stop_loss_pct) {
      const stopLossThreshold = -Math.abs(this.entryExitRules.stop_loss_pct);
      if (metrics.unrealized_pnl_pct <= stopLossThreshold) {
        return { should_exit: true, exit_percentage: 100, reason: 'Stop loss triggered' };
      }
    }

    // Take profit
    if (this.entryExitRules.take_profit_pct) {
      if (metrics.unrealized_pnl_pct >= this.entryExitRules.take_profit_pct) {
        return { should_exit: true, exit_percentage: 100, reason: 'Take profit triggered' };
      }
    }

    // Trailing stop
    if (this.entryExitRules.trailing_stop_pct) {
      const trailingStop = await this.calculateTrailingStop(positionId, currentPrice);
      const isLong = parseFloat(position.quantity) > 0;
      
      if ((isLong && currentPrice <= trailingStop) || (!isLong && currentPrice >= trailingStop)) {
        return { should_exit: true, exit_percentage: 100, reason: 'Trailing stop triggered' };
      }
    }

    // Partial exits based on performance
    const partialExitLevel = this.getPartialExitLevel(metrics.unrealized_pnl_pct);
    if (partialExitLevel > 0) {
      return {
        should_exit: true,
        exit_percentage: partialExitLevel,
        reason: `Partial exit at ${metrics.unrealized_pnl_pct.toFixed(2)}% profit`
      };
    }

    // Market condition based exits
    if (marketConditions) {
      const marketExit = await this.evaluateMarketConditionExit(position, marketConditions);
      if (marketExit.should_exit) {
        return marketExit;
      }
    }

    return { should_exit: false, exit_percentage: 0, reason: 'No exit conditions met' };
  }

  private getPartialExitLevel(pnlPct: number): number {
    for (let i = this.entryExitRules.partial_exit_levels.length - 1; i >= 0; i--) {
      const level = this.entryExitRules.partial_exit_levels[i];
      if (pnlPct >= level) {
        // Return increasing exit percentages: 25%, 50%, 75%
        return Math.min(25 * (i + 1), 75);
      }
    }
    return 0;
  }

  async optimizePositions(): Promise<PositionAdjustment[]> {
    const activePositions = await this.getActivePositions();
    const adjustments: PositionAdjustment[] = [];

    for (const position of activePositions) {
      try {
        const positionAdjustments = await this.optimizePosition(position);
        adjustments.push(...positionAdjustments);
      } catch (error) {
        logger.error({ error, position_id: position.id }, 'Position optimization failed');
      }
    }

    // Execute adjustments if any
    if (adjustments.length > 0) {
      await this.executePositionAdjustments(adjustments);
      this.emit('positions_optimized', adjustments);
    }

    return adjustments;
  }

  private async optimizePosition(position: any): Promise<PositionAdjustment[]> {
    const adjustments: PositionAdjustment[] = [];
    const metrics = await this.calculatePositionMetrics(position.id);
    const currentPrice = await this.getCurrentPrice(position.symbol);

    // Size optimization based on performance
    if (metrics.efficiency_ratio > 0.7 && metrics.sharpe_ratio > 1.0) {
      // High-performing position - consider increasing size
      const portfolioValue = await this.getPortfolioValue();
      const currentExposure = metrics.current_size_usd / portfolioValue;
      
      if (currentExposure < 0.15) { // Less than 15% exposure
        const additionalSize = Math.min(
          portfolioValue * 0.05, // Add max 5% of portfolio
          this.sizingConfig.max_size_usd - metrics.current_size_usd
        );
        
        if (additionalSize > 1000) { // Minimum $1000 increase
          adjustments.push({
            position_id: position.id,
            adjustment_type: 'size_increase',
            size_change_usd: additionalSize,
            reason: `High performance: efficiency ${metrics.efficiency_ratio.toFixed(3)}, Sharpe ${metrics.sharpe_ratio.toFixed(2)}`,
            confidence_score: 85,
            risk_reward_ratio: metrics.profit_factor
          });
        }
      }
    } else if (metrics.efficiency_ratio < 0.3 && metrics.unrealized_pnl_pct < -5) {
      // Poor-performing position - consider reducing size
      const reductionSize = metrics.current_size_usd * 0.3; // Reduce by 30%
      
      adjustments.push({
        position_id: position.id,
        adjustment_type: 'size_decrease',
        size_change_usd: -reductionSize,
        reason: `Poor performance: efficiency ${metrics.efficiency_ratio.toFixed(3)}, PnL ${metrics.unrealized_pnl_pct.toFixed(2)}%`,
        confidence_score: 75,
        risk_reward_ratio: metrics.profit_factor
      });
    }

    // Stop loss optimization
    const dynamicStop = await this.calculateDynamicStopLoss(position.id, currentPrice);
    const currentStop = position.stop_loss_price ? parseFloat(position.stop_loss_price) : null;
    
    if (dynamicStop && (!currentStop || Math.abs(dynamicStop - currentStop) / currentStop > 0.02)) {
      adjustments.push({
        position_id: position.id,
        adjustment_type: 'stop_adjustment',
        new_stop_loss: dynamicStop,
        reason: `Dynamic stop adjustment based on volatility and trend`,
        confidence_score: 70,
        risk_reward_ratio: Math.abs(currentPrice - dynamicStop) / (position.take_profit_price ? Math.abs(position.take_profit_price - currentPrice) : currentPrice * 0.1)
      });
    }

    return adjustments;
  }

  private async executePositionAdjustments(adjustments: PositionAdjustment[]): Promise<void> {
    for (const adjustment of adjustments) {
      try {
        logger.info({ adjustment }, 'Executing position adjustment');
        
        // This would integrate with the strategy/trading system to execute adjustments
        // For now, we'll just log the adjustment
        
        await this.recordPositionAdjustment(adjustment);
        
      } catch (error) {
        logger.error({ error, adjustment }, 'Failed to execute position adjustment');
      }
    }
  }

  private async recordPositionAdjustment(adjustment: PositionAdjustment): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('position_adjustments').insert({
      id: `adj_${adjustment.position_id}_${Date.now()}`,
      ...adjustment,
      executed_at: new Date(),
      created_at: new Date()
    });
  }

  async calculatePositionMetrics(positionId: string): Promise<PositionMetrics> {
    const position = await this.getPosition(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    const currentPrice = await this.getCurrentPrice(position.symbol);
    const entryTime = new Date(position.opened_at);
    const holdDuration = (Date.now() - entryTime.getTime()) / (1000 * 60 * 60); // hours

    const quantity = parseFloat(position.quantity);
    const avgEntry = parseFloat(position.avg_entry_price);
    const currentSizeUsd = Math.abs(quantity) * currentPrice;
    
    const unrealizedPnlUsd = quantity * (currentPrice - avgEntry);
    const unrealizedPnlPct = (unrealizedPnlUsd / (Math.abs(quantity) * avgEntry)) * 100;
    
    // Get trade history for this position
    const trades = await this.getPositionTrades(positionId);
    const realizedPnl = trades.reduce((sum, trade) => sum + parseFloat(trade.pnl || '0'), 0);
    
    // Calculate MAE and MFE
    const priceHistory = await this.getPositionPriceHistory(positionId);
    const { mae, mfe } = this.calculateMAEMFE(priceHistory, avgEntry, quantity > 0);
    
    // Calculate efficiency ratio
    const efficiencyRatio = mfe > 0 ? (unrealizedPnlUsd / mfe) : 0;
    
    // Calculate other metrics
    const winRate = await this.calculateWinRate(position.symbol);
    const profitFactor = await this.calculateProfitFactor(position.symbol);
    const sharpeRatio = await this.calculateSharpeRatio(position.symbol);

    return {
      position_id: positionId,
      symbol: position.symbol,
      entry_time: entryTime,
      hold_duration_hours: holdDuration,
      current_size_usd: currentSizeUsd,
      avg_entry_price: avgEntry,
      current_price: currentPrice,
      unrealized_pnl_usd: unrealizedPnlUsd,
      unrealized_pnl_pct: unrealizedPnlPct,
      realized_pnl_usd: realizedPnl,
      max_favorable_excursion: mfe,
      max_adverse_excursion: mae,
      efficiency_ratio: efficiencyRatio,
      win_rate: winRate,
      profit_factor: profitFactor,
      sharpe_ratio: sharpeRatio
    };
  }

  async calculatePortfolioMetrics(): Promise<PortfolioMetrics> {
    const positions = await this.getActivePositions();
    const portfolioValue = await this.getPortfolioValue();
    
    let totalPnl = 0;
    let totalValue = 0;
    let largestPosition = 0;
    
    const positionMetrics: PositionMetrics[] = [];
    
    for (const position of positions) {
      const metrics = await this.calculatePositionMetrics(position.id);
      positionMetrics.push(metrics);
      
      totalPnl += metrics.unrealized_pnl_usd + metrics.realized_pnl_usd;
      totalValue += metrics.current_size_usd;
      largestPosition = Math.max(largestPosition, metrics.current_size_usd);
    }

    const avgPositionSize = positions.length > 0 ? totalValue / positions.length : 0;
    const largestPositionPct = portfolioValue > 0 ? (largestPosition / portfolioValue) * 100 : 0;
    
    // Calculate concentration ratio (HHI)
    const concentrationRatio = this.calculateHerfindahlIndex(positionMetrics.map(p => p.current_size_usd), totalValue);
    
    // Calculate correlation score
    const correlationScore = await this.calculatePortfolioCorrelation(positions.map(p => p.symbol));
    
    // Calculate portfolio-level metrics
    const portfolioBeta = await this.calculatePortfolioBeta(positions);
    const volatility = await this.calculatePortfolioVolatility(positions);
    const sharpeRatio = await this.calculatePortfolioSharpeRatio();
    const sortinoRatio = await this.calculateSortinoRatio();
    const maxDrawdown = await this.calculateMaxDrawdown();
    
    // Calculate performance metrics
    const allTrades = await this.getAllTrades();
    const wins = allTrades.filter(t => parseFloat(t.pnl || '0') > 0);
    const losses = allTrades.filter(t => parseFloat(t.pnl || '0') < 0);
    
    const winRate = allTrades.length > 0 ? (wins.length / allTrades.length) * 100 : 0;
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0) / losses.length) : 0;
    const largestWin = wins.length > 0 ? Math.max(...wins.map(t => parseFloat(t.pnl || '0'))) : 0;
    const largestLoss = losses.length > 0 ? Math.abs(Math.min(...losses.map(t => parseFloat(t.pnl || '0')))) : 0;
    
    const profitFactor = avgLoss > 0 ? (wins.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0) / Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0))) : 0;
    const recoveryFactor = maxDrawdown > 0 ? (totalPnl / portfolioValue * 100) / maxDrawdown : 0;

    return {
      total_value_usd: totalValue,
      total_pnl_usd: totalPnl,
      total_pnl_pct: portfolioValue > 0 ? (totalPnl / portfolioValue) * 100 : 0,
      number_of_positions: positions.length,
      avg_position_size_usd: avgPositionSize,
      largest_position_pct: largestPositionPct,
      concentration_ratio: concentrationRatio,
      correlation_score: correlationScore,
      portfolio_beta: portfolioBeta,
      volatility_annualized: volatility * Math.sqrt(252), // Annualized
      sharpe_ratio: sharpeRatio,
      sortino_ratio: sortinoRatio,
      max_drawdown_pct: maxDrawdown,
      recovery_factor: recoveryFactor,
      profit_factor: profitFactor,
      win_rate: winRate,
      avg_win_pct: portfolioValue > 0 ? (avgWin / portfolioValue) * 100 : 0,
      avg_loss_pct: portfolioValue > 0 ? (avgLoss / portfolioValue) * 100 : 0,
      largest_win_pct: portfolioValue > 0 ? (largestWin / portfolioValue) * 100 : 0,
      largest_loss_pct: portfolioValue > 0 ? (largestLoss / portfolioValue) * 100 : 0
    };
  }

  // Helper methods
  private async getPosition(positionId: string): Promise<any> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    return await database.connection!('positions')
      .where('id', positionId)
      .first();
  }

  private async getActivePositions(): Promise<any[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    return await database.connection!('positions')
      .where('status', 'active');
  }

  private async getPositionLevels(positionId: string): Promise<number> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const result = await database.connection!('orders')
      .where({ position_id: positionId, status: 'filled' })
      .whereIn('side', ['buy', 'sell'])
      .groupBy('side')
      .count('* as count');
    
    return result.reduce((total, r) => total + parseInt(String(r.count)), 0);
  }

  private async getPortfolioValue(): Promise<number> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const result = await database.connection!('positions')
      .where('status', 'active')
      .sum('current_value_usd as total');
    
    return parseFloat(result[0]?.total || '100000'); // Default portfolio value
  }

  private async getCurrentPrice(symbol: string): Promise<number> {
    // Mock price - would integrate with market data service
    return 45000;
  }

  private async calculateVolatility(symbol: string, lookback: number): Promise<number> {
    // Calculate historical volatility
    return 0.02; // Mock 2% daily volatility
  }

  private async calculateKellyFraction(symbol: string, lookback: number): Promise<number> {
    // Calculate Kelly criterion fraction
    const winRate = await this.calculateWinRate(symbol);
    const avgWin = 0.05; // Mock 5% average win
    const avgLoss = 0.03; // Mock 3% average loss
    
    const b = avgWin / avgLoss; // Odds
    const p = winRate / 100; // Win probability
    
    return Math.max(0, (b * p - (1 - p)) / b);
  }

  private async calculateRiskParitySize(symbol: string, portfolioValue: number): Promise<number> {
    // Risk parity position sizing
    const targetRisk = portfolioValue * 0.02; // 2% risk contribution
    const volatility = await this.calculateVolatility(symbol, 30);
    
    return targetRisk / volatility;
  }

  private async calculateTrailingStop(positionId: string, currentPrice: number): Promise<number> {
    const position = await this.getPosition(positionId);
    if (!position || !this.entryExitRules.trailing_stop_pct) {
      return 0;
    }

    const isLong = parseFloat(position.quantity) > 0;
    const trailingPct = this.entryExitRules.trailing_stop_pct / 100;
    
    // Get highest/lowest price since position opened
    const extremePrice = await this.getExtremePrice(positionId, isLong);
    
    if (isLong) {
      return extremePrice * (1 - trailingPct);
    } else {
      return extremePrice * (1 + trailingPct);
    }
  }

  private async calculateDynamicStopLoss(positionId: string, currentPrice: number): Promise<number | null> {
    const position = await this.getPosition(positionId);
    if (!position) return null;

    const isLong = parseFloat(position.quantity) > 0;
    const volatility = await this.calculateVolatility(position.symbol, 20);
    const atr = await this.calculateATR(position.symbol, 14);
    
    // Dynamic stop based on volatility and ATR
    const stopDistance = Math.max(volatility * 2, atr * 1.5);
    
    if (isLong) {
      return currentPrice * (1 - stopDistance);
    } else {
      return currentPrice * (1 + stopDistance);
    }
  }

  private async evaluateMarketConditionExit(position: any, marketConditions: any): Promise<{ should_exit: boolean; exit_percentage: number; reason: string }> {
    // Evaluate market conditions for exit decisions
    if (marketConditions.vix > 30) { // High volatility
      return { should_exit: true, exit_percentage: 50, reason: 'High market volatility detected' };
    }

    if (marketConditions.trend_strength < -0.7) { // Strong adverse trend
      return { should_exit: true, exit_percentage: 75, reason: 'Strong adverse market trend' };
    }

    return { should_exit: false, exit_percentage: 0, reason: 'Market conditions favorable' };
  }

  private calculateMAEMFE(priceHistory: number[], entryPrice: number, isLong: boolean): { mae: number; mfe: number } {
    let mae = 0; // Max Adverse Excursion
    let mfe = 0; // Max Favorable Excursion

    for (const price of priceHistory) {
      const excursion = ((price - entryPrice) / entryPrice) * 100;
      
      if (isLong) {
        if (excursion < mae) mae = excursion;
        if (excursion > mfe) mfe = excursion;
      } else {
        if (-excursion < mae) mae = -excursion;
        if (-excursion > mfe) mfe = -excursion;
      }
    }

    return { mae: Math.abs(mae), mfe: Math.abs(mfe) };
  }

  private calculateHerfindahlIndex(sizes: number[], total: number): number {
    if (total === 0) return 0;
    
    const shares = sizes.map(size => size / total);
    return shares.reduce((sum, share) => sum + share * share, 0) * 10000; // Scaled to 0-10000
  }

  // Mock helper methods - would be implemented with real data
  private async getPositionTrades(positionId: string): Promise<any[]> { return []; }
  private async getPositionPriceHistory(positionId: string): Promise<number[]> { return []; }
  private async calculateWinRate(symbol: string): Promise<number> { return 60; }
  private async calculateProfitFactor(symbol: string): Promise<number> { return 1.5; }
  private async calculateSharpeRatio(symbol: string): Promise<number> { return 1.2; }
  private async calculatePortfolioCorrelation(symbols: string[]): Promise<number> { return 0.3; }
  private async calculatePortfolioBeta(positions: any[]): Promise<number> { return 1.1; }
  private async calculatePortfolioVolatility(positions: any[]): Promise<number> { return 0.015; }
  private async calculatePortfolioSharpeRatio(): Promise<number> { return 1.4; }
  private async calculateSortinoRatio(): Promise<number> { return 1.8; }
  private async calculateMaxDrawdown(): Promise<number> { return 8.5; }
  private async getAllTrades(): Promise<any[]> { return []; }
  private async getExtremePrice(positionId: string, isHigh: boolean): Promise<number> { return 45000; }
  private async calculateATR(symbol: string, period: number): Promise<number> { return 1000; }

  getStatus() {
    return {
      running: this.running,
      sizing_config: this.sizingConfig,
      entry_exit_rules: this.entryExitRules,
      optimization_interval_ms: this.optimizationIntervalMs
    };
  }
}