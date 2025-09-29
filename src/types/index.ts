// Core types for the BSC Market Maker Bot

export interface WalletInfo {
  address: string;
  privateKey: string;
  mnemonic?: string;
  derivationPath?: string;
  index?: number;
  label?: string;
  group?: string;
}

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  whitelisted: boolean;
  blacklisted: boolean;
  category: string;
  minLiquidityBnb?: number;
}

export interface TradeParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin?: string;
  slippage: number;
  deadline?: number;
  wallet?: string;
}

export interface TransferParams {
  to: string;
  token: string;
  amount: string;
  wallet?: string;
}

export interface BatchOperation {
  id: string;
  type: 'trade' | 'transfer' | 'approve';
  params: any;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  txHash?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface BatchOperationResult {
  id: string;
  success: boolean;
  txHash?: string;
  error?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
  generated?: any; // For backward compatibility
}

export interface ChainConfig {
  id: number;
  name: string;
  wbnbAddress: string;
  rpc: {
    primaryUrls: string[];
    backupUrls: string[];
    maxRetries: number;
    timeoutMs: number;
    rateLimitPerSecond: number;
    healthCheckInterval: number;
  };
}

export interface GasConfig {
  autoGas: boolean;
  maxGasPriceGwei: number;
  priorityFeeGwei: number;
  gasMultiplier: number;
}

export interface RiskConfig {
  enableWhitelist: boolean;
  enableBlacklist: boolean;
  emergencyStopLossPercent: number;
  maxWalletExposurePercent: number;
}

export type WalletTier = 'hot' | 'warm' | 'cold' | 'vault' | 'strategy' | 'treasury';

export type DEXType = 'pancakeswap-v2' | 'pancakeswap-v3' | 'pancakeswap-v4' | 'uniswap-v3' | 'biswap' | 'apeswap';

export interface DEXQuote {
  dex: DEXType;
  amountOut: string;
  priceImpact: string;
  gasEstimate: string;
  route: string[];
  fee?: string;
  hookAddress?: string;
}

export interface AggregatedQuote {
  bestQuote: DEXQuote;
  allQuotes: DEXQuote[];
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage: number;
}

export interface BatchTradeRequest {
  walletAddress: string;
  trades: Array<{
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage?: number;
    dex?: DEXType;
  }>;
  maxGasPrice?: number;
  deadline?: number;
}

// Strategy types
export interface RiskLimits {
  max_position_size: string;
  max_daily_volume: string;
  max_slippage_percent: number;
  max_concurrent_orders: number;
  max_drawdown_percent: number;
  max_daily_loss?: string;
}

export interface GridStrategyParams {
  grid_spacing: string;
  grid_count: number;
  base_order_size: string;
  upper_price: string;
  lower_price: string;
  center_price?: string;
  rebalance_threshold: number;
  inventory_target: number;
}

export type OrderType = 'market' | 'limit' | 'stop_loss' | 'take_profit';
export type OrderSide = 'buy' | 'sell';

export interface OrderRequest {
  id: string;
  strategy_id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: string;
  price?: string;
  stop_price?: string;
  time_in_force?: 'GTC' | 'IOC' | 'FOK';
  expire_time?: Date;
  reduce_only?: boolean;
  metadata?: Record<string, any>;
}

export interface ExecutionOrder {
  id: string;
  strategyId: string;
  type: 'buy' | 'sell' | 'close';
  amount: string;
  price?: string;
  status: 'pending' | 'submitted' | 'filled' | 'cancelled' | 'failed';
  createdAt: Date;
  executedAt?: Date;
}

// Error handling types
export type ErrorContext = Record<string, unknown>;

export interface SystemError extends Error {
  code?: string;
  context?: ErrorContext;
}