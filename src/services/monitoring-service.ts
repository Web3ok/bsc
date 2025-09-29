import { logger } from '../utils/logger';

interface AlertLevel {
  LOW: 'low';
  MEDIUM: 'medium';
  HIGH: 'high';
  CRITICAL: 'critical';
}

export const ALERT_LEVELS: AlertLevel = {
  LOW: 'low',
  MEDIUM: 'medium', 
  HIGH: 'high',
  CRITICAL: 'critical'
} as const;

interface ServiceStatus {
  serviceName: string;
  isHealthy: boolean;
  lastCheck: Date;
  errorCount: number;
  consecutiveFailures: number;
}

interface AlertConfig {
  priceServiceFailures: number;
  consecutiveFailureThreshold: number;
  criticalErrorThreshold: number;
}

export class MonitoringService {
  private static instance: MonitoringService;
  private serviceStatuses: Map<string, ServiceStatus> = new Map();
  private alertConfig: AlertConfig = {
    priceServiceFailures: 0,
    consecutiveFailureThreshold: 3,
    criticalErrorThreshold: 10
  };

  private constructor() {}

  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  // Track service health
  public recordServiceHealth(serviceName: string, isHealthy: boolean, errorDetails?: any): void {
    const currentStatus = this.serviceStatuses.get(serviceName) || {
      serviceName,
      isHealthy: true,
      lastCheck: new Date(),
      errorCount: 0,
      consecutiveFailures: 0
    };

    currentStatus.lastCheck = new Date();
    currentStatus.isHealthy = isHealthy;

    if (!isHealthy) {
      currentStatus.errorCount++;
      currentStatus.consecutiveFailures++;
      
      // Log error details
      logger.error({
        service: serviceName,
        errorCount: currentStatus.errorCount,
        consecutiveFailures: currentStatus.consecutiveFailures,
        errorDetails
      }, `Service ${serviceName} reported unhealthy status`);

      // Trigger alerts based on thresholds
      this.checkAlertThresholds(serviceName, currentStatus);
    } else {
      // Reset consecutive failures on success
      currentStatus.consecutiveFailures = 0;
      
      // Reset service-specific counters when service recovers
      if (serviceName === 'price-service' && this.alertConfig.priceServiceFailures > 0) {
        logger.info({ 
          previousFailures: this.alertConfig.priceServiceFailures 
        }, 'Price service recovered - resetting failure counter');
        this.alertConfig.priceServiceFailures = 0;
      }
    }

    this.serviceStatuses.set(serviceName, currentStatus);
  }

  // Check if alert thresholds are breached
  private checkAlertThresholds(serviceName: string, status: ServiceStatus): void {
    const { consecutiveFailures, errorCount } = status;

    if (consecutiveFailures >= this.alertConfig.criticalErrorThreshold) {
      this.sendAlert(serviceName, ALERT_LEVELS.CRITICAL, 
        `Service ${serviceName} has ${consecutiveFailures} consecutive failures - CRITICAL SYSTEM FAILURE`);
    } else if (consecutiveFailures >= this.alertConfig.consecutiveFailureThreshold) {
      this.sendAlert(serviceName, ALERT_LEVELS.HIGH,
        `Service ${serviceName} has ${consecutiveFailures} consecutive failures`);
    } else if (errorCount > 5) {
      this.sendAlert(serviceName, ALERT_LEVELS.MEDIUM,
        `Service ${serviceName} has accumulated ${errorCount} errors`);
    }

    // Special handling for price service
    if (serviceName === 'price-service') {
      this.alertConfig.priceServiceFailures++;
      
      if (this.alertConfig.priceServiceFailures >= 5) {
        this.sendAlert('price-service', ALERT_LEVELS.HIGH,
          `Price service has failed ${this.alertConfig.priceServiceFailures} times - may be using fallback prices`);
      }
    }
  }

  // Send alert with multiple channel support
  private sendAlert(serviceName: string, level: string, message: string): void {
    const alertData = {
      timestamp: new Date().toISOString(),
      service: serviceName,
      level,
      message,
      systemMetrics: this.getSystemHealth(),
      environment: process.env.NODE_ENV || 'development'
    };

    // Always log alerts
    logger.error(alertData, `🚨 SYSTEM ALERT: ${level.toUpperCase()}`);
    console.error(`\n🚨 ALERT [${level.toUpperCase()}]: ${message}\n`);

    // Send to external channels based on configuration
    this.sendToExternalChannels(alertData);
    
    // Store alert in database for dashboard
    this.storeAlertInDatabase(alertData);
  }

  // Send alerts to external channels
  private async sendToExternalChannels(alertData: any): Promise<void> {
    const promises: Promise<void>[] = [];

    // Slack webhook
    if (process.env.SLACK_WEBHOOK_URL) {
      promises.push(this.sendToSlack(alertData));
    }

    // Discord webhook  
    if (process.env.DISCORD_WEBHOOK_URL) {
      promises.push(this.sendToDiscord(alertData));
    }

    // Email (if configured)
    if (process.env.SMTP_HOST && process.env.ALERT_EMAIL) {
      promises.push(this.sendEmail(alertData));
    }

    // Custom webhook
    if (process.env.CUSTOM_ALERT_WEBHOOK) {
      promises.push(this.sendToCustomWebhook(alertData));
    }

    // Execute all notifications in parallel, but don't block on failures
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  // Send to Slack
  private async sendToSlack(alertData: any): Promise<void> {
    try {
      const color = {
        'critical': '#FF0000',
        'high': '#FF8C00', 
        'medium': '#FFD700',
        'low': '#90EE90'
      }[alertData.level] || '#808080';

      const payload = {
        text: `🚨 ${alertData.level.toUpperCase()} Alert`,
        attachments: [{
          color,
          fields: [
            { title: 'Service', value: alertData.service, short: true },
            { title: 'Level', value: alertData.level.toUpperCase(), short: true },
            { title: 'Message', value: alertData.message, short: false },
            { title: 'Environment', value: alertData.environment, short: true },
            { title: 'Timestamp', value: alertData.timestamp, short: true }
          ]
        }]
      };

      const response = await fetch(process.env.SLACK_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }
    } catch (error) {
      logger.warn({ error, service: 'monitoring' }, 'Failed to send Slack alert');
    }
  }

  // Send to Discord
  private async sendToDiscord(alertData: any): Promise<void> {
    try {
      const color = {
        'critical': 16711680, // Red
        'high': 16753920,     // Orange
        'medium': 16776960,   // Yellow  
        'low': 9498256        // Green
      }[alertData.level] || 8421504; // Gray

      const payload = {
        embeds: [{
          title: `🚨 ${alertData.level.toUpperCase()} Alert`,
          description: alertData.message,
          color,
          fields: [
            { name: 'Service', value: alertData.service, inline: true },
            { name: 'Environment', value: alertData.environment, inline: true },
            { name: 'System Health', value: alertData.systemMetrics.summary, inline: false }
          ],
          timestamp: alertData.timestamp
        }]
      };

      const response = await fetch(process.env.DISCORD_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }
    } catch (error) {
      logger.warn({ error, service: 'monitoring' }, 'Failed to send Discord alert');
    }
  }

  // Send email alert
  private async sendEmail(alertData: any): Promise<void> {
    try {
      // This would require a proper email service like nodemailer
      // For now, just log that email would be sent
      logger.info({
        to: process.env.ALERT_EMAIL,
        subject: `[${alertData.environment.toUpperCase()}] ${alertData.level.toUpperCase()} Alert: ${alertData.service}`,
        alertData
      }, 'Email alert would be sent (not implemented)');
    } catch (error) {
      logger.warn({ error, service: 'monitoring' }, 'Failed to send email alert');
    }
  }

  // Send to custom webhook
  private async sendToCustomWebhook(alertData: any): Promise<void> {
    try {
      const response = await fetch(process.env.CUSTOM_ALERT_WEBHOOK!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alertData)
      });

      if (!response.ok) {
        throw new Error(`Custom webhook error: ${response.status}`);
      }
    } catch (error) {
      logger.warn({ error, service: 'monitoring' }, 'Failed to send custom webhook alert');
    }
  }

  // Store alert in database for dashboard
  private async storeAlertInDatabase(alertData: any): Promise<void> {
    try {
      // This would require database connection - implement when database is ready
      logger.debug({ alertData }, 'Alert would be stored in database (not implemented yet)');
    } catch (error) {
      logger.warn({ error, service: 'monitoring' }, 'Failed to store alert in database');
    }
  }

  // Get overall system health
  public getSystemHealth(): {
    overallHealth: 'healthy' | 'degraded' | 'critical';
    services: { [key: string]: Omit<ServiceStatus, 'serviceName'> };
    summary: string;
  } {
    const services: { [key: string]: Omit<ServiceStatus, 'serviceName'> } = {};
    let healthyCount = 0;
    let totalServices = 0;
    let criticalServices = 0;

    for (const [name, status] of this.serviceStatuses.entries()) {
      services[name] = {
        isHealthy: status.isHealthy,
        lastCheck: status.lastCheck,
        errorCount: status.errorCount,
        consecutiveFailures: status.consecutiveFailures
      };
      
      totalServices++;
      if (status.isHealthy) {
        healthyCount++;
      }
      if (status.consecutiveFailures >= this.alertConfig.criticalErrorThreshold) {
        criticalServices++;
      }
    }

    let overallHealth: 'healthy' | 'degraded' | 'critical' = 'healthy';
    let summary = `${healthyCount}/${totalServices} services healthy`;

    if (criticalServices > 0) {
      overallHealth = 'critical';
      summary += `, ${criticalServices} critical failures`;
    } else if (healthyCount < totalServices) {
      overallHealth = 'degraded';
      summary += `, ${totalServices - healthyCount} services degraded`;
    }

    return {
      overallHealth,
      services,
      summary
    };
  }

  // Track API fallback usage
  public recordSuccessfulPriceFetch(source: string): void {
    // Record successful price fetch to reset counters
    if (source !== 'fallback_static') {
      this.recordServiceHealth('price-service', true, { 
        type: 'successful_fetch',
        source 
      });
    }
  }

  public recordFallbackUsage(serviceName: string, reason: string): void {
    logger.warn({
      service: serviceName,
      reason,
      timestamp: new Date().toISOString()
    }, `Service ${serviceName} using fallback data`);

    // Mark service as degraded but not failed
    this.recordServiceHealth(serviceName, false, { 
      type: 'fallback_usage',
      reason 
    });
  }

  // Reset service health stats (useful for testing or manual recovery)
  public resetServiceHealth(serviceName: string): void {
    if (this.serviceStatuses.has(serviceName)) {
      const status = this.serviceStatuses.get(serviceName)!;
      status.errorCount = 0;
      status.consecutiveFailures = 0;
      status.isHealthy = true;
      status.lastCheck = new Date();
      
      this.serviceStatuses.set(serviceName, status);
      logger.info({ service: serviceName }, 'Service health stats reset');
    }
  }

  // Get monitoring dashboard data
  public getMonitoringStats(): {
    totalServices: number;
    healthyServices: number;
    alertsActive: number;
    uptime: string;
    lastUpdate: Date;
  } {
    const health = this.getSystemHealth();
    const totalServices = Object.keys(health.services).length;
    const healthyServices = Object.values(health.services).filter(s => s.isHealthy).length;
    const alertsActive = Object.values(health.services).filter(s => s.consecutiveFailures > 0).length;

    return {
      totalServices,
      healthyServices,
      alertsActive,
      uptime: process.uptime().toFixed(0) + 's',
      lastUpdate: new Date()
    };
  }
}

export const monitoringService = MonitoringService.getInstance();
export type { ServiceStatus, AlertConfig };