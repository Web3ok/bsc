import pino from 'pino';

const logger = pino({ name: 'BatchExecutor' });

export interface BatchConfig {
  maxConcurrency: number;
  batchSize: number;
  delayBetweenBatches: number;
  retryAttempts: number;
  timeoutMs: number;
}

export interface BatchOperation {
  id: string;
  type: 'trade' | 'transfer' | 'approval';
  data: any;
  priority: 'low' | 'normal' | 'high';
  retryCount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  result?: any;
}

export interface BatchResult {
  totalOperations: number;
  successful: number;
  failed: number;
  operations: BatchOperation[];
  executionTime: number;
  errors: Array<{ operationId: string; error: string }>;
}

export type BatchOperationHandler = (operation: BatchOperation) => Promise<any>;

export class BatchExecutor {
  private config: BatchConfig;
  private operationQueue: BatchOperation[] = [];
  private processingQueue: Set<string> = new Set();
  private handlers: Map<string, BatchOperationHandler> = new Map();
  private isProcessing: boolean = false;

  constructor(config?: Partial<BatchConfig>) {
    this.config = {
      maxConcurrency: 5,
      batchSize: 10,
      delayBetweenBatches: 1000, // 1秒
      retryAttempts: 3,
      timeoutMs: 30000, // 30秒
      ...config
    };

    logger.info({ config: this.config }, 'BatchExecutor initialized');
  }

  registerHandler(operationType: string, handler: BatchOperationHandler): void {
    this.handlers.set(operationType, handler);
    logger.debug({ operationType }, 'Handler registered');
  }

  async addOperation(
    type: string,
    data: any,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<string> {
    const operation: BatchOperation = {
      id: this.generateOperationId(),
      type: type as any,
      data,
      priority,
      retryCount: 0,
      status: 'pending',
      createdAt: new Date()
    };

    this.operationQueue.push(operation);
    
    // 按优先级排序
    this.sortQueueByPriority();

    logger.debug({ operationId: operation.id, type, priority }, 'Operation added to queue');
    
    // 如果没有在处理，启动处理器
    if (!this.isProcessing) {
      this.startProcessing();
    }

    return operation.id;
  }

  async addBatchOperations(operations: Array<{
    type: string;
    data: any;
    priority?: 'low' | 'normal' | 'high';
  }>): Promise<string[]> {
    const operationIds: string[] = [];

    for (const op of operations) {
      const id = await this.addOperation(op.type, op.data, op.priority);
      operationIds.push(id);
    }

    logger.info({ count: operations.length }, 'Batch operations added');
    return operationIds;
  }

  async waitForCompletion(operationIds: string[], timeoutMs?: number): Promise<BatchResult> {
    const timeout = timeoutMs || this.config.timeoutMs * operationIds.length;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkCompletion = () => {
        const operations = this.getOperations(operationIds);
        const completed = operations.filter(op => 
          op.status === 'completed' || op.status === 'failed'
        );

        if (completed.length === operationIds.length) {
          const result = this.createBatchResult(operations, startTime);
          resolve(result);
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error(`Batch execution timeout after ${timeout}ms`));
          return;
        }

        setTimeout(checkCompletion, 100);
      };

      checkCompletion();
    });
  }

  getOperationStatus(operationId: string): BatchOperation | undefined {
    return this.operationQueue.find(op => op.id === operationId);
  }

  getQueueStatus(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  } {
    const total = this.operationQueue.length;
    const pending = this.operationQueue.filter(op => op.status === 'pending').length;
    const processing = this.operationQueue.filter(op => op.status === 'processing').length;
    const completed = this.operationQueue.filter(op => op.status === 'completed').length;
    const failed = this.operationQueue.filter(op => op.status === 'failed').length;

    return { total, pending, processing, completed, failed };
  }

  async cancelOperation(operationId: string): Promise<boolean> {
    const operation = this.operationQueue.find(op => op.id === operationId);
    
    if (!operation) {
      return false;
    }

    if (operation.status === 'processing') {
      logger.warn({ operationId }, 'Cannot cancel operation that is already processing');
      return false;
    }

    if (operation.status === 'pending') {
      operation.status = 'failed';
      operation.error = 'Cancelled by user';
      operation.completedAt = new Date();
      
      logger.info({ operationId }, 'Operation cancelled');
      return true;
    }

    return false;
  }

  clearCompleted(): number {
    const before = this.operationQueue.length;
    this.operationQueue = this.operationQueue.filter(op => 
      op.status !== 'completed' && op.status !== 'failed'
    );
    const cleared = before - this.operationQueue.length;
    
    logger.info({ cleared }, 'Cleared completed operations');
    return cleared;
  }

  // 私有方法
  private async startProcessing(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    logger.info('Starting batch processing');

    try {
      while (this.hasPendingOperations()) {
        await this.processBatch();
        
        if (this.hasPendingOperations()) {
          await this.delay(this.config.delayBetweenBatches);
        }
      }
    } catch (error) {
      logger.error({ error }, 'Batch processing error');
    } finally {
      this.isProcessing = false;
      logger.info('Batch processing completed');
    }
  }

  private async processBatch(): Promise<void> {
    const pendingOperations = this.operationQueue
      .filter(op => op.status === 'pending')
      .slice(0, this.config.batchSize);

    if (pendingOperations.length === 0) {
      return;
    }

    logger.debug({ count: pendingOperations.length }, 'Processing batch');

    // 限制并发数
    const concurrentBatches: Promise<void>[] = [];
    let concurrentCount = 0;

    for (const operation of pendingOperations) {
      if (concurrentCount >= this.config.maxConcurrency) {
        await Promise.race(concurrentBatches);
        // 移除已完成的promise
        const stillRunning = concurrentBatches.filter(p => 
          this.isPromisePending(p)
        );
        concurrentBatches.length = 0;
        concurrentBatches.push(...stillRunning);
        concurrentCount = concurrentBatches.length;
      }

      const operationPromise = this.processOperation(operation);
      concurrentBatches.push(operationPromise);
      concurrentCount++;
    }

    // 等待所有操作完成
    await Promise.allSettled(concurrentBatches);
  }

  private async processOperation(operation: BatchOperation): Promise<void> {
    operation.status = 'processing';
    operation.startedAt = new Date();
    this.processingQueue.add(operation.id);

    logger.debug({ operationId: operation.id, type: operation.type }, 'Processing operation');

    try {
      const handler = this.handlers.get(operation.type);
      
      if (!handler) {
        throw new Error(`No handler registered for operation type: ${operation.type}`);
      }

      const result = await Promise.race([
        handler(operation),
        this.createTimeoutPromise(this.config.timeoutMs)
      ]);

      operation.status = 'completed';
      operation.result = result;
      operation.completedAt = new Date();

      logger.debug({ operationId: operation.id }, 'Operation completed successfully');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      operation.retryCount++;
      
      if (operation.retryCount < this.config.retryAttempts) {
        operation.status = 'pending';
        logger.warn({ 
          operationId: operation.id, 
          retryCount: operation.retryCount,
          error: errorMessage 
        }, 'Operation failed, will retry');
      } else {
        operation.status = 'failed';
        operation.error = errorMessage;
        operation.completedAt = new Date();
        
        logger.error({ 
          operationId: operation.id, 
          error: errorMessage 
        }, 'Operation failed permanently');
      }
    } finally {
      this.processingQueue.delete(operation.id);
    }
  }

  private hasPendingOperations(): boolean {
    return this.operationQueue.some(op => op.status === 'pending');
  }

  private sortQueueByPriority(): void {
    const priorityValues = { high: 3, normal: 2, low: 1 };
    
    this.operationQueue.sort((a, b) => {
      // 优先级高的排前面
      const priorityDiff = priorityValues[b.priority] - priorityValues[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // 同优先级按创建时间排序
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getOperations(operationIds: string[]): BatchOperation[] {
    return operationIds
      .map(id => this.operationQueue.find(op => op.id === id))
      .filter(Boolean) as BatchOperation[];
  }

  private createBatchResult(operations: BatchOperation[], startTime: number): BatchResult {
    const successful = operations.filter(op => op.status === 'completed').length;
    const failed = operations.filter(op => op.status === 'failed').length;
    const errors = operations
      .filter(op => op.status === 'failed' && op.error)
      .map(op => ({ operationId: op.id, error: op.error! }));

    return {
      totalOperations: operations.length,
      successful,
      failed,
      operations,
      executionTime: Date.now() - startTime,
      errors
    };
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Operation timeout')), timeoutMs);
    });
  }

  private isPromisePending(promise: Promise<any>): boolean {
    // 简化的pending检查，实际实现可能需要更复杂的逻辑
    return true; // 在实际应用中，这需要通过其他方式跟踪promise状态
  }
}