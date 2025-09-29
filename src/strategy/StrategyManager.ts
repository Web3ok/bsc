import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { database } from '../persistence/database';
import { Strategy } from './base/Strategy';
import { GridStrategy } from './strategies/GridStrategy';
import { conditionalOrderManager } from './triggers/ConditionalOrderManager';
import { WalletManager } from '../wallet';
import { 
  StrategyConfig, 
  StrategyType,
  ExecutionMode,
  StrategyStatus,
  StrategyMetrics,
  StrategyError
} from './types';

export interface StrategyManagerConfig {
  max_concurrent_strategies: number;
  default_execution_mode: ExecutionMode;
  enable_conditional_orders: boolean;
  risk_check_interval: number;
}

export class StrategyManager extends EventEmitter {
  private static instance: StrategyManager;
  private strategies: Map<string, Strategy> = new Map();
  private config: StrategyManagerConfig;
  private riskCheckInterval: NodeJS.Timeout | null = null;
  private running = false;
  private walletManager: WalletManager;

  private constructor(config: StrategyManagerConfig, walletManager?: WalletManager) {
    super();
    this.config = config;
    this.walletManager = walletManager || WalletManager.getInstance();
  }

  public static getInstance(config?: StrategyManagerConfig, walletManager?: WalletManager): StrategyManager {
    if (!StrategyManager.instance) {
      if (!config) {
        throw new Error('StrategyManager requires config on first initialization');
      }
      StrategyManager.instance = new StrategyManager(config, walletManager);
    }
    return StrategyManager.instance;
  }

  async start(): Promise<void> {
    if (this.running) return;

    logger.info('Starting Strategy Manager');
    this.running = true;

    // Start conditional order manager if enabled
    if (this.config.enable_conditional_orders) {
      await conditionalOrderManager.start();
    }

    // Load and start active strategies from database
    await this.loadActiveStrategies();

    // Start risk monitoring
    this.startRiskMonitoring();

    logger.info({ 
      activeStrategies: this.strategies.size,
      conditionalOrdersEnabled: this.config.enable_conditional_orders 
    }, 'Strategy Manager started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('Stopping Strategy Manager');
    this.running = false;

    // Stop all running strategies
    for (const [id, strategy] of this.strategies) {
      try {
        await strategy.stop();
      } catch (error) {
        logger.error({ error, strategyId: id }, 'Error stopping strategy');
      }
    }

    // Stop conditional order manager
    if (this.config.enable_conditional_orders) {
      await conditionalOrderManager.stop();
    }

    // Stop risk monitoring
    if (this.riskCheckInterval) {
      clearInterval(this.riskCheckInterval);
      this.riskCheckInterval = null;
    }

    this.strategies.clear();
    logger.info('Strategy Manager stopped');
  }

  async createStrategy(config: StrategyConfig): Promise<string> {
    // Validate strategy limits
    if (this.strategies.size >= this.config.max_concurrent_strategies) {
      throw new StrategyError(
        `Maximum concurrent strategies limit reached (${this.config.max_concurrent_strategies})`,
        'LIMIT_EXCEEDED',
        config.id
      );
    }

    // Create strategy instance
    const strategy = this.createStrategyInstance(config);

    // Save to database
    await this.saveStrategyConfig(config);

    // Initialize metrics
    await this.initializeMetrics(config.id);

    // Add to manager
    this.strategies.set(config.id, strategy);

    // Set up event listeners
    this.setupStrategyEventListeners(strategy);

    logger.info({ 
      strategyId: config.id, 
      type: config.type,
      symbol: config.symbol 
    }, 'Strategy created');

    this.emit('strategyCreated', { strategyId: config.id, config });
    return config.id;
  }

  async startStrategy(strategyId: string): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new StrategyError('Strategy not found', 'NOT_FOUND', strategyId);
    }

    await strategy.start();
    logger.info({ strategyId }, 'Strategy started');
  }

  async stopStrategy(strategyId: string): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new StrategyError('Strategy not found', 'NOT_FOUND', strategyId);
    }

    await strategy.stop();
    logger.info({ strategyId }, 'Strategy stopped');
  }

  async pauseStrategy(strategyId: string): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new StrategyError('Strategy not found', 'NOT_FOUND', strategyId);
    }

    await strategy.pause();
    logger.info({ strategyId }, 'Strategy paused');
  }

  async resumeStrategy(strategyId: string): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new StrategyError('Strategy not found', 'NOT_FOUND', strategyId);
    }

    await strategy.resume();
    logger.info({ strategyId }, 'Strategy resumed');
  }

  async deleteStrategy(strategyId: string): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (strategy) {
      // Stop strategy if running
      if (strategy.getStatus().isRunning) {
        await strategy.stop();
      }

      // Remove from manager
      this.strategies.delete(strategyId);
    }

    // Delete from database (cascade will handle related records)
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('strategies').where('id', strategyId).delete();

    logger.info({ strategyId }, 'Strategy deleted');
    this.emit('strategyDeleted', { strategyId });
  }

  async updateStrategy(strategyId: string, updates: Partial<StrategyConfig>): Promise<void> {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new StrategyError('Strategy not found', 'NOT_FOUND', strategyId);
    }

    // Update database
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('strategies')
      .where('id', strategyId)
      .update({
        ...updates,
        updated_at: new Date()
      });

    logger.info({ strategyId, updates }, 'Strategy updated');
    this.emit('strategyUpdated', { strategyId, updates });
  }

  getStrategy(strategyId: string): Strategy | undefined {
    return this.strategies.get(strategyId);
  }

  getAllStrategies(): Map<string, Strategy> {
    return new Map(this.strategies);
  }

  async getStrategyMetrics(strategyId: string): Promise<StrategyMetrics | null> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const row = await database.connection!('strategy_metrics')
      .where('strategy_id', strategyId)
      .first();

    return row || null;
  }

  getManagerStatus(): {
    running: boolean;
    totalStrategies: number;
    activeStrategies: number;
    pausedStrategies: number;
    conditionalOrdersEnabled: boolean;
  } {
    const strategies = Array.from(this.strategies.values());
    const activeCount = strategies.filter(s => s.getStatus().status === 'active').length;
    const pausedCount = strategies.filter(s => s.getStatus().status === 'paused').length;

    return {
      running: this.running,
      totalStrategies: this.strategies.size,
      activeStrategies: activeCount,
      pausedStrategies: pausedCount,
      conditionalOrdersEnabled: this.config.enable_conditional_orders
    };
  }

  private createStrategyInstance(config: StrategyConfig): Strategy {
    switch (config.type) {
      case 'grid':
        return new GridStrategy(config, this.walletManager);
      // Add other strategy types as they're implemented
      default:
        throw new StrategyError(`Unsupported strategy type: ${config.type}`, 'INVALID_TYPE', config.id);
    }
  }

  private async loadActiveStrategies(): Promise<void> {
    try {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
      const rows = await database.connection!('strategies')
        .whereIn('status', ['active', 'paused']);

      for (const row of rows) {
        const config: StrategyConfig = {
          id: row.id,
          name: row.name,
          type: row.type,
          description: row.description,
          symbol: row.symbol,
          status: row.status,
          execution_mode: row.execution_mode,
          risk_limits: JSON.parse(row.risk_limits),
          parameters: JSON.parse(row.parameters),
          created_at: row.created_at,
          updated_at: row.updated_at
        };

        const strategy = this.createStrategyInstance(config);
        this.strategies.set(config.id, strategy);
        this.setupStrategyEventListeners(strategy);

        // Start active strategies
        if (config.status === 'active') {
          try {
            await strategy.start();
          } catch (error) {
            logger.error({ error, strategyId: config.id }, 'Failed to start strategy on load');
          }
        }
      }

      logger.info({ count: rows.length }, 'Loaded strategies from database');
    } catch (error) {
      logger.error({ error }, 'Failed to load strategies');
    }
  }

  private setupStrategyEventListeners(strategy: Strategy): void {
    const config = strategy.getConfig();

    strategy.on('started', () => {
      this.emit('strategyStarted', { strategyId: config.id });
    });

    strategy.on('stopped', () => {
      this.emit('strategyStopped', { strategyId: config.id });
    });

    strategy.on('paused', () => {
      this.emit('strategyPaused', { strategyId: config.id });
    });

    strategy.on('resumed', () => {
      this.emit('strategyResumed', { strategyId: config.id });
    });

    strategy.on('signal', (data) => {
      this.emit('strategySignal', { ...data, strategyId: config.id });
    });

    strategy.on('action', (data) => {
      this.emit('strategyAction', { ...data, strategyId: config.id });
    });

    strategy.on('error', (data) => {
      logger.error({ error: data.error, strategyId: config.id }, 'Strategy error');
      this.emit('strategyError', { ...data, strategyId: config.id });
    });
  }

  private async saveStrategyConfig(config: StrategyConfig): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('strategies')
      .insert({
        id: config.id,
        name: config.name,
        type: config.type,
        description: config.description,
        symbol: config.symbol,
        status: config.status,
        execution_mode: config.execution_mode,
        risk_limits: JSON.stringify(config.risk_limits),
        parameters: JSON.stringify(config.parameters),
        created_at: config.created_at || new Date(),
        updated_at: config.updated_at || new Date()
      })
      .onConflict('id')
      .merge();
  }

  private async initializeMetrics(strategyId: string): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('strategy_metrics')
      .insert({
        strategy_id: strategyId,
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
      })
      .onConflict('strategy_id')
      .ignore();
  }

  private startRiskMonitoring(): void {
    this.riskCheckInterval = setInterval(async () => {
      if (!this.running) return;

      try {
        await this.performRiskChecks();
      } catch (error) {
        logger.error({ error }, 'Error performing risk checks');
      }
    }, this.config.risk_check_interval);

    logger.debug({ 
      interval: this.config.risk_check_interval 
    }, 'Started risk monitoring');
  }

  private async performRiskChecks(): Promise<void> {
    for (const [strategyId, strategy] of this.strategies) {
      if (!strategy.getStatus().isRunning) continue;

      try {
        const config = strategy.getConfig();
        const metrics = await this.getStrategyMetrics(strategyId);
        
        if (!metrics) continue;

        // Check maximum drawdown
        const currentDrawdown = parseFloat(metrics.max_drawdown);
        const maxAllowedDrawdown = config.risk_limits.max_drawdown_percent / 100;
        
        if (currentDrawdown > maxAllowedDrawdown) {
          logger.warn({
            strategyId,
            currentDrawdown,
            maxAllowed: maxAllowedDrawdown
          }, 'Strategy exceeded max drawdown - pausing');
          
          await strategy.pause();
          this.emit('riskLimitExceeded', {
            strategyId,
            type: 'max_drawdown',
            current: currentDrawdown,
            limit: maxAllowedDrawdown
          });
        }

        // Check daily loss limit
        const dailyPnl = parseFloat(metrics.realized_pnl); // This would need proper daily calculation
        const maxDailyLoss = parseFloat(config.risk_limits.max_daily_volume);
        
        if (dailyPnl < -maxDailyLoss) {
          logger.warn({
            strategyId,
            dailyPnl,
            maxDailyLoss
          }, 'Strategy exceeded daily loss limit - pausing');
          
          await strategy.pause();
          this.emit('riskLimitExceeded', {
            strategyId,
            type: 'daily_loss',
            current: Math.abs(dailyPnl),
            limit: maxDailyLoss
          });
        }

      } catch (error) {
        logger.error({ error, strategyId }, 'Error checking strategy risk limits');
      }
    }
  }
}

// Export singleton instance getter
export const getStrategyManager = (config?: StrategyManagerConfig, walletManager?: WalletManager): StrategyManager => {
  return StrategyManager.getInstance(config, walletManager);
};