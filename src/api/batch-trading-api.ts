import { Router, Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { MultiDEXAggregator, BatchTradeRequest } from '../dex/multi-dex-aggregator';
import { BatchWalletManager } from '../wallet/batch-wallet-manager';
import { WalletManager } from '../wallet';
import { logger } from '../utils/logger';
import { authenticate } from '../middleware/auth';

export interface BatchTradingController {
  router: Router;
}

export class BatchTradingAPI {
  public router: Router;
  private multiDexAggregator: MultiDEXAggregator;
  private batchWalletManager: BatchWalletManager;
  private walletManager: WalletManager;

  constructor() {
    this.router = Router();
    this.walletManager = WalletManager.getInstance();
    this.multiDexAggregator = new MultiDEXAggregator(this.walletManager);
    this.batchWalletManager = new BatchWalletManager(this.walletManager);
    
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // DEX Aggregator Routes
    this.router.get('/dex/supported', authenticate, this.getSupportedDEXes.bind(this));
    this.router.get('/dex/health', authenticate, this.getDEXHealth.bind(this));
    this.router.post('/dex/quote', authenticate, [
      body('tokenIn').isEthereumAddress().withMessage('Invalid tokenIn address'),
      body('tokenOut').isEthereumAddress().withMessage('Invalid tokenOut address'),
      body('amountIn').isDecimal().withMessage('Invalid amountIn'),
      body('excludeDEXes').optional().isArray().withMessage('excludeDEXes must be an array'),
    ], this.getBestQuote.bind(this));

    // Batch Trading Routes
    this.router.post('/batch/trades', authenticate, [
      body('walletAddress').isEthereumAddress().withMessage('Invalid wallet address'),
      body('trades').isArray({ min: 1 }).withMessage('Trades array is required'),
      body('trades.*.tokenIn').isEthereumAddress().withMessage('Invalid tokenIn address'),
      body('trades.*.tokenOut').isEthereumAddress().withMessage('Invalid tokenOut address'),
      body('trades.*.amountIn').isDecimal().withMessage('Invalid amountIn'),
      body('trades.*.slippage').optional().isFloat({ min: 0, max: 50 }).withMessage('Slippage must be between 0-50'),
      body('maxGasPrice').optional().isInt({ min: 1 }).withMessage('Invalid gas price'),
      body('deadline').optional().isInt({ min: 60 }).withMessage('Deadline must be at least 60 seconds'),
    ], this.executeBatchTrades.bind(this));

    this.router.post('/batch/limit-orders', authenticate, [
      body('walletAddress').isEthereumAddress().withMessage('Invalid wallet address'),
      body('orders').isArray({ min: 1 }).withMessage('Orders array is required'),
      body('orders.*.tokenIn').isEthereumAddress().withMessage('Invalid tokenIn address'),
      body('orders.*.tokenOut').isEthereumAddress().withMessage('Invalid tokenOut address'),
      body('orders.*.amountIn').isDecimal().withMessage('Invalid amountIn'),
      body('orders.*.limitPrice').isDecimal().withMessage('Invalid limit price'),
      body('orders.*.side').isIn(['buy', 'sell']).withMessage('Side must be buy or sell'),
    ], this.createBatchLimitOrders.bind(this));

    // Batch Wallet Management Routes
    this.router.post('/wallets/generate', authenticate, [
      body('count').isInt({ min: 1, max: 100 }).withMessage('Count must be between 1-100'),
      body('aliasPrefix').optional().isLength({ min: 1, max: 50 }).withMessage('Invalid alias prefix'),
      body('tier').optional().isIn(['hot', 'warm', 'cold', 'vault']).withMessage('Invalid tier'),
      body('tags').optional().isArray().withMessage('Tags must be an array'),
      body('autoFund.enabled').optional().isBoolean().withMessage('Invalid autoFund.enabled'),
      body('autoFund.amountBNB').optional().isDecimal().withMessage('Invalid funding amount'),
    ], this.generateWallets.bind(this));

    this.router.post('/wallets/import', authenticate, [
      body('wallets').isArray({ min: 1 }).withMessage('Wallets array is required'),
      body('wallets.*.privateKey').matches(/^0x[a-fA-F0-9]{64}$/).withMessage('Invalid private key format'),
      body('wallets.*.alias').optional().isLength({ min: 1, max: 100 }).withMessage('Invalid alias'),
      body('skipErrors').optional().isBoolean().withMessage('Invalid skipErrors'),
      body('defaultTier').optional().isIn(['hot', 'warm', 'cold', 'vault']).withMessage('Invalid tier'),
    ], this.importWallets.bind(this));

    this.router.get('/wallets/export', authenticate, [
      query('includePrivateKeys').optional().isBoolean().withMessage('Invalid includePrivateKeys'),
      query('addresses').optional().isString().withMessage('Invalid addresses'),
      query('tags').optional().isString().withMessage('Invalid tags'),
      query('tier').optional().isIn(['hot', 'warm', 'cold', 'vault']).withMessage('Invalid tier'),
      query('format').optional().isIn(['csv', 'json']).withMessage('Format must be csv or json'),
    ], this.exportWallets.bind(this));

    this.router.delete('/wallets/batch', authenticate, [
      body('addresses').isArray({ min: 1 }).withMessage('Addresses array is required'),
      body('addresses.*').isEthereumAddress().withMessage('Invalid wallet address'),
      body('confirmation.confirmPhrase').equals('DELETE_WALLETS_CONFIRMED').withMessage('Invalid confirmation'),
      body('confirmation.backupCompleted').equals('true').withMessage('Backup must be completed'),
    ], this.deleteWallets.bind(this));

    // Bulk Token Operations
    this.router.post('/tokens/bulk-buy', authenticate, [
      body('walletAddresses').isArray({ min: 1 }).withMessage('Wallet addresses required'),
      body('tokenAddress').isEthereumAddress().withMessage('Invalid token address'),
      body('amountPerWallet').isDecimal().withMessage('Invalid amount per wallet'),
      body('maxSlippage').optional().isFloat({ min: 0, max: 50 }).withMessage('Invalid slippage'),
      body('preferredDex').optional().isIn(['pancakeswap-v2', 'pancakeswap-v3']).withMessage('Invalid DEX'),
    ], this.bulkBuyToken.bind(this));

    this.router.post('/tokens/bulk-sell', authenticate, [
      body('walletAddresses').isArray({ min: 1 }).withMessage('Wallet addresses required'),
      body('tokenAddress').isEthereumAddress().withMessage('Invalid token address'),
      body('sellPercentage').optional().isFloat({ min: 0, max: 100 }).withMessage('Invalid sell percentage'),
      body('sellAmount').optional().isDecimal().withMessage('Invalid sell amount'),
      body('maxSlippage').optional().isFloat({ min: 0, max: 50 }).withMessage('Invalid slippage'),
    ], this.bulkSellToken.bind(this));

    this.router.post('/tokens/bulk-limit-orders', authenticate, [
      body('walletAddresses').isArray({ min: 1 }).withMessage('Wallet addresses required'),
      body('tokenAddress').isEthereumAddress().withMessage('Invalid token address'),
      body('orderType').isIn(['buy', 'sell']).withMessage('Order type must be buy or sell'),
      body('limitPrice').isDecimal().withMessage('Invalid limit price'),
      body('amountPerWallet').isDecimal().withMessage('Invalid amount per wallet'),
      body('expiry').optional().isInt({ min: Math.floor(Date.now() / 1000) }).withMessage('Invalid expiry'),
    ], this.createBulkLimitOrders.bind(this));
  }

  private handleValidationErrors(req: Request, res: Response): boolean {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
      return true;
    }
    return false;
  }

  // DEX Aggregator Endpoints
  private async getSupportedDEXes(req: Request, res: Response): Promise<void> {
    try {
      const supportedDEXes = this.multiDexAggregator.getSupportedDEXes();
      res.json({
        success: true,
        data: supportedDEXes,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get supported DEXes');
      res.status(500).json({
        success: false,
        message: 'Failed to get supported DEXes',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async getDEXHealth(req: Request, res: Response): Promise<void> {
    try {
      const healthStatus = await this.multiDexAggregator.getDEXHealthStatus();
      res.json({
        success: true,
        data: healthStatus,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get DEX health status');
      res.status(500).json({
        success: false,
        message: 'Failed to get DEX health status',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async getBestQuote(req: Request, res: Response): Promise<void> {
    if (this.handleValidationErrors(req, res)) return;

    try {
      const { tokenIn, tokenOut, amountIn, excludeDEXes = [] } = req.body;

      const quote = await this.multiDexAggregator.getBestQuote(
        tokenIn,
        tokenOut,
        amountIn,
        excludeDEXes
      );

      res.json({
        success: true,
        data: quote,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get best quote');
      res.status(500).json({
        success: false,
        message: 'Failed to get best quote',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Batch Trading Endpoints
  private async executeBatchTrades(req: Request, res: Response): Promise<void> {
    if (this.handleValidationErrors(req, res)) return;

    try {
      const batchRequest: BatchTradeRequest = req.body;

      logger.info({ 
        walletAddress: batchRequest.walletAddress,
        tradeCount: batchRequest.trades.length 
      }, 'Starting batch trades execution');

      const result = await this.multiDexAggregator.executeBatchTrades(batchRequest);

      res.json({
        success: result.success,
        data: result,
        message: `Completed ${result.completedTrades}/${result.totalTrades} trades`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to execute batch trades');
      res.status(500).json({
        success: false,
        message: 'Failed to execute batch trades',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async createBatchLimitOrders(req: Request, res: Response): Promise<void> {
    if (this.handleValidationErrors(req, res)) return;

    try {
      const { walletAddress, orders } = req.body;

      const result = await this.multiDexAggregator.executeBatchLimitOrders({
        walletAddress,
        orders,
      });

      res.json({
        success: result.success,
        data: result,
        message: `Created ${result.createdOrders} limit orders`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create batch limit orders');
      res.status(500).json({
        success: false,
        message: 'Failed to create batch limit orders',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Batch Wallet Management Endpoints
  private async generateWallets(req: Request, res: Response): Promise<void> {
    if (this.handleValidationErrors(req, res)) return;

    try {
      const config = req.body;

      const result = await this.batchWalletManager.generateWallets(config);

      res.json({
        success: result.success,
        data: result,
        message: `Generated ${result.processed}/${result.total} wallets`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to generate wallets');
      res.status(500).json({
        success: false,
        message: 'Failed to generate wallets',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async importWallets(req: Request, res: Response): Promise<void> {
    if (this.handleValidationErrors(req, res)) return;

    try {
      const { wallets, skipErrors = true, defaultTier = 'hot' } = req.body;

      // Create temporary CSV for import
      const tempFile = `/tmp/wallet_import_${Date.now()}.csv`;
      const csvContent = [
        'privateKey,alias,tags',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...wallets.map((w: any) => `${w.privateKey},${w.alias || ''},${w.tags?.join('|') || ''}`)
      ].join('\n');

      require('fs').writeFileSync(tempFile, csvContent);

      const result = await this.batchWalletManager.importWalletsFromCSV(tempFile, {
        skipErrors,
        defaultTier,
      });

      // Clean up temp file
      require('fs').unlinkSync(tempFile);

      res.json({
        success: result.success,
        data: result,
        message: `Imported ${result.processed}/${result.total} wallets`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to import wallets');
      res.status(500).json({
        success: false,
        message: 'Failed to import wallets',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async exportWallets(req: Request, res: Response): Promise<void> {
    try {
      const {
        includePrivateKeys = false,
        addresses,
        tags,
        tier,
        format = 'csv'
      } = req.query;

      if (includePrivateKeys === 'true') {
        res.status(403).json({
          success: false,
          message: 'Private key export is disabled for security reasons.',
        });
        return;
      }

      const options = {
        includePrivateKeys: false,
        walletAddresses: addresses ? (addresses as string).split(',') : undefined,
        tags: tags ? (tags as string).split(',') : undefined,
        tier: tier as string,
        includeBalances: true,
      };

      if (format === 'json') {
        // Return JSON format
        const wallets = this.walletManager.getAllWallets();
        // Apply filters and return JSON
        res.json({
          success: true,
          data: wallets, // Apply same filtering logic as CSV export
        });
        return;
      }

      // CSV export
      const tempFile = `/tmp/wallet_export_${Date.now()}.csv`;
      await this.batchWalletManager.exportWalletsToCSV(tempFile, options);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=wallets_export.csv');
      
      const fileContent = require('fs').readFileSync(tempFile);
      res.send(fileContent);

      // Clean up temp file
      require('fs').unlinkSync(tempFile);

    } catch (error) {
      logger.error({ error }, 'Failed to export wallets');
      res.status(500).json({
        success: false,
        message: 'Failed to export wallets',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async deleteWallets(req: Request, res: Response): Promise<void> {
    if (this.handleValidationErrors(req, res)) return;

    try {
      const { addresses } = req.body;

      const result = await this.batchWalletManager.deleteWallets(addresses);

      res.json({
        success: result.success,
        data: result,
        message: `Deleted ${result.processed}/${result.total} wallets`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to delete wallets');
      res.status(500).json({
        success: false,
        message: 'Failed to delete wallets',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Bulk Token Operations
  private async bulkBuyToken(req: Request, res: Response): Promise<void> {
    if (this.handleValidationErrors(req, res)) return;

    try {
      const {
        walletAddresses,
        tokenAddress,
        amountPerWallet,
        maxSlippage = 0.5,
        preferredDex
      } = req.body;

      const results = [];

      for (const walletAddress of walletAddresses) {
        try {
          const tradeResult = await this.multiDexAggregator.executeBatchTrades({
            walletAddress,
            trades: [{
              tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
              tokenOut: tokenAddress,
              amountIn: amountPerWallet,
              slippage: maxSlippage,
              preferredDex,
            }],
          });

          results.push({
            walletAddress,
            success: tradeResult.success,
            result: tradeResult.results[0],
          });
        } catch (error) {
          results.push({
            walletAddress,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const successCount = results.filter(r => r.success).length;

      res.json({
        success: successCount > 0,
        data: {
          completed: successCount,
          total: walletAddresses.length,
          results,
        },
        message: `Bulk buy completed: ${successCount}/${walletAddresses.length} successful`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to execute bulk buy');
      res.status(500).json({
        success: false,
        message: 'Failed to execute bulk buy',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async bulkSellToken(req: Request, res: Response): Promise<void> {
    if (this.handleValidationErrors(req, res)) return;

    try {
      const {
        walletAddresses,
        tokenAddress,
        sellPercentage,
        sellAmount,
        maxSlippage = 0.5
      } = req.body;

      const results = [];

      for (const walletAddress of walletAddresses) {
        try {
          let amountToSell = sellAmount;

          // If selling by percentage, get current balance
          if (sellPercentage && !sellAmount) {
            const balance = await this.walletManager.getTokenBalance(walletAddress, tokenAddress);
            amountToSell = (parseFloat(balance) * sellPercentage / 100).toFixed(8);
          }

          const tradeResult = await this.multiDexAggregator.executeBatchTrades({
            walletAddress,
            trades: [{
              tokenIn: tokenAddress,
              tokenOut: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
              amountIn: amountToSell,
              slippage: maxSlippage,
            }],
          });

          results.push({
            walletAddress,
            success: tradeResult.success,
            amountSold: amountToSell,
            result: tradeResult.results[0],
          });
        } catch (error) {
          results.push({
            walletAddress,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const successCount = results.filter(r => r.success).length;

      res.json({
        success: successCount > 0,
        data: {
          completed: successCount,
          total: walletAddresses.length,
          results,
        },
        message: `Bulk sell completed: ${successCount}/${walletAddresses.length} successful`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to execute bulk sell');
      res.status(500).json({
        success: false,
        message: 'Failed to execute bulk sell',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async createBulkLimitOrders(req: Request, res: Response): Promise<void> {
    if (this.handleValidationErrors(req, res)) return;

    try {
      const {
        walletAddresses,
        tokenAddress,
        orderType,
        limitPrice,
        amountPerWallet,
        expiry
      } = req.body;

      const results = [];

      for (const walletAddress of walletAddresses) {
        try {
          const limitOrderResult = await this.multiDexAggregator.executeBatchLimitOrders({
            walletAddress,
            orders: [{
              tokenIn: orderType === 'buy' ? '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' : tokenAddress,
              tokenOut: orderType === 'buy' ? tokenAddress : '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
              amountIn: amountPerWallet,
              limitPrice,
              side: orderType,
              expiry,
            }],
          });

          results.push({
            walletAddress,
            success: limitOrderResult.success,
            result: limitOrderResult.results[0],
          });
        } catch (error) {
          results.push({
            walletAddress,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      const successCount = results.filter(r => r.success).length;

      res.json({
        success: successCount > 0,
        data: {
          completed: successCount,
          total: walletAddresses.length,
          results,
        },
        message: `Bulk limit orders created: ${successCount}/${walletAddresses.length} successful`,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to create bulk limit orders');
      res.status(500).json({
        success: false,
        message: 'Failed to create bulk limit orders',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
