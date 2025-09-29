import { BacktestConfig, BacktestResult, StrategyConfig, Order, StrategySignal, ExecutionContext, MarketData, Candlestick, StrategyMetrics } from '../types';
import { Strategy } from '../base/Strategy';
import { BuyHoldStrategy } from '../strategies/BuyHoldStrategy';
import pino from 'pino';

const logger = pino({ name: 'BacktestEngine' });

interface BacktestState {
  currentTime: Date;
  portfolioValue: number;
  bnbBalance: number;
  tokenBalances: Map<string, number>;
  openOrders: Order[];
  filledOrders: Order[];
  positions: Map<string, { amount: number; entryPrice: number; entryTime: Date }>;
  trades: Order[];
  dailyReturns: Array<{ date: Date; value: number; return: number }>;
  maxDrawdown: number;
  peakValue: number;
}

export class BacktestEngine {
  private config: BacktestConfig;
  private strategy: Strategy;
  private state: BacktestState;
  private marketData: Map<string, Candlestick[]> = new Map();

  constructor(config: BacktestConfig) {
    this.config = config;
    this.strategy = this.createStrategy(config.strategy_config);
    this.state = this.initializeState();
  }

  private createStrategy(strategyConfig: StrategyConfig): Strategy {
    switch (strategyConfig.type) {
      case 'grid':
        // TODO: Implement GridStrategy
        throw new Error('GridStrategy not implemented yet');
      case 'market_making':
        // TODO: Implement MarketMakingStrategy
        throw new Error('MarketMakingStrategy not implemented yet');
      default:
        // Default to BuyHoldStrategy for backtesting
        return new BuyHoldStrategy(strategyConfig);
    }
  }

  private initializeState(): BacktestState {
    const initialBnbBalance = parseFloat(this.config.initial_balance['BNB'] || '100');
    
    return {
      currentTime: this.config.start_date,
      portfolioValue: initialBnbBalance,
      bnbBalance: initialBnbBalance,
      tokenBalances: new Map(),
      openOrders: [],
      filledOrders: [],
      positions: new Map(),
      trades: [],
      dailyReturns: [],
      maxDrawdown: 0,
      peakValue: initialBnbBalance
    };
  }

  async initialize(): Promise<void> {
    logger.info({ id: this.config.id }, 'Initializing backtest engine');
    
    // Generate or load historical market data
    await this.loadMarketData();
    
    // Initialize strategy
    const initialContext = this.createExecutionContext();
    await this.strategy.initialize(initialContext);
  }

  private async loadMarketData(): Promise<void> {
    // For now, generate synthetic market data
    // In a real implementation, this would load historical data from a data source
    
    const symbols = ['CAKE', 'USDT', 'ETH']; // Example tokens
    const startTime = this.config.start_date.getTime();
    const endTime = this.config.end_date.getTime();
    const intervalMs = 1000 * 60 * 60 * 24; // Daily data
    
    for (const symbol of symbols) {
      const candles: Candlestick[] = [];
      let currentPrice = 1.0; // Starting price
      
      for (let time = startTime; time <= endTime; time += intervalMs) {
        const date = new Date(time);
        
        // Generate synthetic price movement (random walk)
        const change = (Math.random() - 0.5) * 0.1; // +/- 5% max daily change
        currentPrice = Math.max(0.1, currentPrice * (1 + change));
        
        const open = currentPrice;
        const high = open * (1 + Math.random() * 0.05);
        const low = open * (1 - Math.random() * 0.05);
        const close = low + Math.random() * (high - low);
        const volume = Math.random() * 1000000; // Random volume
        
        candles.push({
          symbol,
          interval: '1d',
          open_time: date,
          close_time: new Date(time + intervalMs - 1),
          open: open.toString(),
          high: high.toString(),
          low: low.toString(),
          close: close.toString(),
          volume: volume.toString(),
          trades: Math.floor(Math.random() * 1000)
        });
        
        currentPrice = close;
      }
      
      this.marketData.set(symbol, candles);
    }
    
    logger.info({ symbols, candleCount: symbols.length * this.marketData.get(symbols[0])!.length }, 'Generated synthetic market data');
  }

  async run(): Promise<BacktestResult> {
    logger.info({ id: this.config.id }, 'Running backtest');
    
    const startTime = Date.now();
    const intervalMs = 1000 * 60 * 60 * 24; // Daily execution
    
    try {
      let currentTime = this.config.start_date.getTime();
      const endTime = this.config.end_date.getTime();
      
      while (currentTime <= endTime) {
        this.state.currentTime = new Date(currentTime);
        
        // Update market data for current time
        await this.updateMarketPrices();
        
        // Create execution context
        const context = this.createExecutionContext();
        
        // Generate signals from strategy
        const signals = await this.strategy.generateSignals(context);
        
        // Execute signals
        for (const signal of signals) {
          await this.executeSignal(signal);
        }
        
        // Process any filled orders
        await this.processOrders();
        
        // Update portfolio value and metrics
        await this.updatePortfolioMetrics();
        
        // Record daily return
        this.recordDailyReturn();
        
        currentTime += intervalMs;
      }
      
      // Calculate final metrics
      const finalMetrics = await this.calculateFinalMetrics();
      const duration = Date.now() - startTime;
      
      logger.info({ 
        configId: this.config.id,
        duration,
        finalValue: this.state.portfolioValue,
        totalTrades: this.state.trades.length
      }, 'Backtest completed');
      
      return {
        config_id: this.config.id,
        total_return: this.state.portfolioValue - parseFloat(this.config.initial_balance['BNB'] || '100'),
        annualized_return: this.calculateAnnualizedReturn(),
        max_drawdown: this.state.maxDrawdown,
        sharpe_ratio: this.calculateSharpeRatio(),
        sortino_ratio: this.calculateSortinoRatio(),
        win_rate: this.calculateWinRate(),
        total_trades: this.state.trades.length,
        avg_trade_return: this.calculateAverageTradeReturn(),
        profit_factor: this.calculateProfitFactor(),
        calmar_ratio: this.calculateCalmarRatio(),
        daily_returns: this.state.dailyReturns.map(d => d.return),
        equity_curve: this.state.dailyReturns.map(d => ({ date: d.date, value: d.value })),
        trades: this.state.trades,
        metrics: finalMetrics,
        created_at: new Date()
      };
      
    } catch (error) {
      logger.error({ error, configId: this.config.id }, 'Backtest failed');
      throw error;
    }
  }

  private async updateMarketPrices(): Promise<void> {
    // Update current market prices based on historical data
    // This is a simplified implementation
  }

  private createExecutionContext(): ExecutionContext {
    // Create current market data
    const marketData: MarketData = {
      symbol: 'CAKE', // Example
      price: '2.5', // Example price
      volume_24h: '1000000',
      timestamp: this.state.currentTime,
      bid: '2.49',
      ask: '2.51',
      spread: '0.02'
    };

    return {
      strategy: this.strategy.config,
      market_data: marketData,
      recent_candles: [], // TODO: Get recent candles for current time
      open_orders: this.state.openOrders,
      positions: [], // TODO: Convert internal positions to Position type
      balance: {
        'BNB': this.state.bnbBalance.toString(),
        ...Object.fromEntries(
          Array.from(this.state.tokenBalances.entries()).map(([token, balance]) => [token, balance.toString()])
        )
      },
      metrics: {
        strategy_id: this.strategy.config.id,
        total_trades: this.state.trades.length,
        winning_trades: this.state.trades.filter(t => parseFloat(t.filled_amount) > 0).length,
        losing_trades: this.state.trades.filter(t => parseFloat(t.filled_amount) <= 0).length,
        win_rate: this.calculateWinRate(),
        total_pnl: (this.state.portfolioValue - parseFloat(this.config.initial_balance['BNB'] || '100')).toString(),
        realized_pnl: '0', // TODO: Calculate realized PnL
        unrealized_pnl: '0', // TODO: Calculate unrealized PnL
        max_drawdown: this.state.maxDrawdown.toString(),
        max_position_size: Math.max(...Array.from(this.state.positions.values()).map(p => p.amount)).toString(),
        volume_traded: this.state.trades.reduce((sum, t) => sum + parseFloat(t.amount), 0).toString(),
        fees_paid: this.state.trades.reduce((sum, t) => sum + parseFloat(t.fee_paid || '0'), 0).toString(),
        start_time: this.config.start_date,
        updated_at: this.state.currentTime
      }
    };
  }

  private async executeSignal(signal: StrategySignal): Promise<void> {
    // Convert signal to order and execute
    const order: Order = {
      id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      strategy_id: signal.strategy_id,
      symbol: 'CAKE', // This should come from signal
      side: signal.type as 'buy' | 'sell',
      type: 'market',
      amount: signal.amount,
      price: signal.price,
      status: 'pending',
      filled_amount: '0',
      created_at: this.state.currentTime,
      updated_at: this.state.currentTime
    };

    this.state.openOrders.push(order);
    logger.debug({ orderId: order.id, signal: signal.type, amount: signal.amount }, 'Created order from signal');
  }

  private async processOrders(): Promise<void> {
    // Simulate order execution with slippage and fees
    const ordersToFill = [...this.state.openOrders];
    this.state.openOrders = [];

    for (const order of ordersToFill) {
      // Simulate immediate fill for market orders
      const fillPrice = this.simulateSlippage(parseFloat(order.price || '0'));
      const fee = parseFloat(order.amount) * this.config.commission_rate;
      
      order.status = 'filled';
      order.filled_amount = order.amount;
      order.average_price = fillPrice.toString();
      order.fee_paid = fee.toString();
      order.fee_asset = 'BNB';
      order.filled_at = this.state.currentTime;
      order.updated_at = this.state.currentTime;

      // Update balances
      if (order.side === 'buy') {
        const cost = parseFloat(order.amount) + fee;
        this.state.bnbBalance -= cost;
        const tokenBalance = this.state.tokenBalances.get(order.symbol) || 0;
        this.state.tokenBalances.set(order.symbol, tokenBalance + parseFloat(order.amount) / fillPrice);
      } else {
        const proceeds = parseFloat(order.amount) * fillPrice - fee;
        this.state.bnbBalance += proceeds;
        const tokenBalance = this.state.tokenBalances.get(order.symbol) || 0;
        this.state.tokenBalances.set(order.symbol, Math.max(0, tokenBalance - parseFloat(order.amount)));
      }

      this.state.filledOrders.push(order);
      this.state.trades.push(order);
    }
  }

  private simulateSlippage(expectedPrice: number): number {
    // Simulate slippage based on config
    const slippagePercent = this.config.slippage_model === 'fixed' ? 
      this.config.price_impact : 
      Math.random() * this.config.price_impact;
    
    return expectedPrice * (1 + (Math.random() - 0.5) * slippagePercent);
  }

  private async updatePortfolioMetrics(): Promise<void> {
    // Calculate current portfolio value
    let totalValue = this.state.bnbBalance;
    
    for (const [token, balance] of this.state.tokenBalances) {
      // Use current market price (simplified - should get actual price)
      const price = 2.5; // Mock price
      totalValue += balance * price;
    }
    
    this.state.portfolioValue = totalValue;
    
    // Update peak and drawdown
    if (totalValue > this.state.peakValue) {
      this.state.peakValue = totalValue;
    }
    
    const currentDrawdown = (this.state.peakValue - totalValue) / this.state.peakValue;
    if (currentDrawdown > this.state.maxDrawdown) {
      this.state.maxDrawdown = currentDrawdown;
    }
  }

  private recordDailyReturn(): void {
    const prevValue = this.state.dailyReturns.length > 0 ? 
      this.state.dailyReturns[this.state.dailyReturns.length - 1].value : 
      parseFloat(this.config.initial_balance['BNB'] || '100');
    
    const dailyReturn = (this.state.portfolioValue - prevValue) / prevValue;
    
    this.state.dailyReturns.push({
      date: new Date(this.state.currentTime),
      value: this.state.portfolioValue,
      return: dailyReturn
    });
  }

  private async calculateFinalMetrics(): Promise<StrategyMetrics> {
    const initialValue = parseFloat(this.config.initial_balance['BNB'] || '100');
    const totalReturn = this.state.portfolioValue - initialValue;
    
    return {
      strategy_id: this.strategy.config.id,
      total_trades: this.state.trades.length,
      winning_trades: this.state.trades.filter(t => this.isWinningTrade(t)).length,
      losing_trades: this.state.trades.filter(t => !this.isWinningTrade(t)).length,
      win_rate: this.calculateWinRate(),
      total_pnl: totalReturn.toString(),
      realized_pnl: totalReturn.toString(), // Simplified
      unrealized_pnl: '0',
      max_drawdown: (this.state.maxDrawdown * initialValue).toString(),
      sharpe_ratio: this.calculateSharpeRatio(),
      sortino_ratio: this.calculateSortinoRatio(),
      max_position_size: this.state.portfolioValue.toString(),
      volume_traded: this.state.trades.reduce((sum, t) => sum + parseFloat(t.amount), 0).toString(),
      fees_paid: this.state.trades.reduce((sum, t) => sum + parseFloat(t.fee_paid || '0'), 0).toString(),
      start_time: this.config.start_date,
      end_time: this.config.end_date,
      updated_at: new Date()
    };
  }

  private isWinningTrade(trade: Order): boolean {
    // Simplified winning trade logic
    return parseFloat(trade.filled_amount) > 0;
  }

  private calculateWinRate(): number {
    if (this.state.trades.length === 0) return 0;
    const winningTrades = this.state.trades.filter(t => this.isWinningTrade(t)).length;
    return winningTrades / this.state.trades.length;
  }

  private calculateAnnualizedReturn(): number {
    const initialValue = parseFloat(this.config.initial_balance['BNB'] || '100');
    const totalReturn = (this.state.portfolioValue - initialValue) / initialValue;
    const daysElapsed = (this.config.end_date.getTime() - this.config.start_date.getTime()) / (1000 * 60 * 60 * 24);
    const annualizedReturn = Math.pow(1 + totalReturn, 365 / daysElapsed) - 1;
    return annualizedReturn;
  }

  private calculateSharpeRatio(): number {
    if (this.state.dailyReturns.length < 2) return 0;
    
    const returns = this.state.dailyReturns.map(d => d.return);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    // Assuming risk-free rate of 0 for simplicity
    return stdDev === 0 ? 0 : avgReturn / stdDev * Math.sqrt(365);
  }

  private calculateSortinoRatio(): number {
    if (this.state.dailyReturns.length < 2) return 0;
    
    const returns = this.state.dailyReturns.map(d => d.return);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const negativeReturns = returns.filter(r => r < 0);
    
    if (negativeReturns.length === 0) return Infinity;
    
    const downvariance = negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length;
    const downsideStdDev = Math.sqrt(downvariance);
    
    return downsideStdDev === 0 ? 0 : avgReturn / downsideStdDev * Math.sqrt(365);
  }

  private calculateAverageTradeReturn(): number {
    if (this.state.trades.length === 0) return 0;
    
    const totalReturn = this.state.trades.reduce((sum, t) => {
      // Simplified - should calculate actual P&L per trade
      return sum + parseFloat(t.filled_amount);
    }, 0);
    
    return totalReturn / this.state.trades.length;
  }

  private calculateProfitFactor(): number {
    const profits = this.state.trades.filter(t => this.isWinningTrade(t))
      .reduce((sum, t) => sum + parseFloat(t.filled_amount), 0);
    const losses = this.state.trades.filter(t => !this.isWinningTrade(t))
      .reduce((sum, t) => sum + parseFloat(t.filled_amount), 0);
    
    return losses === 0 ? Infinity : profits / Math.abs(losses);
  }

  private calculateCalmarRatio(): number {
    const annualizedReturn = this.calculateAnnualizedReturn();
    return this.state.maxDrawdown === 0 ? Infinity : annualizedReturn / this.state.maxDrawdown;
  }
}