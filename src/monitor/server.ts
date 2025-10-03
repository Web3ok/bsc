import * as http from 'http';
import { healthMonitor } from './health';
import { metricsCollector } from './metrics';
import { logger } from '../utils/logger';
import { configManager } from '../config';
import { SimpleAuth, createAuthConfig } from '../utils/auth';

export class MonitoringServer {
  private static instance: MonitoringServer;
  private server: http.Server | null = null;
  private port: number;
  private auth: SimpleAuth;

  private constructor() {
    this.port = configManager.config.monitoring.metrics_port || 3001;
    this.auth = new SimpleAuth(createAuthConfig());
  }

  public static getInstance(): MonitoringServer {
    if (!MonitoringServer.instance) {
      MonitoringServer.instance = new MonitoringServer();
    }
    return MonitoringServer.instance;
  }

  start(customPort?: number): Promise<void> {
    // Use custom port if provided, otherwise use instance port
    const actualPort = customPort || this.port;
    
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(actualPort, () => {
        logger.info({ port: actualPort }, 'Monitoring server started');
        resolve();
      });

      this.server.on('error', (error) => {
        logger.error({ error, port: actualPort }, 'Monitoring server error');
        reject(error);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Monitoring server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url || '';
    const method = req.method || 'GET';

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Authentication check (skip for health endpoints if needed)
    const isPublicEndpoint = url === '/healthz';
    if (!isPublicEndpoint) {
      const auth = this.auth.authenticate(req);
      if (!auth.authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Unauthorized',
          message: auth.reason || 'Authentication required',
          endpoints: {
            public: ['/healthz'],
            authenticated: ['/health', '/metrics', '/status', '/prometheus']
          }
        }));
        return;
      }
    }

    try {
      if (url === '/health' && method === 'GET') {
        await this.handleHealthCheck(res);
      } else if (url === '/healthz' && method === 'GET') {
        await this.handleSimpleHealthCheck(res);
      } else if (url === '/metrics' && method === 'GET') {
        await this.handleMetrics(res);
      } else if (url === '/status' && method === 'GET') {
        await this.handleStatus(res);
      } else if (url === '/prometheus' && method === 'GET') {
        await this.handlePrometheusMetrics(res);
      } else if (url === '/biandex/stats' && method === 'GET') {
        await this.handleBianDEXStats(res);
      } else if (url === '/biandex/pools' && method === 'GET') {
        await this.handleBianDEXPools(res);
      } else {
        this.handle404(res);
      }
    } catch (error) {
      logger.error({ error, url, method }, 'Request handling error');
      this.handleError(res, error);
    }
  }

  private async handleHealthCheck(res: http.ServerResponse): Promise<void> {
    const health = await healthMonitor.getSystemHealth();
    const statusCode = health.overall === 'healthy' ? 200 : 
                       health.overall === 'degraded' ? 200 : 503;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  }

  private async handleSimpleHealthCheck(res: http.ServerResponse): Promise<void> {
    const isHealthy = await healthMonitor.isHealthy();
    const statusCode = isHealthy ? 200 : 503;
    
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: healthMonitor.getUptimeSeconds(),
    }));
  }

  private async handleMetrics(res: http.ServerResponse): Promise<void> {
    try {
      // Get metrics from all components
      const metricsData: any = {
        system: {
          uptime_seconds: healthMonitor.getUptimeSeconds(),
          memory_usage: process.memoryUsage(),
          cpu_usage: process.cpuUsage(),
          node_version: process.version,
          platform: process.platform,
        },
        timestamp: new Date().toISOString(),
      };

      // Add market data metrics if available
      try {
        const { marketDataManager } = await import('../market/manager');
        const status = marketDataManager.getStatus();
        
        metricsData.market_data = {
          running: status.running,
          healthy: status.healthy,
          websocket: status.websocket,
          event_processor: status.eventProcessor,
          candlestick_aggregator: status.candlestickAggregator,
          api_server: status.apiServer,
          metrics: status.metrics,
        };
      } catch (error) {
        metricsData.market_data = { error: 'Market data manager not available' };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metricsData, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to generate metrics');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to generate metrics' }));
    }
  }

  private async handleStatus(res: http.ServerResponse): Promise<void> {
    const health = await healthMonitor.getSystemHealth();
    const status = {
      service: 'bsc-market-maker-bot',
      version: '0.1.0',
      environment: process.env.NODE_ENV || 'development',
      status: health.overall,
      uptime_seconds: health.uptime / 1000,
      timestamp: health.timestamp,
      features: {
        emergency_stop: health.emergency_status.active,
        database: health.checks.find(c => c.name === 'database')?.status || 'unknown',
        rpc_connection: health.checks.find(c => c.name === 'rpc_connection')?.status || 'unknown',
      },
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  }

  private async handlePrometheusMetrics(res: http.ServerResponse): Promise<void> {
    try {
      // Try to get Prometheus metrics from metrics collector
      const { metricsCollector } = await import('./metrics');
      const prometheusMetrics = metricsCollector.getPrometheusMetrics();
      
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(prometheusMetrics);
    } catch (error) {
      logger.error({ error }, 'Failed to generate Prometheus metrics');
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('# Failed to generate Prometheus metrics');
    }
  }

  private async handleBianDEXStats(res: http.ServerResponse): Promise<void> {
    try {
      const { biandexMonitor } = await import('../services/biandex-monitor');
      const stats = await biandexMonitor.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to get BianDEX stats');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get BianDEX stats' }));
    }
  }

  private async handleBianDEXPools(res: http.ServerResponse): Promise<void> {
    try {
      const { biandexMonitor } = await import('../services/biandex-monitor');
      const pools = await biandexMonitor.getAllPools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(pools, null, 2));
    } catch (error) {
      logger.error({ error }, 'Failed to get BianDEX pools');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get BianDEX pools' }));
    }
  }

  private handle404(res: http.ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not Found',
      available_endpoints: ['/health', '/healthz', '/metrics', '/status', '/prometheus', '/biandex/stats', '/biandex/pools'],
    }));
  }

  private handleError(res: http.ServerResponse, error: unknown): void {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
}

export const monitoringServer = MonitoringServer.getInstance();