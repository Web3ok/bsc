import { register, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { Logger } from 'pino';

// Define custom metrics for BSC bot monitoring
export class MetricsCollector {
  private static instance: MetricsCollector;
  
  // Trading metrics
  public readonly tradesTotal = new Counter({
    name: 'bsc_bot_trades_total',
    help: 'Total number of trades executed',
    labelNames: ['type', 'status', 'token_symbol', 'wallet_group']
  });

  public readonly tradeDuration = new Histogram({
    name: 'bsc_bot_trade_duration_seconds',
    help: 'Time taken to execute trades',
    labelNames: ['type', 'token_symbol'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120]
  });

  public readonly tradeVolume = new Counter({
    name: 'bsc_bot_trade_volume_bnb_total',
    help: 'Total trading volume in BNB',
    labelNames: ['type', 'token_symbol', 'wallet_group']
  });

  public readonly gasCost = new Counter({
    name: 'bsc_bot_gas_cost_bnb_total',
    help: 'Total gas costs in BNB',
    labelNames: ['operation_type', 'wallet_group']
  });

  public readonly slippageActual = new Histogram({
    name: 'bsc_bot_slippage_actual_percent',
    help: 'Actual slippage experienced in trades',
    labelNames: ['type', 'token_symbol'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 20, 50]
  });

  // Wallet metrics
  public readonly walletBalance = new Gauge({
    name: 'bsc_bot_wallet_balance_bnb',
    help: 'BNB balance of wallets',
    labelNames: ['wallet_address', 'wallet_group', 'wallet_label']
  });

  public readonly tokenBalance = new Gauge({
    name: 'bsc_bot_token_balance',
    help: 'Token balance of wallets',
    labelNames: ['wallet_address', 'token_address', 'token_symbol', 'wallet_group']
  });

  // Risk management metrics
  public readonly riskChecksTotal = new Counter({
    name: 'bsc_bot_risk_checks_total',
    help: 'Total number of risk checks performed',
    labelNames: ['status', 'violation_type']
  });

  public readonly riskViolations = new Counter({
    name: 'bsc_bot_risk_violations_total',
    help: 'Total number of risk violations',
    labelNames: ['type', 'severity', 'wallet_address']
  });

  // Infrastructure metrics
  public readonly rpcRequests = new Counter({
    name: 'bsc_bot_rpc_requests_total',
    help: 'Total RPC requests made',
    labelNames: ['provider_url', 'method', 'status']
  });

  public readonly rpcLatency = new Histogram({
    name: 'bsc_bot_rpc_latency_seconds',
    help: 'RPC request latency',
    labelNames: ['provider_url', 'method'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10]
  });

  public readonly rpcProviderHealth = new Gauge({
    name: 'bsc_bot_rpc_provider_healthy',
    help: 'RPC provider health status (1=healthy, 0=unhealthy)',
    labelNames: ['provider_url']
  });

  // Batch operation metrics
  public readonly batchOperations = new Counter({
    name: 'bsc_bot_batch_operations_total',
    help: 'Total batch operations executed',
    labelNames: ['type', 'strategy', 'status']
  });

  public readonly batchOperationDuration = new Histogram({
    name: 'bsc_bot_batch_operation_duration_seconds',
    help: 'Duration of batch operations',
    labelNames: ['type', 'strategy'],
    buckets: [1, 5, 10, 30, 60, 120, 300, 600]
  });

  public readonly batchConcurrency = new Gauge({
    name: 'bsc_bot_batch_concurrent_operations',
    help: 'Number of concurrent batch operations',
    labelNames: ['type']
  });

  // Price and market metrics
  public readonly priceImpact = new Histogram({
    name: 'bsc_bot_price_impact_percent',
    help: 'Price impact of trades',
    labelNames: ['token_symbol', 'trade_size_category'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 20]
  });

  public readonly tokenPrices = new Gauge({
    name: 'bsc_bot_token_price_bnb',
    help: 'Token prices in BNB',
    labelNames: ['token_address', 'token_symbol']
  });

  // Error and alert metrics
  public readonly errors = new Counter({
    name: 'bsc_bot_errors_total',
    help: 'Total errors encountered',
    labelNames: ['component', 'error_type', 'severity']
  });

  public readonly alerts = new Counter({
    name: 'bsc_bot_alerts_total',
    help: 'Total alerts generated',
    labelNames: ['type', 'severity', 'component']
  });

  // Nonce management metrics
  public readonly nonceGaps = new Gauge({
    name: 'bsc_bot_nonce_gaps',
    help: 'Number of nonce gaps detected',
    labelNames: ['wallet_address']
  });

  public readonly nonceReservations = new Gauge({
    name: 'bsc_bot_nonce_reservations_active',
    help: 'Number of active nonce reservations',
    labelNames: ['wallet_address']
  });

  private constructor() {
    // Enable default metrics collection (CPU, memory, etc.)
    collectDefaultMetrics({ register });
  }

  public static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  // Convenience methods for common operations
  recordTrade(
    type: 'buy' | 'sell' | 'swap',
    status: 'success' | 'failed' | 'reverted',
    duration: number,
    tokenSymbol: string,
    volumeBnb: string,
    gasCostBnb: string,
    actualSlippage: number,
    walletGroup: string = 'default'
  ): void {
    this.tradesTotal.inc({ type, status, token_symbol: tokenSymbol, wallet_group: walletGroup });
    this.tradeDuration.observe({ type, token_symbol: tokenSymbol }, duration);
    
    if (status === 'success') {
      this.tradeVolume.inc({ type, token_symbol: tokenSymbol, wallet_group: walletGroup }, parseFloat(volumeBnb));
      this.slippageActual.observe({ type, token_symbol: tokenSymbol }, actualSlippage);
    }
    
    this.gasCost.inc({ operation_type: `trade_${type}`, wallet_group: walletGroup }, parseFloat(gasCostBnb));
  }

  recordRiskCheck(
    status: 'allowed' | 'blocked' | 'warning',
    violationType?: string,
    violationSeverity?: 'low' | 'medium' | 'high' | 'critical',
    walletAddress?: string
  ): void {
    this.riskChecksTotal.inc({ status, violation_type: violationType || 'none' });
    
    if (status === 'blocked' && violationType && violationSeverity) {
      this.riskViolations.inc({
        type: violationType,
        severity: violationSeverity,
        wallet_address: walletAddress || 'unknown'
      });
    }
  }

  recordRpcRequest(
    providerUrl: string,
    method: string,
    status: 'success' | 'error' | 'timeout',
    latencySeconds: number
  ): void {
    this.rpcRequests.inc({ provider_url: providerUrl, method, status });
    
    if (status === 'success') {
      this.rpcLatency.observe({ provider_url: providerUrl, method }, latencySeconds);
    }
  }

  updateRpcProviderHealth(providerUrl: string, isHealthy: boolean): void {
    this.rpcProviderHealth.set({ provider_url: providerUrl }, isHealthy ? 1 : 0);
  }

  recordBatchOperation(
    type: 'trade' | 'transfer',
    strategy: 'sequential' | 'parallel' | 'staggered',
    status: 'success' | 'partial' | 'failed',
    duration: number,
    concurrentCount: number
  ): void {
    this.batchOperations.inc({ type, strategy, status });
    this.batchOperationDuration.observe({ type, strategy }, duration);
    this.batchConcurrency.set({ type }, concurrentCount);
  }

  updateWalletBalance(
    walletAddress: string,
    balanceBnb: string,
    walletGroup: string = 'default',
    walletLabel: string = ''
  ): void {
    this.walletBalance.set(
      { wallet_address: walletAddress, wallet_group: walletGroup, wallet_label: walletLabel },
      parseFloat(balanceBnb)
    );
  }

  updateTokenBalance(
    walletAddress: string,
    tokenAddress: string,
    tokenSymbol: string,
    balance: string,
    walletGroup: string = 'default'
  ): void {
    this.tokenBalance.set(
      { wallet_address: walletAddress, token_address: tokenAddress, token_symbol: tokenSymbol, wallet_group: walletGroup },
      parseFloat(balance)
    );
  }

  recordPriceImpact(tokenSymbol: string, priceImpact: number, tradeSizeBnb: string): void {
    const tradeSizeCategory = this.categorizeTradeSize(parseFloat(tradeSizeBnb));
    this.priceImpact.observe({ token_symbol: tokenSymbol, trade_size_category: tradeSizeCategory }, priceImpact);
  }

  updateTokenPrice(tokenAddress: string, tokenSymbol: string, priceBnb: string): void {
    this.tokenPrices.set({ token_address: tokenAddress, token_symbol: tokenSymbol }, parseFloat(priceBnb));
  }

  recordError(component: string, errorType: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    this.errors.inc({ component, error_type: errorType, severity });
  }

  recordAlert(type: string, severity: 'info' | 'warning' | 'critical', component: string): void {
    this.alerts.inc({ type, severity, component });
  }

  updateNonceMetrics(walletAddress: string, gaps: number, activeReservations: number): void {
    this.nonceGaps.set({ wallet_address: walletAddress }, gaps);
    this.nonceReservations.set({ wallet_address: walletAddress }, activeReservations);
  }

  private categorizeTradeSize(amountBnb: number): string {
    if (amountBnb < 0.1) return 'micro';
    if (amountBnb < 1) return 'small';
    if (amountBnb < 10) return 'medium';
    if (amountBnb < 100) return 'large';
    return 'whale';
  }

  // Get metrics for Prometheus scraping
  getMetrics(): Promise<string> {
    return register.metrics();
  }

  // Clear all metrics (useful for testing)
  clearMetrics(): void {
    register.clear();
  }
}

// Export singleton instance
export const metricsCollector = MetricsCollector.getInstance();