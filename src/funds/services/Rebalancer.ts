import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import { 
  RebalanceJob, 
  RebalanceAction,
  BalanceSnapshot,
  WalletConfig
} from '../types';

export interface RebalancerConfig {
  enabled: boolean;
  check_interval_ms: number;
  target_allocation: Record<string, number>; // asset -> percentage (should sum to 100)
  tolerance_band: number; // Percentage tolerance before triggering rebalance
  min_rebalance_value_usd: number; // Minimum USD value to trigger rebalance
  max_single_trade_usd: number; // Maximum single trade size in USD
  dry_run: boolean;
  supported_assets: string[];
  wallet_groups: string[]; // Which wallet groups to include in rebalancing
  slippage_tolerance: number; // Max acceptable slippage percentage
}

export interface AssetAllocation {
  asset: string;
  current_value_usd: number;
  current_percentage: number;
  target_percentage: number;
  drift: number; // Difference from target
  needs_rebalancing: boolean;
}

export interface PortfolioState {
  total_value_usd: number;
  allocations: AssetAllocation[];
  max_drift: number;
  needs_rebalancing: boolean;
  last_updated: Date;
}

export class RebalancerService extends EventEmitter {
  private static instance: RebalancerService;
  private config: RebalancerConfig;
  private running = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private processingJobs = new Set<string>();

  // Price cache for USD conversions
  private priceCache = new Map<string, { price: number; timestamp: Date }>();
  private priceCacheExpiryMs = 300000; // 5 minutes

  private constructor(config: RebalancerConfig) {
    super();
    this.config = config;
    this.validateConfig();
  }

  public static getInstance(config?: RebalancerConfig): RebalancerService {
    if (!RebalancerService.instance) {
      if (!config) {
        throw new Error('Config required for RebalancerService initialization');
      }
      RebalancerService.instance = new RebalancerService(config);
    }
    return RebalancerService.instance;
  }

  private validateConfig(): void {
    // Validate target allocation sums to 100%
    const totalAllocation = Object.values(this.config.target_allocation)
      .reduce((sum, percentage) => sum + percentage, 0);

    if (Math.abs(totalAllocation - 100) > 0.01) {
      throw new Error(`Target allocation must sum to 100%, got ${totalAllocation}%`);
    }

    // Validate supported assets are in target allocation
    for (const asset of this.config.supported_assets) {
      if (!(asset in this.config.target_allocation)) {
        throw new Error(`Asset ${asset} in supported_assets but not in target_allocation`);
      }
    }
  }

  async start(): Promise<void> {
    if (this.running || !this.config.enabled) {
      logger.warn('RebalancerService is already running or disabled');
      return;
    }

    logger.info('Starting RebalancerService');
    this.running = true;

    // Process existing pending jobs
    await this.processPendingJobs();

    // Start periodic rebalance checks
    this.checkInterval = setInterval(async () => {
      try {
        await this.checkAndCreateRebalanceJob();
        await this.processPendingJobs();
      } catch (error) {
        logger.error({ error }, 'Error in RebalancerService check cycle');
        this.emit('error', error);
      }
    }, this.config.check_interval_ms);

    logger.info({
      intervalMs: this.config.check_interval_ms,
      dryRun: this.config.dry_run,
      targetAllocation: this.config.target_allocation,
      toleranceBand: this.config.tolerance_band
    }, 'RebalancerService started');

    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('Stopping RebalancerService');
    this.running = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Wait for ongoing jobs to complete
    while (this.processingJobs.size > 0) {
      logger.info({ processingJobs: this.processingJobs.size }, 'Waiting for rebalance jobs to complete');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('RebalancerService stopped');
    this.emit('stopped');
  }

  async checkAndCreateRebalanceJob(): Promise<RebalanceJob | null> {
    logger.debug('Checking portfolio allocation for rebalancing needs');

    try {
      // Get current portfolio state
      const portfolioState = await this.getPortfolioState();

      logger.debug({
        totalValueUsd: portfolioState.total_value_usd,
        maxDrift: portfolioState.max_drift,
        needsRebalancing: portfolioState.needs_rebalancing
      }, 'Portfolio state analysis');

      // Check if rebalancing is needed
      if (!portfolioState.needs_rebalancing) {
        logger.debug('Portfolio within tolerance bands, no rebalancing needed');
        return null;
      }

      // Check minimum rebalance value
      if (portfolioState.total_value_usd < this.config.min_rebalance_value_usd) {
        logger.debug({
          currentValue: portfolioState.total_value_usd,
          minValue: this.config.min_rebalance_value_usd
        }, 'Portfolio value below minimum rebalance threshold');
        return null;
      }

      // Check if there's already a pending rebalance job
      const existingJob = await this.getExistingJob();
      if (existingJob) {
        logger.debug({ existingJobId: existingJob.id }, 'Existing rebalance job found, skipping');
        return null;
      }

      // Create rebalance job
      const job = await this.createRebalanceJob(portfolioState);
      
      logger.info({
        jobId: job.id,
        totalValueUsd: job.total_value_usd,
        maxDrift: portfolioState.max_drift,
        actionCount: job.rebalance_actions.length
      }, 'Rebalance job created');

      this.emit('jobCreated', job);
      return job;

    } catch (error) {
      logger.error({ error }, 'Failed to check and create rebalance job');
      throw error;
    }
  }

  async processPendingJobs(): Promise<void> {
    try {
      const pendingJobs = await this.getPendingJobs();
      
      for (const job of pendingJobs) {
        if (!this.running) break;
        
        // Process one job at a time for rebalancing to avoid conflicts
        if (this.processingJobs.size === 0) {
          this.processJob(job).catch(error => {
            logger.error({ error, jobId: job.id }, 'Failed to process rebalance job');
          });
        }
      }

    } catch (error) {
      logger.error({ error }, 'Failed to process pending rebalance jobs');
    }
  }

  private async processJob(job: RebalanceJob): Promise<void> {
    if (this.processingJobs.has(job.id)) {
      return; // Already processing
    }

    this.processingJobs.add(job.id);

    try {
      logger.info({
        jobId: job.id,
        walletGroup: job.wallet_group,
        actionCount: job.rebalance_actions.length,
        totalValueUsd: job.total_value_usd
      }, 'Processing rebalance job');

      // Update job status
      await this.updateJobStatus(job.id, 'processing');

      if (this.config.dry_run) {
        logger.info({ jobId: job.id }, 'Dry run mode - skipping actual rebalancing');
        
        // Mark all actions as completed in dry run
        for (const action of job.rebalance_actions) {
          action.status = 'completed';
          action.tx_hash = 'DRY_RUN';
        }

        await this.updateJobStatus(job.id, 'completed', 'DRY_RUN');
        this.emit('jobCompleted', { ...job, status: 'completed' });
        return;
      }

      // Execute rebalance actions
      const results = await this.executeRebalanceActions(job.rebalance_actions);
      
      // Update job with results
      const allSuccessful = results.every(r => r.success);
      await this.updateJobStatus(
        job.id,
        allSuccessful ? 'completed' : 'failed',
        allSuccessful ? 'MIXED_SUCCESS' : 'SOME_ACTIONS_FAILED'
      );

      logger.info({
        jobId: job.id,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        totalActions: results.length
      }, 'Rebalance job processing completed');

      this.emit('jobCompleted', { 
        ...job, 
        status: allSuccessful ? 'completed' : 'failed',
        rebalance_actions: job.rebalance_actions 
      });

    } catch (error) {
      logger.error({ error, jobId: job.id }, 'Rebalance job failed');

      await this.updateJobStatus(
        job.id,
        'failed',
        error instanceof Error ? error.message : String(error)
      );

      this.emit('jobFailed', { ...job, status: 'failed', error_message: (error as Error).message });

    } finally {
      this.processingJobs.delete(job.id);
    }
  }

  private async executeRebalanceActions(actions: RebalanceAction[]): Promise<{ action: RebalanceAction; success: boolean; error?: string }[]> {
    const results = [];

    for (const action of actions) {
      try {
        logger.info({
          actionType: action.action_type,
          asset: action.asset_symbol,
          amount: action.amount,
          fromWallet: action.from_wallet,
          toWallet: action.to_wallet
        }, 'Executing rebalance action');

        let txHash: string;

        switch (action.action_type) {
          case 'transfer':
            txHash = await this.executeTransfer(action);
            break;
          case 'buy':
          case 'sell':
            txHash = await this.executeTrade(action);
            break;
          default:
            throw new Error(`Unsupported action type: ${action.action_type}`);
        }

        action.status = 'completed';
        action.tx_hash = txHash;
        results.push({ action, success: true });

        logger.info({
          actionType: action.action_type,
          asset: action.asset_symbol,
          txHash
        }, 'Rebalance action completed successfully');

      } catch (error) {
        action.status = 'failed';
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        logger.error({
          error,
          actionType: action.action_type,
          asset: action.asset_symbol
        }, 'Rebalance action failed');

        results.push({ action, success: false, error: errorMessage });
      }

      // Add delay between actions to avoid overwhelming the network
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return results;
  }

  private async executeTransfer(action: RebalanceAction): Promise<string> {
    // This would execute a transfer between wallets
    // For now, return a mock transaction hash
    // In production, this would use the appropriate transfer mechanism
    
    logger.debug({
      asset: action.asset_symbol,
      amount: action.amount,
      from: action.from_wallet,
      to: action.to_wallet
    }, 'Executing transfer (mock implementation)');

    // Simulate transaction processing time
    await new Promise(resolve => setTimeout(resolve, 1000));

    return `0x${Math.random().toString(16).substr(2, 64)}`;
  }

  private async executeTrade(action: RebalanceAction): Promise<string> {
    // This would execute a buy/sell trade
    // For now, return a mock transaction hash
    // In production, this would integrate with DEX or CEX APIs

    logger.debug({
      actionType: action.action_type,
      asset: action.asset_symbol,
      amount: action.amount
    }, 'Executing trade (mock implementation)');

    // Simulate trade processing time
    await new Promise(resolve => setTimeout(resolve, 2000));

    return `0x${Math.random().toString(16).substr(2, 64)}`;
  }

  private async getPortfolioState(): Promise<PortfolioState> {
    // Get latest balance snapshots for all managed wallets in target groups
    const snapshots = await this.getManagedWalletSnapshots();
    
    // Group by asset and calculate totals
    const assetTotals = new Map<string, bigint>();
    
    for (const snapshot of snapshots) {
      const current = assetTotals.get(snapshot.asset_symbol) || 0n;
      assetTotals.set(snapshot.asset_symbol, current + BigInt(snapshot.balance));
    }

    // Convert to USD values and calculate allocations
    const allocations: AssetAllocation[] = [];
    let totalValueUsd = 0;

    for (const asset of this.config.supported_assets) {
      const balance = assetTotals.get(asset) || 0n;
      const priceUsd = await this.getAssetPriceUsd(asset);
      const valueUsd = Number(ethers.formatEther(balance)) * priceUsd;
      
      totalValueUsd += valueUsd;
    }

    // Calculate allocations and drift
    for (const asset of this.config.supported_assets) {
      const balance = assetTotals.get(asset) || 0n;
      const priceUsd = await this.getAssetPriceUsd(asset);
      const valueUsd = Number(ethers.formatEther(balance)) * priceUsd;
      const currentPercentage = totalValueUsd > 0 ? (valueUsd / totalValueUsd) * 100 : 0;
      const targetPercentage = this.config.target_allocation[asset] || 0;
      const drift = Math.abs(currentPercentage - targetPercentage);
      const needsRebalancing = drift > this.config.tolerance_band;

      allocations.push({
        asset,
        current_value_usd: valueUsd,
        current_percentage: currentPercentage,
        target_percentage: targetPercentage,
        drift,
        needs_rebalancing: needsRebalancing
      });
    }

    const maxDrift = Math.max(...allocations.map(a => a.drift));
    const needsRebalancing = allocations.some(a => a.needs_rebalancing);

    return {
      total_value_usd: totalValueUsd,
      allocations,
      max_drift: maxDrift,
      needs_rebalancing: needsRebalancing,
      last_updated: new Date()
    };
  }

  private async getManagedWalletSnapshots(): Promise<BalanceSnapshot[]> {
    // Get wallets from target groups
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const wallets = await database.connection!('wallet_configs')
      .whereIn('group', this.config.wallet_groups)
      .where('is_managed', true);

    const walletAddresses = wallets.map(w => w.address);

    if (walletAddresses.length === 0) {
      return [];
    }

    // Get latest snapshots for these wallets and supported assets
    const supportedAssets = this.config.supported_assets;
    const rows = await database.connection!('balance_snapshots')
      .select('*')
      .whereIn('wallet_address', walletAddresses)
      .whereIn('asset_symbol', supportedAssets)
      .whereIn('id', function() {
        this.select(database.connection!.raw('MAX(id)'))
          .from('balance_snapshots')
          .whereIn('wallet_address', walletAddresses)
          .whereIn('asset_symbol', supportedAssets)
          .groupBy(['wallet_address', 'asset_symbol']);
      });

    return rows as BalanceSnapshot[];
  }

  private async getAssetPriceUsd(asset: string): Promise<number> {
    // Check cache first
    const cached = this.priceCache.get(asset);
    if (cached && (Date.now() - cached.timestamp.getTime()) < this.priceCacheExpiryMs) {
      return cached.price;
    }

    // Mock price data - in production, this would fetch from a price oracle
    const mockPrices: Record<string, number> = {
      'BNB': 300,
      'USDT': 1,
      'USDC': 1,
      'WBNB': 300,
      'CAKE': 2.5,
      'BUSD': 1
    };

    const price = mockPrices[asset] || 0;
    
    // Cache the price
    this.priceCache.set(asset, { price, timestamp: new Date() });
    
    return price;
  }

  private async createRebalanceJob(portfolioState: PortfolioState): Promise<RebalanceJob> {
    // Calculate rebalance actions needed
    const actions = await this.calculateRebalanceActions(portfolioState);

    const job: RebalanceJob = {
      id: `rebalance_${Date.now()}`,
      wallet_group: this.config.wallet_groups.join(','),
      target_allocation: this.config.target_allocation,
      current_allocation: portfolioState.allocations.reduce((acc, a) => {
        acc[a.asset] = a.current_percentage;
        return acc;
      }, {} as Record<string, number>),
      rebalance_actions: actions,
      total_value_usd: portfolioState.total_value_usd.toFixed(2),
      status: 'pending',
      created_at: new Date()
    };

    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('rebalance_jobs').insert({
      id: job.id,
      wallet_group: job.wallet_group,
      target_allocation: JSON.stringify(job.target_allocation),
      current_allocation: JSON.stringify(job.current_allocation),
      rebalance_actions: JSON.stringify(job.rebalance_actions),
      total_value_usd: job.total_value_usd,
      status: job.status,
      created_at: job.created_at
    });

    return job;
  }

  private async calculateRebalanceActions(portfolioState: PortfolioState): Promise<RebalanceAction[]> {
    const actions: RebalanceAction[] = [];

    // For each asset that needs rebalancing
    for (const allocation of portfolioState.allocations) {
      if (!allocation.needs_rebalancing) continue;

      const targetValueUsd = (allocation.target_percentage / 100) * portfolioState.total_value_usd;
      const currentValueUsd = allocation.current_value_usd;
      const differenceUsd = targetValueUsd - currentValueUsd;

      // Skip small differences
      if (Math.abs(differenceUsd) < 10) continue;

      const priceUsd = await this.getAssetPriceUsd(allocation.asset);
      const differenceAmount = Math.abs(differenceUsd) / priceUsd;

      // Limit trade size
      const maxTradeAmount = Math.min(differenceAmount, this.config.max_single_trade_usd / priceUsd);

      if (differenceUsd > 0) {
        // Need to buy more of this asset
        actions.push({
          action_type: 'buy',
          asset_symbol: allocation.asset,
          amount: maxTradeAmount.toFixed(8),
          target_percentage: allocation.target_percentage,
          current_percentage: allocation.current_percentage,
          status: 'pending'
        });
      } else {
        // Need to sell some of this asset
        actions.push({
          action_type: 'sell',
          asset_symbol: allocation.asset,
          amount: maxTradeAmount.toFixed(8),
          target_percentage: allocation.target_percentage,
          current_percentage: allocation.current_percentage,
          status: 'pending'
        });
      }
    }

    return actions;
  }

  private async getExistingJob(): Promise<RebalanceJob | null> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const row = await database.connection!('rebalance_jobs')
      .whereIn('status', ['pending', 'processing'])
      .orderBy('created_at', 'desc')
      .first();

    return row ? {
      ...row,
      target_allocation: JSON.parse(row.target_allocation),
      current_allocation: JSON.parse(row.current_allocation),
      rebalance_actions: JSON.parse(row.rebalance_actions)
    } : null;
  }

  private async getPendingJobs(): Promise<RebalanceJob[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('rebalance_jobs')
      .where('status', 'pending')
      .orderBy('created_at', 'asc')
      .limit(5);

    return rows.map(row => ({
      ...row,
      target_allocation: JSON.parse(row.target_allocation),
      current_allocation: JSON.parse(row.current_allocation),
      rebalance_actions: JSON.parse(row.rebalance_actions)
    }));
  }

  private async updateJobStatus(
    jobId: string,
    status: 'processing' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    const updates: any = {
      status,
      updated_at: new Date()
    };

    if (errorMessage) updates.error_message = errorMessage;
    if (status === 'completed' || status === 'failed') {
      updates.completed_at = new Date();
    }

    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('rebalance_jobs')
      .where('id', jobId)
      .update(updates);
  }

  // Public API methods
  async getPortfolioStatus(): Promise<PortfolioState> {
    return await this.getPortfolioState();
  }

  async createManualRebalance(walletGroup?: string): Promise<RebalanceJob> {
    logger.info({ walletGroup }, 'Creating manual rebalance job');
    
    const portfolioState = await this.getPortfolioState();
    return await this.createRebalanceJob(portfolioState);
  }

  async getJobHistory(limit: number = 20): Promise<RebalanceJob[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('rebalance_jobs')
      .orderBy('created_at', 'desc')
      .limit(limit);

    return rows.map(row => ({
      ...row,
      target_allocation: JSON.parse(row.target_allocation),
      current_allocation: JSON.parse(row.current_allocation),
      rebalance_actions: JSON.parse(row.rebalance_actions)
    }));
  }

  getStatus(): {
    running: boolean;
    enabled: boolean;
    dryRun: boolean;
    processingJobs: number;
    targetAllocation: Record<string, number>;
    toleranceBand: number;
    checkIntervalMs: number;
  } {
    return {
      running: this.running,
      enabled: this.config.enabled,
      dryRun: this.config.dry_run,
      processingJobs: this.processingJobs.size,
      targetAllocation: this.config.target_allocation,
      toleranceBand: this.config.tolerance_band,
      checkIntervalMs: this.config.check_interval_ms
    };
  }
}