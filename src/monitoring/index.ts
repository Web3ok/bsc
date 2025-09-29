import { Logger } from 'pino';
import MonitoringServer from './server';
import { metricsCollector } from './metrics';
import { AlertManager } from './alerts';
import { rpcManager } from '../blockchain/rpc';
import { walletManager } from '../wallet';
import { enhancedRiskManager } from '../risk/enhanced-risk-manager';

export class SystemMonitor {
  private static instance: SystemMonitor;
  private monitoringServer: MonitoringServer;
  private alertManager: AlertManager;
  private monitoringInterval?: NodeJS.Timeout;
  private isRunning = false;

  private constructor(private logger: Logger) {
    this.monitoringServer = new MonitoringServer(logger);
    this.alertManager = this.monitoringServer.getAlertManager();
    this.setupEventListeners();
  }

  public static getInstance(logger?: Logger): SystemMonitor {
    if (!SystemMonitor.instance) {
      if (!logger) {
        throw new Error('Logger is required for first initialization');
      }
      SystemMonitor.instance = new SystemMonitor(logger);
    }
    return SystemMonitor.instance;
  }

  private setupEventListeners(): void {
    // Listen to alert events
    this.alertManager.on('alert', (alert) => {
      this.logger.warn({
        alertId: alert.id,
        type: alert.type,
        severity: alert.severity,
        component: alert.component,
        message: alert.message
      }, 'Alert triggered');
    });

    this.alertManager.on('alertAcknowledged', (alert) => {
      this.logger.info({
        alertId: alert.id,
        acknowledgedBy: alert.acknowledgedBy
      }, 'Alert acknowledged');
    });

    this.alertManager.on('alertResolved', (alert) => {
      this.logger.info({
        alertId: alert.id
      }, 'Alert resolved');
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('System monitor is already running');
      return;
    }

    try {
      // Start monitoring server
      await this.monitoringServer.start();

      // Start periodic monitoring
      this.startPeriodicMonitoring();

      this.isRunning = true;
      this.logger.info('System monitor started successfully');

    } catch (error) {
      this.logger.error({ error }, 'Failed to start system monitor');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Stop periodic monitoring
      this.stopPeriodicMonitoring();

      // Stop monitoring server
      await this.monitoringServer.stop();

      this.isRunning = false;
      this.logger.info('System monitor stopped');

    } catch (error) {
      this.logger.error({ error }, 'Error stopping system monitor');
      throw error;
    }
  }

  private startPeriodicMonitoring(): void {
    // Monitor every 30 seconds
    this.monitoringInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000);

    this.logger.info('Periodic monitoring started');
  }

  private stopPeriodicMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.logger.info('Periodic monitoring stopped');
    }
  }

  private async performHealthChecks(): Promise<void> {
    try {
      // Check RPC providers health
      await this.checkRpcProvidersHealth();

      // Check wallet balances
      await this.checkWalletBalances();

      // Update system metrics
      this.updateSystemMetrics();

    } catch (error) {
      this.logger.error({ error }, 'Error during health checks');
      metricsCollector.recordError('monitor', 'health_check_error', 'medium');
    }
  }

  private async checkRpcProvidersHealth(): Promise<void> {
    try {
      const healthStatus = rpcManager.getProvidersHealth();
      
      for (const [url, health] of healthStatus) {
        // Update metrics
        metricsCollector.updateRpcProviderHealth(url, health.isHealthy);

        // Check for alerts
        this.alertManager.checkRpcAlert({
          rpcProvider: url,
          rpcProviderHealthy: health.isHealthy,
          rpcLatency: health.latency / 1000 // Convert to seconds
        });
      }
    } catch (error) {
      this.logger.error({ error }, 'Error checking RPC providers health');
    }
  }

  private async checkWalletBalances(): Promise<void> {
    try {
      const wallets = await walletManager.listWallets();
      
      for (const wallet of wallets) {
        try {
          const balance = await rpcManager.getProvider().getBalance(wallet.address);
          const balanceBnb = parseFloat(balance.toString()) / 1e18;

          // Update metrics
          metricsCollector.updateWalletBalance(
            wallet.address,
            balanceBnb.toString(),
            wallet.group || 'default',
            wallet.label || ''
          );

          // Check for alerts
          this.alertManager.checkWalletAlert({
            walletAddress: wallet.address,
            walletBalance: balanceBnb.toString()
          });

        } catch (error) {
          this.logger.error({
            error,
            walletAddress: wallet.address
          }, 'Error checking wallet balance');
        }
      }
    } catch (error) {
      this.logger.error({ error }, 'Error checking wallet balances');
    }
  }

  private updateSystemMetrics(): void {
    try {
      // Update memory metrics
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const rssMemoryMB = Math.round(memUsage.rss / 1024 / 1024);

      // Custom gauge metrics for system monitoring
      metricsCollector.errors.inc({ component: 'system', error_type: 'none', severity: 'low' }, 0); // Initialize if needed

    } catch (error) {
      this.logger.error({ error }, 'Error updating system metrics');
    }
  }

  // Public methods for external components to record metrics and check alerts

  recordTrade(
    type: 'buy' | 'sell' | 'swap',
    status: 'success' | 'failed' | 'reverted',
    duration: number,
    tokenSymbol: string,
    volumeBnb: string,
    gasCostBnb: string,
    actualSlippage: number,
    priceImpact: number,
    walletGroup: string = 'default'
  ): void {
    metricsCollector.recordTrade(type, status, duration, tokenSymbol, volumeBnb, gasCostBnb, actualSlippage, walletGroup);
    
    // Check for trade-related alerts
    this.alertManager.checkTradeAlert({
      tokenSymbol,
      tradeAmount: volumeBnb,
      slippage: actualSlippage,
      priceImpact
    });
  }

  recordRiskCheck(
    status: 'allowed' | 'blocked' | 'warning',
    walletAddress: string,
    violationType?: string,
    violationSeverity?: 'low' | 'medium' | 'high' | 'critical'
  ): void {
    metricsCollector.recordRiskCheck(status, violationType, violationSeverity, walletAddress);

    // Check for risk alerts
    if (status === 'blocked' || status === 'warning') {
      this.alertManager.checkRiskAlert({
        walletAddress,
        riskViolationType: violationType,
        riskViolationSeverity: violationSeverity
      });
    }
  }

  recordRpcRequest(
    providerUrl: string,
    method: string,
    status: 'success' | 'error' | 'timeout',
    latencyMs: number
  ): void {
    metricsCollector.recordRpcRequest(providerUrl, method, status, latencyMs / 1000);

    // Check for RPC alerts
    this.alertManager.checkRpcAlert({
      rpcProvider: providerUrl,
      rpcLatency: latencyMs / 1000,
      rpcProviderHealthy: status === 'success'
    });
  }

  recordBatchOperation(
    type: 'trade' | 'transfer',
    strategy: 'sequential' | 'parallel' | 'staggered',
    status: 'success' | 'partial' | 'failed',
    duration: number,
    totalOperations: number,
    failedOperations: number,
    concurrentCount: number
  ): void {
    metricsCollector.recordBatchOperation(type, strategy, status, duration, concurrentCount);

    // Check for batch alerts
    const failureRate = failedOperations / totalOperations;
    this.alertManager.checkBatchAlert({
      batchSize: totalOperations,
      batchFailureRate: failureRate
    });
  }

  recordGasPrice(gasPriceGwei: string): void {
    this.alertManager.checkGasAlert({
      gasPrice: gasPriceGwei
    });
  }

  recordError(component: string, errorType: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    metricsCollector.recordError(component, errorType, severity);
  }

  updateTokenPrice(tokenAddress: string, tokenSymbol: string, priceBnb: string): void {
    metricsCollector.updateTokenPrice(tokenAddress, tokenSymbol, priceBnb);
  }

  recordPriceImpact(tokenSymbol: string, priceImpact: number, tradeSizeBnb: string): void {
    metricsCollector.recordPriceImpact(tokenSymbol, priceImpact, tradeSizeBnb);
  }

  updateTokenBalance(
    walletAddress: string,
    tokenAddress: string,
    tokenSymbol: string,
    balance: string,
    walletGroup: string = 'default'
  ): void {
    metricsCollector.updateTokenBalance(walletAddress, tokenAddress, tokenSymbol, balance, walletGroup);
  }

  // Getters for external access
  getMetricsCollector() {
    return metricsCollector;
  }

  getAlertManager(): AlertManager {
    return this.alertManager;
  }

  isHealthy(): boolean {
    return this.isRunning;
  }

  getStatus() {
    return {
      running: this.isRunning,
      activeAlerts: this.alertManager.getActiveAlerts().length,
      totalAlerts: this.alertManager.getTotalAlertsCount(),
      uptime: process.uptime()
    };
  }
}

// Export singleton instance creator
export function createSystemMonitor(logger: Logger): SystemMonitor {
  return SystemMonitor.getInstance(logger);
}

// Export the instance getter
export function getSystemMonitor(): SystemMonitor | null {
  try {
    return SystemMonitor.getInstance();
  } catch {
    return null;
  }
}

// Re-export other monitoring components
export { metricsCollector } from './metrics';
export { AlertManager } from './alerts';
export type { Alert, AlertContext, AlertRule } from './alerts';