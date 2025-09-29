import { createWalletClient, createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { WalletInfo } from '../wallet';
import { nonceManager, NonceManager } from './nonce';
import { gasManager, GasManager, GasOptions } from './gas';
import { retryManager, RetryManager } from './retry';
import { configManager } from '../config';
import { logger, logTransaction } from '../utils/logger';
import { TransactionModel } from '../persistence/models/Transaction';

export interface TransactionRequest {
  from: string;
  to: string;
  data?: string;
  value?: bigint;
  gasOptions?: GasOptions;
  dryRun?: boolean;
  description?: string;
}

export interface TransactionResult {
  success: boolean;
  txHash?: string;
  nonce?: number;
  gasUsed?: string;
  gasPrice: string;
  blockNumber?: string;
  error?: string;
  attempts?: number;
}

export interface PipelineStats {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  averageAttempts: number;
  averageGasUsed: string;
  nonceRepairs: number;
  gasReplacements: number;
}

export class TransactionPipeline {
  private walletManager: any;
  private publicClient: any;
  private nonceManager: NonceManager;
  private gasManager: GasManager;
  private retryManager: RetryManager;
  private stats: PipelineStats;

  constructor(walletManager: any) {
    this.walletManager = walletManager;
    
    const rpcUrls = configManager.rpcUrls;
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrls[0]),
    });

    this.nonceManager = nonceManager;
    this.gasManager = gasManager;
    this.retryManager = retryManager;
    
    this.stats = {
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      averageAttempts: 0,
      averageGasUsed: '0',
      nonceRepairs: 0,
      gasReplacements: 0,
    };
  }

  async submitTransaction(
    wallet: WalletInfo,
    request: TransactionRequest
  ): Promise<TransactionResult> {
    const txLogger = logTransaction('pending', 'pipeline_submit', {
      from: request.from,
      to: request.to,
      description: request.description,
    });

    this.stats.totalTransactions++;

    try {
      // Validate wallet
      if (wallet.address.toLowerCase() !== request.from.toLowerCase()) {
        throw new Error('Wallet address mismatch');
      }

      // Create wallet client
      const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
      const rpcUrls = configManager.rpcUrls;
      const walletClient = createWalletClient({
        account,
        chain: bsc,
        transport: http(rpcUrls[0]),
      });

      // Get gas estimate
      const gasEstimate = await this.gasManager.getGasEstimate(
        request.to,
        request.data || '0x',
        request.value || BigInt(0),
        request.from,
        request.gasOptions
      );

      // Validate gas price
      const gasValidation = this.gasManager.validateGasPrice(gasEstimate.gasPrice);
      if (!gasValidation.valid) {
        throw new Error(`Invalid gas price: ${gasValidation.reason}`);
      }

      if (request.dryRun) {
        return await this.simulateTransaction(request, gasEstimate, walletClient);
      }

      // Execute transaction with retry logic
      const result = await this.retryManager.retryTransaction(
        () => this.executeTransaction(request, gasEstimate, walletClient),
        `transaction_${request.description || 'unknown'}`,
      );

      if (result.success && result.result) {
        this.stats.successfulTransactions++;
        return result.result;
      } else {
        this.stats.failedTransactions++;
        throw result.error || new Error('Transaction failed without specific error');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      txLogger.error({ error }, 'Transaction pipeline failed');
      
      this.stats.failedTransactions++;
      
      return {
        success: false,
        gasPrice: request.gasOptions?.gasPrice?.toString() || '0',
        error: errorMessage,
      };
    }
  }

  private async simulateTransaction(
    request: TransactionRequest,
    gasEstimate: any,
    walletClient: any
  ): Promise<TransactionResult> {
    try {
      // Simulate the transaction
      await this.publicClient.call({
        to: request.to as `0x${string}`,
        data: request.data as `0x${string}`,
        value: request.value || BigInt(0),
        account: walletClient.account.address,
        gasPrice: gasEstimate.gasPrice,
        gas: gasEstimate.gasLimit,
      });

      logger.info({ 
        from: request.from,
        to: request.to,
        estimatedGas: gasEstimate.gasLimit.toString(),
        estimatedCostBNB: gasEstimate.estimatedCostBNB
      }, 'Transaction simulation successful');

      return {
        success: true,
        gasPrice: gasEstimate.gasPrice.toString(),
      };

    } catch (error) {
      logger.error({ error, request }, 'Transaction simulation failed');
      return {
        success: false,
        gasPrice: gasEstimate.gasPrice.toString(),
        error: error instanceof Error ? error.message : 'Simulation failed',
      };
    }
  }

  private async executeTransaction(
    request: TransactionRequest,
    gasEstimate: any,
    walletClient: any
  ): Promise<TransactionResult> {
    // Reserve nonce
    const nonce = await this.nonceManager.reserveNonce(request.from);
    
    try {
      // Submit transaction
      const txHash = await walletClient.sendTransaction({
        to: request.to as `0x${string}`,
        data: request.data as `0x${string}`,
        value: request.value || BigInt(0),
        nonce,
        gasPrice: gasEstimate.gasPrice,
        gas: gasEstimate.gasLimit,
      });

      // Create transaction record
      await TransactionModel.create({
        tx_hash: txHash,
        from_address: request.from,
        to_address: request.to,
        amount: (request.value || BigInt(0)).toString(),
        gas_price: gasEstimate.gasPrice.toString(),
        operation_type: 'transfer', // This should be set based on the operation
        status: 'pending',
      });

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
        timeout: 60000, // 60 seconds
      });

      // Mark nonce as confirmed
      this.nonceManager.markNonceConfirmed(request.from, nonce);

      // Update transaction record
      await TransactionModel.updateStatus(txHash, 'confirmed', {
        gas_used: receipt.gasUsed.toString(),
        block_number: receipt.blockNumber.toString(),
        transaction_fee: (receipt.gasUsed * gasEstimate.gasPrice).toString(),
      });

      logger.info({ 
        txHash, 
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber.toString(),
        nonce 
      }, 'Transaction confirmed');

      return {
        success: true,
        txHash,
        nonce,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: gasEstimate.gasPrice.toString(),
        blockNumber: receipt.blockNumber.toString(),
      };

    } catch (error) {
      // Mark nonce as failed
      this.nonceManager.markNonceFailed(request.from, nonce);

      // Handle specific error types
      if (this.retryManager.shouldRepairNonce(error as Error)) {
        logger.warn({ error, address: request.from }, 'Repairing nonces due to error');
        await this.nonceManager.repairNonces(request.from);
        this.stats.nonceRepairs++;
      }

      if (this.retryManager.shouldIncreaseGasPrice(error as Error)) {
        logger.warn({ error }, 'Gas price may need to be increased');
        this.stats.gasReplacements++;
      }

      throw error;
    }
  }

  async repairNonces(address: string): Promise<{repaired: number, cleaned: number}> {
    const result = await this.nonceManager.repairNonces(address);
    this.stats.nonceRepairs += result.repaired;
    return result;
  }

  async getTransactionStatus(txHash: string): Promise<{
    status: 'pending' | 'confirmed' | 'failed';
    receipt?: any;
    error?: string;
  }> {
    try {
      const receipt = await this.publicClient.getTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      return {
        status: receipt.status === 'success' ? 'confirmed' : 'failed',
        receipt,
      };

    } catch (error) {
      // Transaction might still be pending
      try {
        const tx = await this.publicClient.getTransaction({
          hash: txHash as `0x${string}`,
        });
        
        return {
          status: 'pending',
        };
      } catch (txError) {
        return {
          status: 'failed',
          error: 'Transaction not found',
        };
      }
    }
  }

  async cancelOrReplaceTransaction(
    originalTxHash: string,
    wallet: WalletInfo,
    replacement?: TransactionRequest
  ): Promise<TransactionResult> {
    try {
      // Get original transaction
      const originalTx = await this.publicClient.getTransaction({
        hash: originalTxHash as `0x${string}`,
      });

      // Calculate replacement gas price
      const newGasPrice = this.gasManager.getReplacementGasPrice(originalTx.gasPrice);

      // Create replacement transaction (cancel = send 0 to self, replace = new transaction)
      const replacementRequest: TransactionRequest = replacement || {
        from: wallet.address,
        to: wallet.address, // Self-send for cancellation
        value: BigInt(0),
        data: '0x',
      };

      // Use same nonce as original transaction
      const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
      const rpcUrls = configManager.rpcUrls;
      const walletClient = createWalletClient({
        account,
        chain: bsc,
        transport: http(rpcUrls[0]),
      });

      const replacementTxHash = await walletClient.sendTransaction({
        to: replacementRequest.to as `0x${string}`,
        data: replacementRequest.data as `0x${string}`,
        value: replacementRequest.value || BigInt(0),
        nonce: originalTx.nonce,
        gasPrice: newGasPrice,
        gas: BigInt(21000), // Standard gas limit
      });

      logger.info({ 
        originalTxHash,
        replacementTxHash,
        nonce: originalTx.nonce,
        newGasPrice: newGasPrice.toString()
      }, replacement ? 'Transaction replaced' : 'Transaction cancelled');

      this.stats.gasReplacements++;

      return {
        success: true,
        txHash: replacementTxHash,
        nonce: originalTx.nonce,
        gasPrice: newGasPrice.toString(),
      };

    } catch (error) {
      logger.error({ error, originalTxHash }, 'Failed to cancel/replace transaction');
      return {
        success: false,
        gasPrice: '0',
        error: error instanceof Error ? error.message : 'Cancel/replace failed',
      };
    }
  }

  getStats(): PipelineStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalTransactions: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      averageAttempts: 0,
      averageGasUsed: '0',
      nonceRepairs: 0,
      gasReplacements: 0,
    };
  }

  // Clean up resources
  cleanup(): void {
    this.gasManager.clearCache();
    this.nonceManager.cleanupOldStates();
  }
}

export default TransactionPipeline;