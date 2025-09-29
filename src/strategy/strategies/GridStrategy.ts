import { ethers } from 'ethers';
import { Strategy } from '../base/Strategy';
import { 
  StrategyConfig, 
  ExecutionContext, 
  StrategySignal, 
  GridStrategyParams,
  GridLevel,
  MarketData,
  Order,
  StrategyError 
} from '../types';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import { TradingService, TradeRequest } from '../../dex/trading';
import { WalletManager } from '../../wallet';

export class GridStrategy extends Strategy {
  private gridParams: GridStrategyParams;
  private gridLevels: GridLevel[] = [];
  private centerPrice: string = '0';
  private tradingService: TradingService;
  private walletManager: WalletManager;

  constructor(config: StrategyConfig, walletManager?: WalletManager) {
    super(config);
    this.gridParams = config.parameters as GridStrategyParams;
    
    // Initialize trading dependencies
    this.walletManager = walletManager || WalletManager.getInstance();
    this.tradingService = new TradingService(this.walletManager);
  }

  async initialize(): Promise<void> {
    logger.info({ strategyId: this.config.id }, 'Initializing grid strategy');

    // Set center price if not provided
    if (!this.gridParams.center_price) {
      const marketData = await this.getMarketData();
      this.centerPrice = marketData.price;
    } else {
      this.centerPrice = this.gridParams.center_price;
    }

    // Generate grid levels
    await this.generateGridLevels();
    
    // Save grid levels to database
    await this.saveGridLevels();

    logger.info({ 
      strategyId: this.config.id, 
      gridLevels: this.gridLevels.length,
      centerPrice: this.centerPrice 
    }, 'Grid strategy initialized');
  }

  validateParameters(): boolean {
    const params = this.gridParams;

    // Validate required parameters
    if (!params.grid_spacing || parseFloat(params.grid_spacing) <= 0) {
      logger.error({ strategyId: this.config.id }, 'Invalid grid_spacing parameter');
      return false;
    }

    if (!params.grid_count || params.grid_count < 2) {
      logger.error({ strategyId: this.config.id }, 'Grid count must be at least 2');
      return false;
    }

    if (!params.base_order_size || parseFloat(params.base_order_size) <= 0) {
      logger.error({ strategyId: this.config.id }, 'Invalid base_order_size parameter');
      return false;
    }

    if (!params.upper_price || !params.lower_price) {
      logger.error({ strategyId: this.config.id }, 'Missing upper_price or lower_price');
      return false;
    }

    const upperPrice = parseFloat(params.upper_price);
    const lowerPrice = parseFloat(params.lower_price);

    if (upperPrice <= lowerPrice) {
      logger.error({ strategyId: this.config.id }, 'Upper price must be greater than lower price');
      return false;
    }

    // Validate grid spacing makes sense with price range
    const priceRange = upperPrice - lowerPrice;
    const gridSpacing = parseFloat(params.grid_spacing) / 100; // Convert percentage to decimal
    const maxGrids = Math.floor(priceRange / (lowerPrice * gridSpacing));

    if (params.grid_count > maxGrids) {
      logger.error({ 
        strategyId: this.config.id,
        requestedGrids: params.grid_count,
        maxPossibleGrids: maxGrids 
      }, 'Too many grids for given price range and spacing');
      return false;
    }

    return true;
  }

  getRequiredBalance(): Record<string, string> {
    // Calculate required balance for grid strategy
    const totalBuyOrders = Math.ceil(this.gridParams.grid_count / 2);
    const totalSellOrders = Math.floor(this.gridParams.grid_count / 2);

    const baseOrderSize = parseFloat(this.gridParams.base_order_size);
    const centerPrice = parseFloat(this.centerPrice);

    // Estimate required quote currency (for buy orders)
    const quoteRequired = totalBuyOrders * baseOrderSize * centerPrice * 1.1; // 10% buffer

    // Estimate required base currency (for sell orders)
    const baseRequired = totalSellOrders * baseOrderSize * 1.1; // 10% buffer

    const [baseSymbol, quoteSymbol] = this.config.symbol.split('/');

    return {
      [baseSymbol]: baseRequired.toFixed(8),
      [quoteSymbol]: quoteRequired.toFixed(8)
    };
  }

  async generateSignals(context: ExecutionContext): Promise<StrategySignal[]> {
    const signals: StrategySignal[] = [];
    const currentPrice = parseFloat(context.market_data.price);

    try {
      // Check if we need to rebalance the grid
      const rebalanceNeeded = await this.checkRebalanceNeeded(currentPrice);
      if (rebalanceNeeded) {
        await this.rebalanceGrid(currentPrice);
      }

      // Check for filled orders and create new orders
      const filledLevels = await this.checkFilledOrders();
      
      for (const level of filledLevels) {
        const signal = await this.createReorderSignal(level, currentPrice);
        if (signal) {
          signals.push(signal);
        }
      }

      // Check for empty grid levels that need orders
      const emptyLevels = this.gridLevels.filter(level => !level.order_id && !level.filled);
      
      for (const level of emptyLevels) {
        // Only create orders for levels that make sense given current price
        if (this.shouldCreateOrderForLevel(level, currentPrice)) {
          const signal = this.createGridOrderSignal(level);
          signals.push(signal);
        }
      }

    } catch (error) {
      logger.error({ error, strategyId: this.config.id }, 'Error generating grid signals');
    }

    return signals;
  }

  private async generateGridLevels(): Promise<void> {
    const params = this.gridParams;
    const centerPrice = parseFloat(this.centerPrice);
    const gridSpacing = parseFloat(params.grid_spacing) / 100; // Convert to decimal
    const gridCount = params.grid_count;

    this.gridLevels = [];

    // Calculate grid levels around center price
    const halfGrids = Math.floor(gridCount / 2);
    
    // Generate sell levels (above center price)
    for (let i = 1; i <= halfGrids; i++) {
      const price = centerPrice * (1 + (gridSpacing * i));
      
      if (price <= parseFloat(params.upper_price)) {
        this.gridLevels.push({
          id: `${this.config.id}_grid_${i}`,
          strategy_id: this.config.id,
          level: i,
          price: price.toFixed(8),
          side: 'sell',
          amount: params.base_order_size,
          filled: false,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    }

    // Generate buy levels (below center price)
    for (let i = 1; i <= halfGrids; i++) {
      const price = centerPrice * (1 - (gridSpacing * i));
      
      if (price >= parseFloat(params.lower_price)) {
        this.gridLevels.push({
          id: `${this.config.id}_grid_${-i}`,
          strategy_id: this.config.id,
          level: -i,
          price: price.toFixed(8),
          side: 'buy',
          amount: params.base_order_size,
          filled: false,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    }

    // Sort by level
    this.gridLevels.sort((a, b) => a.level - b.level);

    logger.info({ 
      strategyId: this.config.id,
      totalLevels: this.gridLevels.length,
      buyLevels: this.gridLevels.filter(l => l.side === 'buy').length,
      sellLevels: this.gridLevels.filter(l => l.side === 'sell').length
    }, 'Generated grid levels');
  }

  private async saveGridLevels(): Promise<void> {
    for (const level of this.gridLevels) {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
      await database.connection!('grid_levels')
        .insert({
          id: level.id,
          strategy_id: level.strategy_id,
          level: level.level,
          price: level.price,
          side: level.side,
          amount: level.amount,
          order_id: level.order_id,
          filled: level.filled,
          created_at: level.created_at,
          updated_at: level.updated_at
        })
        .onConflict('id')
        .merge();
    }
  }

  private async checkRebalanceNeeded(currentPrice: number): Promise<boolean> {
    const rebalanceThreshold = this.gridParams.rebalance_threshold / 100; // Convert to decimal
    const centerPrice = parseFloat(this.centerPrice);
    
    const priceDeviation = Math.abs(currentPrice - centerPrice) / centerPrice;
    
    if (priceDeviation > rebalanceThreshold) {
      logger.info({ 
        strategyId: this.config.id,
        currentPrice,
        centerPrice,
        deviation: priceDeviation,
        threshold: rebalanceThreshold
      }, 'Rebalance needed');
      return true;
    }

    return false;
  }

  private async rebalanceGrid(currentPrice: number): Promise<void> {
    logger.info({ strategyId: this.config.id, currentPrice }, 'Rebalancing grid');

    // Cancel all pending orders
    for (const level of this.gridLevels) {
      if (level.order_id) {
        try {
          await this.cancelOrder(level.order_id);
          level.order_id = undefined;
          level.updated_at = new Date();
        } catch (error) {
          logger.warn({ error, orderId: level.order_id }, 'Failed to cancel order during rebalance');
        }
      }
    }

    // Update center price and regenerate grid
    this.centerPrice = currentPrice.toFixed(8);
    await this.generateGridLevels();
    await this.saveGridLevels();
  }

  private async checkFilledOrders(): Promise<GridLevel[]> {
    const filledLevels: GridLevel[] = [];

    for (const level of this.gridLevels) {
      if (level.order_id && !level.filled) {
        try {
          // Check order status from database
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
          const order = await database.connection!('orders')
            .where('id', level.order_id)
            .first();

          if (order && order.status === 'filled') {
            level.filled = true;
            level.updated_at = new Date();
            await this.updateGridLevel(level);
            filledLevels.push(level);
          }
        } catch (error) {
          logger.error({ error, levelId: level.id }, 'Error checking order status');
        }
      }
    }

    return filledLevels;
  }

  private async updateGridLevel(level: GridLevel): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('grid_levels')
      .where('id', level.id)
      .update({
        order_id: level.order_id,
        filled: level.filled,
        updated_at: level.updated_at
      });
  }

  private async createReorderSignal(filledLevel: GridLevel, currentPrice: number): Promise<StrategySignal | null> {
    // When a grid level is filled, create opposite order
    const oppositeLevel = this.findOppositeLevel(filledLevel);
    
    if (!oppositeLevel) {
      logger.warn({ 
        strategyId: this.config.id, 
        filledLevel: filledLevel.id 
      }, 'No opposite level found for filled order');
      return null;
    }

    return this.createGridOrderSignal(oppositeLevel);
  }

  private findOppositeLevel(filledLevel: GridLevel): GridLevel | null {
    // Find the corresponding level on the opposite side
    const oppositeSide = filledLevel.side === 'buy' ? 'sell' : 'buy';
    const oppositeLevel = filledLevel.side === 'buy' ? -filledLevel.level : -filledLevel.level;

    return this.gridLevels.find(level => 
      level.side === oppositeSide && 
      level.level === oppositeLevel &&
      !level.filled &&
      !level.order_id
    ) || null;
  }

  private shouldCreateOrderForLevel(level: GridLevel, currentPrice: number): boolean {
    const levelPrice = parseFloat(level.price);

    if (level.side === 'buy') {
      // For buy orders, only create if current price is above the level price
      return currentPrice > levelPrice;
    } else {
      // For sell orders, only create if current price is below the level price  
      return currentPrice < levelPrice;
    }
  }

  private createGridOrderSignal(level: GridLevel): StrategySignal {
    return {
      id: `${this.config.id}_signal_${level.id}_${Date.now()}`,
      strategy_id: this.config.id,
      type: level.side,
      confidence: 0.8, // Grid orders have high confidence
      price: level.price,
      amount: level.amount,
      reason: `Grid ${level.side} order for level ${level.level} at price ${level.price}`,
      metadata: {
        grid_level_id: level.id,
        grid_level: level.level,
        strategy_type: 'grid'
      },
      created_at: new Date()
    };
  }

  // Real DEX trading implementation
  protected async placeOrder(parameters: any, context: ExecutionContext): Promise<Order> {
    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Get strategy wallet (assumed first wallet for now)
      const wallets = this.walletManager.getAllWallets();
      if (wallets.length === 0) {
        throw new StrategyError('No wallet available for trading', 'NO_WALLET', this.config.id);
      }
      
      const wallet = wallets[0]; // Use first available wallet
      const [baseToken, quoteToken] = this.config.symbol.split('/');
      
      // Determine trade direction and tokens
      let tokenIn: string, tokenOut: string, amountIn: string;
      
      if (parameters.side === 'buy') {
        // Buy base token with quote token
        tokenIn = quoteToken;
        tokenOut = baseToken;
        // Calculate quote amount needed (amount * price)
        amountIn = (parseFloat(parameters.amount) * parseFloat(parameters.price)).toFixed(8);
      } else {
        // Sell base token for quote token
        tokenIn = baseToken;
        tokenOut = quoteToken;
        amountIn = parameters.amount;
      }
      
      // Execute DEX trade
      const tradeRequest: TradeRequest = {
        from: wallet.address,
        tokenIn,
        tokenOut,
        amountIn,
        slippage: 0.5, // 0.5% slippage for grid trades
        dryRun: this.config.execution_mode === 'paper'
      };
      
      logger.info({ 
        strategyId: this.config.id,
        orderId,
        tradeRequest 
      }, 'Executing grid order on DEX');
      
      const tradeResult = await this.tradingService.executeTrade(tradeRequest);
      
      if (!tradeResult.success) {
        throw new Error(`DEX trade failed: ${tradeResult.error}`);
      }
      
      // Create order record
      const order: Order = {
        id: orderId,
        strategy_id: this.config.id,
        symbol: this.config.symbol,
        side: parameters.side,
        type: 'market', // DEX trades are effectively market orders
        status: tradeResult.txHash ? 'filled' : 'submitted',
        amount: parameters.amount,
        price: tradeResult.executionPrice,
        filled_amount: tradeResult.txHash ? parameters.amount : '0',
        average_price: tradeResult.executionPrice,
        fee_paid: tradeResult.gasUsed ? (parseFloat(tradeResult.gasUsed) * parseFloat(tradeResult.gasPrice) / 1e9).toFixed(8) : undefined,
        fee_asset: 'BNB',
        tx_hash: tradeResult.txHash,
        created_at: new Date(),
        updated_at: new Date(),
        filled_at: tradeResult.txHash ? new Date() : undefined
      };

      // Save to database
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
      await database.connection!('orders').insert(order);

      // Update grid level with order ID and fill status
      if (parameters.grid_level_id) {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
        await database.connection!('grid_levels')
          .where('id', parameters.grid_level_id)
          .update({ 
            order_id: orderId,
            filled: tradeResult.txHash ? true : false,
            updated_at: new Date() 
          });
      }
      
      logger.info({
        strategyId: this.config.id,
        orderId,
        txHash: tradeResult.txHash,
        executionPrice: tradeResult.executionPrice
      }, 'Grid order executed successfully');

      return order;
      
    } catch (error) {
      logger.error({ error, strategyId: this.config.id, orderId }, 'Failed to execute grid order');
      
      // Create failed order record
      const failedOrder: Order = {
        id: orderId,
        strategy_id: this.config.id,
        symbol: this.config.symbol,
        side: parameters.side,
        type: 'market',
        status: 'failed',
        amount: parameters.amount,
        price: parameters.price,
        filled_amount: '0',
        error_message: error instanceof Error ? error.message : String(error),
        created_at: new Date(),
        updated_at: new Date()
      };
      
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
      await database.connection!('orders').insert(failedOrder);
      throw error;
    }
  }

  protected async closePosition(parameters: any): Promise<boolean> {
    // Close all grid positions by cancelling orders and optionally executing market close
    try {
      const openOrders = await this.getOpenOrders();
      
      for (const order of openOrders) {
        await super.cancelOrder(order.id);
      }
      
      logger.info({ 
        strategyId: this.config.id,
        cancelledOrders: openOrders.length
      }, 'Grid positions closed');
      
      return true;
    } catch (error) {
      logger.error({ error, strategyId: this.config.id }, 'Failed to close grid positions');
      return false;
    }
  }

  protected async getMarketData(): Promise<MarketData> {
    try {
      // Get real market price from DEX
      const [baseToken, quoteToken] = this.config.symbol.split('/');
      
      // Try to get quote for 1 unit to determine current price
      const quote = await this.tradingService.getQuote(
        quoteToken, 
        baseToken, 
        '1'  // 1 unit of quote token
      );
      
      return {
        symbol: this.config.symbol,
        price: quote.executionPrice,
        volume_24h: '0', // Would need to implement volume tracking
        timestamp: new Date(),
        bid: quote.executionPrice,
        ask: quote.executionPrice,
        spread: '0'
      };
    } catch (error) {
      logger.warn({ 
        error, 
        strategyId: this.config.id,
        symbol: this.config.symbol 
      }, 'Failed to get real market data, using fallback');
      
      // Fallback to center price or default
      return {
        symbol: this.config.symbol,
        price: this.centerPrice || '100.00',
        volume_24h: '0',
        timestamp: new Date()
      };
    }
  }

  protected async getRecentCandles(): Promise<any[]> {
    // This would get real candlestick data
    return [];
  }

  protected async getBalance(): Promise<Record<string, string>> {
    try {
      // Get real wallet balances
      const wallets = this.walletManager.getAllWallets();
      if (wallets.length === 0) {
        throw new Error('No wallet available');
      }
      
      const wallet = wallets[0]; // Use first wallet
      const [baseSymbol, quoteSymbol] = this.config.symbol.split('/');
      
      // Get balances for both tokens
      const baseBalance = await this.walletManager.getTokenBalance(wallet.address, baseSymbol);
      const quoteBalance = await this.walletManager.getTokenBalance(wallet.address, quoteSymbol);
      
      return {
        [baseSymbol]: baseBalance,
        [quoteSymbol]: quoteBalance
      };
    } catch (error) {
      logger.warn({ 
        error, 
        strategyId: this.config.id 
      }, 'Failed to get real balance, using mock values');
      
      // Fallback to mock balances
      const [baseSymbol, quoteSymbol] = this.config.symbol.split('/');
      return {
        [baseSymbol]: '1000',
        [quoteSymbol]: '50000'
      };
    }
  }

  // Grid-specific methods
  public async getGridStatus(): Promise<{
    levels: GridLevel[];
    filledLevels: number;
    activeLevels: number;
    pendingOrders: number;
  }> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const levels = await database.connection!('grid_levels')
      .where('strategy_id', this.config.id);

    const filledLevels = levels.filter(l => l.filled).length;
    const activeLevels = levels.filter(l => l.order_id && !l.filled).length;
    const pendingOrders = levels.filter(l => l.order_id).length;

    return {
      levels,
      filledLevels,
      activeLevels,
      pendingOrders
    };
  }

  protected getExecutionInterval(): number {
    // Grid strategies can execute more frequently
    return 5000; // 5 seconds
  }
}