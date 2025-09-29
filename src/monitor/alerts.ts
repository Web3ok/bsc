import { logger } from '../utils/logger';

export interface Alert {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface AlertChannel {
  name: string;
  send(alert: Alert): Promise<void>;
}

// Webhook alert channel
export class WebhookAlertChannel implements AlertChannel {
  public readonly name = 'webhook';
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(alert: Alert): Promise<void> {
    try {
      const payload = {
        text: `[${alert.type.toUpperCase()}] ${alert.title}`,
        attachments: [
          {
            color: this.getColor(alert.type),
            title: alert.title,
            text: alert.message,
            fields: alert.metadata ? Object.entries(alert.metadata).map(([key, value]) => ({
              title: key,
              value: String(value),
              short: true,
            })) : undefined,
            ts: Math.floor(alert.timestamp.getTime() / 1000),
          }
        ],
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
      }

      logger.debug({ alertId: alert.id }, 'Alert sent to webhook');
    } catch (error) {
      logger.error({ error, alertId: alert.id }, 'Failed to send webhook alert');
      throw error;
    }
  }

  private getColor(type: Alert['type']): string {
    switch (type) {
      case 'error':
        return 'danger';
      case 'warning':
        return 'warning';
      default:
        return 'good';
    }
  }
}

// Console alert channel (for development)
export class ConsoleAlertChannel implements AlertChannel {
  public readonly name = 'console';

  async send(alert: Alert): Promise<void> {
    const emoji = this.getEmoji(alert.type);
    const timestamp = alert.timestamp.toISOString();
    
    console.log(`\n${emoji} [${alert.type.toUpperCase()}] ${timestamp}`);
    console.log(`📋 ${alert.title}`);
    console.log(`💬 ${alert.message}`);
    
    if (alert.metadata) {
      console.log('📊 Metadata:');
      Object.entries(alert.metadata).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    }
    console.log('');
  }

  private getEmoji(type: Alert['type']): string {
    switch (type) {
      case 'error':
        return '🚨';
      case 'warning':
        return '⚠️';
      default:
        return 'ℹ️';
    }
  }
}

export class AlertManager {
  private static instance: AlertManager;
  private channels: AlertChannel[] = [];
  private alertHistory: Alert[] = [];
  private maxHistorySize = 1000;

  private constructor() {}

  public static getInstance(): AlertManager {
    if (!AlertManager.instance) {
      AlertManager.instance = new AlertManager();
    }
    return AlertManager.instance;
  }

  public addChannel(channel: AlertChannel): void {
    this.channels.push(channel);
    logger.info(`Alert channel added: ${channel.name}`);
  }

  public removeChannel(channelName: string): void {
    const initialLength = this.channels.length;
    this.channels = this.channels.filter(channel => channel.name !== channelName);
    
    if (this.channels.length < initialLength) {
      logger.info(`Alert channel removed: ${channelName}`);
    }
  }

  public async sendAlert(
    type: Alert['type'],
    title: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const alert: Alert = {
      id: this.generateAlertId(),
      type,
      title,
      message,
      metadata,
      timestamp: new Date(),
    };

    // Store in history
    this.alertHistory.push(alert);
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory.shift();
    }

    // Log the alert
    const logFn = type === 'warning' ? logger.warn : logger[type as 'info' | 'error'];
    logFn({ 
      alertId: alert.id, 
      title: alert.title, 
      metadata: alert.metadata 
    }, alert.message);

    // Send to all channels
    const sendPromises = this.channels.map(async channel => {
      try {
        await channel.send(alert);
      } catch (error) {
        logger.error({ 
          error, 
          channelName: channel.name, 
          alertId: alert.id 
        }, 'Failed to send alert to channel');
      }
    });

    await Promise.allSettled(sendPromises);
  }

  public async error(title: string, message: string, metadata?: Record<string, any>): Promise<void> {
    await this.sendAlert('error', title, message, metadata);
  }

  public async warning(title: string, message: string, metadata?: Record<string, any>): Promise<void> {
    await this.sendAlert('warning', title, message, metadata);
  }

  public async info(title: string, message: string, metadata?: Record<string, any>): Promise<void> {
    await this.sendAlert('info', title, message, metadata);
  }

  public getRecentAlerts(count: number = 50): Alert[] {
    return this.alertHistory.slice(-count);
  }

  public getAlertsByType(type: Alert['type'], count: number = 50): Alert[] {
    return this.alertHistory
      .filter(alert => alert.type === type)
      .slice(-count);
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Built-in alert helpers
export class SystemAlerts {
  private static alertManager = AlertManager.getInstance();

  static async transactionFailed(
    txHash: string, 
    from: string, 
    to: string, 
    error: string
  ): Promise<void> {
    await this.alertManager.error(
      'Transaction Failed',
      `Transaction ${txHash} failed to execute`,
      { txHash, from, to, error }
    );
  }

  static async highFailureRate(rate: number, timeframe: string): Promise<void> {
    await this.alertManager.warning(
      'High Transaction Failure Rate',
      `Transaction failure rate is ${(rate * 100).toFixed(2)}% over the last ${timeframe}`,
      { failureRate: rate, timeframe }
    );
  }

  static async lowBalance(address: string, balance: string, threshold: string): Promise<void> {
    await this.alertManager.warning(
      'Low Wallet Balance',
      `Wallet ${address} balance (${balance} BNB) is below threshold (${threshold} BNB)`,
      { address, balance, threshold }
    );
  }

  static async rpcError(endpoint: string, error: string): Promise<void> {
    await this.alertManager.error(
      'RPC Endpoint Error',
      `RPC endpoint ${endpoint} is experiencing issues`,
      { endpoint, error }
    );
  }

  static async strategyError(strategyName: string, error: string): Promise<void> {
    await this.alertManager.error(
      'Strategy Error',
      `Strategy ${strategyName} encountered an error: ${error}`,
      { strategy: strategyName, error }
    );
  }

  static async priceAnomalyDetected(
    token: string, 
    currentPrice: string, 
    previousPrice: string, 
    changePercent: number
  ): Promise<void> {
    const alertType = Math.abs(changePercent) > 0.2 ? 'error' : 'warning';
    
    await this.alertManager.sendAlert(
      alertType,
      'Price Anomaly Detected',
      `${token} price changed by ${(changePercent * 100).toFixed(2)}% (${previousPrice} → ${currentPrice})`,
      { token, currentPrice, previousPrice, changePercent }
    );
  }
}

// Initialize alert manager with default channels
export function initializeAlerts(): AlertManager {
  const alertManager = AlertManager.getInstance();
  
  // Add console channel for development
  if (process.env.NODE_ENV === 'development') {
    alertManager.addChannel(new ConsoleAlertChannel());
  }
  
  // Add webhook channel if configured
  const webhookUrl = process.env.ALERT_WEBHOOK;
  if (webhookUrl) {
    alertManager.addChannel(new WebhookAlertChannel(webhookUrl));
  }
  
  return alertManager;
}

export const alertManager = AlertManager.getInstance();