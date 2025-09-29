import fs from 'fs';
import path from 'path';
import TOML from 'toml';
import { load as loadYAML } from 'js-yaml';
import dotenv from 'dotenv';
import { randomBytes } from 'crypto';
import { ChainConfig, TokenInfo, GasConfig, RiskConfig } from '../utils/types';

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: any = {};
  private tokens: TokenInfo[] = [];
  private devFallbackPassword?: string;

  private constructor() {
    this.loadEnvironment();
    this.loadConfigs();
  }

  static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  private loadEnvironment() {
    dotenv.config();
  }

  private loadConfigs() {
    try {
      // Load main application config
      const appConfigPath = path.resolve('./configs/app.toml');
      if (fs.existsSync(appConfigPath)) {
        const appConfigContent = fs.readFileSync(appConfigPath, 'utf8');
        this.config = TOML.parse(appConfigContent);
      }

      // Load tokens config
      const tokensConfigPath = path.resolve('./configs/tokens.yml');
      if (fs.existsSync(tokensConfigPath)) {
        const tokensConfigContent = fs.readFileSync(tokensConfigPath, 'utf8');
        const tokensConfig = loadYAML(tokensConfigContent) as any;
        this.tokens = tokensConfig.tokens || [];
      }
    } catch (error) {
      console.warn(`Config loading error: ${error}`);
    }
  }

  getChainConfig(): ChainConfig {
    const envOverrides = {
      rpc: {
        primaryUrls: process.env.RPC_URL ? [process.env.RPC_URL] : undefined,
        backupUrls: process.env.RPC_BACKUP_URLS?.split(','),
        maxRetries: process.env.RPC_MAX_RETRIES ? parseInt(process.env.RPC_MAX_RETRIES) : undefined,
        timeoutMs: process.env.RPC_TIMEOUT_MS ? parseInt(process.env.RPC_TIMEOUT_MS) : undefined,
        rateLimitPerSecond: process.env.RPC_RATE_LIMIT_PER_SECOND ? 
          parseInt(process.env.RPC_RATE_LIMIT_PER_SECOND) : undefined
      }
    };

    return {
      id: process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID) : this.config.chain?.id || 56,
      name: this.config.chain?.name || 'BSC',
      wbnbAddress: process.env.WBNB_ADDRESS || this.config.chain?.wbnb_address || 
        '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      rpc: {
        primaryUrls: envOverrides.rpc.primaryUrls || this.config.rpc?.primary_urls || 
          [
            'https://bsc-dataseed1.binance.org/',
            'https://bsc-dataseed2.binance.org/',
            'https://bsc-dataseed3.binance.org/',
            'https://bsc-dataseed4.binance.org/'
          ],
        backupUrls: envOverrides.rpc.backupUrls || this.config.rpc?.backup_urls || [
          'https://bsc-dataseed1.defibit.io/',
          'https://bsc-dataseed2.defibit.io/',
          'https://bsc-dataseed1.ninicoin.io/',
          'https://bsc.rpc.blxrbdn.com/',
          'https://rpc.ankr.com/bsc',
          'https://bsc.blockpi.network/v1/rpc/public',
          'https://bsc-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3'
        ],
        maxRetries: envOverrides.rpc.maxRetries || this.config.rpc?.max_retries || 3,
        timeoutMs: envOverrides.rpc.timeoutMs || this.config.rpc?.timeout_ms || 5000,
        rateLimitPerSecond: envOverrides.rpc.rateLimitPerSecond || 
          this.config.rpc?.rate_limit_per_second || 15,
        healthCheckInterval: this.config.rpc?.health_check_interval || 15
      }
    };
  }

  getGasConfig(): GasConfig {
    return {
      autoGas: process.env.AUTO_GAS === 'true' || this.config.gas?.auto_gas || true,
      maxGasPriceGwei: process.env.MAX_GAS_PRICE_GWEI ? 
        parseFloat(process.env.MAX_GAS_PRICE_GWEI) : this.config.gas?.max_gas_price_gwei || 20,
      priorityFeeGwei: process.env.PRIORITY_FEE_GWEI ? 
        parseFloat(process.env.PRIORITY_FEE_GWEI) : this.config.gas?.priority_fee_gwei || 2,
      gasMultiplier: this.config.gas?.gas_multiplier || 1.1
    };
  }

  getRiskConfig(): RiskConfig {
    return {
      enableWhitelist: this.config.risk?.enable_whitelist || true,
      enableBlacklist: this.config.risk?.enable_blacklist || true,
      emergencyStopLossPercent: process.env.EMERGENCY_STOP_LOSS_PERCENT ?
        parseFloat(process.env.EMERGENCY_STOP_LOSS_PERCENT) : 
        this.config.risk?.emergency_stop_loss_percent || 10,
      maxWalletExposurePercent: this.config.risk?.max_wallet_exposure_percent || 20
    };
  }

  getPancakeSwapConfig() {
    return {
      v2Router: process.env.PANCAKESWAP_V2_ROUTER || this.config.pancakeswap?.v2_router ||
        '0x10ED43C718714eb63d5aA57B78B54704E256024E',
      v2Factory: process.env.PANCAKESWAP_V2_FACTORY || this.config.pancakeswap?.v2_factory ||
        '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
      v3Router: process.env.PANCAKESWAP_V3_ROUTER || this.config.pancakeswap?.v3_router ||
        '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4',
      v3Factory: process.env.PANCAKESWAP_V3_FACTORY || this.config.pancakeswap?.v3_factory ||
        '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865'
    };
  }

  getTradingConfig() {
    return {
      defaultSlippage: process.env.DEFAULT_SLIPPAGE ? 
        parseFloat(process.env.DEFAULT_SLIPPAGE) : this.config.trading?.default_slippage || 0.5,
      maxSlippage: process.env.MAX_SLIPPAGE ? 
        parseFloat(process.env.MAX_SLIPPAGE) : this.config.trading?.max_slippage || 5.0,
      maxPriceImpact: process.env.MAX_PRICE_IMPACT ? 
        parseFloat(process.env.MAX_PRICE_IMPACT) : this.config.trading?.max_price_impact || 3.0,
      deadlineMinutes: process.env.DEFAULT_DEADLINE_MINUTES ? 
        parseInt(process.env.DEFAULT_DEADLINE_MINUTES) : this.config.trading?.deadline_minutes || 20,
      minTradeValueBnb: this.config.trading?.min_trade_value_bnb || 0.001
    };
  }

  getLimitsConfig() {
    return {
      maxConcurrentTransactions: process.env.MAX_CONCURRENT_TRANSACTIONS ?
        parseInt(process.env.MAX_CONCURRENT_TRANSACTIONS) : 
        this.config.limits?.max_concurrent_transactions || 5,
      transactionRateLimitPerSecond: process.env.TRANSACTION_RATE_LIMIT_PER_SECOND ?
        parseInt(process.env.TRANSACTION_RATE_LIMIT_PER_SECOND) : 
        this.config.limits?.transaction_rate_limit_per_second || 2,
      batchSizeLimit: process.env.BATCH_SIZE_LIMIT ?
        parseInt(process.env.BATCH_SIZE_LIMIT) : this.config.limits?.batch_size_limit || 50,
      maxPositionSizeBnb: process.env.MAX_POSITION_SIZE_BNB ?
        parseFloat(process.env.MAX_POSITION_SIZE_BNB) : 
        this.config.limits?.max_position_size_bnb || 10,
      maxDailyVolumeBnb: process.env.MAX_DAILY_VOLUME_BNB ?
        parseFloat(process.env.MAX_DAILY_VOLUME_BNB) : 
        this.config.limits?.max_daily_volume_bnb || 100
    };
  }

  getTokens(): TokenInfo[] {
    return this.tokens;
  }

  getTokenByAddress(address: string): TokenInfo | undefined {
    return this.tokens.find(token => 
      token.address.toLowerCase() === address.toLowerCase());
  }

  getTokenBySymbol(symbol: string): TokenInfo | undefined {
    return this.tokens.find(token => 
      token.symbol.toLowerCase() === symbol.toLowerCase());
  }

  isTokenWhitelisted(address: string): boolean {
    const token = this.getTokenByAddress(address);
    return token?.whitelisted || false;
  }

  isTokenBlacklisted(address: string): boolean {
    const token = this.getTokenByAddress(address);
    return token?.blacklisted || false;
  }

  getDatabaseConfig() {
    return {
      type: process.env.DATABASE_TYPE || this.config.database?.type || 'sqlite',
      path: process.env.DATABASE_PATH || this.config.database?.path || './data/bot.db',
      url: process.env.DATABASE_URL || this.config.database?.url
    };
  }

  getApiConfig() {
    return {
      port: process.env.API_PORT ? parseInt(process.env.API_PORT) : 
        this.config.api?.port || 3000,
      enableWebInterface: process.env.ENABLE_WEB_INTERFACE === 'true' || 
        this.config.api?.enable_web_interface || false,
      corsEnabled: this.config.api?.cors_enabled !== false,
      rateLimitRequestsPerMinute: this.config.api?.rate_limit_requests_per_minute || 100,
      secret: process.env.API_SECRET || 'your-api-secret-key-here'
    };
  }

  getMonitoringConfig() {
    return {
      logLevel: process.env.LOG_LEVEL || this.config.monitoring?.log_level || 'info',
      enableMetrics: process.env.ENABLE_METRICS === 'true' || 
        this.config.monitoring?.enable_metrics || true,
      metricsPort: process.env.METRICS_PORT ? parseInt(process.env.METRICS_PORT) :
        this.config.monitoring?.metrics_port || 9090,
      enableAlerts: this.config.monitoring?.enable_alerts !== false
    };
  }

  getEncryptionPassword(): string {
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
}
