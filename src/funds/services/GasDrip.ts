import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import { 
  GasTopUpJob, 
  WalletConfig, 
  TreasuryAccount, 
  FundsAlert,
  BalanceSnapshot
} from '../types';

export interface GasDripConfig {
  enabled: boolean;
  check_interval_ms: number;
  max_concurrent_jobs: number;
  min_gas_bnb: string;
  max_gas_bnb: string;
  gas_buffer_bnb: string; // Buffer to add above min threshold
  treasury_address: string;
  gas_price_multiplier: number; // Multiplier for gas price
  dry_run: boolean; // If true, jobs are created but not executed
}

export class GasDripService extends EventEmitter {
  private static instance: GasDripService;
  private provider: ethers.Provider;
  private signer: ethers.Wallet;
  private config: GasDripConfig;
  private running = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private processingJobs = new Set<string>();

  private constructor(
    provider: ethers.Provider, 
    signer: ethers.Wallet, 
    config: GasDripConfig
  ) {
    super();
    this.provider = provider;
    this.signer = signer;
    this.config = config;
  }

  public static getInstance(
    provider?: ethers.Provider, 
    signer?: ethers.Wallet, 
    config?: GasDripConfig
  ): GasDripService {
    if (!GasDripService.instance) {
      if (!provider || !signer || !config) {
        throw new Error('Provider, signer, and config required for GasDripService initialization');
      }
      GasDripService.instance = new GasDripService(provider, signer, config);
    }
    return GasDripService.instance;
  }

  async start(): Promise<void> {
    if (this.running || !this.config.enabled) {
      logger.warn('GasDripService is already running or disabled');
      return;
    }

    logger.info('Starting GasDripService');
    this.running = true;

    // Process existing pending jobs
    await this.processPendingJobs();

    // Start periodic check for new gas top-up needs
    this.checkInterval = setInterval(async () => {
      try {
        await this.checkAndCreateTopUpJobs();
        await this.processPendingJobs();
      } catch (error) {
        logger.error({ error }, 'Error in GasDripService check cycle');
        this.emit('error', error);
      }
    }, this.config.check_interval_ms);

    logger.info({ 
      intervalMs: this.config.check_interval_ms,
      dryRun: this.config.dry_run 
    }, 'GasDripService started');
    
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('Stopping GasDripService');
    this.running = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Wait for ongoing jobs to complete
    while (this.processingJobs.size > 0) {
      logger.info({ processingJobs: this.processingJobs.size }, 'Waiting for gas drip jobs to complete');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('GasDripService stopped');
    this.emit('stopped');
  }

  async checkAndCreateTopUpJobs(): Promise<GasTopUpJob[]> {
    logger.debug('Checking for wallets needing gas top-up');
    
    try {
      // Get wallets with low BNB balance
      const walletsNeedingGas = await this.getWalletsNeedingGas();
      const createdJobs: GasTopUpJob[] = [];

      for (const snapshot of walletsNeedingGas) {
        try {
          // Check if there's already a pending job for this wallet
          const existingJob = await this.getExistingJob(snapshot.wallet_address);
          if (existingJob) {
            logger.debug({ 
              wallet: snapshot.wallet_address,
              existingJobId: existingJob.id 
            }, 'Existing gas top-up job found, skipping');
            continue;
          }

          // Calculate top-up amount
          const topUpAmount = await this.calculateTopUpAmount(snapshot);
          if (!topUpAmount || topUpAmount <= 0n) {
            continue;
          }

          // Create gas top-up job
          const job = await this.createTopUpJob(snapshot.wallet_address, topUpAmount);
          createdJobs.push(job);

          logger.info({ 
            jobId: job.id,
            wallet: job.target_wallet,
            amount: ethers.formatEther(job.amount_bnb)
          }, 'Gas top-up job created');

        } catch (error) {
          logger.error({ 
            error, 
            wallet: snapshot.wallet_address 
          }, 'Failed to create gas top-up job for wallet');
        }
      }

      if (createdJobs.length > 0) {
        this.emit('jobsCreated', { jobs: createdJobs, count: createdJobs.length });
      }

      return createdJobs;

    } catch (error) {
      logger.error({ error }, 'Failed to check and create gas top-up jobs');
      throw error;
    }
  }

  async processPendingJobs(): Promise<void> {
    try {
      // Get pending jobs
      const pendingJobs = await this.getPendingJobs();
      
      // Limit concurrent processing
      const availableSlots = this.config.max_concurrent_jobs - this.processingJobs.size;
      const jobsToProcess = pendingJobs.slice(0, availableSlots);

      for (const job of jobsToProcess) {
        if (!this.running) break;
        
        // Process job in background
        this.processJob(job).catch(error => {
          logger.error({ error, jobId: job.id }, 'Failed to process gas top-up job');
        });
      }

    } catch (error) {
      logger.error({ error }, 'Failed to process pending gas top-up jobs');
    }
  }

  private async processJob(job: GasTopUpJob): Promise<void> {
    if (this.processingJobs.has(job.id)) {
      return; // Already processing
    }

    this.processingJobs.add(job.id);
    
    try {
      logger.info({ 
        jobId: job.id,
        targetWallet: job.target_wallet,
        amount: ethers.formatEther(job.amount_bnb)
      }, 'Processing gas top-up job');

      // Update job status
      await this.updateJobStatus(job.id, 'processing');

      if (this.config.dry_run) {
        logger.info({ jobId: job.id }, 'Dry run mode - skipping actual transaction');
        await this.updateJobStatus(job.id, 'completed', undefined, '0', 'DRY_RUN');
        this.emit('jobCompleted', { ...job, status: 'completed' });
        return;
      }

      // Execute the transaction
      const result = await this.executeTopUp(job);
      
      // Update job with results
      await this.updateJobStatus(
        job.id, 
        'completed', 
        result.txHash, 
        result.gasUsed.toString()
      );

      logger.info({ 
        jobId: job.id,
        txHash: result.txHash,
        gasUsed: result.gasUsed.toString()
      }, 'Gas top-up job completed successfully');

      this.emit('jobCompleted', { ...job, status: 'completed', tx_hash: result.txHash });

    } catch (error) {
      logger.error({ error, jobId: job.id }, 'Gas top-up job failed');
      
      await this.updateJobStatus(
        job.id, 
        'failed', 
        undefined, 
        undefined, 
        error instanceof Error ? error.message : String(error)
      );

      this.emit('jobFailed', { ...job, status: 'failed', error_message: (error as Error).message });
      
    } finally {
      this.processingJobs.delete(job.id);
    }
  }

  private async executeTopUp(job: GasTopUpJob): Promise<{ txHash: string; gasUsed: bigint }> {
    try {
      // Validate treasury has sufficient balance
      const treasuryBalance = await this.provider.getBalance(job.from_wallet);
      const requiredAmount = ethers.parseEther(job.amount_bnb);
      
      if (treasuryBalance < requiredAmount) {
        throw new Error(`Treasury balance insufficient: ${ethers.formatEther(treasuryBalance)} < ${job.amount_bnb}`);
      }

      // Prepare transaction
      const gasPrice = await this.provider.getFeeData();
      const adjustedGasPrice = gasPrice.gasPrice ? 
        (gasPrice.gasPrice * BigInt(Math.floor(this.config.gas_price_multiplier * 100))) / 100n :
        undefined;

      const tx = {
        to: job.target_wallet,
        value: requiredAmount,
        gasPrice: adjustedGasPrice,
        gasLimit: 21000n // Standard ETH transfer gas limit
      };

      logger.debug({ 
        jobId: job.id,
        tx,
        gasPrice: adjustedGasPrice?.toString()
      }, 'Sending gas top-up transaction');

      // Send transaction
      const txResponse = await this.signer.sendTransaction(tx);
      
      logger.info({ 
        jobId: job.id,
        txHash: txResponse.hash 
      }, 'Gas top-up transaction sent, waiting for confirmation');

      // Wait for confirmation
      const receipt = await txResponse.wait();
      
      if (!receipt) {
        throw new Error('Transaction receipt not received');
      }

      if (receipt.status !== 1) {
        throw new Error(`Transaction failed with status: ${receipt.status}`);
      }

      return {
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed
      };

    } catch (error) {
      logger.error({ error, jobId: job.id }, 'Failed to execute gas top-up transaction');
      throw error;
    }
  }

  private async getWalletsNeedingGas(): Promise<BalanceSnapshot[]> {
    // Get latest BNB balance snapshots that are below threshold
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('balance_snapshots')
      .select('*')
      .where('asset_symbol', 'BNB')
      .where('is_below_threshold', true)
      .whereIn('id', function() {
        this.select(database.connection!.raw('MAX(id)'))
          .from('balance_snapshots')
          .where('asset_symbol', 'BNB')
          .groupBy('wallet_address');
      });

    return rows as BalanceSnapshot[];
  }

  private async getExistingJob(walletAddress: string): Promise<GasTopUpJob | null> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const row = await database.connection!('gas_topup_jobs')
      .where('target_wallet', walletAddress)
      .whereIn('status', ['pending', 'processing'])
      .orderBy('created_at', 'desc')
      .first();

    return row || null;
  }

  private async calculateTopUpAmount(snapshot: BalanceSnapshot): Promise<bigint> {
    const currentBalance = BigInt(snapshot.balance);
    const minThreshold = ethers.parseEther(this.config.min_gas_bnb);
    const maxThreshold = ethers.parseEther(this.config.max_gas_bnb);
    const buffer = ethers.parseEther(this.config.gas_buffer_bnb);

    // If already above min threshold, no top-up needed
    if (currentBalance >= minThreshold) {
      return 0n;
    }

    // Calculate amount to reach min threshold + buffer, but not exceed max
    const targetBalance = minThreshold + buffer;
    const topUpAmount = targetBalance - currentBalance;

    // Ensure we don't exceed max threshold
    if (currentBalance + topUpAmount > maxThreshold) {
      return maxThreshold - currentBalance;
    }

    return topUpAmount;
  }

  private async createTopUpJob(targetWallet: string, amount: bigint): Promise<GasTopUpJob> {
    const job: GasTopUpJob = {
      id: `gastopup_${targetWallet}_${Date.now()}`,
      target_wallet: targetWallet,
      from_wallet: this.config.treasury_address,
      amount_bnb: ethers.formatEther(amount),
      status: 'pending',
      created_at: new Date()
    };

    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('gas_topup_jobs').insert({
      id: job.id,
      target_wallet: job.target_wallet,
      from_wallet: job.from_wallet,
      amount_bnb: job.amount_bnb,
      status: job.status,
      created_at: job.created_at
    });

    return job;
  }

  private async getPendingJobs(): Promise<GasTopUpJob[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('gas_topup_jobs')
      .where('status', 'pending')
      .orderBy('created_at', 'asc')
      .limit(this.config.max_concurrent_jobs * 2); // Get extra in case some are already processing

    return rows as GasTopUpJob[];
  }

  private async updateJobStatus(
    jobId: string, 
    status: 'processing' | 'completed' | 'failed',
    txHash?: string,
    gasUsed?: string,
    errorMessage?: string
  ): Promise<void> {
    const updates: any = {
      status,
      updated_at: new Date()
    };

    if (txHash) updates.tx_hash = txHash;
    if (gasUsed) updates.gas_used = gasUsed;
    if (errorMessage) updates.error_message = errorMessage;
    if (status === 'completed' || status === 'failed') {
      updates.completed_at = new Date();
    }

    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('gas_topup_jobs')
      .where('id', jobId)
      .update(updates);
  }

  // Public API methods
  async createManualTopUp(targetWallet: string, amount: string): Promise<GasTopUpJob> {
    logger.info({ targetWallet, amount }, 'Creating manual gas top-up job');
    
    const amountWei = ethers.parseEther(amount);
    return await this.createTopUpJob(targetWallet, amountWei);
  }

  async getJobHistory(targetWallet?: string, limit: number = 50): Promise<GasTopUpJob[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    let query = database.connection!('gas_topup_jobs')
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (targetWallet) {
      query = query.where('target_wallet', targetWallet);
    }

    const rows = await query;
    return rows as GasTopUpJob[];
  }

  async cancelJob(jobId: string): Promise<boolean> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const job = await database.connection!('gas_topup_jobs')
      .where('id', jobId)
      .first();

    if (!job || job.status !== 'pending') {
      return false;
    }

    await this.updateJobStatus(jobId, 'failed', undefined, undefined, 'CANCELLED_BY_USER');
    
    logger.info({ jobId }, 'Gas top-up job cancelled');
    this.emit('jobCancelled', { ...job, status: 'cancelled' });
    
    return true;
  }

  getStatus(): {
    running: boolean;
    enabled: boolean;
    dryRun: boolean;
    processingJobs: number;
    maxConcurrentJobs: number;
    checkIntervalMs: number;
  } {
    return {
      running: this.running,
      enabled: this.config.enabled,
      dryRun: this.config.dry_run,
      processingJobs: this.processingJobs.size,
      maxConcurrentJobs: this.config.max_concurrent_jobs,
      checkIntervalMs: this.config.check_interval_ms
    };
  }
}