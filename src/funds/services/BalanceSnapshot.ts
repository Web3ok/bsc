import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import { 
  BalanceSnapshot, 
  WalletConfig, 
  FundsAlert, 
  BalanceThreshold,
  FundsMetrics
} from '../types';

// ERC20 ABI for balance checking
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

export class BalanceSnapshotService extends EventEmitter {
  private static instance: BalanceSnapshotService;
  private provider: ethers.Provider;
  private running = false;
  private snapshotInterval: NodeJS.Timeout | null = null;
  private intervalMs: number;

  private constructor(provider: ethers.Provider, intervalMs: number = 60000) {
    super();
    this.provider = provider;
    this.intervalMs = intervalMs;
  }

  public static getInstance(provider?: ethers.Provider, intervalMs?: number): BalanceSnapshotService {
    if (!BalanceSnapshotService.instance) {
      if (!provider) {
        throw new Error('Provider required for BalanceSnapshotService initialization');
      }
      BalanceSnapshotService.instance = new BalanceSnapshotService(provider, intervalMs);
    }
    return BalanceSnapshotService.instance;
  }

  async start(): Promise<void> {
    if (this.running) {
      logger.warn('BalanceSnapshotService is already running');
      return;
    }

    logger.info('Starting BalanceSnapshotService');
    this.running = true;

    // Take initial snapshot
    await this.takeSnapshots();

    // Start periodic snapshots
    this.snapshotInterval = setInterval(async () => {
      try {
        await this.takeSnapshots();
      } catch (error) {
        logger.error({ error }, 'Error taking balance snapshots');
        this.emit('error', error);
      }
    }, this.intervalMs);

    logger.info({ intervalMs: this.intervalMs }, 'BalanceSnapshotService started');
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('Stopping BalanceSnapshotService');
    this.running = false;

    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }

    logger.info('BalanceSnapshotService stopped');
    this.emit('stopped');
  }

  async takeSnapshots(): Promise<BalanceSnapshot[]> {
    logger.debug('Taking balance snapshots for all managed wallets');
    
    try {
      // Get all managed wallets
      const wallets = await this.getManagedWallets();
      const snapshots: BalanceSnapshot[] = [];

      for (const wallet of wallets) {
        try {
          const walletSnapshots = await this.takeWalletSnapshot(wallet);
          snapshots.push(...walletSnapshots);
        } catch (error) {
          logger.error({ 
            error, 
            walletAddress: wallet.address 
          }, 'Failed to take snapshot for wallet');
        }
      }

      // Process threshold alerts
      await this.processThresholdAlerts(snapshots);

      logger.info({ 
        walletsProcessed: wallets.length, 
        snapshotsTaken: snapshots.length 
      }, 'Balance snapshots completed');

      this.emit('snapshotsTaken', { snapshots, count: snapshots.length });
      return snapshots;

    } catch (error) {
      logger.error({ error }, 'Failed to take balance snapshots');
      throw error;
    }
  }

  async takeWalletSnapshot(wallet: WalletConfig): Promise<BalanceSnapshot[]> {
    const snapshots: BalanceSnapshot[] = [];
    
    // Get supported assets for this wallet
    const assets = await this.getSupportedAssets(wallet);
    
    for (const asset of assets) {
      try {
        const balance = await this.getAssetBalance(wallet.address, asset);
        const balanceUsd = await this.getBalanceUsd(asset, balance);
        
        // Get thresholds for this wallet/asset combination
        const threshold = await this.getBalanceThreshold(wallet.address, asset);
        
        const snapshot: BalanceSnapshot = {
          id: `snapshot_${wallet.address}_${asset}_${Date.now()}`,
          wallet_address: wallet.address,
          wallet_group: wallet.group,
          wallet_label: wallet.label,
          asset_symbol: asset,
          balance: balance.toString(),
          balance_usd: balanceUsd?.toString(),
          threshold_min: threshold?.min_threshold,
          threshold_max: threshold?.max_threshold,
          is_below_threshold: threshold ? this.isBalanceBelowThreshold(balance, threshold.min_threshold) : false,
          is_above_threshold: threshold ? this.isBalanceAboveThreshold(balance, threshold.max_threshold) : false,
          created_at: new Date()
        };

        // Save to database
        await this.saveSnapshot(snapshot);
        snapshots.push(snapshot);

        logger.debug({ 
          wallet: wallet.address, 
          asset, 
          balance: balance.toString(),
          belowThreshold: snapshot.is_below_threshold,
          aboveThreshold: snapshot.is_above_threshold
        }, 'Wallet asset snapshot taken');

      } catch (error) {
        logger.error({ 
          error, 
          wallet: wallet.address, 
          asset 
        }, 'Failed to get balance for wallet asset');
      }
    }

    return snapshots;
  }

  private async getAssetBalance(walletAddress: string, asset: string): Promise<bigint> {
    if (asset === 'BNB' || asset === 'ETH') {
      // Native token balance
      return await this.provider.getBalance(walletAddress);
    } else {
      // ERC20 token balance
      const tokenAddress = await this.getTokenAddress(asset);
      if (!tokenAddress) {
        throw new Error(`Token address not found for asset: ${asset}`);
      }

      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const balance = await contract.balanceOf(walletAddress);
      return balance;
    }
  }

  private async getBalanceUsd(asset: string, balance: bigint): Promise<bigint | null> {
    // This would integrate with a price oracle or API
    // For now, return null - implement price conversion later
    return null;
  }

  private async getTokenAddress(symbol: string): Promise<string | null> {
    // This would look up token addresses from a registry
    // Common BSC tokens for now
    const tokenAddresses: Record<string, string> = {
      'USDT': '0x55d398326f99059fF775485246999027B3197955',
      'USDC': '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      'WBNB': '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      'CAKE': '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82',
      'BUSD': '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56'
    };

    return tokenAddresses[symbol] || null;
  }

  private async getManagedWallets(): Promise<WalletConfig[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const rows = await database.connection!('wallet_configs')
      .where('is_managed', true);

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

  private async getSupportedAssets(wallet: WalletConfig): Promise<string[]> {
    const defaultAssets = ['BNB', 'USDT', 'USDC', 'WBNB'];
    
    if (wallet.whitelist_assets && wallet.whitelist_assets.length > 0) {
      return wallet.whitelist_assets;
    }
    
    if (wallet.blacklist_assets && wallet.blacklist_assets.length > 0) {
      return defaultAssets.filter(asset => !wallet.blacklist_assets!.includes(asset));
    }
    
    return defaultAssets;
  }

  private async getBalanceThreshold(walletAddress: string, asset: string): Promise<BalanceThreshold | null> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const row = await database.connection!('balance_thresholds')
      .where('wallet_address', walletAddress)
      .where('asset_symbol', asset)
      .first();

    return row || null;
  }

  private isBalanceBelowThreshold(balance: bigint, threshold?: string): boolean {
    if (!threshold) return false;
    const thresholdWei = ethers.parseEther(threshold);
    return balance < thresholdWei;
  }

  private isBalanceAboveThreshold(balance: bigint, threshold?: string): boolean {
    if (!threshold) return false;
    const thresholdWei = ethers.parseEther(threshold);
    return balance > thresholdWei;
  }

  private async saveSnapshot(snapshot: BalanceSnapshot): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('balance_snapshots').insert({
      id: snapshot.id,
      wallet_address: snapshot.wallet_address,
      wallet_group: snapshot.wallet_group,
      wallet_label: snapshot.wallet_label,
      asset_symbol: snapshot.asset_symbol,
      balance: snapshot.balance,
      balance_usd: snapshot.balance_usd,
      threshold_min: snapshot.threshold_min,
      threshold_max: snapshot.threshold_max,
      is_below_threshold: snapshot.is_below_threshold,
      is_above_threshold: snapshot.is_above_threshold,
      created_at: snapshot.created_at
    });
  }

  private async processThresholdAlerts(snapshots: BalanceSnapshot[]): Promise<void> {
    for (const snapshot of snapshots) {
      if (snapshot.is_below_threshold) {
        await this.createAlert({
          id: `alert_${snapshot.wallet_address}_${snapshot.asset_symbol}_low_${Date.now()}`,
          alert_type: 'low_gas',
          wallet_address: snapshot.wallet_address,
          asset_symbol: snapshot.asset_symbol,
          message: `${snapshot.asset_symbol} balance (${ethers.formatEther(snapshot.balance)}) below threshold (${snapshot.threshold_min}) for wallet ${snapshot.wallet_address}`,
          severity: snapshot.asset_symbol === 'BNB' ? 'high' : 'medium',
          is_resolved: false,
          metadata: { snapshot_id: snapshot.id },
          created_at: new Date()
        });
      }

      if (snapshot.is_above_threshold) {
        await this.createAlert({
          id: `alert_${snapshot.wallet_address}_${snapshot.asset_symbol}_high_${Date.now()}`,
          alert_type: 'sweep_ready',
          wallet_address: snapshot.wallet_address,
          asset_symbol: snapshot.asset_symbol,
          message: `${snapshot.asset_symbol} balance (${ethers.formatEther(snapshot.balance)}) above threshold (${snapshot.threshold_max}) for wallet ${snapshot.wallet_address} - ready for sweep`,
          severity: 'medium',
          is_resolved: false,
          metadata: { snapshot_id: snapshot.id },
          created_at: new Date()
        });
      }
    }
  }

  private async createAlert(alert: FundsAlert): Promise<void> {
    // Check if similar alert already exists and is unresolved
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const existingAlert = await database.connection!('funds_alerts')
      .where('wallet_address', alert.wallet_address)
      .where('asset_symbol', alert.asset_symbol)
      .where('alert_type', alert.alert_type)
      .where('is_resolved', false)
      .first();

    if (existingAlert) {
      logger.debug({ 
        alertType: alert.alert_type, 
        wallet: alert.wallet_address 
      }, 'Similar alert already exists, skipping');
      return;
    }

    await database.connection!('funds_alerts').insert({
      id: alert.id,
      alert_type: alert.alert_type,
      wallet_address: alert.wallet_address,
      asset_symbol: alert.asset_symbol,
      message: alert.message,
      severity: alert.severity,
      is_resolved: alert.is_resolved,
      metadata: JSON.stringify(alert.metadata || {}),
      created_at: alert.created_at
    });

    logger.info({ 
      alertId: alert.id, 
      type: alert.alert_type, 
      severity: alert.severity,
      wallet: alert.wallet_address
    }, 'Funds alert created');

    this.emit('alertCreated', alert);
  }

  // Public API methods
  async getLatestSnapshots(walletAddress?: string, asset?: string): Promise<BalanceSnapshot[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    let query = database.connection!('balance_snapshots')
      .orderBy('created_at', 'desc');

    if (walletAddress) {
      query = query.where('wallet_address', walletAddress);
    }

    if (asset) {
      query = query.where('asset_symbol', asset);
    }

    const rows = await query.limit(100);
    return rows as BalanceSnapshot[];
  }

  async getWalletsNeedingGas(minThreshold?: string): Promise<BalanceSnapshot[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    let query = database.connection!('balance_snapshots')
      .where('asset_symbol', 'BNB')
      .where('is_below_threshold', true)
      .orderBy('created_at', 'desc');

    if (minThreshold) {
      query = query.where('balance', '<', ethers.parseEther(minThreshold).toString());
    }

    const rows = await query;
    return rows as BalanceSnapshot[];
  }

  async getWalletsReadyForSweep(asset?: string): Promise<BalanceSnapshot[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    let query = database.connection!('balance_snapshots')
      .where('is_above_threshold', true)
      .orderBy('created_at', 'desc');

    if (asset) {
      query = query.where('asset_symbol', asset);
    }

    const rows = await query;
    return rows as BalanceSnapshot[];
  }

  async getFundsMetrics(): Promise<FundsMetrics> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    
    const [
      totalWallets,
      gasTopUps24h,
      sweeps24h,
      rebalances24h,
      walletsNeedingGas,
      walletsReadyForSweep,
      latestSnapshot
    ] = await Promise.all([
      database.connection!('wallet_configs').where('is_managed', true).count('* as count'),
      database.connection!('gas_topup_jobs').where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000)).count('* as count'),
      database.connection!('sweep_jobs').where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000)).count('* as count'),
      database.connection!('rebalance_jobs').where('created_at', '>', new Date(Date.now() - 24 * 60 * 60 * 1000)).count('* as count'),
      database.connection!('balance_snapshots').where('asset_symbol', 'BNB').where('is_below_threshold', true).count('* as count'),
      database.connection!('balance_snapshots').where('is_above_threshold', true).count('* as count'),
      database.connection!('balance_snapshots').orderBy('created_at', 'desc').first()
    ]);

    return {
      total_managed_wallets: Number(totalWallets[0].count),
      total_balance_usd: '0', // Would calculate from USD values
      gas_top_ups_24h: Number(gasTopUps24h[0].count),
      sweeps_24h: Number(sweeps24h[0].count),
      rebalances_24h: Number(rebalances24h[0].count),
      wallets_below_gas_threshold: Number(walletsNeedingGas[0].count),
      wallets_ready_for_sweep: Number(walletsReadyForSweep[0].count),
      allocation_drift_max: 0, // Would calculate from rebalance data
      last_balance_update: latestSnapshot?.created_at || new Date()
    };
  }

  getStatus(): {
    running: boolean;
    intervalMs: number;
    lastSnapshot?: Date;
  } {
    return {
      running: this.running,
      intervalMs: this.intervalMs,
      // Would track last snapshot time
    };
  }
}