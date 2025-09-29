import express from 'express';
import { Logger } from 'pino';
import { metricsCollector } from './metrics';
import { AlertManager } from './alerts';
import { ConfigLoader } from '../config/loader';

export class MonitoringServer {
  private app: express.Application;
  private server?: ReturnType<typeof this.app.listen>;
  private alertManager: AlertManager;

  constructor(private logger: Logger) {
    this.app = express();
    this.alertManager = new AlertManager(logger);
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // Prometheus metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = await metricsCollector.getMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
      } catch (error) {
        this.logger.error({ error }, 'Failed to get metrics');
        res.status(500).send('Failed to get metrics');
      }
    });

    // Alerts endpoint
    this.app.get('/alerts', async (req, res) => {
      try {
        const alerts = this.alertManager.getActiveAlerts();
        res.json({
          total: alerts.length,
          alerts: alerts
        });
      } catch (error) {
        this.logger.error({ error }, 'Failed to get alerts');
        res.status(500).json({ error: 'Failed to get alerts' });
      }
    });

    // Alert acknowledgment endpoint
    this.app.post('/alerts/:id/ack', (req, res) => {
      try {
        const alertId = req.params.id;
        const success = this.alertManager.acknowledgeAlert(alertId);
        
        if (success) {
          res.json({ success: true, message: 'Alert acknowledged' });
        } else {
          res.status(404).json({ error: 'Alert not found' });
        }
      } catch (error) {
        this.logger.error({ error }, 'Failed to acknowledge alert');
        res.status(500).json({ error: 'Failed to acknowledge alert' });
      }
    });

    // System status endpoint
    this.app.get('/status', (req, res) => {
      try {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        res.json({
          system: {
            uptime: process.uptime(),
            memory: {
              rss: Math.round(memUsage.rss / 1024 / 1024),
              heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
              heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
              external: Math.round(memUsage.external / 1024 / 1024)
            },
            cpu: {
              user: cpuUsage.user,
              system: cpuUsage.system
            }
          },
          alerts: {
            active: this.alertManager.getActiveAlerts().length,
            total: this.alertManager.getTotalAlertsCount()
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error({ error }, 'Failed to get system status');
        res.status(500).json({ error: 'Failed to get system status' });
      }
    });

    // Error handler
    this.app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error({ error, url: req.url, method: req.method }, 'HTTP error');
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  async start(): Promise<void> {
    const config = ConfigLoader.getInstance().getMonitoringConfig();
    const port = config.metricsPort || 3001;

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          this.logger.info({ port }, 'Monitoring server started');
          resolve();
        });

        this.server.on('error', (error) => {
          this.logger.error({ error }, 'Monitoring server error');
          reject(error);
        });

        // Start alert manager
        this.alertManager.start();

      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info('Monitoring server stopped');
          resolve();
        });
      } else {
        resolve();
      }

      // Stop alert manager
      this.alertManager.stop();
    });
  }

  getAlertManager(): AlertManager {
    return this.alertManager;
  }
}

export default MonitoringServer;