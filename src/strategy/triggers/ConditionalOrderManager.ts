import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import { marketEventProcessor } from '../../market/eventProcessor';
import { 
  ConditionalOrderParams,
  TriggerCondition,
  Order,
  MarketData,
  OrderRequest,
  Candlestick 
} from '../types';

export interface ConditionalOrder extends ConditionalOrderParams {
  id: string;
  status: 'active' | 'triggered' | 'expired' | 'cancelled';
  strategy_id?: string;
  created_at: Date;
  updated_at: Date;
  triggered_at?: Date;
  triggered_order_id?: string;
  expire_time?: Date;
}

export class ConditionalOrderManager extends EventEmitter {
  private static instance: ConditionalOrderManager;
  private orders: Map<string, ConditionalOrder> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private running = false;
  
  // Market data caches for trigger evaluation
  private marketDataCache = new Map<string, MarketData>();
  private candleDataCache = new Map<string, Candlestick[]>();
  private indicatorCache = new Map<string, any>();

  private constructor() {
    super();
    this.setupEventListeners();
  }

  public static getInstance(): ConditionalOrderManager {
    if (!ConditionalOrderManager.instance) {
      ConditionalOrderManager.instance = new ConditionalOrderManager();
    }
    return ConditionalOrderManager.instance;
  }

  async start(): Promise<void> {
    if (this.running) return;

    logger.info('Starting conditional order manager');
    this.running = true;

    // Load existing conditional orders from database
    await this.loadConditionalOrders();

    // Start evaluation loop
    this.checkInterval = setInterval(() => {
      this.evaluateAllConditions().catch(error => {
        logger.error({ error }, 'Error evaluating conditional orders');
      });
    }, 1000); // Check every second for high precision

    logger.info({ activeOrders: this.orders.size }, 'Conditional order manager started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('Stopping conditional order manager');
    this.running = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    logger.info('Conditional order manager stopped');
  }

  async createConditionalOrder(params: ConditionalOrderParams): Promise<ConditionalOrder> {
    const orderId = `cond_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const conditionalOrder: ConditionalOrder = {
      id: orderId,
      ...params,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date()
    };

    // Validate trigger condition
    this.validateTriggerCondition(conditionalOrder.trigger_condition);

    // Save to database
    await this.saveConditionalOrder(conditionalOrder);

    // Add to memory
    this.orders.set(orderId, conditionalOrder);

    logger.info({ 
      orderId, 
      triggerType: conditionalOrder.trigger_condition.type,
      symbol: conditionalOrder.trigger_condition.symbol 
    }, 'Created conditional order');

    this.emit('orderCreated', conditionalOrder);
    return conditionalOrder;
  }

  async cancelConditionalOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) {
      logger.warn({ orderId }, 'Conditional order not found for cancellation');
      return false;
    }

    order.status = 'cancelled';
    order.updated_at = new Date();

    await this.saveConditionalOrder(order);
    this.orders.delete(orderId);

    logger.info({ orderId }, 'Cancelled conditional order');
    this.emit('orderCancelled', order);
    return true;
  }

  async getConditionalOrders(filters: {
    status?: string;
    strategy_id?: string;
    symbol?: string;
  } = {}): Promise<ConditionalOrder[]> {
    const orders = Array.from(this.orders.values());
    
    return orders.filter(order => {
      if (filters.status && order.status !== filters.status) return false;
      if (filters.strategy_id && order.strategy_id !== filters.strategy_id) return false;
      if (filters.symbol && order.trigger_condition.symbol !== filters.symbol) return false;
      return true;
    });
  }

  private setupEventListeners(): void {
    // Listen for market data updates to trigger evaluations
    marketEventProcessor.on('priceUpdate', (priceUpdate) => {
      this.updateMarketDataCache(priceUpdate);
      // Trigger immediate evaluation for price-based conditions
      this.evaluatePriceConditions(priceUpdate.pair).catch(error => {
        logger.error({ error }, 'Error evaluating price conditions');
      });
    });

    // Listen for new candlestick data
    marketEventProcessor.on('candlestickUpdate', (candlestick) => {
      this.updateCandleDataCache(candlestick);
    });
  }

  private async loadConditionalOrders(): Promise<void> {
    try {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
      const rows = await database.connection!('conditional_orders')
        .where('status', 'active')
        .orWhere('status', 'triggered');

      for (const row of rows) {
        const order: ConditionalOrder = {
          id: row.id,
          strategy_id: row.strategy_id,
          trigger_condition: JSON.parse(row.trigger_condition),
          order_request: JSON.parse(row.order_request),
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
          triggered_at: row.triggered_at,
          triggered_order_id: row.triggered_order_id,
          expire_time: row.expire_time
        };

        this.orders.set(order.id, order);
      }

      logger.info({ count: rows.length }, 'Loaded conditional orders from database');
    } catch (error) {
      logger.error({ error }, 'Failed to load conditional orders');
    }
  }

  private async saveConditionalOrder(order: ConditionalOrder): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('conditional_orders')
      .insert({
        id: order.id,
        strategy_id: order.strategy_id,
        trigger_condition: JSON.stringify(order.trigger_condition),
        order_request: JSON.stringify(order.order_request),
        status: order.status,
        triggered_at: order.triggered_at,
        triggered_order_id: order.triggered_order_id,
        expire_time: order.expire_time,
        created_at: order.created_at,
        updated_at: order.updated_at
      })
      .onConflict('id')
      .merge([
        'status', 
        'triggered_at', 
        'triggered_order_id', 
        'updated_at'
      ]);
  }

  private validateTriggerCondition(condition: TriggerCondition): void {
    if (!condition.type) {
      throw new Error('Trigger condition type is required');
    }

    if (!condition.symbol) {
      throw new Error('Trigger condition symbol is required');
    }

    switch (condition.type) {
      case 'price_above':
      case 'price_below':
      case 'price_cross_up':
      case 'price_cross_down':
        if (!condition.value || typeof condition.value !== 'string') {
          throw new Error('Price trigger conditions require a valid price value');
        }
        break;
        
      case 'rsi_above':
      case 'rsi_below':
        if (!condition.value || typeof condition.value !== 'number') {
          throw new Error('RSI trigger conditions require a numeric value');
        }
        if (!condition.timeframe) {
          throw new Error('RSI trigger conditions require a timeframe');
        }
        break;
        
      case 'volume_above':
        if (!condition.value || typeof condition.value !== 'string') {
          throw new Error('Volume trigger conditions require a volume value');
        }
        break;
        
      case 'time_based':
        if (!condition.value) {
          throw new Error('Time-based trigger conditions require a timestamp');
        }
        break;
        
      case 'custom':
        if (!condition.custom_logic) {
          throw new Error('Custom trigger conditions require custom_logic');
        }
        break;
        
      default:
        throw new Error(`Unsupported trigger condition type: ${condition.type}`);
    }
  }

  private async evaluateAllConditions(): Promise<void> {
    const activeOrders = Array.from(this.orders.values())
      .filter(order => order.status === 'active');

    // Check for expired orders first
    const now = new Date();
    for (const order of activeOrders) {
      if (order.expire_time && now > order.expire_time) {
        await this.expireOrder(order);
      }
    }

    // Evaluate trigger conditions
    for (const order of activeOrders) {
      if (order.status === 'active') {
        try {
          const triggered = await this.evaluateTriggerCondition(order.trigger_condition);
          if (triggered) {
            await this.triggerOrder(order);
          }
        } catch (error) {
          logger.error({ error, orderId: order.id }, 'Error evaluating trigger condition');
        }
      }
    }
  }

  private async evaluatePriceConditions(symbol: string): Promise<void> {
    const priceOrders = Array.from(this.orders.values())
      .filter(order => 
        order.status === 'active' && 
        order.trigger_condition.symbol === symbol &&
        ['price_above', 'price_below', 'price_cross_up', 'price_cross_down'].includes(order.trigger_condition.type)
      );

    for (const order of priceOrders) {
      try {
        const triggered = await this.evaluateTriggerCondition(order.trigger_condition);
        if (triggered) {
          await this.triggerOrder(order);
        }
      } catch (error) {
        logger.error({ error, orderId: order.id }, 'Error evaluating price condition');
      }
    }
  }

  private async evaluateTriggerCondition(condition: TriggerCondition): Promise<boolean> {
    const marketData = this.marketDataCache.get(condition.symbol);
    
    switch (condition.type) {
      case 'price_above':
        return marketData ? parseFloat(marketData.price) > parseFloat(condition.value as string) : false;
        
      case 'price_below':
        return marketData ? parseFloat(marketData.price) < parseFloat(condition.value as string) : false;
        
      case 'price_cross_up':
        return this.evaluatePriceCross(condition, 'up');
        
      case 'price_cross_down':
        return this.evaluatePriceCross(condition, 'down');
        
      case 'rsi_above':
        return this.evaluateRSI(condition, 'above');
        
      case 'rsi_below':
        return this.evaluateRSI(condition, 'below');
        
      case 'volume_above':
        return marketData ? parseFloat(marketData.volume_24h) > parseFloat(condition.value as string) : false;
        
      case 'time_based':
        return new Date() >= new Date(condition.value as string);
        
      case 'custom':
        return this.evaluateCustomLogic(condition);
        
      default:
        logger.warn({ type: condition.type }, 'Unsupported trigger condition type');
        return false;
    }
  }

  private evaluatePriceCross(condition: TriggerCondition, direction: 'up' | 'down'): boolean {
    // This would need historical price data to determine if price crossed the threshold
    // For now, implement simple logic based on current vs target price
    const marketData = this.marketDataCache.get(condition.symbol);
    if (!marketData) return false;

    const currentPrice = parseFloat(marketData.price);
    const targetPrice = parseFloat(condition.value as string);

    // This is simplified - in reality you'd need to track price history
    if (direction === 'up') {
      return currentPrice > targetPrice;
    } else {
      return currentPrice < targetPrice;
    }
  }

  private evaluateRSI(condition: TriggerCondition, comparison: 'above' | 'below'): boolean {
    // Calculate RSI from recent candlestick data
    const candles = this.candleDataCache.get(`${condition.symbol}_${condition.timeframe}`);
    if (!candles || candles.length < 14) {
      return false; // Need at least 14 periods for RSI
    }

    const rsi = this.calculateRSI(candles);
    const threshold = condition.value as number;

    return comparison === 'above' ? rsi > threshold : rsi < threshold;
  }

  private calculateRSI(candles: Candlestick[], period: number = 14): number {
    if (candles.length < period + 1) return 50; // Default RSI

    let gains = 0;
    let losses = 0;

    // Calculate initial average gain and loss
    for (let i = 1; i <= period; i++) {
      const change = parseFloat(candles[i].close) - parseFloat(candles[i - 1].close);
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    // Calculate RSI using Wilder's smoothing
    for (let i = period + 1; i < candles.length; i++) {
      const change = parseFloat(candles[i].close) - parseFloat(candles[i - 1].close);
      
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private evaluateCustomLogic(condition: TriggerCondition): boolean {
    try {
      // This would evaluate custom JavaScript logic
      // For security, this should be sandboxed or use a safe evaluation method
      const customFunction = new Function('marketData', 'indicators', condition.custom_logic!);
      const marketData = this.marketDataCache.get(condition.symbol);
      const indicators = this.indicatorCache.get(condition.symbol) || {};
      
      return Boolean(customFunction(marketData, indicators));
    } catch (error) {
      logger.error({ error, condition }, 'Error evaluating custom logic');
      return false;
    }
  }

  private async triggerOrder(conditionalOrder: ConditionalOrder): Promise<void> {
    try {
      logger.info({ orderId: conditionalOrder.id }, 'Triggering conditional order');

      // Update order status
      conditionalOrder.status = 'triggered';
      conditionalOrder.triggered_at = new Date();
      conditionalOrder.updated_at = new Date();

      // Create the actual order
      const order = await this.createTriggeredOrder(conditionalOrder.order_request);
      conditionalOrder.triggered_order_id = order.id;

      // Save updated conditional order
      await this.saveConditionalOrder(conditionalOrder);

      // Remove from active orders (but keep in database for history)
      this.orders.delete(conditionalOrder.id);

      this.emit('orderTriggered', { conditionalOrder, triggeredOrder: order });
      
      logger.info({ 
        conditionalOrderId: conditionalOrder.id,
        triggeredOrderId: order.id 
      }, 'Conditional order triggered successfully');

    } catch (error) {
      logger.error({ error, orderId: conditionalOrder.id }, 'Failed to trigger conditional order');
      // Don't remove from active orders if triggering fails
    }
  }

  private async expireOrder(order: ConditionalOrder): Promise<void> {
    order.status = 'expired';
    order.updated_at = new Date();

    await this.saveConditionalOrder(order);
    this.orders.delete(order.id);

    logger.info({ orderId: order.id }, 'Conditional order expired');
    this.emit('orderExpired', order);
  }

  private async createTriggeredOrder(orderRequest: OrderRequest): Promise<Order> {
    // This would integrate with the actual trading engine
    // For now, create a mock order in the database
    
    const order: Order = {
      ...orderRequest,
      status: 'submitted',
      filled_amount: '0',
      created_at: new Date(),
      updated_at: new Date()
    };

    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('orders').insert(order);
    
    logger.info({ orderId: order.id }, 'Created triggered order');
    return order;
  }

  private updateMarketDataCache(priceUpdate: any): void {
    const marketData: MarketData = {
      symbol: priceUpdate.pair,
      price: priceUpdate.price,
      volume_24h: priceUpdate.volume_24h || '0',
      timestamp: new Date()
    };
    
    this.marketDataCache.set(priceUpdate.pair, marketData);
  }

  private updateCandleDataCache(candlestick: Candlestick): void {
    const key = `${candlestick.symbol}_${candlestick.interval}`;
    const candles = this.candleDataCache.get(key) || [];
    
    // Add new candlestick and keep only recent ones (e.g., last 100)
    candles.push(candlestick);
    if (candles.length > 100) {
      candles.shift();
    }
    
    this.candleDataCache.set(key, candles);
  }

  // Public API methods
  getStatus(): {
    running: boolean;
    activeOrders: number;
    totalOrders: number;
  } {
    return {
      running: this.running,
      activeOrders: Array.from(this.orders.values()).filter(o => o.status === 'active').length,
      totalOrders: this.orders.size
    };
  }
}

export const conditionalOrderManager = ConditionalOrderManager.getInstance();