import { logger } from '../utils/logger';
import nodemailer from 'nodemailer';
import fetch from 'node-fetch';

export interface AlertConfig {
  slackWebhookUrl?: string;
  discordWebhookUrl?: string;
  emailConfig?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
    from: string;
    to: string[];
  };
  customWebhookUrl?: string;
}

export interface Alert {
  level: 'critical' | 'high' | 'medium' | 'low';
  service: string;
  message: string;
  details?: any;
  timestamp: Date;
}

class RealAlertService {
  private static instance: RealAlertService;
  private config: AlertConfig;
  private emailTransporter?: nodemailer.Transporter;
  
  private constructor() {
    this.config = this.loadConfig();
    this.initializeEmailTransporter();
  }
  
  public static getInstance(): RealAlertService {
    if (!RealAlertService.instance) {
      RealAlertService.instance = new RealAlertService();
    }
    return RealAlertService.instance;
  }
  
  private loadConfig(): AlertConfig {
    return {
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL,
      customWebhookUrl: process.env.CUSTOM_ALERT_WEBHOOK,
      emailConfig: process.env.SMTP_HOST ? {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER!,
          pass: process.env.SMTP_PASS!
        },
        from: process.env.SMTP_FROM || process.env.SMTP_USER!,
        to: (process.env.ALERT_EMAIL || '').split(',').filter(Boolean)
      } : undefined
    };
  }
  
  private initializeEmailTransporter(): void {
    if (this.config.emailConfig) {
      this.emailTransporter = nodemailer.createTransport({
        host: this.config.emailConfig.host,
        port: this.config.emailConfig.port,
        secure: this.config.emailConfig.secure,
        auth: this.config.emailConfig.auth
      });
      
      // Verify email configuration
      this.emailTransporter.verify((error) => {
        if (error) {
          logger.error({ error }, 'Email transporter verification failed');
          this.emailTransporter = undefined;
        } else {
          logger.info('Email alert service configured successfully');
        }
      });
    }
  }
  
  public async sendAlert(alert: Alert): Promise<void> {
    const promises: Promise<void>[] = [];
    
    // Send to all configured channels
    if (this.config.slackWebhookUrl) {
      promises.push(this.sendToSlack(alert));
    }
    
    if (this.config.discordWebhookUrl) {
      promises.push(this.sendToDiscord(alert));
    }
    
    if (this.config.emailConfig && this.emailTransporter) {
      promises.push(this.sendEmail(alert));
    }
    
    if (this.config.customWebhookUrl) {
      promises.push(this.sendToCustomWebhook(alert));
    }
    
    // Log to console if no external channels configured
    if (promises.length === 0) {
      logger.warn({ alert }, 'No alert channels configured, logging to console only');
    }
    
    // Send to all channels in parallel
    await Promise.allSettled(promises);
  }
  
  private async sendToSlack(alert: Alert): Promise<void> {
    try {
      const color = {
        'critical': '#FF0000',
        'high': '#FF9900',
        'medium': '#FFCC00',
        'low': '#00CC00'
      }[alert.level];
      
      const payload = {
        attachments: [{
          color,
          title: `${this.getEmoji(alert.level)} ${alert.level.toUpperCase()} Alert`,
          text: alert.message,
          fields: [
            {
              title: 'Service',
              value: alert.service,
              short: true
            },
            {
              title: 'Time',
              value: alert.timestamp.toISOString(),
              short: true
            }
          ],
          footer: 'BSC Trading Bot',
          ts: Math.floor(alert.timestamp.getTime() / 1000)
        }]
      };
      
      const response = await fetch(this.config.slackWebhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`Slack webhook failed: ${response.status}`);
      }
      
      logger.info({ alert: alert.message }, 'Alert sent to Slack');
    } catch (error) {
      logger.error({ error, alert: alert.message }, 'Failed to send Slack alert');
    }
  }
  
  private async sendToDiscord(alert: Alert): Promise<void> {
    try {
      const color = {
        'critical': 0xFF0000,
        'high': 0xFF9900,
        'medium': 0xFFCC00,
        'low': 0x00CC00
      }[alert.level];
      
      const payload = {
        embeds: [{
          title: `${this.getEmoji(alert.level)} ${alert.level.toUpperCase()} Alert`,
          description: alert.message,
          color,
          fields: [
            {
              name: 'Service',
              value: alert.service,
              inline: true
            },
            {
              name: 'Environment',
              value: process.env.NODE_ENV || 'development',
              inline: true
            }
          ],
          timestamp: alert.timestamp.toISOString(),
          footer: {
            text: 'BSC Trading Bot'
          }
        }]
      };
      
      const response = await fetch(this.config.discordWebhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.status}`);
      }
      
      logger.info({ alert: alert.message }, 'Alert sent to Discord');
    } catch (error) {
      logger.error({ error, alert: alert.message }, 'Failed to send Discord alert');
    }
  }
  
  private async sendEmail(alert: Alert): Promise<void> {
    try {
      if (!this.emailTransporter || !this.config.emailConfig) {
        return;
      }
      
      const subject = `[${alert.level.toUpperCase()}] BSC Bot Alert: ${alert.service}`;
      
      const html = `
        <h2>${this.getEmoji(alert.level)} ${alert.level.toUpperCase()} Alert</h2>
        <p><strong>Service:</strong> ${alert.service}</p>
        <p><strong>Message:</strong> ${alert.message}</p>
        <p><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
        ${alert.details ? `<pre>${JSON.stringify(alert.details, null, 2)}</pre>` : ''}
        <hr>
        <p><small>BSC Trading Bot Alert System</small></p>
      `;
      
      await this.emailTransporter.sendMail({
        from: this.config.emailConfig.from,
        to: this.config.emailConfig.to,
        subject,
        html
      });
      
      logger.info({ alert: alert.message, to: this.config.emailConfig.to }, 'Alert sent via email');
    } catch (error) {
      logger.error({ error, alert: alert.message }, 'Failed to send email alert');
    }
  }
  
  private async sendToCustomWebhook(alert: Alert): Promise<void> {
    try {
      const response = await fetch(this.config.customWebhookUrl!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...alert,
          environment: process.env.NODE_ENV || 'development',
          hostname: require('os').hostname()
        })
      });
      
      if (!response.ok) {
        throw new Error(`Custom webhook failed: ${response.status}`);
      }
      
      logger.info({ alert: alert.message }, 'Alert sent to custom webhook');
    } catch (error) {
      logger.error({ error, alert: alert.message }, 'Failed to send custom webhook alert');
    }
  }
  
  private getEmoji(level: string): string {
    return {
      'critical': '🚨',
      'high': '⚠️',
      'medium': '🔔',
      'low': 'ℹ️'
    }[level] || '📢';
  }
  
  // Test alert functionality
  public async testAlerts(): Promise<void> {
    const testAlert: Alert = {
      level: 'low',
      service: 'alert-test',
      message: 'This is a test alert to verify all channels are working',
      timestamp: new Date(),
      details: {
        configured_channels: {
          slack: !!this.config.slackWebhookUrl,
          discord: !!this.config.discordWebhookUrl,
          email: !!this.emailTransporter,
          custom: !!this.config.customWebhookUrl
        }
      }
    };
    
    await this.sendAlert(testAlert);
  }
}

export const realAlertService = RealAlertService.getInstance();