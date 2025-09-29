import { EventEmitter } from 'events';
import { logger } from './logger';
import { healthMonitor } from '../monitor/health';
import { metricsCollector } from '../monitor/metrics';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  name: string;
  severity: AlertSeverity;
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  acknowledged?: boolean;
}

export interface AlertRule {
  name: string;
  description: string;
  severity: AlertSeverity;
  condition: (metrics: any, health: any) => boolean;
  cooldown: number; // minutes
  enabled: boolean;
}

export class AlertingSystem extends EventEmitter {
  private static instance: AlertingSystem;
  private rules: Map<string, AlertRule> = new Map();
  private lastTriggered: Map<string, Date> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private running = false;

  private constructor() {
    super();
    this.setupDefaultRules();
  }

  public static getInstance(): AlertingSystem {
    if (!AlertingSystem.instance) {
      AlertingSystem.instance = new AlertingSystem();
    }
    return AlertingSystem.instance;
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    
    // Check alerts every 30 seconds
    this.checkInterval = setInterval(() => {
      this.checkAllRules().catch(error => {
        logger.error({ error }, 'Failed to check alert rules');
      });
    }, 30000);

    logger.info('Alerting system started');
  }

  stop(): void {
    if (!this.running) return;

    this.running = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    logger.info('Alerting system stopped');
  }

  private setupDefaultRules(): void {
    // Critical alerts
    this.addRule({
      name: 'system_down',
      description: 'System health check failed',
      severity: 'critical',
      condition: (metrics, health) => health.overall !== 'healthy',
      cooldown: 5, // 5 minutes
      enabled: true
    });

    this.addRule({
      name: 'emergency_stop_active', 
      description: 'Emergency stop has been activated',
      severity: 'critical',
      condition: (metrics, health) => health.emergency_status.active === true,
      cooldown: 1, // 1 minute
      enabled: true
    });

    this.addRule({
      name: 'high_error_rate',
      description: 'Market data error rate is too high',
      severity: 'critical', 
      condition: (metrics, health) => {
        const errorMetric = metrics.find((m: any) => m.name === 'market_data_errors_total');
        return errorMetric && errorMetric.value > 100; // More than 100 errors
      },
      cooldown: 10, // 10 minutes
      enabled: true
    });

    // Warning alerts
    this.addRule({
      name: 'websocket_disconnected',
      description: 'WebSocket connection lost',
      severity: 'warning',
      condition: (metrics, health) => {
        const wsCheck = health.checks.find((c: any) => c.name.includes('websocket'));
        return wsCheck && wsCheck.status !== 'healthy';
      },
      cooldown: 15, // 15 minutes
      enabled: true
    });

    this.addRule({
      name: 'high_memory_usage',
      description: 'Memory usage is high',
      severity: 'warning',
      condition: (metrics, health) => {
        const memoryMetric = metrics.find((m: any) => m.name === 'system_memory_usage_bytes');
        if (memoryMetric) {
          const usageGB = memoryMetric.value / (1024 * 1024 * 1024);
          return usageGB > 1; // More than 1GB
        }
        return false;
      },
      cooldown: 30, // 30 minutes
      enabled: true
    });

    this.addRule({
      name: 'high_cpu_usage',
      description: 'CPU usage is high',
      severity: 'warning', 
      condition: (metrics, health) => {
        const cpuMetric = metrics.find((m: any) => m.name === 'system_cpu_usage_percent');
        return cpuMetric && cpuMetric.value > 80; // More than 80%
      },
      cooldown: 20, // 20 minutes
      enabled: true
    });

    this.addRule({
      name: 'rpc_connection_issues',
      description: 'RPC connection health check failed',
      severity: 'warning',
      condition: (metrics, health) => {
        const rpcCheck = health.checks.find((c: any) => c.name === 'rpc_connection');
        return rpcCheck && rpcCheck.status !== 'healthy';
      },
      cooldown: 15, // 15 minutes
      enabled: true
    });

    this.addRule({
      name: 'stale_price_data',
      description: 'Price data is stale',
      severity: 'warning',
      condition: (metrics, health) => {
        // Check if last price update is older than 5 minutes
        const now = Date.now();
        const fiveMinutesAgo = now - (5 * 60 * 1000);
        
        // This would need to be implemented based on actual price update tracking
        return false; // Placeholder
      },
      cooldown: 30, // 30 minutes
      enabled: true
    });
  }

  addRule(rule: AlertRule): void {
    this.rules.set(rule.name, rule);
    logger.debug({ ruleName: rule.name }, 'Alert rule added');
  }

  removeRule(name: string): void {
    this.rules.delete(name);
    this.lastTriggered.delete(name);
    logger.debug({ ruleName: name }, 'Alert rule removed');
  }

  enableRule(name: string): void {
    const rule = this.rules.get(name);
    if (rule) {
      rule.enabled = true;
      logger.debug({ ruleName: name }, 'Alert rule enabled');
    }
  }

  disableRule(name: string): void {
    const rule = this.rules.get(name);
    if (rule) {
      rule.enabled = false;
      logger.debug({ ruleName: name }, 'Alert rule disabled');
    }
  }

  private async checkAllRules(): Promise<void> {
    try {
      // Get current system state
      const health = await healthMonitor.getSystemHealth();
      const metrics = this.getMetricsSnapshot();

      for (const [ruleName, rule] of this.rules) {
        if (!rule.enabled) continue;

        // Check cooldown
        const lastTriggered = this.lastTriggered.get(ruleName);
        if (lastTriggered) {
          const cooldownMs = rule.cooldown * 60 * 1000;
          if (Date.now() - lastTriggered.getTime() < cooldownMs) {
            continue; // Still in cooldown
          }
        }

        try {
          // Evaluate condition
          if (rule.condition(metrics, health)) {
            await this.triggerAlert(rule, { metrics, health });
          }
        } catch (error) {
          logger.error({ error, ruleName }, 'Failed to evaluate alert rule');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to check alert rules');
    }
  }

  private getMetricsSnapshot(): any[] {
    // Get current metrics from metricsCollector
    const status = metricsCollector.getStatus();
    const metrics: any[] = [];

    // Convert metrics to format expected by alert rules
    // This is a simplified version - in practice, you'd extract actual metric values
    
    return metrics;
  }

  private async triggerAlert(rule: AlertRule, context: any): Promise<void> {
    const alertId = `${rule.name}_${Date.now()}`;
    const alert: Alert = {
      id: alertId,
      name: rule.name,
      severity: rule.severity,
      message: rule.description,
      timestamp: new Date(),
      metadata: {
        rule: rule.name,
        context: context
      }
    };

    // Store alert
    this.activeAlerts.set(alertId, alert);
    this.lastTriggered.set(rule.name, new Date());

    // Log alert
    const logLevel = rule.severity === 'critical' ? 'error' : 
                     rule.severity === 'warning' ? 'warn' : 'info';
    
    logger[logLevel]({
      alert: {
        id: alertId,
        name: rule.name,
        severity: rule.severity,
        message: rule.description
      }
    }, `Alert triggered: ${rule.name}`);

    // Emit event for external handlers
    this.emit('alert', alert);

    // Call alert handlers
    await this.handleAlert(alert);
  }

  private async handleAlert(alert: Alert): Promise<void> {
    // Different handling based on severity
    switch (alert.severity) {
      case 'critical':
        await this.handleCriticalAlert(alert);
        break;
      case 'warning':
        await this.handleWarningAlert(alert);
        break;
      case 'info':
        await this.handleInfoAlert(alert);
        break;
    }
  }

  private async handleCriticalAlert(alert: Alert): Promise<void> {
    // For critical alerts, we might want to:
    // 1. Send immediate notifications
    // 2. Trigger emergency procedures
    // 3. Log to external monitoring systems
    
    logger.error({ alert }, 'CRITICAL ALERT - Immediate attention required');

    // If emergency stop is not already active, consider activating it for certain critical alerts
    if (alert.name === 'system_down' || alert.name === 'high_error_rate') {
      logger.warn('Critical alert detected - Consider emergency stop if issues persist');
    }
  }

  private async handleWarningAlert(alert: Alert): Promise<void> {
    // For warning alerts:
    // 1. Log appropriately
    // 2. Send notifications (email, Slack, etc.)
    // 3. Update monitoring dashboards
    
    logger.warn({ alert }, 'WARNING ALERT - Monitor closely');
  }

  private async handleInfoAlert(alert: Alert): Promise<void> {
    // For info alerts:
    // 1. Log for tracking
    // 2. Update metrics/dashboards
    
    logger.info({ alert }, 'INFO ALERT - For your awareness');
  }

  // Public methods for alert management
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  getAlert(id: string): Alert | undefined {
    return this.activeAlerts.get(id);
  }

  acknowledgeAlert(id: string): boolean {
    const alert = this.activeAlerts.get(id);
    if (alert) {
      alert.acknowledged = true;
      logger.info({ alertId: id }, 'Alert acknowledged');
      return true;
    }
    return false;
  }

  clearAlert(id: string): boolean {
    const deleted = this.activeAlerts.delete(id);
    if (deleted) {
      logger.info({ alertId: id }, 'Alert cleared');
    }
    return deleted;
  }

  getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  getStatus(): {
    running: boolean;
    ruleCount: number;
    activeAlertCount: number;
    lastCheckTime?: Date;
  } {
    return {
      running: this.running,
      ruleCount: this.rules.size,
      activeAlertCount: this.activeAlerts.size
    };
  }
}

export const alertingSystem = AlertingSystem.getInstance();