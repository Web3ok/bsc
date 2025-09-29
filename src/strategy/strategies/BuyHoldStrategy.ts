import { StrategyConfig, StrategySignal, ExecutionContext, StrategyMetrics } from '../types';
import { Strategy } from '../base/Strategy';
import { logger } from '../../utils/logger';

export interface BuyHoldParams {
  target_tokens: string[];
  allocation_percent: Record<string, number>; // token -> percentage
  rebalance_threshold: number; // percentage deviation to trigger rebalance
  initial_investment: string; // in BNB
}

export class BuyHoldStrategy extends Strategy {
  private params: BuyHoldParams;
  private positions: Map<string, { amount: string; entryPrice: string }> = new Map();
  private lastRebalance: Date = new Date();

  constructor(config: StrategyConfig) {
    super(config);
    this.params = config.parameters as BuyHoldParams;
    
    // Validate parameters
    this.validateParams();
  }

  private validateParams(): void {
    if (!this.params.target_tokens || this.params.target_tokens.length === 0) {
      throw new Error('BuyHoldStrategy requires target_tokens');
    }

    if (!this.params.allocation_percent || Object.keys(this.params.allocation_percent).length === 0) {
      throw new Error('BuyHoldStrategy requires allocation_percent');
    }

    // Check that allocations sum to 100%
    const totalAllocation = Object.values(this.params.allocation_percent).reduce((sum, pct) => sum + pct, 0);
    if (Math.abs(totalAllocation - 100) > 0.01) {
      throw new Error(`BuyHoldStrategy allocations must sum to 100%, got ${totalAllocation}%`);
    }

    // Check that all target tokens have allocations
    for (const token of this.params.target_tokens) {
      if (!(token in this.params.allocation_percent)) {
        throw new Error(`No allocation specified for token ${token}`);
      }
    }
  }

  async initialize(context: ExecutionContext): Promise<void> {
    logger.info({ strategyId: this.config.id }, 'Initializing BuyHoldStrategy');
    
    // Initial buy of all target tokens if no positions exist
    if (this.positions.size === 0) {
      await this.initialPurchase(context);
    }
  }

  async generateSignals(context: ExecutionContext): Promise<StrategySignal[]> {
    const signals: StrategySignal[] = [];
    const currentTime = new Date();

    // Check if we need to rebalance (weekly rebalancing)
    const daysSinceRebalance = (currentTime.getTime() - this.lastRebalance.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysSinceRebalance >= 7) {
      const rebalanceSignals = await this.generateRebalanceSignals(context);
      signals.push(...rebalanceSignals);
      this.lastRebalance = currentTime;
    }

    return signals;
  }

  private async initialPurchase(context: ExecutionContext): Promise<void> {
    // This would be called during initialization to buy initial positions
    logger.info({ strategyId: this.config.id }, 'Performing initial purchase for BuyHoldStrategy');
    
    for (const token of this.params.target_tokens) {
      const allocation = this.params.allocation_percent[token];
      const investmentAmount = (parseFloat(this.params.initial_investment) * allocation / 100).toString();
      
      this.positions.set(token, {
        amount: '0', // Will be updated when order is filled
        entryPrice: context.market_data.price
      });
      
      logger.info({
        strategyId: this.config.id,
        token,
        allocation,
        investmentAmount
      }, 'Planned initial purchase');
    }
  }

  private async generateRebalanceSignals(context: ExecutionContext): Promise<StrategySignal[]> {
    const signals: StrategySignal[] = [];
    
    // Calculate current portfolio value and target allocations
    const totalPortfolioValue = this.calculatePortfolioValue(context);
    
    for (const token of this.params.target_tokens) {
      const targetAllocation = this.params.allocation_percent[token];
      const targetValue = totalPortfolioValue * targetAllocation / 100;
      
      const currentPosition = this.positions.get(token);
      const currentValue = currentPosition ? 
        parseFloat(currentPosition.amount) * parseFloat(context.market_data.price) : 0;
      
      const deviation = Math.abs(currentValue - targetValue) / targetValue;
      
      // If deviation exceeds threshold, create rebalance signal
      if (deviation > this.params.rebalance_threshold / 100) {
        const action = currentValue > targetValue ? 'sell' : 'buy';
        const amount = Math.abs(targetValue - currentValue);
        
        signals.push({
          id: `${this.config.id}_rebalance_${token}_${Date.now()}`,
          strategy_id: this.config.id,
          type: action as 'buy' | 'sell',
          confidence: 0.9,
          price: context.market_data.price,
          amount: amount.toString(),
          reason: `Rebalancing ${token}: current ${currentValue.toFixed(4)} BNB, target ${targetValue.toFixed(4)} BNB`,
          metadata: {
            rebalance: true,
            token,
            current_allocation: (currentValue / totalPortfolioValue) * 100,
            target_allocation: targetAllocation,
            deviation: deviation * 100
          },
          created_at: new Date()
        });
      }
    }

    return signals;
  }

  private calculatePortfolioValue(context: ExecutionContext): number {
    let totalValue = 0;
    
    // Add BNB balance
    const bnbBalance = parseFloat(context.balance['BNB'] || '0');
    totalValue += bnbBalance;
    
    // Add token positions value
    for (const [token, position] of this.positions) {
      const tokenValue = parseFloat(position.amount) * parseFloat(context.market_data.price);
      totalValue += tokenValue;
    }
    
    return totalValue;
  }

  async onOrderFilled(orderId: string, filledAmount: string, filledPrice: string, context: ExecutionContext): Promise<void> {
    // Update position when order is filled
    // This is a simplified implementation - in reality, you'd track which order corresponds to which token
    logger.info({
      strategyId: this.config.id,
      orderId,
      filledAmount,
      filledPrice
    }, 'Order filled for BuyHoldStrategy');
  }

  async calculateMetrics(context: ExecutionContext): Promise<StrategyMetrics> {
    const currentValue = this.calculatePortfolioValue(context);
    const initialValue = parseFloat(this.params.initial_investment);
    const totalReturn = currentValue - initialValue;
    const returnPercent = (totalReturn / initialValue) * 100;

    return {
      strategy_id: this.config.id,
      total_trades: context.metrics.total_trades,
      winning_trades: context.metrics.winning_trades,
      losing_trades: context.metrics.losing_trades,
      win_rate: context.metrics.win_rate,
      total_pnl: totalReturn.toString(),
      realized_pnl: '0', // Buy and hold doesn't realize profits until final sale
      unrealized_pnl: totalReturn.toString(),
      max_drawdown: context.metrics.max_drawdown,
      sharpe_ratio: context.metrics.sharpe_ratio,
      sortino_ratio: context.metrics.sortino_ratio,
      max_position_size: currentValue.toString(),
      volume_traded: context.metrics.volume_traded,
      fees_paid: context.metrics.fees_paid,
      start_time: context.metrics.start_time,
      end_time: context.metrics.end_time,
      updated_at: new Date()
    };
  }

  getStrategyInfo(): any {
    return {
      name: 'Buy and Hold',
      description: 'Simple buy and hold strategy with periodic rebalancing',
      version: '1.0.0',
      parameters: {
        target_tokens: this.params.target_tokens,
        allocation_percent: this.params.allocation_percent,
        rebalance_threshold: this.params.rebalance_threshold,
        initial_investment: this.params.initial_investment
      }
    };
  }
}