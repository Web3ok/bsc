import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { WalletManager, WalletInfo } from './index';
import { logger } from '../utils/logger';
import { database } from '../persistence/database';
import { CryptoUtils } from '../utils/crypto';
import { ConfigLoader } from '../config/loader';
import * as fs from 'fs';

export interface BatchWalletImportData {
  address?: string;
  privateKey: string;
  alias?: string;
  tags?: string[]; // For grouping wallets
  initialBalance?: string;
  notes?: string;
}

export interface BatchWalletExportData {
  address: string;
  privateKey: string;
  alias: string;
  tier: string;
  tags: string;
  balance_bnb: string;
  balance_usd: string;
  created_at: string;
  last_used: string;
  notes: string;
}

export interface WalletGenerationConfig {
  count: number;
  aliasPrefix?: string;
  label?: string;  // Single wallet label
  group?: string;  // Group name
  tags?: string[];
  tier?: 'hot' | 'warm' | 'cold' | 'vault';
  autoFund?: {
    enabled: boolean;
    amountBNB: string;
    fromWallet?: string;
  };
}

export interface BatchOperationResult {
  success: boolean;
  processed: number;
  total: number;
  errors: Array<{
    index: number;
    error: string;
    data?: any;
  }>;
  results: Array<{
    success: boolean;
    data?: any;
  }>;
}

export class BatchWalletManager {
  private walletManager: WalletManager;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
  }

  /**
   * Generate multiple wallets at once
   */
  async generateWallets(config: WalletGenerationConfig): Promise<BatchOperationResult> {
    const results: BatchOperationResult['results'] = [];
    const errors: BatchOperationResult['errors'] = [];

    logger.info({ count: config.count }, 'Starting batch wallet generation');

    // Ensure database connection
    await database.ensureConnection();
    const db = database.getConnection();

    // Get encryption password
    const configLoader = ConfigLoader.getInstance();
    const encryptionPassword = configLoader.getEncryptionPassword();

    for (let i = 0; i < config.count; i++) {
      try {
        // Generate new wallet using viem
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);

        // Determine label for this wallet
        const label = config.count === 1
          ? (config.label || config.aliasPrefix || 'Wallet')
          : (config.aliasPrefix ? `${config.aliasPrefix}-${i + 1}` : `Wallet-${i + 1}`);

        const walletInfo: WalletInfo = {
          address: account.address,
          privateKey: privateKey,
          derivationIndex: -1, // Not derived from seed
          alias: label,
          label,
          group: config.group,
          tier: config.tier || 'hot',
          createdAt: new Date(),
        };

        // Add wallet to manager (in-memory)
        await this.walletManager.addWallet(walletInfo);

        // Encrypt private key for database storage
        const encryptedPrivateKey = CryptoUtils.encrypt(privateKey, encryptionPassword);

        // Save to database
        await db('wallets').insert({
          address: account.address,
          private_key_encrypted: encryptedPrivateKey,
          derivation_index: -1,
          label: label,
          group_name: config.group || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // Add tags if specified
        if (config.tags && config.tags.length > 0) {
          for (const tag of config.tags) {
            await this.walletManager.addWalletTag(walletInfo.address, tag);
          }
        }

        results.push({
          success: true,
          data: { address: walletInfo.address, alias: walletInfo.alias, label, group: config.group },
        });

        logger.debug({ address: walletInfo.address, label, group: config.group, index: i + 1 }, 'Generated and saved wallet');

        // Auto-fund if enabled
        if (config.autoFund?.enabled && config.autoFund.amountBNB) {
          try {
            // TODO: Implement auto-funding logic
            logger.debug({ address: walletInfo.address }, 'Auto-funding not implemented');
          } catch (fundError) {
            logger.warn({ error: fundError, address: walletInfo.address }, 'Auto-funding failed');
          }
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          index: i,
          error: errorMessage,
          data: { aliasPrefix: config.aliasPrefix, index: i },
        });

        results.push({
          success: false,
          data: { index: i, error: errorMessage },
        });

        logger.error({ error, index: i }, 'Failed to generate wallet');
      }
    }

    const successCount = results.filter(r => r.success).length;

    logger.info({
      total: config.count,
      success: successCount,
      failed: errors.length
    }, 'Batch wallet generation completed');

    return {
      success: successCount > 0,
      processed: successCount,
      total: config.count,
      errors,
      results,
    };
  }

  /**
   * Import wallets from CSV file
   */
  async importWalletsFromCSV(filePath: string, options: {
    skipErrors?: boolean;
    validateAddresses?: boolean;
    defaultTier?: 'hot' | 'warm' | 'cold' | 'vault';
  } = {}): Promise<BatchOperationResult> {
    const results: BatchOperationResult['results'] = [];
    const errors: BatchOperationResult['errors'] = [];

    try {
      const csvContent = await fs.promises.readFile(filePath, 'utf-8');
      const lines = csvContent.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      const dataRows = lines.slice(1);

      const walletData: BatchWalletImportData[] = dataRows.map(line => {
        const values = line.split(',').map(v => v.trim());
        const row: any = {};
        headers.forEach((header, index) => {
          row[header] = values[index];
        });

        return {
          address: row.address,
          privateKey: row.privateKey || row.private_key,
          alias: row.alias || row.name,
          tags: row.tags ? row.tags.split('|').map((t: string) => t.trim()).filter(Boolean) : [],
          notes: row.notes,
        };
      });

      logger.info({ 
        totalWallets: walletData.length,
        filePath 
      }, 'CSV file parsed, starting wallet import');

      for (const [index, data] of walletData.entries()) {
        try {
          // Validate private key
          if (!data.privateKey) {
            throw new Error('Private key is required');
          }

          // Validate and get address from private key
          const account = privateKeyToAccount(data.privateKey as `0x${string}`);
          const derivedAddress = account.address;

          // If address is provided, validate it matches
          if (data.address && data.address.toLowerCase() !== derivedAddress.toLowerCase()) {
            if (!options.skipErrors) {
              throw new Error(`Address mismatch: provided ${data.address}, derived ${derivedAddress}`);
            }
            logger.warn({ provided: data.address, derived: derivedAddress }, 'Address mismatch, using derived');
          }

          const walletInfo: WalletInfo = {
            address: derivedAddress,
            privateKey: data.privateKey as `0x${string}`,
            derivationIndex: -1, // Imported wallet
            alias: data.alias || `Imported-${index + 1}`,
            tier: options.defaultTier || 'hot',
            createdAt: new Date(),
          };

          // Import the wallet
          await this.walletManager.addWallet(walletInfo);

          // Add tags if provided
          if (data.tags && data.tags.length > 0) {
            for (const tag of data.tags) {
              await this.walletManager.addWalletTag(walletInfo.address, tag);
            }
          }

          results.push({
            success: true,
            data: { address: walletInfo.address, alias: walletInfo.alias },
          });

          logger.debug({ address: walletInfo.address, index: index + 1 }, 'Imported wallet');

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push({
            index,
            error: errorMessage,
            data: { originalData: data },
          });

          results.push({
            success: false,
            data: { index, originalData: data },
          });

          logger.error({ error, index, data }, 'Failed to import wallet');

          if (!options.skipErrors) {
            throw new Error(`Import failed at row ${index + 1}: ${errorMessage}`);
          }
        }
      }

      const successCount = results.filter(r => r.success).length;

      logger.info({ 
        total: walletData.length,
        success: successCount,
        failed: errors.length 
      }, 'Batch wallet import completed');

      return {
        success: successCount > 0,
        processed: successCount,
        total: walletData.length,
        errors,
        results,
      };
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to import wallets from CSV');
      throw error;
    }
  }

  /**
   * Export wallets to CSV file
   */
  async exportWalletsToCSV(filePath: string, options: {
    includePrivateKeys?: boolean;
    walletAddresses?: string[];
    tags?: string[];
    tier?: string;
    includeBalances?: boolean;
  } = {}): Promise<{
    success: boolean;
    exportedCount: number;
    filePath: string;
  }> {
    try {
      let wallets = this.walletManager.getAllWallets();

      // Apply filters
      if (options.walletAddresses && options.walletAddresses.length > 0) {
        wallets = wallets.filter(w => options.walletAddresses!.includes(w.address));
      }

      if (options.tier) {
        wallets = wallets.filter(w => w.tier === options.tier);
      }

      if (options.tags && options.tags.length > 0) {
        wallets = wallets.filter(wallet => {
          const walletTags = this.walletManager.getWalletTags(wallet.address);
          return options.tags!.some(tag => walletTags.includes(tag));
        });
      }

      // Build CSV content
      const headers = ['address', 'alias', 'tier', 'created_at'];
      if (options.includePrivateKeys) {
        logger.error('🚨 SECURITY VIOLATION ATTEMPT: Private key export is disabled via API');
        throw new Error('SECURITY ERROR: Private key export is permanently disabled.');
      }
      if (options.includeBalances) {
        headers.push('balance_bnb', 'balance_usd');
      }
      headers.push('tags', 'notes');

      const csvRows: string[] = [headers.join(',')];

      for (const wallet of wallets) {
        const row: string[] = [
          wallet.address,
          wallet.alias || '',
          wallet.tier || 'hot',
          wallet.createdAt.toISOString(),
        ];

        if (options.includeBalances) {
          let balanceBNB = '0';
          let balanceUSD = '0';

          try {
            balanceBNB = await this.walletManager.getTokenBalance(wallet.address, 'BNB');
            // Calculate USD value (would need price feed)
            balanceUSD = '0'; // TODO: Implement price conversion
          } catch (error) {
            logger.debug({ error, address: wallet.address }, 'Failed to get balance for export');
          }

          row.push(balanceBNB, balanceUSD);
        }

        // Add tags
        const tags = this.walletManager.getWalletTags(wallet.address);
        row.push(tags.join('|'));
        
        // Add notes (placeholder)
        row.push('');

        csvRows.push(row.join(','));
      }

      const csvContent = csvRows.join('\n');
      await fs.promises.writeFile(filePath, csvContent, 'utf-8');

      logger.info({ 
        filePath, 
        exportedCount: wallets.length 
      }, 'Wallets exported to CSV');

      return {
        success: true,
        exportedCount: wallets.length,
        filePath,
      };
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to export wallets to CSV');
      throw error;
    }
  }

  /**
   * Batch delete wallets
   */
  async deleteWallets(addresses: string[]): Promise<BatchOperationResult> {
    const results: BatchOperationResult['results'] = [];
    const errors: BatchOperationResult['errors'] = [];

    logger.info({ count: addresses.length }, 'Starting batch wallet deletion');

    for (const [index, address] of addresses.entries()) {
      try {
        await this.walletManager.removeWallet(address);
        
        results.push({
          success: true,
          data: { address },
        });

        logger.debug({ address, index: index + 1 }, 'Deleted wallet');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          index,
          error: errorMessage,
          data: { address },
        });

        results.push({
          success: false,
          data: { address, error: errorMessage },
        });

        logger.error({ error, address }, 'Failed to delete wallet');
      }
    }

    const successCount = results.filter(r => r.success).length;

    return {
      success: successCount > 0,
      processed: successCount,
      total: addresses.length,
      errors,
      results,
    };
  }

  /**
   * Get wallet statistics
   */
  getWalletStats(): {
    total: number;
    byTier: Record<string, number>;
    byTags: Record<string, number>;
    totalBalance: string;
  } {
    const wallets = this.walletManager.getAllWallets();
    
    const stats = {
      total: wallets.length,
      byTier: {} as Record<string, number>,
      byTags: {} as Record<string, number>,
      totalBalance: '0', // TODO: Calculate total balance
    };

    // Count by tier
    for (const wallet of wallets) {
      const tier = wallet.tier || 'hot';
      stats.byTier[tier] = (stats.byTier[tier] || 0) + 1;
    }

    // Count by tags
    for (const wallet of wallets) {
      const tags = this.walletManager.getWalletTags(wallet.address);
      for (const tag of tags) {
        stats.byTags[tag] = (stats.byTags[tag] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * Validate wallet data before operations
   */
  private validateWalletData(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!data.privateKey) {
      errors.push('Private key is required');
    }

    if (data.privateKey && !data.privateKey.startsWith('0x')) {
      errors.push('Private key must start with 0x');
    }

    if (data.privateKey && data.privateKey.length !== 66) {
      errors.push('Private key must be 64 characters (plus 0x prefix)');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
