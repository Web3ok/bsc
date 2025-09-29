export interface BalanceSnapshot {
  id: string;
  wallet_address: string;
  wallet_group: 'hot' | 'warm' | 'cold' | 'treasury' | 'strategy';
  wallet_label?: string;
  asset_symbol: string;
  balance: string;
  balance_usd?: string;
  threshold_min?: string;
  threshold_max?: string;
  is_below_threshold: boolean;
  is_above_threshold: boolean;
  created_at: Date;
}

export interface WalletConfig {
  address: string;
  group: 'hot' | 'warm' | 'cold' | 'treasury' | 'strategy';
  label?: string;
  strategy_id?: string;
  is_managed: boolean;
  gas_min_bnb: string;
  gas_max_bnb: string;
  sweep_enabled: boolean;
  sweep_min_threshold: string;
  whitelist_assets?: string[];
  blacklist_assets?: string[];
  created_at: Date;
  updated_at: Date;
}

export interface GasTopUpJob {
  id: string;
  target_wallet: string;
  from_wallet: string; // treasury or gas reservoir
  amount_bnb: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  tx_hash?: string;
  gas_used?: string;
  error_message?: string;
  created_at: Date;
  completed_at?: Date;
}

export interface SweepJob {
  id: string;
  source_wallet: string;
  target_wallet: string; // usually treasury
  asset_symbol: string;
  amount: string;
  amount_usd?: string;
  leaving_amount: string; // amount to leave in source wallet
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  tx_hash?: string;
  gas_used?: string;
  error_message?: string;
  created_at: Date;
  completed_at?: Date;
}

export interface RebalanceJob {
  id: string;
  wallet_group: string;
  target_allocation: Record<string, number>; // asset -> percentage
  current_allocation: Record<string, number>;
  rebalance_actions: RebalanceAction[];
  total_value_usd: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  error_message?: string;
  created_at: Date;
  completed_at?: Date;
}

export interface RebalanceAction {
  action_type: 'buy' | 'sell' | 'transfer';
  asset_symbol: string;
  amount: string;
  from_wallet?: string;
  to_wallet?: string;
  target_percentage: number;
  current_percentage: number;
  tx_hash?: string;
  status: 'pending' | 'completed' | 'failed';
}

export interface TreasuryAccount {
  id: string;
  address: string;
  name: string;
  account_type: 'primary' | 'gas_reservoir' | 'backup';
  environment: 'mainnet' | 'testnet';
  is_active: boolean;
  balance_snapshot_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface FundsConfig {
  min_gas_bnb: number;
  max_gas_bnb: number;
  sweep_min: number;
  rebalance_target: Record<string, number>;
  rebalance_band: number;
  treasury_address: string;
  gas_reservoir_address?: string;
  managed_wallet_groups: string[];
  supported_assets: string[];
  sweep_schedule_cron: string;
  rebalance_schedule_cron: string;
  balance_check_interval: number;
}

export interface FundsMetrics {
  total_managed_wallets: number;
  total_balance_usd: string;
  gas_top_ups_24h: number;
  sweeps_24h: number;
  rebalances_24h: number;
  wallets_below_gas_threshold: number;
  wallets_ready_for_sweep: number;
  allocation_drift_max: number;
  last_balance_update: Date;
}

export interface FundsAlert {
  id: string;
  alert_type: 'low_gas' | 'sweep_ready' | 'rebalance_needed' | 'job_failed' | 'wallet_anomaly';
  wallet_address?: string;
  asset_symbol?: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  is_resolved: boolean;
  metadata?: Record<string, any>;
  created_at: Date;
  resolved_at?: Date;
}

export interface BalanceThreshold {
  wallet_address: string;
  asset_symbol: string;
  min_threshold?: string;
  max_threshold?: string;
  alert_enabled: boolean;
  auto_action_enabled: boolean;
  auto_action_type?: 'gas_topup' | 'sweep' | 'rebalance';
}