import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { database } from '../persistence/database';
import { emergencyManager } from '../utils/emergency';

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface Metric {
  name: string;
  value: number | string;
  timestamp: Date;
  labels?: Record<string, string>;
  type?: MetricType;
}

export interface AggregatedMetric {
  name: string;
  value: number;
  count: number;
  min: number;
  max: number;
  avg: number;
  timestamp: Date;
  labels?: Record<string, string>;
}

export class MetricsCollector extends EventEmitter {
  private static instance: MetricsCollector;
  private metrics = new Map<string, Metric[]>();
  private lastPersistedTime = Date.now();
  private isRunning = false;
  private collectionInterval: NodeJS.Timeout | null = null;
  private persistenceInterval: NodeJS.Timeout | null = null;
  private maxMetricsPerKey = 1000;
  private collectionIntervalMs = 10000; // 10 seconds
  private persistenceIntervalMs = 30000; // 30 seconds - persist more frequently

  private constructor() {
    super();
  }

  public static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Metrics collector already running');
      return;
    }

    logger.info('Starting metrics collector');
    this.isRunning = true;

    // Start periodic collection
    this.collectionInterval = setInterval(() => {
      this.collectSystemMetrics().catch(error => {
        logger.error({ error }, 'Failed to collect system metrics');
      });
    }, this.collectionIntervalMs);

    // Start periodic persistence
    this.persistenceInterval = setInterval(() => {
      this.persistMetrics().catch(error => {
        logger.error({ error }, 'Failed to persist metrics');
      });
    }, this.persistenceIntervalMs);

    // Register emergency stop callback
    emergencyManager.registerStopCallback(async () => {
      await this.stop();
    });

    logger.info('Metrics collector started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('Stopping metrics collector');
    this.isRunning = false;

    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }

    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
      this.persistenceInterval = null;
    }

    // Persist remaining metrics
    await this.persistMetrics();
    this.metrics.clear();

    logger.info('Metrics collector stopped');
  }

  // Record a single metric
  recordMetric(name: string, value: number | string, labels?: Record<string, string>, type?: MetricType): void {
    if (!this.isRunning) return;

    const metric: Metric = {
      name,
      value,
      timestamp: new Date(),
      labels,
      type,
    };

    const key = this.getMetricKey(name, labels);
    let metricArray = this.metrics.get(key);
    
    if (!metricArray) {
      metricArray = [];
      this.metrics.set(key, metricArray);
    }

    metricArray.push(metric);

    // Limit memory usage
    if (metricArray.length > this.maxMetricsPerKey) {
      metricArray.splice(0, metricArray.length - this.maxMetricsPerKey);
    }

    this.emit('metricRecorded', metric);
  }

  // Record multiple metrics at once
  recordMetrics(metrics: Omit<Metric, 'timestamp'>[]): void {
    for (const metric of metrics) {
      this.recordMetric(metric.name, metric.value, metric.labels, metric.type);
    }
  }

  // Get current metrics for a specific name
  getMetrics(name: string, labels?: Record<string, string>): Metric[] {
    const key = this.getMetricKey(name, labels);
    return this.metrics.get(key) || [];
  }

  // Get aggregated metrics
  getAggregatedMetrics(name: string, labels?: Record<string, string>, timeWindow?: number): AggregatedMetric[] {
    const key = this.getMetricKey(name, labels);
    const metricArray = this.metrics.get(key) || [];
    
    if (metricArray.length === 0) return [];

    // Filter by time window if specified
    let filteredMetrics = metricArray;
    if (timeWindow) {
      const cutoff = new Date(Date.now() - timeWindow);
      filteredMetrics = metricArray.filter(m => m.timestamp >= cutoff);
    }

    if (filteredMetrics.length === 0) return [];

    // Group by minute for aggregation
    const groupedMetrics = new Map<string, Metric[]>();
    
    for (const metric of filteredMetrics) {
      const minute = new Date(metric.timestamp);
      minute.setSeconds(0, 0);
      const timeKey = minute.toISOString();
      
      if (!groupedMetrics.has(timeKey)) {
        groupedMetrics.set(timeKey, []);
      }
      groupedMetrics.get(timeKey)!.push(metric);
    }

    // Calculate aggregations
    const aggregated: AggregatedMetric[] = [];
    
    for (const [timeKey, metrics] of groupedMetrics) {
      const numericValues = metrics
        .map(m => typeof m.value === 'number' ? m.value : parseFloat(m.value.toString()))
        .filter(v => !isNaN(v));
      
      if (numericValues.length > 0) {
        aggregated.push({
          name,
          value: numericValues[numericValues.length - 1], // Last value
          count: numericValues.length,
          min: Math.min(...numericValues),
          max: Math.max(...numericValues),
          avg: numericValues.reduce((a, b) => a + b, 0) / numericValues.length,
          timestamp: new Date(timeKey),
          labels,
        });
      }
    }

    return aggregated.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // Get all current metric names
  getMetricNames(): string[] {
    const names = new Set<string>();
    for (const [key] of this.metrics) {
      const name = key.split('|')[0];
      names.add(name);
    }
    return Array.from(names);
  }

  // Collect system-level metrics
  private async collectSystemMetrics(): Promise<void> {
    try {
      // Memory metrics
      const memUsage = process.memoryUsage();
      this.recordMetric('system_memory_heap_used', memUsage.heapUsed, undefined, 'gauge');
      this.recordMetric('system_memory_heap_total', memUsage.heapTotal, undefined, 'gauge');
      this.recordMetric('system_memory_rss', memUsage.rss, undefined, 'gauge');
      this.recordMetric('system_memory_external', memUsage.external, undefined, 'gauge');

      // CPU metrics
      const cpuUsage = process.cpuUsage();
      this.recordMetric('system_cpu_user', cpuUsage.user, undefined, 'counter');
      this.recordMetric('system_cpu_system', cpuUsage.system, undefined, 'counter');

      // Database metrics
      try {
        const dbStats = await this.getDatabaseStats();
        for (const [table, count] of Object.entries(dbStats)) {
          this.recordMetric('database_table_rows', count, { table }, 'gauge');
        }
      } catch (error) {
        logger.debug({ error }, 'Failed to collect database metrics');
      }

      // Market data metrics (if available)
      try {
        const { marketDataManager } = await import('../market/manager');
        if (marketDataManager.getStatus().running) {
          const status = marketDataManager.getStatus();
          
          this.recordMetric('market_websocket_connected', status.websocket.connected ? 1 : 0, undefined, 'gauge');
          this.recordMetric('market_websocket_subscriptions', status.websocket.subscriptions, undefined, 'gauge');
          this.recordMetric('market_event_queue_size', status.eventProcessor.queueSize, undefined, 'gauge');
          this.recordMetric('market_events_processed_total', status.metrics.eventsProcessed, undefined, 'counter');
          this.recordMetric('market_processing_errors_total', status.metrics.processingErrors, undefined, 'counter');
          this.recordMetric('market_active_candles', status.candlestickAggregator.activeCandlesCount, undefined, 'gauge');
        }
      } catch (error) {
        logger.debug({ error }, 'Market data manager not available for metrics');
      }

    } catch (error) {
      logger.error({ error }, 'Failed to collect system metrics');
    }
  }

  private async getDatabaseStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = {};
    
    try {
      const tables = ['wallets', 'transactions', 'orders', 'system_metrics', 'swap_events', 'price_updates', 'candlestick_data'];
      
      for (const table of tables) {
        try {
          if (!database.connection) {
            throw new Error('Database connection not available');
          }
          const result = await database.connection!(table).count('* as count').first();
          stats[table] = parseInt(result?.count?.toString() || '0');
        } catch (error) {
          // Table might not exist yet
          stats[table] = 0;
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get database statistics');
    }

    return stats;
  }

  private async persistMetrics(): Promise<void> {
    if (this.metrics.size === 0) return;

    try {
      const currentTime = Date.now();
      const metricsToSave: Array<{
        metric_name: string;
        metric_value: string;
        metadata: string;
        recorded_at: Date;
      }> = [];

      // Only persist metrics that are new since last persistence
      for (const [key, metricArray] of this.metrics) {
        const newMetrics = metricArray.filter(metric => 
          metric.timestamp.getTime() > this.lastPersistedTime
        );
        
        for (const metric of newMetrics) {
          metricsToSave.push({
            metric_name: metric.name,
            metric_value: metric.value.toString(),
            metadata: JSON.stringify({
              labels: metric.labels,
              type: metric.type,
              key,
            }),
            recorded_at: metric.timestamp,
          });
        }
      }

      if (metricsToSave.length > 0) {
        // Save in batches to avoid memory issues
        const batchSize = 100;
        for (let i = 0; i < metricsToSave.length; i += batchSize) {
          const batch = metricsToSave.slice(i, i + batchSize);
          if (!database.connection) {
            throw new Error('Database connection not available');
          }
          await database.connection!('system_metrics').insert(batch);
        }

        logger.debug({ count: metricsToSave.length }, 'Persisted new metrics to database');
      }

      // Update last persisted time
      this.lastPersistedTime = currentTime;
    } catch (error) {
      logger.error({ error }, 'Failed to persist metrics');
    }
  }

  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels) return name;
    
    const sortedLabels = Object.keys(labels)
      .sort()
      .map(key => `${key}=${labels[key]}`)
      .join(',');
    
    return `${name}|${sortedLabels}`;
  }

  // Prometheus-style metrics export
  getPrometheusMetrics(): string {
    const lines: string[] = [];
    const metricsByName = new Map<string, Array<{ key: string; metrics: Metric[] }>>();

    // Group metrics by name
    for (const [key, metrics] of this.metrics) {
      const name = key.split('|')[0];
      if (!metricsByName.has(name)) {
        metricsByName.set(name, []);
      }
      metricsByName.get(name)!.push({ key, metrics });
    }

    // Generate Prometheus format with HELP and TYPE lines
    for (const [name, entries] of metricsByName) {
      const sanitizedName = name.replace(/[^a-zA-Z0-9_]/g, '_');
      const firstEntry = entries[0];
      const latestMetric = firstEntry?.metrics[firstEntry.metrics.length - 1];
      
      if (!latestMetric) continue;

      // Add HELP line
      const helpText = this.getMetricHelpText(name);
      lines.push(`# HELP ${sanitizedName} ${helpText}`);
      
      // Add TYPE line
      const metricType = this.getPrometheusType(latestMetric.type || 'gauge');
      lines.push(`# TYPE ${sanitizedName} ${metricType}`);

      // Add metric data lines
      for (const { key, metrics } of entries) {
        const metric = metrics[metrics.length - 1];
        if (!metric) continue;

        let line = sanitizedName;
        
        // Add labels
        if (metric.labels) {
          const labelString = Object.keys(metric.labels)
            .map(k => `${k}="${metric.labels![k]}"`)
            .join(',');
          line += `{${labelString}}`;
        }
        
        line += ` ${metric.value} ${metric.timestamp.getTime()}`;
        lines.push(line);
      }
      
      // Add empty line between metrics for readability
      lines.push('');
    }

    return lines.join('\n');
  }

  private getMetricHelpText(metricName: string): string {
    const helpTexts: Record<string, string> = {
      'system_memory_usage_bytes': 'System memory usage in bytes',
      'system_cpu_usage_percent': 'System CPU usage percentage',
      'database_query_duration_ms': 'Database query duration in milliseconds',
      'websocket_connections_total': 'Total number of active WebSocket connections',
      'swap_events_processed_total': 'Total number of swap events processed',
      'price_updates_total': 'Total number of price updates processed',
      'market_data_errors_total': 'Total number of market data processing errors',
      'candlestick_aggregations_total': 'Total number of candlestick aggregations performed',
      'rpc_requests_total': 'Total number of RPC requests made',
      'emergency_stop_active': 'Emergency stop status (1 = active, 0 = inactive)',
      'health_check_status': 'Health check status (1 = healthy, 0 = unhealthy)',
      'uptime_seconds': 'Service uptime in seconds',
    };

    return helpTexts[metricName] || `${metricName} metric`;
  }

  private getPrometheusType(metricType: MetricType): string {
    const typeMapping: Record<MetricType, string> = {
      'counter': 'counter',
      'gauge': 'gauge',
      'histogram': 'histogram',
      'summary': 'summary',
    };

    return typeMapping[metricType] || 'gauge';
  }

  // Status and health
  getStatus(): {
    running: boolean;
    metricCount: number;
    metricNames: number;
    collectionInterval: number;
  } {
    return {
      running: this.isRunning,
      metricCount: Array.from(this.metrics.values()).reduce((total, arr) => total + arr.length, 0),
      metricNames: this.getMetricNames().length,
      collectionInterval: this.collectionIntervalMs,
    };
  }
}

export const metricsCollector = MetricsCollector.getInstance();