import { Logger } from 'pino';
import { EventEmitter } from 'events';
import { metricsCollector } from './metrics';

export interface Alert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  component: string;
  message: string;
  details?: Record<string, any>;
  timestamp: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolved: boolean;
  resolvedAt?: Date;
  count: number; // For duplicate alerts
  lastOccurrence: Date;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  component: string;
  condition: (context: AlertContext) => boolean;
  message: (context: AlertContext) => string;
  cooldownMs: number; // Minimum time between duplicate alerts
  autoResolve: boolean;
  autoResolveAfterMs?: number;
}

export interface AlertContext {
  walletAddress?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  tradeAmount?: string;
  gasPrice?: string;
  slippage?: number;
  priceImpact?: number;
  errorMessage?: string;
  rpcProvider?: string;
  batchSize?: number;
  [key: string]: any;
}

export class AlertManager extends EventEmitter {
  private alerts: Map<string, Alert> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private isRunning = false;

  constructor(private logger: Logger) {
    super();
    this.setupDefaultAlertRules();
  }

  private setupDefaultAlertRules(): void {
    // Trading alerts
    this.addAlertRule({
      id: 'high_slippage',
      name: 'High Slippage Detected',
      description: 'Trade executed with slippage higher than expected',
      severity: 'warning',
      component: 'trading',
      condition: (ctx) => (ctx.slippage || 0) > 5,
      message: (ctx) => `High slippage detected: ${ctx.slippage?.toFixed(2)}% for ${ctx.tokenSymbol} trade`,
      cooldownMs: 60000, // 1 minute
      autoResolve: true,
      autoResolveAfterMs: 300000 // 5 minutes
    });

    this.addAlertRule({
      id: 'extreme_price_impact',
      name: 'Extreme Price Impact',
      description: 'Trade would cause extreme price impact',
      severity: 'critical',
      component: 'trading',
      condition: (ctx) => (ctx.priceImpact || 0) > 10,
      message: (ctx) => `Extreme price impact: ${ctx.priceImpact?.toFixed(2)}% for ${ctx.tokenSymbol} trade of ${ctx.tradeAmount} BNB`,
      cooldownMs: 30000, // 30 seconds
      autoResolve: false
    });

    this.addAlertRule({
      id: 'high_gas_price',
      name: 'High Gas Price',
      description: 'Gas price is unusually high',
      severity: 'warning',
      component: 'blockchain',
      condition: (ctx) => parseFloat(ctx.gasPrice || '0') > 20, // > 20 gwei
      message: (ctx) => `High gas price detected: ${ctx.gasPrice} gwei`,
      cooldownMs: 300000, // 5 minutes
      autoResolve: true,
      autoResolveAfterMs: 600000 // 10 minutes
    });

    // Wallet alerts
    this.addAlertRule({
      id: 'low_wallet_balance',
      name: 'Low Wallet Balance',
      description: 'Wallet balance is below minimum threshold',
      severity: 'warning',
      component: 'wallet',
      condition: (ctx) => parseFloat(ctx.walletBalance || '0') < 0.01, // < 0.01 BNB
      message: (ctx) => `Low balance in wallet ${ctx.walletAddress}: ${ctx.walletBalance} BNB`,
      cooldownMs: 1800000, // 30 minutes
      autoResolve: true,
      autoResolveAfterMs: 3600000 // 1 hour
    });

    this.addAlertRule({
      id: 'wallet_balance_critical',
      name: 'Critical Wallet Balance',
      description: 'Wallet balance is critically low',
      severity: 'critical',
      component: 'wallet',
      condition: (ctx) => parseFloat(ctx.walletBalance || '0') < 0.001, // < 0.001 BNB
      message: (ctx) => `Critical low balance in wallet ${ctx.walletAddress}: ${ctx.walletBalance} BNB`,
      cooldownMs: 600000, // 10 minutes
      autoResolve: false
    });

    // RPC provider alerts
    this.addAlertRule({
      id: 'rpc_provider_down',
      name: 'RPC Provider Unavailable',
      description: 'RPC provider is not responding',
      severity: 'critical',
      component: 'infrastructure',
      condition: (ctx) => ctx.rpcProviderHealthy === false,
      message: (ctx) => `RPC provider ${ctx.rpcProvider} is unavailable`,
      cooldownMs: 120000, // 2 minutes
      autoResolve: true,
      autoResolveAfterMs: 300000 // 5 minutes
    });

    this.addAlertRule({
      id: 'rpc_high_latency',
      name: 'High RPC Latency',
      description: 'RPC requests are taking too long',
      severity: 'warning',
      component: 'infrastructure',
      condition: (ctx) => (ctx.rpcLatency || 0) > 5, // > 5 seconds
      message: (ctx) => `High RPC latency: ${ctx.rpcLatency?.toFixed(2)}s for ${ctx.rpcProvider}`,
      cooldownMs: 300000, // 5 minutes
      autoResolve: true,
      autoResolveAfterMs: 600000 // 10 minutes
    });

    // Risk management alerts
    this.addAlertRule({
      id: 'risk_violation',
      name: 'Risk Management Violation',
      description: 'Risk management rule violated',
      severity: 'warning',
      component: 'risk',
      condition: (ctx) => ctx.riskViolationType !== undefined,
      message: (ctx) => `Risk violation: ${ctx.riskViolationType} for wallet ${ctx.walletAddress}`,
      cooldownMs: 60000, // 1 minute
      autoResolve: true,
      autoResolveAfterMs: 1800000 // 30 minutes
    });

    this.addAlertRule({
      id: 'critical_risk_violation',
      name: 'Critical Risk Violation',
      description: 'Critical risk management rule violated',
      severity: 'critical',
      component: 'risk',
      condition: (ctx) => ctx.riskViolationSeverity === 'critical',
      message: (ctx) => `Critical risk violation: ${ctx.riskViolationType} for wallet ${ctx.walletAddress}`,
      cooldownMs: 30000, // 30 seconds
      autoResolve: false
    });

    // Batch operation alerts
    this.addAlertRule({
      id: 'batch_operation_failed',
      name: 'Batch Operation Failed',
      description: 'Batch operation completed with failures',
      severity: 'warning',
      component: 'batch',
      condition: (ctx) => (ctx.batchFailureRate || 0) > 0.2, // > 20% failure rate
      message: (ctx) => `Batch operation failed: ${((ctx.batchFailureRate || 0) * 100).toFixed(1)}% failure rate for ${ctx.batchSize} operations`,
      cooldownMs: 60000, // 1 minute
      autoResolve: true,
      autoResolveAfterMs: 300000 // 5 minutes
    });

    // System alerts
    this.addAlertRule({
      id: 'high_memory_usage',
      name: 'High Memory Usage',
      description: 'System memory usage is high',
      severity: 'warning',
      component: 'system',
      condition: (ctx) => (ctx.memoryUsagePercent || 0) > 80,
      message: (ctx) => `High memory usage: ${ctx.memoryUsagePercent?.toFixed(1)}%`,
      cooldownMs: 600000, // 10 minutes
      autoResolve: true,
      autoResolveAfterMs: 1200000 // 20 minutes
    });
  }

  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    this.logger.debug({ ruleId: rule.id, ruleName: rule.name }, 'Alert rule added');
  }

  removeAlertRule(ruleId: string): void {
    this.alertRules.delete(ruleId);
    this.logger.debug({ ruleId }, 'Alert rule removed');
  }

  checkAlert(ruleId: string, context: AlertContext): void {
    const rule = this.alertRules.get(ruleId);
    if (!rule) {
      this.logger.warn({ ruleId }, 'Alert rule not found');
      return;
    }

    try {
      if (rule.condition(context)) {
        this.triggerAlert(rule, context);
      }
    } catch (error) {
      this.logger.error({ error, ruleId }, 'Error checking alert rule');
    }
  }

  private triggerAlert(rule: AlertRule, context: AlertContext): void {
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(rule.id);

    // Check cooldown
    if (lastAlert && (now - lastAlert) < rule.cooldownMs) {
      return;
    }

    const alertId = `${rule.id}_${Date.now()}`;
    const message = rule.message(context);

    // Check if similar alert already exists
    const existingAlert = Array.from(this.alerts.values()).find(
      alert => alert.type === rule.id && !alert.resolved && alert.message === message
    );

    if (existingAlert) {
      // Update existing alert
      existingAlert.count++;
      existingAlert.lastOccurrence = new Date();
      this.logger.debug({ alertId: existingAlert.id, count: existingAlert.count }, 'Alert count updated');
    } else {
      // Create new alert
      const alert: Alert = {
        id: alertId,
        type: rule.id,
        severity: rule.severity,
        component: rule.component,
        message,
        details: context,
        timestamp: new Date(),
        acknowledged: false,
        resolved: false,
        count: 1,
        lastOccurrence: new Date()
      };

      this.alerts.set(alertId, alert);
      this.lastAlertTime.set(rule.id, now);

      // Record metric
      metricsCollector.recordAlert(rule.id, rule.severity, rule.component);

      // Emit event
      this.emit('alert', alert);

      this.logger.warn({
        alertId,
        type: rule.id,
        severity: rule.severity,
        component: rule.component,
        message
      }, 'Alert triggered');

      // Schedule auto-resolve if configured
      if (rule.autoResolve && rule.autoResolveAfterMs) {
        setTimeout(() => {
          this.resolveAlert(alertId, 'auto-resolved');
        }, rule.autoResolveAfterMs);
      }
    }
  }

  acknowledgeAlert(alertId: string, acknowledgedBy: string = 'system'): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.acknowledged) {
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;

    this.emit('alertAcknowledged', alert);
    this.logger.info({ alertId, acknowledgedBy }, 'Alert acknowledged');
    return true;
  }

  resolveAlert(alertId: string, resolvedBy: string = 'system'): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.resolved) {
      return false;
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();

    this.emit('alertResolved', alert);
    this.logger.info({ alertId, resolvedBy }, 'Alert resolved');
    return true;
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.resolved)
      .sort((a, b) => {
        // Sort by severity then by timestamp
        const severityOrder = { critical: 3, warning: 2, info: 1 };
        const aSeverity = severityOrder[a.severity];
        const bSeverity = severityOrder[b.severity];
        
        if (aSeverity !== bSeverity) {
          return bSeverity - aSeverity;
        }
        
        return b.timestamp.getTime() - a.timestamp.getTime();
      });
  }

  getAlertHistory(limit: number = 100): Alert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  getTotalAlertsCount(): number {
    return this.alerts.size;
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.logger.info('Alert manager started');

    // Start periodic monitoring for system alerts
    this.monitoringInterval = setInterval(() => {
      this.checkSystemAlerts();
    }, 60000); // Check every minute
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.logger.info('Alert manager stopped');
  }

  private checkSystemAlerts(): void {
    try {
      // Check memory usage
      const memUsage = process.memoryUsage();
      const totalMemory = memUsage.rss + memUsage.external;
      const memoryUsagePercent = (totalMemory / (1024 * 1024 * 1024)) * 100; // Rough percentage

      this.checkAlert('high_memory_usage', { memoryUsagePercent });

    } catch (error) {
      this.logger.error({ error }, 'Error checking system alerts');
    }
  }

  // Convenience methods for common alerts
  checkTradeAlert(context: AlertContext): void {
    this.checkAlert('high_slippage', context);
    this.checkAlert('extreme_price_impact', context);
  }

  checkWalletAlert(context: AlertContext): void {
    this.checkAlert('low_wallet_balance', context);
    this.checkAlert('wallet_balance_critical', context);
  }

  checkRpcAlert(context: AlertContext): void {
    this.checkAlert('rpc_provider_down', context);
    this.checkAlert('rpc_high_latency', context);
  }

  checkRiskAlert(context: AlertContext): void {
    this.checkAlert('risk_violation', context);
    this.checkAlert('critical_risk_violation', context);
  }

  checkBatchAlert(context: AlertContext): void {
    this.checkAlert('batch_operation_failed', context);
  }

  checkGasAlert(context: AlertContext): void {
    this.checkAlert('high_gas_price', context);
  }
}