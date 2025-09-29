import { logger } from '../utils/logger';
import { database } from '../persistence/database';

export interface BatchOperation {
  id: string;
  type: 'transfer' | 'approve' | 'trade' | 'limit_order';
  walletAddress: string;
  params: Record<string, any>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  error?: string;
  retries: number;
  maxRetries: number;
}

export interface BatchExecutionResult {
  batchId: string;
  totalOperations: number;
  completedOperations: number;
  failedOperations: number;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'partial';
  startTime: Date;
  endTime?: Date;
  operations: BatchOperation[];
}

export class BatchExecutor {
  private static instance: BatchExecutor;
  private batches: Map<string, BatchExecutionResult> = new Map();
  private operationQueue: BatchOperation[] = [];
  private isProcessing = false;
  private readonly MAX_CONCURRENT_OPERATIONS = 3;
  private readonly DEFAULT_MAX_RETRIES = 2;

  private constructor() {}

  public static getInstance(): BatchExecutor {
    if (!BatchExecutor.instance) {
      BatchExecutor.instance = new BatchExecutor();
    }
    return BatchExecutor.instance;
  }

  async createBatchOperations(operations: any[]): Promise<string> {
    try {
      await database.ensureConnection();
      
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const batchOperations: BatchOperation[] = operations.map((op, index) => ({
        id: `${batchId}_op_${index}`,
        type: op.type,
        walletAddress: op.walletAddress,
        params: op.params || {},
        status: 'pending',
        createdAt: new Date(),
        retries: 0,
        maxRetries: op.maxRetries || this.DEFAULT_MAX_RETRIES
      }));

      const batch: BatchExecutionResult = {
        batchId,
        totalOperations: batchOperations.length,
        completedOperations: 0,
        failedOperations: 0,
        status: 'pending',
        startTime: new Date(),
        operations: batchOperations
      };

      this.batches.set(batchId, batch);

      // Store batch in database for persistence
      if (database.connection) {
        await database.connection('batch_operations').insert({
          batch_id: batchId,
          total_operations: batch.totalOperations,
          status: batch.status,
          created_at: batch.startTime,
          operations_data: JSON.stringify(batchOperations)
        });
      }

      logger.info({ batchId, operationCount: batchOperations.length }, 'Batch operations created');
      
      return batchId;
    } catch (error) {
      logger.error({ error, operationCount: operations.length }, 'Failed to create batch operations');
      throw error;
    }
  }

  async executeBatch(batchId: string): Promise<BatchExecutionResult> {
    try {
      const batch = this.batches.get(batchId);
      if (!batch) {
        throw new Error(`Batch ${batchId} not found`);
      }

      if (batch.status !== 'pending') {
        throw new Error(`Batch ${batchId} is not in pending state`);
      }

      batch.status = 'executing';
      await this.updateBatchInDatabase(batch);

      // Add operations to queue
      this.operationQueue.push(...batch.operations);
      
      // Start processing queue if not already processing
      if (!this.isProcessing) {
        this.processOperationQueue();
      }

      logger.info({ batchId }, 'Batch execution started');
      
      return batch;
    } catch (error) {
      logger.error({ error, batchId }, 'Failed to start batch execution');
      throw error;
    }
  }

  private async processOperationQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    
    try {
      while (this.operationQueue.length > 0) {
        // Process up to MAX_CONCURRENT_OPERATIONS at once
        const currentBatch = this.operationQueue.splice(0, this.MAX_CONCURRENT_OPERATIONS);
        
        // Execute operations concurrently
        await Promise.allSettled(
          currentBatch.map(operation => this.executeOperation(operation))
        );

        // Small delay between batches to avoid overwhelming the system
        if (this.operationQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeOperation(operation: BatchOperation): Promise<void> {
    try {
      operation.status = 'executing';
      logger.info({ operationId: operation.id, type: operation.type }, 'Executing operation');

      // Simulate different operation types
      switch (operation.type) {
        case 'transfer':
          await this.executeTransfer(operation);
          break;
        case 'approve':
          await this.executeApproval(operation);
          break;
        case 'trade':
          await this.executeTrade(operation);
          break;
        case 'limit_order':
          await this.executeLimitOrder(operation);
          break;
        default:
          throw new Error(`Unsupported operation type: ${operation.type}`);
      }

      operation.status = 'completed';
      operation.completedAt = new Date();
      
      await this.updateOperationStatus(operation);
      
      logger.info({ operationId: operation.id }, 'Operation completed successfully');
    } catch (error) {
      operation.retries++;
      
      if (operation.retries >= operation.maxRetries) {
        operation.status = 'failed';
        operation.error = error instanceof Error ? error.message : 'Unknown error';
        operation.completedAt = new Date();
        
        logger.error({ 
          operationId: operation.id, 
          error: operation.error,
          retries: operation.retries 
        }, 'Operation failed permanently');
      } else {
        operation.status = 'pending';
        // Add back to queue for retry
        this.operationQueue.push(operation);
        
        logger.warn({ 
          operationId: operation.id, 
          error: error instanceof Error ? error.message : 'Unknown error',
          retries: operation.retries,
          maxRetries: operation.maxRetries
        }, 'Operation failed, will retry');
      }
      
      await this.updateOperationStatus(operation);
    }
  }

  private async executeTransfer(operation: BatchOperation): Promise<void> {
    // Simulate transfer execution
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500));
    
    // Simulate occasional failures
    if (Math.random() < 0.1) {
      throw new Error('Transfer simulation failure');
    }
  }

  private async executeApproval(operation: BatchOperation): Promise<void> {
    // Simulate approval execution
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1500 + 300));
    
    // Simulate occasional failures
    if (Math.random() < 0.05) {
      throw new Error('Approval simulation failure');
    }
  }

  private async executeTrade(operation: BatchOperation): Promise<void> {
    // Simulate trade execution
    await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 1000));
    
    // Simulate occasional failures
    if (Math.random() < 0.15) {
      throw new Error('Trade simulation failure');
    }
  }

  private async executeLimitOrder(operation: BatchOperation): Promise<void> {
    // Simulate limit order creation
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 200));
    
    // Simulate occasional failures
    if (Math.random() < 0.08) {
      throw new Error('Limit order simulation failure');
    }
  }

  private async updateOperationStatus(operation: BatchOperation): Promise<void> {
    try {
      // Update the batch statistics
      const batchId = operation.id.split('_op_')[0];
      const batch = this.batches.get(batchId);
      
      if (batch) {
        const operationIndex = batch.operations.findIndex(op => op.id === operation.id);
        if (operationIndex >= 0) {
          batch.operations[operationIndex] = operation;
        }

        // Recalculate batch statistics
        batch.completedOperations = batch.operations.filter(op => op.status === 'completed').length;
        batch.failedOperations = batch.operations.filter(op => op.status === 'failed').length;
        
        const pendingOperations = batch.operations.filter(op => 
          op.status === 'pending' || op.status === 'executing'
        ).length;

        if (pendingOperations === 0) {
          if (batch.failedOperations === 0) {
            batch.status = 'completed';
          } else if (batch.completedOperations === 0) {
            batch.status = 'failed';
          } else {
            batch.status = 'partial';
          }
          batch.endTime = new Date();
        }

        await this.updateBatchInDatabase(batch);
      }
    } catch (error) {
      logger.error({ error, operationId: operation.id }, 'Failed to update operation status');
    }
  }

  private async updateBatchInDatabase(batch: BatchExecutionResult): Promise<void> {
    try {
      if (!database.connection) {
        return;
      }

      await database.connection('batch_operations')
        .where({ batch_id: batch.batchId })
        .update({
          status: batch.status,
          completed_operations: batch.completedOperations,
          failed_operations: batch.failedOperations,
          updated_at: new Date(),
          completed_at: batch.endTime || null,
          operations_data: JSON.stringify(batch.operations)
        });
    } catch (error) {
      logger.error({ error, batchId: batch.batchId }, 'Failed to update batch in database');
    }
  }

  getBatchStatus(batchId: string): BatchExecutionResult | null {
    return this.batches.get(batchId) || null;
  }

  getOperationStatus(operationId: string): BatchOperation | null {
    for (const batch of this.batches.values()) {
      const operation = batch.operations.find(op => op.id === operationId);
      if (operation) {
        return operation;
      }
    }
    return null;
  }

  getAllBatches(): BatchExecutionResult[] {
    return Array.from(this.batches.values());
  }
}

export const batchExecutor = BatchExecutor.getInstance();