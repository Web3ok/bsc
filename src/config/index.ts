import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as toml from 'toml';
import { randomBytes } from 'crypto';
import { BSC_MAINNET_ADDRESSES, BSC_TESTNET_ADDRESSES } from './constants';

config();

interface RpcConfig {
  primary_urls: string[];
  backup_urls: string[];
  max_retries: number;
  timeout_ms: number;
  rate_limit_per_second: number;
  health_check_interval: number;
}

interface ChainConfig {
  id: number;
  name: string;
  wbnb_address?: string;
}

interface GasConfig {
  default_gas_limit: number;
  max_gas_price_gwei: number;
  priority_fee_gwei: number;
  gas_multiplier: number;
}

interface TradingConfig {
  default_slippage: number;
  max_slippage: number;
  deadline_minutes: number;
  min_bnb_balance: number;
  max_price_impact: number;
}

interface AppConfig {
  chain: ChainConfig;
  addresses: Record<string, string>;
  rpc: RpcConfig;
  gas: GasConfig;
  trading: TradingConfig;
  concurrency: {
    max_concurrent_transactions: number;
    max_concurrent_per_wallet: number;
    batch_size: number;
    rate_limit_per_minute: number;
  };
  retry: {
    max_retries: number;
    base_delay_ms: number;
    max_delay_ms: number;
    backoff_multiplier: number;
  };
  risk: {
    enable_whitelist: boolean;
    enable_blacklist: boolean;
    max_daily_volume_bnb: number;
    max_single_trade_bnb: number;
    suspicious_slippage_threshold: number;
  };
  monitoring: {
    enable_metrics: boolean;
    metrics_port: number;
    health_check_port: number;
    api_port: number;
    log_level: string;
  };
}

class ConfigManager {
  private static instance: ConfigManager;
  private appConfig!: AppConfig;
  private devFallbackPassword?: string;

  private constructor() {
    this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): void {
    const configPath = path.join(process.cwd(), 'configs', 'app.toml');
    
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      this.appConfig = toml.parse(configContent) as AppConfig;
    } catch (error) {
      throw new Error(`Failed to parse config file: ${error}`);
    }
  }

  public get config(): AppConfig {
    return this.appConfig;
  }

  public get chainId(): number {
    return this.appConfig.chain.id;
  }

  public get addresses() {
    return this.chainId === 56 ? BSC_MAINNET_ADDRESSES : BSC_TESTNET_ADDRESSES;
  }

  public get rpcUrls(): string[] {
    return [
      ...this.appConfig.rpc.primary_urls,
      ...this.appConfig.rpc.backup_urls,
    ];
  }

  public get isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  }

  public get isTestnet(): boolean {
    return this.chainId === 97;
  }

  public get encryptionPassword(): string {
    const password = process.env.ENCRYPTION_PASSWORD;
    if (password && password.trim().length > 0) {
      return password.trim();
    }

    if (process.env.ALLOW_DEV_ENCRYPTION_FALLBACK === 'true') {
      if (!this.devFallbackPassword) {
        this.devFallbackPassword = randomBytes(32).toString('hex');
        console.warn('[config] ENCRYPTION_PASSWORD not set. Using temporary development password. DO NOT USE IN PRODUCTION.');
      }
      return this.devFallbackPassword;
    }

    throw new Error('ENCRYPTION_PASSWORD is required. Set it in your environment or .env file. (Tip: set ALLOW_DEV_ENCRYPTION_FALLBACK=true for ephemeral dev mode.)');
  }

  public get walletStoragePath(): string {
    return process.env.WALLET_STORAGE_PATH || './wallets';
  }

  public get dbPath(): string {
    return process.env.DB_PATH || './data/bot.db';
  }
}

export const configManager = ConfigManager.getInstance();
export type { AppConfig, RpcConfig, ChainConfig, GasConfig, TradingConfig };
