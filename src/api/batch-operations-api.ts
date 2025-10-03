import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { WalletManager } from '../wallet';

interface BatchOperation {
  id: string;
  type: 'buy' | 'sell' | 'transfer';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  progress: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  error?: string;
  createdAt: string;
  executedAt?: string;
}

interface BatchConfig {
  maxConcurrency: number;
  delayBetweenOps: number;
  slippage: number;
  riskCheck: boolean;
}

export class BatchOperationsAPI {
  private router: Router;
  private walletManager: WalletManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private batches: Map<string, any>;
  private operationQueue: Map<string, BatchOperation[]>;

  constructor() {
    this.router = Router();
    this.walletManager = WalletManager.getInstance();
    this.batches = new Map();
    this.operationQueue = new Map();
    this.setupRoutes();
  }

  getRouter(): Router {
    return this.router;
  }

  private setupRoutes(): void {
    // 创建批量操作
    this.router.post('/operations', async (req: Request, res: Response) => {
      try {
        const { operations, config } = req.body;

        if (!operations || !Array.isArray(operations) || operations.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Operations array is required and must not be empty'
          });
        }

        // 限制最大操作数量
        if (operations.length > 100) {
          return res.status(400).json({
            success: false,
            message: 'Too many operations. Maximum 100 operations per batch'
          });
        }

        // 验证每个操作
        const addressPattern = /^0x[a-fA-F0-9]{40}$/;
        for (let i = 0; i < operations.length; i++) {
          const op = operations[i];

          if (!op.walletAddress || !addressPattern.test(op.walletAddress)) {
            return res.status(400).json({
              success: false,
              message: `Invalid walletAddress in operation ${i + 1}`
            });
          }

          if (!op.tokenIn || !op.tokenOut) {
            return res.status(400).json({
              success: false,
              message: `Missing tokenIn or tokenOut in operation ${i + 1}`
            });
          }

          if (!op.amountIn || parseFloat(op.amountIn) <= 0) {
            return res.status(400).json({
              success: false,
              message: `Invalid amountIn in operation ${i + 1}`
            });
          }
        }

        // 验证配置
        const maxConcurrency = config?.maxConcurrency || 3;
        const delayBetweenOps = config?.delayBetweenOps || 1000;
        const slippage = config?.slippage || 0.5;

        if (maxConcurrency < 1 || maxConcurrency > 10) {
          return res.status(400).json({
            success: false,
            message: 'maxConcurrency must be between 1 and 10'
          });
        }

        if (delayBetweenOps < 0 || delayBetweenOps > 60000) {
          return res.status(400).json({
            success: false,
            message: 'delayBetweenOps must be between 0 and 60000 milliseconds'
          });
        }

        if (slippage < 0 || slippage > 50) {
          return res.status(400).json({
            success: false,
            message: 'slippage must be between 0 and 50 percent'
          });
        }

        const batchConfig: BatchConfig = {
          maxConcurrency,
          delayBetweenOps,
          slippage,
          riskCheck: config?.riskCheck !== false
        };

        // 生成批次ID
        const batchId = this.generateBatchId();

        // 创建操作列表
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const batchOperations: BatchOperation[] = operations.map((op: any, index: number) => ({
          id: `${batchId}_op_${index}`,
          type: op.type || 'buy',
          status: 'pending',
          walletAddress: op.walletAddress,
          tokenIn: op.tokenIn,
          tokenOut: op.tokenOut,
          amountIn: op.amountIn,
          progress: 0,
          createdAt: new Date().toISOString()
        }));

        // 保存批次
        const batch = {
          id: batchId,
          operations: batchOperations,
          config: batchConfig,
          status: 'created',
          createdAt: new Date().toISOString(),
          totalOperations: batchOperations.length,
          completedOperations: 0,
          failedOperations: 0
        };

        this.batches.set(batchId, batch);
        this.operationQueue.set(batchId, batchOperations);

        logger.info({
          batchId,
          operationCount: batchOperations.length,
          config: batchConfig
        }, 'Batch operations created');

        res.json({
          success: true,
          data: {
            batchId,
            operationCount: batchOperations.length,
            status: 'created'
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to create batch operations');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to create batch operations'
        });
      }
    });

    // 查询批量操作状态
    this.router.get('/operations/:batchId', async (req: Request, res: Response) => {
      try {
        const { batchId } = req.params;

        const batch = this.batches.get(batchId);
        if (!batch) {
          return res.status(404).json({
            success: false,
            message: 'Batch not found'
          });
        }

        res.json({
          success: true,
          data: batch
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get batch status');
        res.status(500).json({
          success: false,
          message: 'Failed to get batch status'
        });
      }
    });

    // 执行批量操作
    this.router.post('/execute', async (req: Request, res: Response) => {
      try {
        const { batchId } = req.body;

        if (!batchId) {
          return res.status(400).json({
            success: false,
            message: 'batchId is required'
          });
        }

        const batch = this.batches.get(batchId);
        if (!batch) {
          return res.status(404).json({
            success: false,
            message: 'Batch not found'
          });
        }

        if (batch.status === 'processing') {
          return res.status(400).json({
            success: false,
            message: 'Batch is already processing'
          });
        }

        // 更新状态
        batch.status = 'processing';
        batch.startedAt = new Date().toISOString();
        this.batches.set(batchId, batch);

        // 异步执行批量操作
        this.executeBatch(batchId).catch(error => {
          logger.error({ error, batchId }, 'Batch execution failed');
        });

        res.json({
          success: true,
          message: 'Batch execution started',
          data: {
            batchId,
            status: 'processing',
            totalOperations: batch.totalOperations
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to start batch execution');
        res.status(500).json({
          success: false,
          message: 'Failed to start batch execution'
        });
      }
    });

    // 获取所有批次列表
    this.router.get('/list', async (req: Request, res: Response) => {
      try {
        const { status, limit = 50 } = req.query;

        let batches = Array.from(this.batches.values());

        // 按状态过滤
        if (status) {
          batches = batches.filter(b => b.status === status);
        }

        // 按时间排序(最新的在前)
        batches.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        // 限制数量
        batches = batches.slice(0, parseInt(limit as string));

        res.json({
          success: true,
          data: {
            batches,
            total: this.batches.size
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to list batches');
        res.status(500).json({
          success: false,
          message: 'Failed to list batches'
        });
      }
    });

    // 取消批量操作
    this.router.post('/cancel/:batchId', async (req: Request, res: Response) => {
      try {
        const { batchId } = req.params;

        const batch = this.batches.get(batchId);
        if (!batch) {
          return res.status(404).json({
            success: false,
            message: 'Batch not found'
          });
        }

        if (batch.status === 'completed' || batch.status === 'failed') {
          return res.status(400).json({
            success: false,
            message: 'Cannot cancel completed or failed batch'
          });
        }

        batch.status = 'cancelled';
        batch.cancelledAt = new Date().toISOString();
        this.batches.set(batchId, batch);

        logger.info({ batchId }, 'Batch cancelled');

        res.json({
          success: true,
          message: 'Batch cancelled',
          data: { batchId, status: 'cancelled' }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to cancel batch');
        res.status(500).json({
          success: false,
          message: 'Failed to cancel batch'
        });
      }
    });
  }

  private async executeBatch(batchId: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new Error('Batch not found');
    }

    const operations = this.operationQueue.get(batchId);
    if (!operations) {
      throw new Error('Operations not found');
    }

    const config: BatchConfig = batch.config;

    try {
      let completed = 0;
      let failed = 0;

      // 按并发限制执行操作
      for (let i = 0; i < operations.length; i += config.maxConcurrency) {
        const chunk = operations.slice(i, i + config.maxConcurrency);

        // 并发执行当前块
        const results = await Promise.allSettled(
          chunk.map(op => this.executeOperation(op))
        );

        // 更新结果
        results.forEach((result, index) => {
          const operation = chunk[index];
          if (result.status === 'fulfilled') {
            operation.status = 'completed';
            operation.result = result.value;
            operation.progress = 100;
            operation.executedAt = new Date().toISOString();
            completed++;
          } else {
            operation.status = 'failed';
            operation.error = result.reason?.message || 'Unknown error';
            operation.progress = 0;
            operation.executedAt = new Date().toISOString();
            failed++;
          }
        });

        // 更新批次进度
        batch.completedOperations = completed;
        batch.failedOperations = failed;
        batch.progress = Math.round((completed + failed) / operations.length * 100);
        this.batches.set(batchId, batch);

        // 延迟(如果不是最后一块)
        if (i + config.maxConcurrency < operations.length) {
          await this.delay(config.delayBetweenOps);
        }
      }

      // 更新最终状态
      batch.status = failed === 0 ? 'completed' : 'partially_completed';
      batch.completedAt = new Date().toISOString();
      this.batches.set(batchId, batch);

      logger.info({
        batchId,
        completed,
        failed,
        total: operations.length
      }, 'Batch execution completed');
    } catch (error) {
      logger.error({ error, batchId }, 'Batch execution failed');
      batch.status = 'failed';
      batch.error = error instanceof Error ? error.message : 'Unknown error';
      batch.completedAt = new Date().toISOString();
      this.batches.set(batchId, batch);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async executeOperation(operation: BatchOperation): Promise<any> {
    // 模拟操作执行
    // TODO: 集成真实的交易逻辑
    logger.info({
      operationId: operation.id,
      type: operation.type,
      walletAddress: operation.walletAddress
    }, 'Executing operation');

    // 模拟延迟
    await this.delay(1000 + Math.random() * 2000);

    // 模拟成功/失败
    if (Math.random() > 0.1) { // 90%成功率
      return {
        txHash: `0x${Math.random().toString(16).substr(2, 64)}`,
        status: 'success',
        amountOut: (parseFloat(operation.amountIn) * 0.98).toFixed(6)
      };
    } else {
      throw new Error('Simulated execution failure');
    }
  }

  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
