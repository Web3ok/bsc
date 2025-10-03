import { Router, Request, Response } from 'express';
import { WalletManager } from '../wallet';
import { BatchWalletManager } from '../wallet/batch-wallet-manager';
import { logger } from '../utils/logger';

interface BalanceCache {
  balance: string;
  balanceWei: string;
  timestamp: number;
}

export class WalletManagementAPI {
  private router: Router;
  private walletManager: WalletManager;
  private batchWalletManager: BatchWalletManager;
  private balanceCache: Map<string, BalanceCache>;
  private readonly CACHE_TTL = 30000; // 30秒缓存

  constructor() {
    this.router = Router();
    this.walletManager = WalletManager.getInstance();
    this.batchWalletManager = new BatchWalletManager(this.walletManager);
    this.balanceCache = new Map();
    this.setupRoutes();
    this.startCacheCleanup();
  }

  private startCacheCleanup(): void {
    // 每分钟清理过期缓存
    setInterval(() => {
      const now = Date.now();
      for (const [address, cache] of this.balanceCache.entries()) {
        if (now - cache.timestamp > this.CACHE_TTL) {
          this.balanceCache.delete(address);
        }
      }
    }, 60000);
  }

  getRouter(): Router {
    return this.router;
  }

  private setupRoutes(): void {
    // List wallets with filtering
    this.router.get('/list', async (req: Request, res: Response) => {
      try {
        const { group, tier, tag, page = 1, limit = 50 } = req.query;

        // Import database module here to avoid circular dependencies
        const { database } = await import('../persistence/database');
        await database.ensureConnection();
        const db = database.getConnection();

        // Build query
        let query = db('wallets').select(
          'address',
          'label',
          'group_name as group',
          'derivation_index',
          'created_at as createdAt'
        );

        // Apply filters
        if (group) {
          query = query.where('group_name', group);
        }

        // Count total for pagination
        const countQuery = query.clone().count('* as count');
        const countResult = await countQuery.first();
        const total = Number(countResult?.count || 0);

        // Pagination
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        // Fetch paginated results
        const wallets = await query
          .orderBy('created_at', 'desc')
          .limit(limitNum)
          .offset(offset);

        // Format wallets for response
        const formattedWallets = wallets.map(w => ({
          address: w.address,
          label: w.label || '',
          group: w.group || '',
          balance: '0', // Will be fetched on-demand via balance endpoint
          tier: 'standard', // Default tier
          privateKey: '***HIDDEN***',
          createdAt: w.createdAt,
          tags: this.walletManager.getWalletTags(w.address),
        }));

        res.json({
          success: true,
          data: {
            wallets: formattedWallets,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
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

    // Import wallets from private keys (saves to database)
    this.router.post('/import', async (req: Request, res: Response) => {
      try {
        const { privateKeys, config } = req.body;

        if (!Array.isArray(privateKeys) || privateKeys.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'privateKeys must be a non-empty array',
          });
        }

        // Import database and crypto modules
        const { database } = await import('../persistence/database');
        const { CryptoUtils } = await import('../utils/crypto');
        const { ConfigLoader } = await import('../config/loader');
        const { ethers } = await import('ethers');

        await database.ensureConnection();
        const db = database.getConnection();

        const configLoader = ConfigLoader.getInstance();
        const encryptionPassword = configLoader.getEncryptionPassword();

        const imported = [];
        const errors: Array<{ index: number; error: string }> = [];

        for (let i = 0; i < privateKeys.length; i++) {
          try {
            const privateKey = privateKeys[i];

            // Validate private key format
            if (!privateKey.startsWith('0x')) {
              throw new Error('Private key must start with 0x');
            }

            const wallet = new ethers.Wallet(privateKey);
            const label = config?.labels?.[i] || `Imported-${i + 1}`;

            // Add to WalletManager (in-memory)
            await this.walletManager.importWallet(privateKey, label, config?.group);

            // Encrypt and save to database
            const encryptedPrivateKey = CryptoUtils.encrypt(privateKey, encryptionPassword);

            await db('wallets').insert({
              address: wallet.address,
              private_key_encrypted: encryptedPrivateKey,
              derivation_index: -1, // Imported wallets have no derivation
              label: label,
              group_name: config?.group || null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

            imported.push({ address: wallet.address, label });
            logger.info({ address: wallet.address, label }, 'Imported wallet');
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push({ index: i, error: errorMessage });
            logger.error({ error, index: i }, 'Failed to import wallet');
          }
        }

        res.json({
          success: imported.length > 0,
          data: {
            imported: imported.length,
            failed: errors.length,
            wallets: imported,
            errors,
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

    // Import wallets from CSV file
    this.router.post('/import-csv', async (req: Request, res: Response) => {
      try {
        const { csvData } = req.body;

        if (!csvData || typeof csvData !== 'string') {
          return res.status(400).json({
            success: false,
            message: 'CSV data is required as a string',
          });
        }

        // Import required modules
        const { database } = await import('../persistence/database');
        const { CryptoUtils } = await import('../utils/crypto');
        const { ConfigLoader } = await import('../config/loader');
        const { ethers } = await import('ethers');

        await database.ensureConnection();
        const db = database.getConnection();

        const configLoader = ConfigLoader.getInstance();
        const encryptionPassword = configLoader.getEncryptionPassword();

        // Parse CSV
        const lines = csvData.split('\n').filter(line => line.trim());
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const dataRows = lines.slice(1);

        const imported = [];
        const errors: Array<{ row: number; error: string }> = [];

        for (let i = 0; i < dataRows.length; i++) {
          try {
            const values = dataRows[i].split(',').map(v => v.trim());
            const row: any = {};
            headers.forEach((header, index) => {
              row[header] = values[index];
            });

            // Extract wallet data (support multiple column names)
            const privateKey = row.privatekey || row.private_key || row['private key'];
            const address = row.address;
            const label = row.label || row.name || `Imported-${i + 1}`;
            const group = row.group || row.group_name || row['group name'];

            if (!privateKey) {
              throw new Error('Private key is required in CSV');
            }

            const wallet = new ethers.Wallet(privateKey);

            // Verify address matches if provided
            if (address && address.toLowerCase() !== wallet.address.toLowerCase()) {
              throw new Error(`Address mismatch: CSV has ${address}, derived ${wallet.address}`);
            }

            // Add to WalletManager (in-memory)
            await this.walletManager.importWallet(privateKey, label, group);

            // Encrypt and save to database
            const encryptedPrivateKey = CryptoUtils.encrypt(privateKey, encryptionPassword);

            await db('wallets').insert({
              address: wallet.address,
              private_key_encrypted: encryptedPrivateKey,
              derivation_index: -1,
              label: label,
              group_name: group || null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });

            imported.push({ address: wallet.address, label, group });
            logger.info({ address: wallet.address, label, group }, 'Imported wallet from CSV');
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push({ row: i + 1, error: errorMessage });
            logger.error({ error, row: i + 1 }, 'Failed to import wallet from CSV');
          }
        }

        res.json({
          success: imported.length > 0,
          data: {
            imported: imported.length,
            failed: errors.length,
            wallets: imported,
            errors,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to import wallets from CSV');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Export wallets to CSV (reads from database)
    this.router.get('/export', async (req: Request, res: Response) => {
      try {
        const { format = 'csv' } = req.query;

        if (format !== 'csv') {
          return res.status(400).json({
            success: false,
            message: 'Only CSV format is currently supported',
          });
        }

        // Import database and filesystem modules
        const { database } = await import('../persistence/database');
        const fs = await import('fs/promises');
        const path = await import('path');

        await database.ensureConnection();
        const db = database.getConnection();

        // Fetch all wallets from database
        const wallets = await db('wallets').select(
          'address',
          'label',
          'group_name as group',
          'derivation_index',
          'created_at'
        ).orderBy('created_at', 'desc');

        // Generate CSV content
        const header = 'Address,Label,Group,Derivation Index,Created At\n';
        const rows = wallets.map((w: any) =>
          `${w.address},${w.label || ''},${w.group || ''},${w.derivation_index || ''},${w.created_at}`
        ).join('\n');

        const csvContent = header + rows;

        // Create exports directory
        const exportDir = './data/exports';
        await fs.mkdir(exportDir, { recursive: true });

        // Save to file
        const fileName = `wallets_export_${new Date().toISOString().split('T')[0]}.csv`;
        const filePath = path.join(exportDir, fileName);
        await fs.writeFile(filePath, csvContent, 'utf8');

        logger.info({ filePath, count: wallets.length }, 'Exported wallets to CSV');

        res.json({
          success: true,
          data: {
            filePath,
            count: wallets.length,
            format: 'csv',
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to export wallets');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // SECURITY: Private key endpoint with strict controls
    // Only available in development mode with explicit confirmation
    this.router.get('/:address/private-key', async (req: Request, res: Response) => {
      const { address } = req.params;
      const { confirm } = req.query;

      // Block in production environment
      if (process.env.NODE_ENV === 'production') {
        logger.error({
          address,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          timestamp: new Date().toISOString()
        }, 'SECURITY VIOLATION: Attempted private key access in production');

        return res.status(403).json({
          success: false,
          message: 'SECURITY: Private key access disabled in production environment.',
          recommendation: 'Use secure key management with HSM/hardware wallets.'
        });
      }

      // Require explicit confirmation even in dev mode
      if (confirm !== 'I_UNDERSTAND_THE_SECURITY_RISKS') {
        logger.warn({ address, ip: req.ip }, 'Private key access attempted without confirmation');
        return res.status(403).json({
          success: false,
          message: 'Security confirmation required',
          requiresConfirmation: true
        });
      }

      try {
        const wallet = this.walletManager.getWallet(address);
        if (!wallet) {
          return res.status(404).json({
            success: false,
            message: 'Wallet not found'
          });
        }

        logger.warn({
          address,
          ip: req.ip,
          timestamp: new Date().toISOString()
        }, 'DEV MODE: Private key accessed');

        res.json({
          success: true,
          data: {
            address: wallet.address,
            privateKey: wallet.privateKey,
            warning: 'NEVER share your private key! This is for development only.'
          }
        });
      } catch (error) {
        logger.error({ error, address }, 'Failed to retrieve private key');
        res.status(500).json({
          success: false,
          message: 'Failed to retrieve private key'
        });
      }
    });

    // Get wallet balance from blockchain (with caching)
    this.router.get('/:address/balance', async (req: Request, res: Response) => {
      const { address } = req.params;
      const { force } = req.query; // force=true 强制刷新缓存

      // 验证地址格式
      if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Ethereum address format. Address must be 42 characters starting with 0x',
          receivedAddress: address
        });
      }

      try {
        // 检查缓存
        const now = Date.now();
        const cached = this.balanceCache.get(address.toLowerCase());

        if (cached && !force && (now - cached.timestamp < this.CACHE_TTL)) {
          logger.info({ address, age: now - cached.timestamp }, 'Balance served from cache');
          return res.json({
            success: true,
            data: {
              address,
              BNB: parseFloat(cached.balance).toFixed(4),
              balanceWei: cached.balanceWei,
              timestamp: new Date(cached.timestamp).toISOString(),
              cached: true,
              cacheAge: Math.floor((now - cached.timestamp) / 1000) // 秒
            }
          });
        }

        const ethers = require('ethers');
        const provider = new ethers.JsonRpcProvider(
          process.env.RPC_URL || 'https://bsc-dataseed1.binance.org/'
        );

        // Get BNB balance from blockchain
        const startTime = Date.now();
        const balanceWei = await provider.getBalance(address);
        const balanceBNB = ethers.formatEther(balanceWei);
        const queryTime = Date.now() - startTime;

        // 更新缓存 (使用小写地址作为key)
        this.balanceCache.set(address.toLowerCase(), {
          balance: balanceBNB,
          balanceWei: balanceWei.toString(),
          timestamp: Date.now()
        });

        logger.info({ address, queryTime }, 'Balance fetched from blockchain');

        res.json({
          success: true,
          data: {
            address,
            BNB: parseFloat(balanceBNB).toFixed(4),
            balanceWei: balanceWei.toString(),
            timestamp: new Date().toISOString(),
            cached: false,
            queryTime
          }
        });
      } catch (error) {
        logger.error({ error, address }, 'Failed to fetch wallet balance');
        res.status(500).json({
          success: false,
          message: 'Failed to fetch balance from blockchain',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
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

    // Batch Transfer - One-to-One, One-to-Many, Many-to-Many
    this.router.post('/batch-transfer', async (req: Request, res: Response) => {
      try {
        const { type, fromAddresses, toAddresses, amount, tokenAddress } = req.body;

        // Validate request
        if (!type || !fromAddresses || !toAddresses || !amount) {
          return res.status(400).json({
            success: false,
            message: 'Missing required fields: type, fromAddresses, toAddresses, amount',
          });
        }

        // Import transfer module
        const { TransferManager } = await import('../transfer');
        const transferManager = new TransferManager(this.walletManager);

        const results: any[] = [];
        let successCount = 0;
        let failCount = 0;

        // Type: one-to-one (single wallet to single wallet)
        if (type === 'one-to-one') {
          if (fromAddresses.length !== 1 || toAddresses.length !== 1) {
            return res.status(400).json({
              success: false,
              message: 'One-to-one transfer requires exactly 1 from address and 1 to address',
            });
          }

          try {
            const result = await transferManager.sendSingle({
              from: fromAddresses[0],
              to: toAddresses[0],
              amount: amount,
              token: tokenAddress,
              dryRun: false,
            });

            results.push(result);
            if (result.success) successCount++;
            else failCount++;
          } catch (error) {
            results.push({
              success: false,
              from: fromAddresses[0],
              to: toAddresses[0],
              error: error instanceof Error ? error.message : 'Unknown error',
            });
            failCount++;
          }
        }

        // Type: one-to-many (single wallet to multiple wallets)
        else if (type === 'one-to-many') {
          if (fromAddresses.length !== 1) {
            return res.status(400).json({
              success: false,
              message: 'One-to-many transfer requires exactly 1 from address',
            });
          }

          const fromAddress = fromAddresses[0];
          for (const toAddress of toAddresses) {
            try {
              const result = await transferManager.sendSingle({
                from: fromAddress,
                to: toAddress,
                amount: amount,
                token: tokenAddress,
                dryRun: false,
              });

              results.push(result);
              if (result.success) successCount++;
              else failCount++;
            } catch (error) {
              results.push({
                success: false,
                from: fromAddress,
                to: toAddress,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
              failCount++;
            }
          }
        }

        // Type: many-to-many (multiple wallets to multiple wallets, round-robin)
        else if (type === 'many-to-many') {
          const fromCount = fromAddresses.length;
          const toCount = toAddresses.length;

          for (let i = 0; i < toCount; i++) {
            const fromAddress = fromAddresses[i % fromCount]; // Round-robin
            const toAddress = toAddresses[i];

            try {
              const result = await transferManager.sendSingle({
                from: fromAddress,
                to: toAddress,
                amount: amount,
                token: tokenAddress,
                dryRun: false,
              });

              results.push(result);
              if (result.success) successCount++;
              else failCount++;
            } catch (error) {
              results.push({
                success: false,
                from: fromAddress,
                to: toAddress,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
              failCount++;
            }
          }
        }

        else {
          return res.status(400).json({
            success: false,
            message: 'Invalid transfer type. Must be one of: one-to-one, one-to-many, many-to-many',
          });
        }

        res.json({
          success: successCount > 0,
          data: {
            type,
            totalTransfers: results.length,
            successful: successCount,
            failed: failCount,
            results,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to execute batch transfer');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  }
}
