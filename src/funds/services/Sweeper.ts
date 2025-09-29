import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import { 
  SweepJob, 
  WalletConfig, 
  BalanceSnapshot,
  FundsAlert
} from '../types';

export interface SweeperConfig {
  enabled: boolean;
  check_interval_ms: number;
  max_concurrent_jobs: number;
  sweep_min_threshold: string; // Minimum balance to trigger sweep
  leaving_amount: string; // Amount to leave in source wallet
  treasury_address: string;
  gas_price_multiplier: number;
  dry_run: boolean;
  supported_assets: string[];
  whitelist_wallets?: string[]; // Only sweep from these wallets
  blacklist_wallets?: string[]; // Never sweep from these wallets
}

// ERC20 ABI for token transfers
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

export class SweeperService extends EventEmitter {
  private static instance: SweeperService;
  private provider: ethers.Provider;
  private signer: ethers.Wallet;
  private config: SweeperConfig;
  private running = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private processingJobs = new Set<string>();

  private constructor(
    provider: ethers.Provider,
    signer: ethers.Wallet,
    config: SweeperConfig
  ) {
    super();
    this.provider = provider;
    this.signer = signer;
    this.config = config;
  }

  public static getInstance(
    provider?: ethers.Provider,
    signer?: ethers.Wallet,
    config?: SweeperConfig
  ): SweeperService {
    if (!SweeperService.instance) {
      if (!provider || !signer || !config) {
        throw new Error('Provider, signer, and config required for SweeperService initialization');
      }
      SweeperService.instance = new SweeperService(provider, signer, config);
    }
    return SweeperService.instance;
  }

  async start(): Promise<void> {
    if (this.running || !this.config.enabled) {
      logger.warn('SweeperService is already running or disabled');
      return;
    }

    logger.info('Starting SweeperService');
    this.running = true;

    // Process existing pending jobs
    await this.processPendingJobs();

    // Start periodic sweep checks
    this.checkInterval = setInterval(async () => {
      try {
        await this.checkAndCreateSweepJobs();
        await this.processPendingJobs();
      } catch (error) {
        logger.error({ error }, 'Error in SweeperService check cycle');
        this.emit('error', error);
      }
    }, this.config.check_interval_ms);

    logger.info({
      intervalMs: this.config.check_interval_ms,
      dryRun: this.config.dry_run,
      supportedAssets: this.config.supported_assets
    }, 'SweeperService started');

    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('Stopping SweeperService');
    this.running = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Wait for ongoing jobs to complete
    while (this.processingJobs.size > 0) {
      logger.info({ processingJobs: this.processingJobs.size }, 'Waiting for sweep jobs to complete');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('SweeperService stopped');
    this.emit('stopped');
  }

  async checkAndCreateSweepJobs(): Promise<SweepJob[]> {
    logger.debug('Checking for balances ready for sweep');

    try {
      // Get wallets ready for sweep
      const walletsReadyForSweep = await this.getWalletsReadyForSweep();
      const createdJobs: SweepJob[] = [];

      for (const snapshot of walletsReadyForSweep) {
        try {
          // Skip if wallet filtering rules apply
          if (!this.shouldSweepWallet(snapshot.wallet_address)) {
            continue;
          }

          // Check if there's already a pending job for this wallet/asset
          const existingJob = await this.getExistingJob(snapshot.wallet_address, snapshot.asset_symbol);
          if (existingJob) {
            logger.debug({
              wallet: snapshot.wallet_address,
              asset: snapshot.asset_symbol,
              existingJobId: existingJob.id
            }, 'Existing sweep job found, skipping');
            continue;
          }

          // Calculate sweep amount
          const sweepAmount = await this.calculateSweepAmount(snapshot);
          if (!sweepAmount || sweepAmount <= 0n) {
            continue;
          }

          // Create sweep job
          const job = await this.createSweepJob(snapshot, sweepAmount);
          createdJobs.push(job);

          logger.info({
            jobId: job.id,
            wallet: job.source_wallet,
            asset: job.asset_symbol,
            amount: job.amount
          }, 'Sweep job created');

        } catch (error) {
          logger.error({
            error,
            wallet: snapshot.wallet_address,
            asset: snapshot.asset_symbol
          }, 'Failed to create sweep job');
        }
      }

      if (createdJobs.length > 0) {
        this.emit('jobsCreated', { jobs: createdJobs, count: createdJobs.length });
      }

      return createdJobs;

    } catch (error) {
      logger.error({ error }, 'Failed to check and create sweep jobs');
      throw error;
    }
  }

  async processPendingJobs(): Promise<void> {
    try {
      const pendingJobs = await this.getPendingJobs();
      
      // Limit concurrent processing
      const availableSlots = this.config.max_concurrent_jobs - this.processingJobs.size;
      const jobsToProcess = pendingJobs.slice(0, availableSlots);

      for (const job of jobsToProcess) {
        if (!this.running) break;
        
        // Process job in background
        this.processJob(job).catch(error => {
          logger.error({ error, jobId: job.id }, 'Failed to process sweep job');
        });
      }

    } catch (error) {
      logger.error({ error }, 'Failed to process pending sweep jobs');
    }
  }

  private async processJob(job: SweepJob): Promise<void> {
    if (this.processingJobs.has(job.id)) {
      return; // Already processing
    }

    this.processingJobs.add(job.id);

    try {
      logger.info({
        jobId: job.id,
        sourceWallet: job.source_wallet,
        targetWallet: job.target_wallet,
        asset: job.asset_symbol,
        amount: job.amount
      }, 'Processing sweep job');

      // Update job status
      await this.updateJobStatus(job.id, 'processing');

      if (this.config.dry_run) {
        logger.info({ jobId: job.id }, 'Dry run mode - skipping actual transaction');
        await this.updateJobStatus(job.id, 'completed', '0x0', '0', 'DRY_RUN');
        this.emit('jobCompleted', { ...job, status: 'completed' });
        return;
      }

      // Execute the sweep
      const result = await this.executeSweep(job);

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
      }, 'Sweep job completed successfully');

      this.emit('jobCompleted', { ...job, status: 'completed', tx_hash: result.txHash });

    } catch (error) {
      logger.error({ error, jobId: job.id }, 'Sweep job failed');

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

  private async executeSweep(job: SweepJob): Promise<{ txHash: string; gasUsed: bigint }> {
    try {
      const sweepAmount = ethers.parseEther(job.amount);

      if (job.asset_symbol === 'BNB') {
        return await this.sweepNativeToken(job, sweepAmount);
      } else {
        return await this.sweepERC20Token(job, sweepAmount);
      }

    } catch (error) {
      logger.error({ error, jobId: job.id }, 'Failed to execute sweep transaction');
      throw error;
    }
  }

  private async sweepNativeToken(job: SweepJob, amount: bigint): Promise<{ txHash: string; gasUsed: bigint }> {
    // For native token (BNB), need to account for gas costs
    const gasPrice = await this.provider.getFeeData();
    const adjustedGasPrice = gasPrice.gasPrice ?
      (gasPrice.gasPrice * BigInt(Math.floor(this.config.gas_price_multiplier * 100))) / 100n :
      undefined;

    const estimatedGas = 21000n; // Standard transfer gas limit
    const gasCost = adjustedGasPrice ? estimatedGas * adjustedGasPrice : 0n;

    // Adjust amount to leave gas for the transaction
    const adjustedAmount = amount > gasCost ? amount - gasCost : 0n;

    if (adjustedAmount <= 0n) {
      throw new Error('Insufficient balance to cover gas costs');
    }

    const tx = {
      to: job.target_wallet,
      value: adjustedAmount,
      gasPrice: adjustedGasPrice,
      gasLimit: estimatedGas
    };

    logger.debug({
      jobId: job.id,
      originalAmount: ethers.formatEther(amount),
      adjustedAmount: ethers.formatEther(adjustedAmount),
      gasCost: ethers.formatEther(gasCost)
    }, 'Sweeping native token');

    const txResponse = await this.signer.sendTransaction(tx);
    const receipt = await txResponse.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`Native token sweep transaction failed`);
    }

    return {
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed
    };
  }

  private async sweepERC20Token(job: SweepJob, amount: bigint): Promise<{ txHash: string; gasUsed: bigint }> {
    const tokenAddress = await this.getTokenAddress(job.asset_symbol);
    if (!tokenAddress) {
      throw new Error(`Token address not found for ${job.asset_symbol}`);
    }

    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.signer);

    // Check current balance
    const currentBalance = await tokenContract.balanceOf(job.source_wallet);
    if (currentBalance < amount) {
      throw new Error(`Insufficient token balance: ${currentBalance} < ${amount}`);
    }

    logger.debug({
      jobId: job.id,
      tokenAddress,
      amount: amount.toString(),
      currentBalance: currentBalance.toString()
    }, 'Sweeping ERC20 token');

    // Execute transfer
    const tx = await tokenContract.transfer(job.target_wallet, amount);
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error(`ERC20 token sweep transaction failed`);
    }

    return {
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed
    };
  }

  private async getTokenAddress(symbol: string): Promise<string | null> {
    // Token address registry - in production this would be from a config or database
    const tokenAddresses: Record<string, string> = {
      'USDT': '0x55d398326f99059fF775485246999027B3197955',
      'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      'CAKE': '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56'
    };

    return tokenAddresses[symbol] || null;
  }

  private async getWalletsReadyForSweep(): Promise<BalanceSnapshot[]> {
    // Get latest balance snapshots above threshold for supported assets
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const supportedAssets = this.config.supported_assets;
    const rows = await database.connection!('balance_snapshots')
      .select('*')
      .whereIn('asset_symbol', supportedAssets)
      .where('is_above_threshold', true)
      .whereIn('id', function() {
        this.select(database.connection!.raw('MAX(id)'))
          .from('balance_snapshots')
          .whereIn('asset_symbol', supportedAssets)
          .groupBy(['wallet_address', 'asset_symbol']);
      });

    return rows as BalanceSnapshot[];
  }

  private shouldSweepWallet(walletAddress: string): boolean {
    // Check whitelist
    if (this.config.whitelist_wallets && this.config.whitelist_wallets.length > 0) {
      if (!this.config.whitelist_wallets.includes(walletAddress)) {
        return false;
      }
    }

    // Check blacklist
    if (this.config.blacklist_wallets && this.config.blacklist_wallets.includes(walletAddress)) {
      return false;
    }

    // Don't sweep from treasury
    if (walletAddress.toLowerCase() === this.config.treasury_address.toLowerCase()) {
      return false;
    }

    return true;
  }

  private async getExistingJob(walletAddress: string, asset: string): Promise<SweepJob | null> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const row = await database.connection!('sweep_jobs')
      .where('source_wallet', walletAddress)
      .where('asset_symbol', asset)
      .whereIn('status', ['pending', 'processing'])
      .orderBy('created_at', 'desc')
      .first();

    return row || null;
  }

  private async calculateSweepAmount(snapshot: BalanceSnapshot): Promise<bigint> {
    const currentBalance = BigInt(snapshot.balance);
    const minThreshold = ethers.parseEther(this.config.sweep_min_threshold);
    const leavingAmount = ethers.parseEther(this.config.leaving_amount);

    // Must be above minimum threshold
    if (currentBalance <= minThreshold) {
      return 0n;
    }

    // Calculate amount to sweep (leaving specified amount)
    const sweepAmount = currentBalance - leavingAmount;

    // Ensure we don't sweep more than available
    return sweepAmount > 0n ? sweepAmount : 0n;
  }

  private async createSweepJob(snapshot: BalanceSnapshot, amount: bigint): Promise<SweepJob> {
    const job: SweepJob = {
      id: `sweep_${snapshot.wallet_address}_${snapshot.asset_symbol}_${Date.now()}`,
      source_wallet: snapshot.wallet_address,
      target_wallet: this.config.treasury_address,
      asset_symbol: snapshot.asset_symbol,
      amount: ethers.formatEther(amount),
      amount_usd: snapshot.balance_usd, // Use existing USD value if available
      leaving_amount: this.config.leaving_amount,
      status: 'pending',
      created_at: new Date()
    };

    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('sweep_jobs').insert({
      id: job.id,
      source_wallet: job.source_wallet,
      target_wallet: job.target_wallet,
      asset_symbol: job.asset_symbol,
      amount: job.amount,
      amount_usd: job.amount_usd,
      leaving_amount: job.leaving_amount,
      status: job.status,
      created_at: job.created_at
    });

    return job;
  }

  private async getPendingJobs(): Promise<SweepJob[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('sweep_jobs')
      .where('status', 'pending')
      .orderBy('created_at', 'asc')
      .limit(this.config.max_concurrent_jobs * 2);

    return rows as SweepJob[];
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
    await database.connection!('sweep_jobs')
      .where('id', jobId)
      .update(updates);
  }

  // Public API methods
  async createManualSweep(
    sourceWallet: string,
    targetWallet: string,
    asset: string,
    amount: string
  ): Promise<SweepJob> {
    logger.info({
      sourceWallet,
      targetWallet,
      asset,
      amount
    }, 'Creating manual sweep job');

    // Create a mock snapshot for the manual sweep
    const mockSnapshot: BalanceSnapshot = {
      id: `manual_${Date.now()}`,
      wallet_address: sourceWallet,
      wallet_group: 'treasury',
      asset_symbol: asset,
      balance: ethers.parseEther(amount).toString(),
      is_below_threshold: false,
      is_above_threshold: true,
      created_at: new Date()
    };

    const amountWei = ethers.parseEther(amount);
    return await this.createSweepJob(mockSnapshot, amountWei);
  }

  async getJobHistory(sourceWallet?: string, asset?: string, limit: number = 50): Promise<SweepJob[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    let query = database.connection!('sweep_jobs')
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (sourceWallet) {
      query = query.where('source_wallet', sourceWallet);
    }

    if (asset) {
      query = query.where('asset_symbol', asset);
    }

    const rows = await query;
    return rows as SweepJob[];
  }

  async cancelJob(jobId: string): Promise<boolean> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const job = await database.connection!('sweep_jobs')
      .where('id', jobId)
      .first();

    if (!job || job.status !== 'pending') {
      return false;
    }

    await this.updateJobStatus(jobId, 'failed', undefined, undefined, 'CANCELLED_BY_USER');

    logger.info({ jobId }, 'Sweep job cancelled');
    this.emit('jobCancelled', { ...job, status: 'cancelled' });

    return true;
  }

  getStatus(): {
    running: boolean;
    enabled: boolean;
    dryRun: boolean;
    processingJobs: number;
    maxConcurrentJobs: number;
    supportedAssets: string[];
    checkIntervalMs: number;
  } {
    return {
      running: this.running,
      enabled: this.config.enabled,
      dryRun: this.config.dry_run,
      processingJobs: this.processingJobs.size,
      maxConcurrentJobs: this.config.max_concurrent_jobs,
      supportedAssets: this.config.supported_assets,
      checkIntervalMs: this.config.check_interval_ms
    };
  }
}