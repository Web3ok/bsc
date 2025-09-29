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