import { database } from '../database';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface OrderRecord {
  id?: number;
  order_id: string;
  order_type: 'market_buy' | 'market_sell' | 'limit_buy' | 'limit_sell';
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'expired';
  
  wallet_address: string;
  token_in_address: string;
  token_out_address: string;
  token_in_symbol: string;
  token_out_symbol: string;
  amount_in: string;
  amount_out_expected?: string;
  amount_out_min?: string;
  amount_out_actual?: string;
  
  slippage: number;
  price_impact?: number;
  execution_price?: string;
  trading_path?: string[]; // JSON array
  
  tx_hash?: string;
  gas_used?: string;
  gas_price?: string;
  total_fee_bnb?: string;
  
  created_at?: Date;
  updated_at?: Date;
  executed_at?: Date;
  expires_at?: Date;
  
  metadata?: any; // JSON object
  failure_reason?: string;
  retry_count?: number;
  parent_order_id?: string;
}

export interface OrderEvent {
  id?: number;
  order_id: string;
  event_type: 'created' | 'validated' | 'quote_obtained' | 'approval_started' | 'approval_completed' |
             'execution_started' | 'tx_submitted' | 'tx_confirmed' | 'completed' |
             'failed' | 'cancelled' | 'expired' | 'replaced';
  event_message?: string;
  event_data?: any;
  created_at?: Date;
}

export class OrderModel {
  private static tableName = 'orders';
  private static eventsTableName = 'order_events';

  static async create(order: Omit<OrderRecord, 'id' | 'order_id' | 'created_at' | 'updated_at'>): Promise<OrderRecord> {
    const orderId = uuidv4();
    
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const [record] = await database.connection!(this.tableName)
        .insert({
          order_id: orderId,
          ...order,
          trading_path: order.trading_path ? JSON.stringify(order.trading_path) : null,
          metadata: order.metadata ? JSON.stringify(order.metadata) : null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      // Log creation event
      await this.addEvent(orderId, 'created', 'Order created', {
        order_type: order.order_type,
        token_pair: `${order.token_in_symbol}/${order.token_out_symbol}`,
        amount_in: order.amount_in,
      });

      logger.info({ orderId, orderType: order.order_type }, 'Order created');
      return this.parseRecord(record);
    } catch (error) {
      logger.error({ error, orderId }, 'Failed to create order');
      throw error;
    }
  }

  static async findById(orderId: string): Promise<OrderRecord | undefined> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const record = await database.connection!(this.tableName)
        .where('order_id', orderId)
        .first();

      return record ? this.parseRecord(record) : undefined;
    } catch (error) {
      logger.error({ error, orderId }, 'Failed to find order');
      throw error;
    }
  }

  static async updateStatus(
    orderId: string,
    status: OrderRecord['status'],
    updates: Partial<OrderRecord> = {}
  ): Promise<void> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      await database.connection!(this.tableName)
        .where('order_id', orderId)
        .update({
          status,
          ...updates,
          metadata: updates.metadata ? JSON.stringify(updates.metadata) : undefined,
          trading_path: updates.trading_path ? JSON.stringify(updates.trading_path) : undefined,
          updated_at: new Date(),
        });

      // Log status change event
      await this.addEvent(orderId, status === 'completed' ? 'completed' : 
                                   status === 'failed' ? 'failed' :
                                   status === 'cancelled' ? 'cancelled' :
                                   status === 'expired' ? 'expired' : 'execution_started',
                         `Order status changed to ${status}`,
                         updates);

      logger.info({ orderId, status }, 'Order status updated');
    } catch (error) {
      logger.error({ error, orderId, status }, 'Failed to update order status');
      throw error;
    }
  }

  static async addEvent(
    orderId: string,
    eventType: OrderEvent['event_type'],
    message?: string,
    data?: any
  ): Promise<void> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      await database.connection!(this.eventsTableName)
        .insert({
          order_id: orderId,
          event_type: eventType,
          event_message: message,
          event_data: data ? JSON.stringify(data) : null,
          created_at: new Date(),
        });

      logger.debug({ orderId, eventType, message }, 'Order event logged');
    } catch (error) {
      logger.error({ error, orderId, eventType }, 'Failed to log order event');
      // Don't throw - event logging should not fail the main operation
    }
  }

  static async getOrderHistory(
    walletAddress?: string,
    limit = 100,
    status?: OrderRecord['status']
  ): Promise<OrderRecord[]> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      let query = database.connection!(this.tableName)
        .orderBy('created_at', 'desc')
        .limit(limit);

      if (walletAddress) {
        query = query.where('wallet_address', walletAddress);
      }

      if (status) {
        query = query.where('status', status);
      }

      const records = await query;
      return records.map(record => this.parseRecord(record));
    } catch (error) {
      logger.error({ error, walletAddress, status }, 'Failed to get order history');
      throw error;
    }
  }

  static async getOrderEvents(orderId: string): Promise<OrderEvent[]> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const events = await database.connection!(this.eventsTableName)
        .where('order_id', orderId)
        .orderBy('created_at', 'asc');

      return events.map(event => ({
        ...event,
        event_data: event.event_data ? JSON.parse(event.event_data) : undefined,
      }));
    } catch (error) {
      logger.error({ error, orderId }, 'Failed to get order events');
      throw error;
    }
  }

  static async getPendingOrders(): Promise<OrderRecord[]> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const records = await database.connection!(this.tableName)
        .whereIn('status', ['pending', 'executing'])
        .orderBy('created_at', 'asc');

      return records.map(record => this.parseRecord(record));
    } catch (error) {
      logger.error({ error }, 'Failed to get pending orders');
      throw error;
    }
  }

  static async getOrderMetrics(timeframe: 'day' | 'week' | 'month' = 'day'): Promise<{
    total_orders: number;
    completed_orders: number;
    failed_orders: number;
    average_execution_time_ms: number;
    total_volume_bnb: string;
    success_rate: number;
  }> {
    try {
      let timeCondition;
      const now = new Date();
      
      switch (timeframe) {
        case 'day':
          timeCondition = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'week':
          timeCondition = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          timeCondition = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }

      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const [metrics] = await database.connection!(this.tableName)
        .where('created_at', '>=', timeCondition)
        .select(
          database.connection!.raw('COUNT(*) as total_orders'),
          database.connection!.raw('COUNT(CASE WHEN status = ? THEN 1 END) as completed_orders', ['completed']),
          database.connection!.raw('COUNT(CASE WHEN status = ? THEN 1 END) as failed_orders', ['failed']),
          database.connection!.raw('AVG(CASE WHEN executed_at IS NOT NULL THEN (JULIANDAY(executed_at) - JULIANDAY(created_at)) * 86400000 END) as avg_execution_time_ms'),
          database.connection!.raw('COALESCE(SUM(CASE WHEN status = ? AND token_in_address = ? THEN CAST(amount_in AS REAL) ELSE 0 END), 0) as total_volume_bnb', ['completed', 'BNB'])
        );

      const totalOrders = parseInt(metrics.total_orders) || 0;
      const completedOrders = parseInt(metrics.completed_orders) || 0;
      
      return {
        total_orders: totalOrders,
        completed_orders: completedOrders,
        failed_orders: parseInt(metrics.failed_orders) || 0,
        average_execution_time_ms: parseFloat(metrics.avg_execution_time_ms) || 0,
        total_volume_bnb: metrics.total_volume_bnb.toString(),
        success_rate: totalOrders > 0 ? completedOrders / totalOrders : 0,
      };
    } catch (error) {
      logger.error({ error, timeframe }, 'Failed to get order metrics');
      throw error;
    }
  }

  static async expireOldOrders(): Promise<number> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const expiredCount = await database.connection!(this.tableName)
        .where('status', 'pending')
        .where('expires_at', '<', new Date())
        .update({
          status: 'expired',
          updated_at: new Date(),
        });

      if (expiredCount > 0) {
        logger.info({ expiredCount }, 'Expired old orders');
      }

      return expiredCount;
    } catch (error) {
      logger.error({ error }, 'Failed to expire old orders');
      throw error;
    }
  }

  private static parseRecord(record: any): OrderRecord {
    return {
      ...record,
      trading_path: record.trading_path ? JSON.parse(record.trading_path) : undefined,
      metadata: record.metadata ? JSON.parse(record.metadata) : undefined,
    };
  }
}

// Install UUID package if not already installed
export default OrderModel;