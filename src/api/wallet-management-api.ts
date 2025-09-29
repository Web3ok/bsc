import { Router, Request, Response } from 'express';
import { WalletManager } from '../wallet';
import { BatchWalletManager } from '../wallet/batch-wallet-manager';
import { logger } from '../utils/logger';

export class WalletManagementAPI {
  private router: Router;
  private walletManager: WalletManager;
  private batchWalletManager: BatchWalletManager;

  constructor() {
    this.router = Router();
    this.walletManager = WalletManager.getInstance();
    this.batchWalletManager = new BatchWalletManager(this.walletManager);
    this.setupRoutes();
  }

  getRouter(): Router {
    return this.router;
  }

  private setupRoutes(): void {
    // List wallets with filtering
    this.router.get('/list', async (req: Request, res: Response) => {
      try {
        const { group, tier, tag, page = 1, limit = 50 } = req.query;
        
        let wallets = this.walletManager.getWallets(group as string);
        
        // Filter by tier if provided
        if (tier) {
          wallets = wallets.filter(w => w.tier === tier);
        }

        // Filter by tag if provided
        if (tag) {
          const taggedWallets = this.walletManager.getWalletsByTag(tag as string);
          wallets = wallets.filter(w => 
            taggedWallets.some(tw => tw.address === w.address)
          );
        }

        // Pagination
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;
        const paginatedWallets = wallets.slice(startIndex, endIndex);

        // Remove private keys from response for security
        const safeWallets = paginatedWallets.map(w => ({
          ...w,
          privateKey: '***HIDDEN***',
          tags: this.walletManager.getWalletTags(w.address),
        }));

        res.json({
          success: true,
          data: {
            wallets: safeWallets,
            total: wallets.length,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(wallets.length / limitNum),
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to list wallets');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Generate new wallets
    this.router.post('/generate', async (req: Request, res: Response) => {
      try {
        const { count = 1, config } = req.body;

        const result = await this.batchWalletManager.generateWallets({ count, ...config });

        res.json({
          success: result.success,
          data: {
            wallets: result.results.filter(r => r.success),
            count: result.processed,
            errors: result.errors,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to generate wallets');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Import wallets from private keys
    this.router.post('/import', async (req: Request, res: Response) => {
      try {
        const { privateKeys, config } = req.body;

        if (!Array.isArray(privateKeys) || privateKeys.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'privateKeys must be a non-empty array',
          });
        }

        const result = await this.walletManager.importFromPrivateKeys(privateKeys, config);

        res.json({
          success: result.success,
          data: {
            imported: result.imported,
            failed: result.errors.length,
            errors: result.errors,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to import wallets');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Export wallets to CSV
    this.router.get('/export', async (req: Request, res: Response) => {
      try {
        const { group, format = 'csv' } = req.query;

        if (format === 'csv') {
          const filePath = await this.walletManager.exportToCSV();
          const count = this.walletManager.getWalletCount();

          res.json({
            success: true,
            data: {
              filePath,
              count,
              format: 'csv',
            },
          });
        } else {
          res.status(400).json({
            success: false,
            message: 'Only CSV format is currently supported',
          });
        }
      } catch (error) {
        logger.error({ error }, 'Failed to export wallets');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // SECURITY: Private key endpoint permanently disabled for security
    // Private keys should never be exposed via HTTP APIs
    this.router.get('/:address/private-key', async (req: Request, res: Response) => {
      // Log security violation attempt
      logger.error({ 
        address: req.params.address,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      }, 'SECURITY VIOLATION: Attempted access to disabled private key endpoint');
      
      res.status(501).json({
        success: false,
        message: 'SECURITY: Private key access endpoint permanently disabled.',
        recommendation: 'Use secure key management with HSM/hardware wallets for production environments.',
        error: 'This endpoint poses a security risk and has been disabled.'
      });
    });

    // Get wallet statistics
    this.router.get('/stats', async (req: Request, res: Response) => {
      try {
        const totalWallets = this.walletManager.getWalletCount();
        const groups = this.walletManager.getGroups();
        
        const tierStats = {
          hot: (await this.walletManager.getWalletsByTier('hot')).length,
          cold: (await this.walletManager.getWalletsByTier('cold')).length,
          vault: (await this.walletManager.getWalletsByTier('vault')).length,
        };

        res.json({
          success: true,
          data: {
            totalWallets,
            groups: groups.length,
            tierStats,
            groupList: groups,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get wallet statistics');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  }
}
