import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { database } from '../persistence/database';
import { BalanceSnapshotService } from './services/BalanceSnapshot';
import { GasDripService, GasDripConfig } from './services/GasDrip';
import { SweeperService, SweeperConfig } from './services/Sweeper';
import { RebalancerService, RebalancerConfig } from './services/Rebalancer';
import { 
  FundsConfig, 
  FundsMetrics, 
  WalletConfig, 
  TreasuryAccount,
  FundsAlert
} from './types';

export interface FundsManagerConfig extends FundsConfig {
  provider: ethers.Provider;
  signer: ethers.Wallet;
  balance_snapshot_interval_ms: number;
  gas_drip: GasDripConfig;
  sweeper: SweeperConfig;
  rebalancer: RebalancerConfig;
}

export class FundsManager extends EventEmitter {
  private static instance: FundsManager;
  private config: FundsManagerConfig;
  private running = false;

  // Service instances
  private balanceSnapshotService: BalanceSnapshotService;
  private gasDripService: GasDripService;
  private sweeperService: SweeperService;
  private rebalancerService: RebalancerService;

  private constructor(config: FundsManagerConfig) {
    super();
    this.config = config;
    
    // Initialize services
    this.balanceSnapshotService = BalanceSnapshotService.getInstance(
      config.provider, 
      config.balance_snapshot_interval_ms
    );
    
    this.gasDripService = GasDripService.getInstance(
      config.provider,
      config.signer,
      config.gas_drip
    );
    
    this.sweeperService = SweeperService.getInstance(
      config.provider,
      config.signer,
      config.sweeper
    );
    
    this.rebalancerService = RebalancerService.getInstance(config.rebalancer);
    
    this.setupEventListeners();
  }

  public static getInstance(config?: FundsManagerConfig): FundsManager {
    if (!FundsManager.instance) {
      if (!config) {
        throw new Error('Config required for FundsManager initialization');
      }
      FundsManager.instance = new FundsManager(config);
    }
    return FundsManager.instance;
  }

  private setupEventListeners(): void {
    // Balance snapshot events
    this.balanceSnapshotService.on('alertCreated', (alert) => {
      this.emit('fundsAlert', alert);
    });

    this.balanceSnapshotService.on('snapshotsTaken', (data) => {
      this.emit('balanceSnapshotsTaken', data);
    });

    // Gas drip events
    this.gasDripService.on('jobCompleted', (job) => {
      logger.info({ jobId: job.id, wallet: job.target_wallet }, 'Gas top-up completed');
      this.emit('gasTopUpCompleted', job);
    });

    this.gasDripService.on('jobFailed', (job) => {
      logger.error({ jobId: job.id, wallet: job.target_wallet }, 'Gas top-up failed');
      this.emit('gasTopUpFailed', job);
    });

    // Sweeper events
    this.sweeperService.on('jobCompleted', (job) => {
      logger.info({ 
        jobId: job.id, 
        sourceWallet: job.source_wallet,
        asset: job.asset_symbol,
        amount: job.amount 
      }, 'Sweep completed');
      this.emit('sweepCompleted', job);
    });

    this.sweeperService.on('jobFailed', (job) => {
      logger.error({ 
        jobId: job.id, 
        sourceWallet: job.source_wallet,
        asset: job.asset_symbol 
      }, 'Sweep failed');
      this.emit('sweepFailed', job);
    });

    // Rebalancer events
    this.rebalancerService.on('jobCompleted', (job) => {
      logger.info({ 
        jobId: job.id,
        walletGroup: job.wallet_group,
        totalValueUsd: job.total_value_usd 
      }, 'Rebalance completed');
      this.emit('rebalanceCompleted', job);
    });

    this.rebalancerService.on('jobFailed', (job) => {
      logger.error({ 
        jobId: job.id,
        walletGroup: job.wallet_group 
      }, 'Rebalance failed');
      this.emit('rebalanceFailed', job);
    });

    // Forward all service errors
    [this.balanceSnapshotService, this.gasDripService, this.sweeperService, this.rebalancerService]
      .forEach(service => {
        service.on('error', (error) => {
          this.emit('error', error);
        });
      });
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('FundsManager is already running');
      return;
    }

    logger.info('Starting FundsManager');
    this.running = true;

    try {
      // Initialize default wallet configurations and treasury accounts if needed
      await this.initializeDefaults();

      // Start all services
      await Promise.all([
        this.balanceSnapshotService.start(),
        this.gasDripService.start(),
        this.sweeperService.start(),
        this.rebalancerService.start()
      ]);

      logger.info('FundsManager started successfully');
      this.emit('started');

    } catch (error) {
      logger.error({ error }, 'Failed to start FundsManager');
      this.running = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('Stopping FundsManager');
    this.running = false;

    try {
      // Stop all services
      await Promise.all([
        this.balanceSnapshotService.stop(),
        this.gasDripService.stop(),
        this.sweeperService.stop(),
        this.rebalancerService.stop()
      ]);

      logger.info('FundsManager stopped successfully');
      this.emit('stopped');

    } catch (error) {
      logger.error({ error }, 'Error stopping FundsManager');
      throw error;
    }
  }

  private async initializeDefaults(): Promise<void> {
    // Ensure treasury account exists
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const treasuryExists = await database.connection!('treasury_accounts')
      .where('address', this.config.treasury_address)
      .first();

    if (!treasuryExists) {
      await this.createTreasuryAccount({
        id: `treasury_${Date.now()}`,
        address: this.config.treasury_address,
        name: 'Primary Treasury',
        account_type: 'primary',
        environment: 'mainnet', // or get from config
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      logger.info({ address: this.config.treasury_address }, 'Created default treasury account');
    }
  }

  // Wallet Management API
  async addWallet(config: Omit<WalletConfig, 'created_at' | 'updated_at'>): Promise<void> {
    const walletConfig: WalletConfig = {
      ...config,
      created_at: new Date(),
      updated_at: new Date()
    };

    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('wallet_configs')
      .insert({
        address: walletConfig.address,
        group: walletConfig.group,
        label: walletConfig.label,
        strategy_id: walletConfig.strategy_id,
        is_managed: walletConfig.is_managed,
        gas_min_bnb: walletConfig.gas_min_bnb,
        gas_max_bnb: walletConfig.gas_max_bnb,
        sweep_enabled: walletConfig.sweep_enabled,
        sweep_min_threshold: walletConfig.sweep_min_threshold,
        whitelist_assets: walletConfig.whitelist_assets ? JSON.stringify(walletConfig.whitelist_assets) : null,
        blacklist_assets: walletConfig.blacklist_assets ? JSON.stringify(walletConfig.blacklist_assets) : null,
        created_at: walletConfig.created_at,
        updated_at: walletConfig.updated_at
      })
      .onConflict('address')
      .merge();

    logger.info({ 
      address: config.address, 
      group: config.group, 
      label: config.label 
    }, 'Wallet configuration added/updated');

    this.emit('walletAdded', walletConfig);
  }

  async removeWallet(address: string): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('wallet_configs')
      .where('address', address)
      .delete();

    logger.info({ address }, 'Wallet removed from management');
    this.emit('walletRemoved', { address });
  }

  async getWallets(group?: string): Promise<WalletConfig[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    let query = database.connection!('wallet_configs');
    
    if (group) {
      query = query.where('group', group);
    }

    const rows = await query.orderBy('created_at', 'desc');
    
    return rows.map(row => ({
      address: row.address,
      group: row.group,
      label: row.label,
      strategy_id: row.strategy_id,
      is_managed: row.is_managed,
      gas_min_bnb: row.gas_min_bnb,
      gas_max_bnb: row.gas_max_bnb,
      sweep_enabled: row.sweep_enabled,
      sweep_min_threshold: row.sweep_min_threshold,
      whitelist_assets: row.whitelist_assets ? JSON.parse(row.whitelist_assets) : undefined,
      blacklist_assets: row.blacklist_assets ? JSON.parse(row.blacklist_assets) : undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  // Treasury Management API
  async createTreasuryAccount(account: TreasuryAccount): Promise<void> {
    if (!database.connection) throw new Error("Database not available");
    await database.connection!('treasury_accounts').insert({
      id: account.id,
      address: account.address,
      name: account.name,
      account_type: account.account_type,
      environment: account.environment,
      is_active: account.is_active,
      created_at: account.created_at,
      updated_at: account.updated_at
    });

    logger.info({ 
      address: account.address, 
      name: account.name, 
      type: account.account_type 
    }, 'Treasury account created');
  }

  async getTreasuryAccounts(): Promise<TreasuryAccount[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('treasury_accounts')
      .where('is_active', true)
      .orderBy('created_at', 'desc');

    return rows as TreasuryAccount[];
  }

  // Service Access API
  getBalanceSnapshotService(): BalanceSnapshotService {
    return this.balanceSnapshotService;
  }

  getGasDripService(): GasDripService {
    return this.gasDripService;
  }

  getSweeperService(): SweeperService {
    return this.sweeperService;
  }

  getRebalancerService(): RebalancerService {
    return this.rebalancerService;
  }

  // Metrics and Status API
  async getFundsMetrics(): Promise<FundsMetrics> {
    return await this.balanceSnapshotService.getFundsMetrics();
  }

  async getUnresolvedAlerts(): Promise<FundsAlert[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('funds_alerts')
      .where('is_resolved', false)
      .orderBy('created_at', 'desc')
      .limit(100);

    return rows.map(row => ({
      id: row.id,
      alert_type: row.alert_type,
      wallet_address: row.wallet_address,
      asset_symbol: row.asset_symbol,
      message: row.message,
      severity: row.severity,
      is_resolved: row.is_resolved,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      created_at: row.created_at,
      resolved_at: row.resolved_at
    }));
  }

  async resolveAlert(alertId: string): Promise<void> {
    if (!database.connection) throw new Error("Database not available");
    await database.connection!('funds_alerts')
      .where('id', alertId)
      .update({
        is_resolved: true,
        resolved_at: new Date()
      });

    logger.info({ alertId }, 'Funds alert resolved');
    this.emit('alertResolved', { alertId });
  }

  getStatus(): {
    running: boolean;
    services: {
      balanceSnapshot: any;
      gasDrip: any;
      sweeper: any;
      rebalancer: any;
    };
    config: {
      treasuryAddress: string;
      managedWalletGroups: string[];
      supportedAssets: string[];
    };
  } {
    return {
      running: this.running,
      services: {
        balanceSnapshot: this.balanceSnapshotService.getStatus(),
        gasDrip: this.gasDripService.getStatus(),
        sweeper: this.sweeperService.getStatus(),
        rebalancer: this.rebalancerService.getStatus()
      },
      config: {
        treasuryAddress: this.config.treasury_address,
        managedWalletGroups: this.config.managed_wallet_groups,
        supportedAssets: this.config.supported_assets
      }
    };
  }

  // Manual Operations API
  async manualGasTopUp(targetWallet: string, amount: string): Promise<string> {
    const job = await this.gasDripService.createManualTopUp(targetWallet, amount);
    return job.id;
  }

  async manualSweep(
    sourceWallet: string, 
    targetWallet: string, 
    asset: string, 
    amount: string
  ): Promise<string> {
    const job = await this.sweeperService.createManualSweep(sourceWallet, targetWallet, asset, amount);
    return job.id;
  }

  async manualRebalance(walletGroup?: string): Promise<string> {
    const job = await this.rebalancerService.createManualRebalance(walletGroup);
    return job.id;
  }

  async forceBalanceSnapshot(): Promise<void> {
    await this.balanceSnapshotService.takeSnapshots();
    logger.info('Forced balance snapshot completed');
  }
}

// Export singleton instance getter
export const getFundsManager = (config?: FundsManagerConfig): FundsManager => {
  return FundsManager.getInstance(config);
};