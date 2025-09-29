import { ethers } from 'ethers';
import { configManager } from '../config';
import { rpcManager } from '../blockchain/rpc';
import { gasManager } from '../tx/gas';
import { nonceManager } from '../tx/nonce';
import { pancakeSwapV2 } from '../dex/pancakeswap-v2';
import { logger } from '../utils/logger';
import { ERC20_ABI } from '../dex/constants';

export interface TransferParams {
  tokenAddress: string; // 'BNB' for native BNB
  recipient: string;
  amount: string; // in wei
  memo?: string;
}

export interface BatchTransferRequest {
  transfers: TransferParams[];
  senderWallets: Array<{
    privateKey: string;
    label?: string;
    maxAmount?: string; // Maximum amount this wallet can send
    enabled?: boolean;
  }>;
  executionStrategy: 'sequential' | 'parallel' | 'round_robin';
  gasStrategy: 'fast' | 'standard' | 'slow' | 'custom';
  customGasPrice?: string; // in gwei
  maxConcurrency?: number;
  delayBetweenTransfers?: number; // milliseconds
  failureStrategy: 'stop_on_failure' | 'continue_on_failure';
  retryAttempts?: number;
  dryRun?: boolean;
}

export interface TransferResult {
  transferIndex: number;
  senderAddress: string;
  senderLabel?: string;
  recipient: string;
  tokenAddress: string;
  amount: string;
  status: 'success' | 'failed' | 'skipped';
  txHash?: string;
  gasUsed?: string;
  gasCost?: string;
  nonce?: number;
  error?: string;
  executionTimeMs: number;
}

export interface BatchTransferResult {
  requestId: string;
  totalTransfers: number;
  successfulTransfers: number;
  failedTransfers: number;
  totalAmountTransferred: Map<string, string>; // token -> total amount
  totalGasUsed: string;
  totalGasCost: string;
  executionTimeMs: number;
  results: TransferResult[];
}

export interface SweepRequest {
  fromWallets: Array<{
    privateKey: string;
    label?: string;
  }>;
  toAddress: string;
  tokenAddresses: string[]; // ['BNB', token1, token2, ...]
  minAmount?: string; // Minimum amount to sweep (in wei)
  maxGasPrice?: string; // in gwei
  leaveGasReserve?: boolean; // Keep some BNB for gas
  gasReserveBNB?: string; // Amount of BNB to leave (default: 0.01 BNB)
}

export interface SweepResult {
  requestId: string;
  totalWallets: number;
  totalTokensSwept: number;
  sweptAmounts: Map<string, string>; // token -> total amount
  totalGasCost: string;
  results: Array<{
    walletAddress: string;
    walletLabel?: string;
    sweptTokens: Array<{
      tokenAddress: string;
      amount: string;
      txHash?: string;
      status: 'success' | 'failed';
      error?: string;
    }>;
  }>;
}

export class BatchTransferEngine {
  private static instance: BatchTransferEngine;
  private provider: ethers.JsonRpcProvider;
  private activeRequests = new Map<string, BatchTransferRequest>();
  private transferResults = new Map<string, BatchTransferResult>();

  private constructor() {
    this.provider = rpcManager.getProvider();
  }

  public static getInstance(): BatchTransferEngine {
    if (!BatchTransferEngine.instance) {
      BatchTransferEngine.instance = new BatchTransferEngine();
    }
    return BatchTransferEngine.instance;
  }

  /**
   * Submit batch transfer request
   */
  async submitBatchTransfer(request: BatchTransferRequest): Promise<string> {
    const requestId = this.generateRequestId();
    
    // Validate request
    const validation = await this.validateBatchTransferRequest(request);
    if (!validation.valid) {
      throw new Error(`Invalid batch transfer request: ${validation.errors.join(', ')}`);
    }

    // Store request
    this.activeRequests.set(requestId, request);

    logger.info({
      requestId,
      transferCount: request.transfers.length,
      senderCount: request.senderWallets.length,
      strategy: request.executionStrategy
    }, 'Batch transfer request submitted');

    // Execute the batch transfer
    try {
      const result = await this.executeBatchTransfer(requestId);
      this.transferResults.set(requestId, result);
      return requestId;
    } catch (error) {
      this.activeRequests.delete(requestId);
      throw error;
    }
  }

  /**
   * Execute batch transfer
   */
  private async executeBatchTransfer(requestId: string): Promise<BatchTransferResult> {
    const request = this.activeRequests.get(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    const startTime = Date.now();
    const results: TransferResult[] = [];
    const totalAmountTransferred = new Map<string, string>();
    let totalGasUsed = BigInt(0);
    let totalGasCost = BigInt(0);

    try {
      // Filter enabled wallets
      const enabledWallets = request.senderWallets.filter(w => w.enabled !== false);
      
      if (enabledWallets.length === 0) {
        throw new Error('No enabled sender wallets found');
      }

      // Execute transfers based on strategy
      switch (request.executionStrategy) {
        case 'sequential':
          await this.executeSequentialTransfers(request, enabledWallets, results);
          break;
        case 'parallel':
          await this.executeParallelTransfers(request, enabledWallets, results);
          break;
        case 'round_robin':
          await this.executeRoundRobinTransfers(request, enabledWallets, results);
          break;
      }

      // Calculate totals
      for (const result of results) {
        if (result.status === 'success') {
          // Track total transferred amounts per token
          const currentTotal = totalAmountTransferred.get(result.tokenAddress) || '0';
          const newTotal = BigInt(currentTotal) + BigInt(result.amount);
          totalAmountTransferred.set(result.tokenAddress, newTotal.toString());

          // Track gas costs
          if (result.gasUsed) totalGasUsed += BigInt(result.gasUsed);
          if (result.gasCost) totalGasCost += BigInt(result.gasCost);
        }
      }

      const batchResult: BatchTransferResult = {
        requestId,
        totalTransfers: results.length,
        successfulTransfers: results.filter(r => r.status === 'success').length,
        failedTransfers: results.filter(r => r.status === 'failed').length,
        totalAmountTransferred,
        totalGasUsed: totalGasUsed.toString(),
        totalGasCost: totalGasCost.toString(),
        executionTimeMs: Date.now() - startTime,
        results
      };

      logger.info({
        requestId,
        successful: batchResult.successfulTransfers,
        failed: batchResult.failedTransfers,
        totalGasCost: ethers.formatEther(totalGasCost)
      }, 'Batch transfer completed');

      return batchResult;

    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Execute transfers sequentially
   */
  private async executeSequentialTransfers(
    request: BatchTransferRequest,
    senderWallets: BatchTransferRequest['senderWallets'],
    results: TransferResult[]
  ): Promise<void> {
    for (let i = 0; i < request.transfers.length; i++) {
      const transfer = request.transfers[i];
      const senderWallet = senderWallets[i % senderWallets.length]; // Round robin wallets

      if (this.shouldStopOnFailure(request, results)) {
        break;
      }

      const result = await this.executeSingleTransfer(senderWallet, transfer, i, request);
      results.push(result);

      // Delay between transfers
      if (request.delayBetweenTransfers && request.delayBetweenTransfers > 0) {
        await new Promise(resolve => setTimeout(resolve, request.delayBetweenTransfers));
      }
    }
  }

  /**
   * Execute transfers in parallel
   */
  private async executeParallelTransfers(
    request: BatchTransferRequest,
    senderWallets: BatchTransferRequest['senderWallets'],
    results: TransferResult[]
  ): Promise<void> {
    const maxConcurrency = request.maxConcurrency || Math.min(5, request.transfers.length);
    const semaphore = new Array(maxConcurrency).fill(false);

    const transferPromises = request.transfers.map(async (transfer, index) => {
      // Wait for available slot
      await this.waitForSemaphore(semaphore);
      
      try {
        const senderWallet = senderWallets[index % senderWallets.length];
        return await this.executeSingleTransfer(senderWallet, transfer, index, request);
      } finally {
        this.releaseSemaphore(semaphore);
      }
    });

    const parallelResults = await Promise.allSettled(transferPromises);
    
    parallelResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          transferIndex: index,
          senderAddress: 'unknown',
          recipient: request.transfers[index].recipient,
          tokenAddress: request.transfers[index].tokenAddress,
          amount: request.transfers[index].amount,
          status: 'failed',
          error: result.reason?.message || 'Unknown error',
          executionTimeMs: 0
        });
      }
    });
  }

  /**
   * Execute transfers with round-robin wallet distribution
   */
  private async executeRoundRobinTransfers(
    request: BatchTransferRequest,
    senderWallets: BatchTransferRequest['senderWallets'],
    results: TransferResult[]
  ): Promise<void> {
    // Group transfers by sender wallet
    const walletTransfers: Array<{ wallet: any; transfers: Array<{ transfer: TransferParams; originalIndex: number }> }> = [];
    
    senderWallets.forEach(wallet => {
      walletTransfers.push({ wallet, transfers: [] });
    });

    // Distribute transfers round-robin style
    request.transfers.forEach((transfer, index) => {
      const walletIndex = index % senderWallets.length;
      walletTransfers[walletIndex].transfers.push({ transfer, originalIndex: index });
    });

    // Execute transfers per wallet in parallel
    const walletPromises = walletTransfers.map(async ({ wallet, transfers }) => {
      const walletResults: TransferResult[] = [];
      
      for (const { transfer, originalIndex } of transfers) {
        const result = await this.executeSingleTransfer(wallet, transfer, originalIndex, request);
        walletResults.push(result);

        // Delay between transfers from same wallet
        if (request.delayBetweenTransfers && request.delayBetweenTransfers > 0) {
          await new Promise(resolve => setTimeout(resolve, request.delayBetweenTransfers));
        }
      }
      
      return walletResults;
    });

    const allWalletResults = await Promise.allSettled(walletPromises);
    
    // Flatten results and sort by original index
    const flatResults: TransferResult[] = [];
    allWalletResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        flatResults.push(...result.value);
      }
    });

    flatResults.sort((a, b) => a.transferIndex - b.transferIndex);
    results.push(...flatResults);
  }

  /**
   * Execute single transfer
   */
  private async executeSingleTransfer(
    senderWallet: BatchTransferRequest['senderWallets'][0],
    transfer: TransferParams,
    transferIndex: number,
    request: BatchTransferRequest
  ): Promise<TransferResult> {
    const startTime = Date.now();
    const wallet = new ethers.Wallet(senderWallet.privateKey, this.provider);

    try {
      logger.debug({
        from: wallet.address,
        to: transfer.recipient,
        token: transfer.tokenAddress,
        amount: transfer.amount,
        transferIndex
      }, 'Executing transfer');

      if (request.dryRun) {
        // Simulate transfer
        await this.validateTransfer(wallet.address, transfer);
        
        return {
          transferIndex,
          senderAddress: wallet.address,
          senderLabel: senderWallet.label,
          recipient: transfer.recipient,
          tokenAddress: transfer.tokenAddress,
          amount: transfer.amount,
          status: 'success',
          executionTimeMs: Date.now() - startTime
        };
      }

      // Validate transfer
      await this.validateTransfer(wallet.address, transfer);

      // Reserve nonce
      const nonce = await nonceManager.reserveNonce(wallet.address);

      // Get gas estimate
      const gasEstimate = await this.estimateTransferGas(transfer, wallet.address);
      
      let tx: ethers.TransactionResponse;

      if (transfer.tokenAddress.toLowerCase() === 'bnb') {
        // Native BNB transfer
        tx = await wallet.sendTransaction({
          to: transfer.recipient,
          value: BigInt(transfer.amount),
          gasLimit: gasEstimate.gasLimit,
          gasPrice: gasEstimate.gasPrice,
          nonce
        });
      } else {
        // ERC20 token transfer
        const tokenContract = new ethers.Contract(transfer.tokenAddress, ERC20_ABI, wallet);
        
        tx = await tokenContract.transfer(transfer.recipient, BigInt(transfer.amount), {
          gasLimit: gasEstimate.gasLimit,
          gasPrice: gasEstimate.gasPrice,
          nonce
        });
      }

      // Wait for confirmation
      const receipt = await tx.wait();
      
      if (!receipt) {
        throw new Error('Transaction receipt not available');
      }

      // Mark nonce as confirmed
      nonceManager.markNonceConfirmed(wallet.address, nonce);

      const gasCost = receipt.gasUsed * (receipt.gasPrice || BigInt(0));

      logger.info({
        txHash: receipt.hash,
        from: wallet.address,
        to: transfer.recipient,
        amount: ethers.formatEther(transfer.amount),
        gasUsed: receipt.gasUsed.toString()
      }, 'Transfer completed successfully');

      return {
        transferIndex,
        senderAddress: wallet.address,
        senderLabel: senderWallet.label,
        recipient: transfer.recipient,
        tokenAddress: transfer.tokenAddress,
        amount: transfer.amount,
        status: 'success',
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        gasCost: gasCost.toString(),
        nonce,
        executionTimeMs: Date.now() - startTime
      };

    } catch (error) {
      logger.warn({
        error,
        from: wallet.address,
        to: transfer.recipient,
        transferIndex
      }, 'Transfer failed');

      return {
        transferIndex,
        senderAddress: wallet.address,
        senderLabel: senderWallet.label,
        recipient: transfer.recipient,
        tokenAddress: transfer.tokenAddress,
        amount: transfer.amount,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Sweep funds from multiple wallets to a single address
   */
  async sweepFunds(request: SweepRequest): Promise<SweepResult> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    
    logger.info({
      requestId,
      fromWallets: request.fromWallets.length,
      toAddress: request.toAddress,
      tokens: request.tokenAddresses.length
    }, 'Starting fund sweep operation');

    const results: SweepResult['results'] = [];
    const sweptAmounts = new Map<string, string>();
    let totalGasCost = BigInt(0);

    try {
      for (const walletConfig of request.fromWallets) {
        const wallet = new ethers.Wallet(walletConfig.privateKey, this.provider);
        const walletResult = {
          walletAddress: wallet.address,
          walletLabel: walletConfig.label,
          sweptTokens: [] as any[]
        };

        for (const tokenAddress of request.tokenAddresses) {
          try {
            const sweepResult = await this.sweepTokenFromWallet(
              wallet,
              tokenAddress,
              request.toAddress,
              request
            );

            if (sweepResult.amount !== '0') {
              // Update total swept amounts
              const currentTotal = sweptAmounts.get(tokenAddress) || '0';
              const newTotal = BigInt(currentTotal) + BigInt(sweepResult.amount);
              sweptAmounts.set(tokenAddress, newTotal.toString());

              if (sweepResult.gasCost) {
                totalGasCost += BigInt(sweepResult.gasCost);
              }
            }

            walletResult.sweptTokens.push(sweepResult);

          } catch (error) {
            logger.warn({
              error,
              wallet: wallet.address,
              token: tokenAddress
            }, 'Failed to sweep token from wallet');

            walletResult.sweptTokens.push({
              tokenAddress,
              amount: '0',
              status: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }

        results.push(walletResult);
      }

      const sweepResult: SweepResult = {
        requestId,
        totalWallets: request.fromWallets.length,
        totalTokensSwept: Array.from(sweptAmounts.keys()).length,
        sweptAmounts,
        totalGasCost: totalGasCost.toString(),
        results
      };

      logger.info({
        requestId,
        totalWallets: sweepResult.totalWallets,
        totalTokensSwept: sweepResult.totalTokensSwept,
        totalGasCost: ethers.formatEther(totalGasCost)
      }, 'Fund sweep operation completed');

      return sweepResult;

    } catch (error) {
      logger.error({ error, requestId }, 'Fund sweep operation failed');
      throw error;
    }
  }

  /**
   * Sweep specific token from a wallet
   */
  private async sweepTokenFromWallet(
    wallet: ethers.Wallet,
    tokenAddress: string,
    toAddress: string,
    request: SweepRequest
  ): Promise<{
    tokenAddress: string;
    amount: string;
    txHash?: string;
    status: 'success' | 'failed' | 'skipped';
    error?: string;
    gasCost?: string;
  }> {
    try {
      let balance: bigint;
      let decimals = 18;

      if (tokenAddress.toLowerCase() === 'bnb') {
        // Native BNB
        balance = await this.provider.getBalance(wallet.address);
        
        // Reserve gas if requested
        if (request.leaveGasReserve !== false) {
          const gasReserve = request.gasReserveBNB ? 
            ethers.parseEther(request.gasReserveBNB) : 
            ethers.parseEther('0.01'); // Default 0.01 BNB
          
          if (balance <= gasReserve) {
            return {
              tokenAddress,
              amount: '0',
              status: 'skipped',
              error: 'Insufficient balance after gas reserve'
            };
          }
          
          balance -= gasReserve;
        }
      } else {
        // ERC20 token
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
        balance = await tokenContract.balanceOf(wallet.address);
        decimals = await tokenContract.decimals();
      }

      // Check minimum amount
      if (request.minAmount && balance < BigInt(request.minAmount)) {
        return {
          tokenAddress,
          amount: '0',
          status: 'skipped',
          error: 'Below minimum sweep amount'
        };
      }

      if (balance === BigInt(0)) {
        return {
          tokenAddress,
          amount: '0',
          status: 'skipped',
          error: 'Zero balance'
        };
      }

      // Execute transfer
      const nonce = await nonceManager.reserveNonce(wallet.address);
      let tx: ethers.TransactionResponse;

      if (tokenAddress.toLowerCase() === 'bnb') {
        // Estimate gas for BNB transfer
        const gasLimit = BigInt(21000);
        const gasPrice = request.maxGasPrice ? 
          ethers.parseUnits(request.maxGasPrice, 'gwei') : 
          (await this.provider.getFeeData()).gasPrice || ethers.parseUnits('5', 'gwei');

        const gasCost = gasLimit * gasPrice;
        const transferAmount = balance - gasCost;

        if (transferAmount <= 0) {
          return {
            tokenAddress,
            amount: '0',
            status: 'failed',
            error: 'Insufficient balance for gas'
          };
        }

        tx = await wallet.sendTransaction({
          to: toAddress,
          value: transferAmount,
          gasLimit,
          gasPrice,
          nonce
        });
      } else {
        // ERC20 transfer
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
        
        const gasEstimate = await gasManager.getGasEstimate(
          tokenAddress,
          tokenContract.interface.encodeFunctionData('transfer', [toAddress, balance]),
          BigInt(0),
          wallet.address
        );

        tx = await tokenContract.transfer(toAddress, balance, {
          gasLimit: gasEstimate.gasLimit,
          gasPrice: gasEstimate.gasPrice,
          nonce
        });
      }

      const receipt = await tx.wait();
      
      if (!receipt) {
        throw new Error('Transaction receipt not available');
      }

      nonceManager.markNonceConfirmed(wallet.address, nonce);
      
      const gasCost = receipt.gasUsed * (receipt.gasPrice || BigInt(0));

      return {
        tokenAddress,
        amount: balance.toString(),
        txHash: receipt.hash,
        status: 'success',
        gasCost: gasCost.toString()
      };

    } catch (error) {
      return {
        tokenAddress,
        amount: '0',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Validation and utility methods
   */
  private async validateTransfer(senderAddress: string, transfer: TransferParams): Promise<void> {
    // Validate recipient address
    if (!ethers.isAddress(transfer.recipient)) {
      throw new Error(`Invalid recipient address: ${transfer.recipient}`);
    }

    // Check sender balance
    let balance: bigint;
    
    if (transfer.tokenAddress.toLowerCase() === 'bnb') {
      balance = await this.provider.getBalance(senderAddress);
    } else {
      const tokenContract = new ethers.Contract(transfer.tokenAddress, ERC20_ABI, this.provider);
      balance = await tokenContract.balanceOf(senderAddress);
    }

    if (balance < BigInt(transfer.amount)) {
      throw new Error(`Insufficient balance: ${balance} < ${transfer.amount}`);
    }
  }

  private async estimateTransferGas(transfer: TransferParams, fromAddress: string) {
    if (transfer.tokenAddress.toLowerCase() === 'bnb') {
      // BNB transfer
      return await gasManager.getGasEstimate(
        transfer.recipient,
        '0x',
        BigInt(transfer.amount),
        fromAddress
      );
    } else {
      // ERC20 transfer
      const tokenContract = new ethers.Contract(transfer.tokenAddress, ERC20_ABI);
      const data = tokenContract.interface.encodeFunctionData('transfer', [
        transfer.recipient,
        BigInt(transfer.amount)
      ]);

      return await gasManager.getGasEstimate(
        transfer.tokenAddress,
        data,
        BigInt(0),
        fromAddress
      );
    }
  }

  private async validateBatchTransferRequest(request: BatchTransferRequest): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!request.transfers || request.transfers.length === 0) {
      errors.push('No transfers specified');
    }

    if (!request.senderWallets || request.senderWallets.length === 0) {
      errors.push('No sender wallets specified');
    }

    // Validate transfers
    for (let i = 0; i < request.transfers.length; i++) {
      const transfer = request.transfers[i];
      
      if (!ethers.isAddress(transfer.recipient)) {
        errors.push(`Transfer ${i}: Invalid recipient address`);
      }
      
      if (!transfer.amount || BigInt(transfer.amount) <= 0) {
        errors.push(`Transfer ${i}: Invalid amount`);
      }
    }

    // Validate wallets
    for (let i = 0; i < request.senderWallets.length; i++) {
      const wallet = request.senderWallets[i];
      
      try {
        new ethers.Wallet(wallet.privateKey);
      } catch (error) {
        errors.push(`Sender wallet ${i}: Invalid private key`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  // Helper methods
  private generateRequestId(): string {
    return `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private shouldStopOnFailure(request: BatchTransferRequest, results: TransferResult[]): boolean {
    return request.failureStrategy === 'stop_on_failure' && 
           results.some(r => r.status === 'failed');
  }

  private async waitForSemaphore(semaphore: boolean[]): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const index = semaphore.findIndex(slot => !slot);
        if (index >= 0) {
          semaphore[index] = true;
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  private releaseSemaphore(semaphore: boolean[]): void {
    const index = semaphore.findIndex(slot => slot);
    if (index >= 0) {
      semaphore[index] = false;
    }
  }

  /**
   * Get transfer result
   */
  getTransferResult(requestId: string): BatchTransferResult | undefined {
    return this.transferResults.get(requestId);
  }
}

export const batchTransferEngine = BatchTransferEngine.getInstance();