import { database } from '../database';
import { logger } from '../../utils/logger';

export interface TransactionRecord {
  id?: number;
  tx_hash: string;
  from_address: string;
  to_address: string;
  amount: string;
  token_address?: string;
  token_symbol?: string;
  token_decimals?: number;
  gas_used?: string;
  gas_price: string;
  transaction_fee?: string;
  status: 'pending' | 'confirmed' | 'failed';
  operation_type: 'transfer' | 'trade_buy' | 'trade_sell' | 'approve';
  block_number?: string;
  block_timestamp?: number;
  error_message?: string;
  created_at?: Date;
  updated_at?: Date;
}

export class TransactionModel {
  private static tableName = 'transactions';

  static async create(transaction: Omit<TransactionRecord, 'id' | 'created_at' | 'updated_at'>): Promise<TransactionRecord> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const [record] = await database.connection!(this.tableName)
        .insert({
          ...transaction,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      logger.info({ txHash: transaction.tx_hash }, 'Transaction record created');
      return record;
    } catch (error) {
      logger.error({ error, txHash: transaction.tx_hash }, 'Failed to create transaction record');
      throw error;
    }
  }

  static async findByHash(txHash: string): Promise<TransactionRecord | undefined> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const record = await database.connection!(this.tableName)
        .where('tx_hash', txHash)
        .first();

      return record;
    } catch (error) {
      logger.error({ error, txHash }, 'Failed to find transaction by hash');
      throw error;
    }
  }

  static async updateStatus(
    txHash: string, 
    status: TransactionRecord['status'],
    updates: Partial<Pick<TransactionRecord, 'gas_used' | 'transaction_fee' | 'block_number' | 'block_timestamp' | 'error_message'>>
  ): Promise<void> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      await database.connection!(this.tableName)
        .where('tx_hash', txHash)
        .update({
          status,
          ...updates,
          updated_at: new Date(),
        });

      logger.info({ txHash, status }, 'Transaction status updated');
    } catch (error) {
      logger.error({ error, txHash, status }, 'Failed to update transaction status');
      throw error;
    }
  }

  static async findByAddress(address: string, limit = 100): Promise<TransactionRecord[]> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const records = await database.connection!(this.tableName)
        .where('from_address', address)
        .orWhere('to_address', address)
        .orderBy('created_at', 'desc')
        .limit(limit);

      return records;
    } catch (error) {
      logger.error({ error, address }, 'Failed to find transactions by address');
      throw error;
    }
  }

  static async getMetrics(timeframe: 'day' | 'week' | 'month' = 'day'): Promise<{
    total_count: number;
    successful_count: number;
    failed_count: number;
    total_volume_bnb: string;
    total_fees_bnb: string;
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
          database.connection!.raw('COUNT(*) as total_count'),
          database.connection!.raw('COUNT(CASE WHEN status = ? THEN 1 END) as successful_count', ['confirmed']),
          database.connection!.raw('COUNT(CASE WHEN status = ? THEN 1 END) as failed_count', ['failed']),
          database.connection!.raw('COALESCE(SUM(CASE WHEN token_address IS NULL AND status = ? THEN CAST(amount AS REAL) ELSE 0 END), 0) as total_volume_bnb', ['confirmed']),
          database.connection!.raw('COALESCE(SUM(CASE WHEN status = ? THEN CAST(transaction_fee AS REAL) ELSE 0 END), 0) as total_fees_bnb', ['confirmed'])
        );

      return {
        total_count: parseInt(metrics.total_count),
        successful_count: parseInt(metrics.successful_count),
        failed_count: parseInt(metrics.failed_count),
        total_volume_bnb: metrics.total_volume_bnb.toString(),
        total_fees_bnb: metrics.total_fees_bnb.toString(),
      };
    } catch (error) {
      logger.error({ error, timeframe }, 'Failed to get transaction metrics');
      throw error;
    }
  }

  static async findPending(): Promise<TransactionRecord[]> {
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      const records = await database.connection!(this.tableName)
        .where('status', 'pending')
        .orderBy('created_at', 'asc');

      return records;
    } catch (error) {
      logger.error({ error }, 'Failed to find pending transactions');
      throw error;
    }
  }
}