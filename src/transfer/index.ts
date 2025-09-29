import { createWalletClient, createPublicClient, http, parseEther, parseUnits, formatEther, formatUnits } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from 'fs/promises';
import { parse } from 'csv-parse/sync';
import { WalletManager, WalletInfo } from '../wallet';
import { logger, logTransaction } from '../utils/logger';
import { configManager } from '../config';

export interface TransferOptions {
  from: string;
  to: string;
  amount: string;
  token?: string; // Contract address, undefined for BNB
  gasPrice?: number; // In gwei
  dryRun?: boolean;
}

export interface TransferResult {
  success: boolean;
  from: string;
  to: string;
  amount: string;
  token?: string;
  txHash?: string;
  gasUsed?: string;
  gasPrice: string;
  error?: string;
}

export interface BatchTransferOptions {
  csvPath: string;
  dryRun?: boolean;
  maxConcurrent?: number;
}

interface CSVTransferRow {
  from: string;
  to: string;
  amount: string;
  token?: string;
  gasPrice?: string;
}

export class TransferManager {
  private walletManager: WalletManager;
  private publicClient: any;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
    
    const rpcUrls = configManager.rpcUrls;
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrls[0]),
    });
  }

  private createWalletClient(wallet: WalletInfo) {
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const rpcUrls = configManager.rpcUrls;
    
    return createWalletClient({
      account,
      chain: bsc,
      transport: http(rpcUrls[0]),
    });
  }

  async sendSingle(options: TransferOptions): Promise<TransferResult> {
    const fromWallet = this.walletManager.getWallet(options.from);
    if (!fromWallet) {
      throw new Error(`Wallet ${options.from} not found`);
    }

    const walletClient = this.createWalletClient(fromWallet);
    const txLogger = logTransaction('pending', 'transfer', {
      from: options.from,
      to: options.to,
      amount: options.amount,
      token: options.token,
    });

    try {
      let txHash: string;
      let gasUsed: string | undefined;
      const gasPriceGwei = options.gasPrice || configManager.config.gas.priority_fee_gwei;
      const gasPriceWei = BigInt(gasPriceGwei * 1e9);

      if (options.token) {
        // ERC20 token transfer
        const decimals = await this.getTokenDecimals(options.token);
        const amount = parseUnits(options.amount, decimals);

        if (options.dryRun) {
          // Simulate the transaction
          await this.publicClient.simulateContract({
            address: options.token as `0x${string}`,
            abi: [
              {
                name: 'transfer',
                type: 'function',
                inputs: [
                  { name: 'to', type: 'address' },
                  { name: 'amount', type: 'uint256' }
                ],
                outputs: [{ name: '', type: 'bool' }],
                stateMutability: 'nonpayable',
              }
            ],
            functionName: 'transfer',
            args: [options.to as `0x${string}`, amount],
            account: walletClient.account,
            gasPrice: gasPriceWei,
          });

          txLogger.info('Token transfer simulation successful');
          return {
            success: true,
            from: options.from,
            to: options.to,
            amount: options.amount,
            token: options.token,
            gasPrice: gasPriceGwei.toString(),
          };
        }

        // Actual ERC20 transfer
        txHash = await walletClient.writeContract({
          address: options.token as `0x${string}`,
          abi: [
            {
              name: 'transfer',
              type: 'function',
              inputs: [
                { name: 'to', type: 'address' },
                { name: 'amount', type: 'uint256' }
              ],
              outputs: [{ name: '', type: 'bool' }],
              stateMutability: 'nonpayable',
            }
          ],
          functionName: 'transfer',
          args: [options.to as `0x${string}`, amount],
          gasPrice: gasPriceWei,
        });

      } else {
        // BNB transfer
        const amount = parseEther(options.amount);

        if (options.dryRun) {
          // Check balance
          const balance = await this.publicClient.getBalance({
            address: options.from as `0x${string}`,
          });

          if (balance < amount) {
            throw new Error(`Insufficient BNB balance: ${formatEther(balance)} < ${options.amount}`);
          }

          txLogger.info('BNB transfer simulation successful');
          return {
            success: true,
            from: options.from,
            to: options.to,
            amount: options.amount,
            gasPrice: gasPriceGwei.toString(),
          };
        }

        // Actual BNB transfer
        txHash = await walletClient.sendTransaction({
          to: options.to as `0x${string}`,
          value: amount,
          gasPrice: gasPriceWei,
        });
      }

      // Wait for transaction receipt
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      gasUsed = receipt.gasUsed.toString();
      txLogger.info({ txHash, gasUsed }, 'Transfer successful');

      return {
        success: true,
        from: options.from,
        to: options.to,
        amount: options.amount,
        token: options.token,
        txHash,
        gasUsed,
        gasPrice: gasPriceGwei.toString(),
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      txLogger.error({ error }, 'Transfer failed');
      
      return {
        success: false,
        from: options.from,
        to: options.to,
        amount: options.amount,
        token: options.token,
        gasPrice: (options.gasPrice || configManager.config.gas.priority_fee_gwei).toString(),
        error: errorMessage,
      };
    }
  }

  async sendBatch(options: BatchTransferOptions): Promise<TransferResult[]> {
    const transferData = await this.loadTransfersFromCSV(options.csvPath);
    const maxConcurrent = options.maxConcurrent || 5;
    const results: TransferResult[] = [];

    logger.info(`Starting batch transfer: ${transferData.length} transfers, max concurrent: ${maxConcurrent}`);

    // Process transfers in batches
    for (let i = 0; i < transferData.length; i += maxConcurrent) {
      const batch = transferData.slice(i, i + maxConcurrent);
      const batchPromises = batch.map(transfer => 
        this.sendSingle({
          from: transfer.from,
          to: transfer.to,
          amount: transfer.amount,
          token: transfer.token,
          gasPrice: transfer.gasPrice ? parseFloat(transfer.gasPrice) : undefined,
          dryRun: options.dryRun,
        })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      logger.info(`Processed batch ${Math.ceil((i + maxConcurrent) / maxConcurrent)}/${Math.ceil(transferData.length / maxConcurrent)}`);
      
      // Small delay between batches to avoid overwhelming the RPC
      if (i + maxConcurrent < transferData.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const successful = results.filter(r => r.success).length;
    logger.info(`Batch transfer completed: ${successful}/${results.length} successful`);

    return results;
  }

  private async loadTransfersFromCSV(csvPath: string): Promise<CSVTransferRow[]> {
    try {
      const csvContent = await fs.readFile(csvPath, 'utf8');
      const records = parse(csvContent, {
        columns: true,
        skipEmptyLines: true,
        trim: true,
      });

      return records.map((record: any) => ({
        from: record.from,
        to: record.to,
        amount: record.amount,
        token: record.token || undefined,
        gasPrice: record.gasPrice || undefined,
      }));
    } catch (error) {
      throw new Error(`Failed to load CSV file: ${error}`);
    }
  }

  private async getTokenDecimals(tokenAddress: string): Promise<number> {
    try {
      const decimals = await this.publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: [
          {
            name: 'decimals',
            type: 'function',
            inputs: [],
            outputs: [{ name: '', type: 'uint8' }],
            stateMutability: 'view',
          }
        ],
        functionName: 'decimals',
      });
      
      return Number(decimals);
    } catch (error) {
      logger.warn({ tokenAddress, error }, 'Failed to get token decimals, using 18');
      return 18; // Default to 18 decimals
    }
  }
}