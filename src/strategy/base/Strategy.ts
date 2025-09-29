import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import { 
  StrategyConfig, 
  ExecutionContext, 
  StrategySignal, 
  StrategyAction,
  StrategyMetrics,
  Order,
  Position,
  MarketData,
  StrategyError,
  StrategyStatus 
} from '../types';

export abstract class Strategy extends EventEmitter {
  protected config: StrategyConfig;
  protected metrics: StrategyMetrics;
  protected isRunning: boolean = false;
  protected lastExecution: Date | null = null;
  private executionInterval: NodeJS.Timeout | null = null;

  constructor(config: StrategyConfig) {
    super();
    this.config = config;
    this.metrics = this.initializeMetrics();
  }

  // Abstract methods that each strategy must implement
  abstract initialize(): Promise<void>;
  abstract generateSignals(context: ExecutionContext): Promise<StrategySignal[]>;
  abstract validateParameters(): boolean;
  abstract getRequiredBalance(): Record<string, string>;
  
  // Strategy lifecycle management
  async start(): Promise<void> {
    try {
      if (this.isRunning) {
        logger.warn({ strategyId: this.config.id }, 'Strategy is already running');
        return;
      }

      logger.info({ strategyId: this.config.id, name: this.config.name }, 'Starting strategy');

      // Validate configuration
      if (!this.validateParameters()) {
        throw new StrategyError('Invalid strategy parameters', 'INVALID_PARAMS', this.config.id);
      }

      // Initialize strategy
      await this.initialize();

      // Update status
      await this.updateStatus('active');
      this.isRunning = true;

      // Start execution loop if not in backtest mode
      if (this.config.execution_mode === 'live' || this.config.execution_mode === 'paper') {
        this.startExecutionLoop();
      }

      this.emit('started', { strategyId: this.config.id });
      logger.info({ strategyId: this.config.id }, 'Strategy started successfully');

    } catch (error) {
      logger.error({ error, strategyId: this.config.id }, 'Failed to start strategy');
      await this.updateStatus('error');
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      if (!this.isRunning) {
        logger.warn({ strategyId: this.config.id }, 'Strategy is not running');
        return;
      }

      logger.info({ strategyId: this.config.id }, 'Stopping strategy');

      this.isRunning = false;
      
      // Stop execution loop
      if (this.executionInterval) {
        clearInterval(this.executionInterval);
        this.executionInterval = null;
      }

      // Cancel pending orders (if required by strategy)
      await this.cancelAllOrders();

      // Update status
      await this.updateStatus('stopped');

      this.emit('stopped', { strategyId: this.config.id });
      logger.info({ strategyId: this.config.id }, 'Strategy stopped');

    } catch (error) {
      logger.error({ error, strategyId: this.config.id }, 'Failed to stop strategy');
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (!this.isRunning) {
      throw new StrategyError('Cannot pause inactive strategy', 'INVALID_STATE', this.config.id);
    }

    await this.updateStatus('paused');
    this.emit('paused', { strategyId: this.config.id });
    logger.info({ strategyId: this.config.id }, 'Strategy paused');
  }

  async resume(): Promise<void> {
    if (this.config.status !== 'paused') {
      throw new StrategyError('Cannot resume non-paused strategy', 'INVALID_STATE', this.config.id);
    }

    await this.updateStatus('active');
    this.emit('resumed', { strategyId: this.config.id });
    logger.info({ strategyId: this.config.id }, 'Strategy resumed');
  }

  // Execution methods
  protected startExecutionLoop(): void {
    const intervalMs = this.getExecutionInterval();
    
    this.executionInterval = setInterval(async () => {
      if (this.isRunning && this.config.status === 'active') {
        await this.executeStrategy();
      }
    }, intervalMs);

    logger.debug({ strategyId: this.config.id, intervalMs }, 'Started execution loop');
  }

  protected async executeStrategy(): Promise<void> {
    try {
      const context = await this.buildExecutionContext();
      
      // Generate signals
      const signals = await this.generateSignals(context);
      
      if (signals.length === 0) {
        return; // No signals to process
      }

      // Process each signal
      for (const signal of signals) {
        await this.processSignal(signal, context);
      }

      this.lastExecution = new Date();
      await this.updateMetrics(context);

    } catch (error) {
      logger.error({ error, strategyId: this.config.id }, 'Strategy execution error');
      await this.handleExecutionError(error);
    }
  }

  protected async processSignal(signal: StrategySignal, context: ExecutionContext): Promise<void> {
    try {
      // Save signal to database
      await this.saveSignal(signal);

      // Create and execute actions based on signal
      const actions = await this.createActionsFromSignal(signal, context);
      
      for (const action of actions) {
        await this.executeAction(action, context);
      }

      this.emit('signal', { signal, strategyId: this.config.id });
      
    } catch (error) {
      logger.error({ error, signal, strategyId: this.config.id }, 'Failed to process signal');
      throw error;
    }
  }

  protected async createActionsFromSignal(
    signal: StrategySignal, 
    context: ExecutionContext
  ): Promise<StrategyAction[]> {
    const actions: StrategyAction[] = [];
    const actionId = `${this.config.id}_${signal.id}_${Date.now()}`;

    switch (signal.type) {
      case 'buy':
      case 'sell':
        // Create place order action
        actions.push({
          id: actionId,
          strategy_id: this.config.id,
          signal_id: signal.id,
          type: 'place_order',
          parameters: {
            side: signal.type,
            amount: signal.amount,
            price: signal.price,
            type: 'limit' // Default to limit orders
          },
          status: 'pending',
          created_at: new Date()
        });
        break;

      case 'close':
        // Create close position action
        actions.push({
          id: actionId,
          strategy_id: this.config.id,
          signal_id: signal.id,
          type: 'close_position',
          parameters: {
            symbol: this.config.symbol,
            amount: signal.amount
          },
          status: 'pending',
          created_at: new Date()
        });
        break;

      case 'hold':
        // No action needed for hold signals
        break;

      case 'adjust':
        // Strategy-specific adjustment logic
        // This would be implemented by each strategy type
        break;
    }

    return actions;
  }

  protected async executeAction(action: StrategyAction, context: ExecutionContext): Promise<void> {
    try {
      action.status = 'executing';
      await this.saveAction(action);

      let result: any = null;

      switch (action.type) {
        case 'place_order':
          result = await this.placeOrder(action.parameters, context);
          break;
        case 'cancel_order':
          result = await this.cancelOrder(action.parameters.order_id);
          break;
        case 'modify_order':
          result = await this.modifyOrder(action.parameters.order_id, action.parameters);
          break;
        case 'close_position':
          result = await this.closePosition(action.parameters);
          break;
        case 'pause_strategy':
          await this.pause();
          result = { paused: true };
          break;
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      action.status = 'completed';
      action.result = result;
      action.executed_at = new Date();
      
      await this.saveAction(action);
      this.emit('action', { action, result, strategyId: this.config.id });

    } catch (error) {
      action.status = 'failed';
      action.error = error instanceof Error ? error.message : String(error);
      action.executed_at = new Date();
      
      await this.saveAction(action);
      logger.error({ error, action, strategyId: this.config.id }, 'Action execution failed');
      throw error;
    }
  }

  // Context and data methods
  protected async buildExecutionContext(): Promise<ExecutionContext> {
    const [openOrders, positions, marketData, recentCandles] = await Promise.all([
      this.getOpenOrders(),
      this.getPositions(),
      this.getMarketData(),
      this.getRecentCandles()
    ]);

    const balance = await this.getBalance();

    return {
      strategy: this.config,
      market_data: marketData,
      recent_candles: recentCandles,
      open_orders: openOrders,
      positions: positions,
      balance: balance,
      metrics: this.metrics
    };
  }

  // Order management methods with DEX integration
  protected async placeOrder(parameters: any, context: ExecutionContext): Promise<Order> {
    // This will be implemented by concrete strategy classes with TradingService integration
    throw new Error('placeOrder must be implemented by concrete strategy class');
  }
  
  protected async cancelOrder(orderId: string): Promise<boolean> {
    // Cancel order in database - actual DEX orders are typically non-cancellable
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('orders')
      .where('id', orderId)
      .update({ status: 'cancelled', updated_at: new Date() });
    return true;
  }
  
  protected async modifyOrder(orderId: string, parameters: any): Promise<Order> {
    // Modify order in database
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const order = await database.connection!('orders').where('id', orderId).first();
    if (!order) throw new Error(`Order ${orderId} not found`);
    
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('orders')
      .where('id', orderId)
      .update({
        price: parameters.price || order.price,
        amount: parameters.amount || order.amount,
        updated_at: new Date()
      });
    
    return { ...order, ...parameters, updated_at: new Date() };
  }
  
  protected async closePosition(parameters: any): Promise<boolean> {
    // Close position by creating opposite order
    throw new Error('closePosition must be implemented by concrete strategy class');
  }
  
  // Abstract methods for market data
  protected abstract getMarketData(): Promise<MarketData>;
  protected abstract getRecentCandles(): Promise<any[]>;
  protected abstract getBalance(): Promise<Record<string, string>>;

  // Database operations
  protected async getOpenOrders(): Promise<Order[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('orders')
      .where('strategy_id', this.config.id)
      .whereIn('status', ['pending', 'submitted', 'partial']);
    
    return rows as Order[];
  }

  protected async getPositions(): Promise<Position[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('positions')
      .where('strategy_id', this.config.id);
    
    return rows as Position[];
  }

  protected async cancelAllOrders(): Promise<void> {
    const openOrders = await this.getOpenOrders();
    
    for (const order of openOrders) {
      try {
        await this.cancelOrder(order.id);
      } catch (error) {
        logger.warn({ error, orderId: order.id }, 'Failed to cancel order during strategy stop');
      }
    }
  }

  protected async saveSignal(signal: StrategySignal): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('strategy_signals').insert({
      id: signal.id,
      strategy_id: signal.strategy_id,
      type: signal.type,
      confidence: signal.confidence,
      price: signal.price,
      amount: signal.amount,
      reason: signal.reason,
      metadata: JSON.stringify(signal.metadata || {}),
      created_at: signal.created_at
    });
  }

  protected async saveAction(action: StrategyAction): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('strategy_actions')
      .insert({
        id: action.id,
        strategy_id: action.strategy_id,
        signal_id: action.signal_id,
        type: action.type,
        parameters: JSON.stringify(action.parameters),
        status: action.status,
        result: JSON.stringify(action.result || {}),
        error: action.error,
        created_at: action.created_at,
        executed_at: action.executed_at
      })
      .onConflict('id')
      .merge([
        'status', 
        'result', 
        'error', 
        'executed_at'
      ]);
  }

  protected async updateStatus(status: StrategyStatus): Promise<void> {
    this.config.status = status;
    this.config.updated_at = new Date();
    
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('strategies')
      .where('id', this.config.id)
      .update({
        status: status,
        updated_at: this.config.updated_at
      });
  }

  protected async updateMetrics(context: ExecutionContext): Promise<void> {
    // Update metrics based on current state
    // This would calculate PnL, win rate, etc.
    this.metrics.updated_at = new Date();
    
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('strategy_metrics')
      .where('strategy_id', this.config.id)
      .update({
        total_trades: this.metrics.total_trades,
        winning_trades: this.metrics.winning_trades,
        losing_trades: this.metrics.losing_trades,
        win_rate: this.metrics.win_rate,
        total_pnl: this.metrics.total_pnl,
        realized_pnl: this.metrics.realized_pnl,
        unrealized_pnl: this.metrics.unrealized_pnl,
        max_drawdown: this.metrics.max_drawdown,
        sharpe_ratio: this.metrics.sharpe_ratio,
        sortino_ratio: this.metrics.sortino_ratio,
        max_position_size: this.metrics.max_position_size,
        volume_traded: this.metrics.volume_traded,
        fees_paid: this.metrics.fees_paid,
        updated_at: this.metrics.updated_at
      });
  }

  protected async handleExecutionError(error: any): Promise<void> {
    // Strategy-specific error handling
    this.emit('error', { error, strategyId: this.config.id });
    
    // If critical error, pause strategy
    if (error instanceof StrategyError && error.code === 'CRITICAL') {
      await this.pause();
    }
  }

  // Utility methods
  protected getExecutionInterval(): number {
    // Default execution interval: 10 seconds
    // Can be overridden by specific strategies
    return 10000;
  }

  protected initializeMetrics(): StrategyMetrics {
    return {
      strategy_id: this.config.id,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      win_rate: 0,
      total_pnl: '0',
      realized_pnl: '0',
      unrealized_pnl: '0',
      max_drawdown: '0',
      max_position_size: '0',
      volume_traded: '0',
      fees_paid: '0',
      start_time: new Date(),
      updated_at: new Date()
    };
  }

  // Public getters
  public getConfig(): StrategyConfig {
    return { ...this.config };
  }

  public getMetrics(): StrategyMetrics {
    return { ...this.metrics };
  }

  public getStatus(): {
    id: string;
    name: string;
    type: string;
    status: StrategyStatus;
    isRunning: boolean;
    lastExecution: Date | null;
    metrics: StrategyMetrics;
  } {
    return {
      id: this.config.id,
      name: this.config.name,
      type: this.config.type,
      status: this.config.status,
      isRunning: this.isRunning,
      lastExecution: this.lastExecution,
      metrics: this.metrics
    };
  }
}