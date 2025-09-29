import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { configManager } from '../config';
import { database } from '../persistence/database';
import { emergencyManager } from '../utils/emergency';
import { logger } from '../utils/logger';
import { rpcManager } from '../blockchain/rpc';

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  latency?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface SystemHealth {
  overall: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  checks: HealthCheck[];
  emergency_status: {
    active: boolean;
    reason?: string;
    since?: string;
  };
}

export class HealthMonitor {
  private static instance: HealthMonitor;
  private publicClient: any;
  private startTime: number;

  private constructor() {
    this.startTime = Date.now();
    const rpcUrls = configManager.rpcUrls;
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrls[0]),
    });
  }

  public static getInstance(): HealthMonitor {
    if (!HealthMonitor.instance) {
      HealthMonitor.instance = new HealthMonitor();
    }
    return HealthMonitor.instance;
  }

  async getSystemHealth(): Promise<SystemHealth> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRpcConnection(),
      this.checkRpcProviders(),
      this.checkEmergencyStatus(),
      this.checkMemoryUsage(),
      this.checkDiskSpace(),
      this.checkWebSocketHealth(),
      this.checkMarketDataProcessor(),
    ]);

    const healthChecks: HealthCheck[] = checks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const checkNames = ['database', 'rpc', 'rpc_providers', 'emergency', 'memory', 'disk', 'websocket', 'market_processor'];
        return {
          name: checkNames[index],
          status: 'unhealthy',
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
      }
    });

    const overallStatus = this.determineOverallStatus(healthChecks);
    const emergencyState = emergencyManager.getEmergencyState();

    return {
      overall: emergencyState ? 'unhealthy' : overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      checks: healthChecks,
      emergency_status: {
        active: emergencyState !== null,
        reason: emergencyState?.reason,
        since: emergencyState?.timestamp.toISOString(),
      },
    };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      await database.connection!.raw('SELECT 1');
      return {
        name: 'database',
        status: 'healthy',
        latency: Date.now() - start,
        metadata: {
          type: 'sqlite',
          path: configManager.dbPath,
        },
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'unhealthy',
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Database check failed',
      };
    }
  }

  private async checkRpcConnection(): Promise<HealthCheck> {
    const start = Date.now();
    try {
      const blockNumber = await this.publicClient.getBlockNumber();
      const latency = Date.now() - start;
      
      return {
        name: 'rpc_connection',
        status: latency > 5000 ? 'degraded' : 'healthy',
        latency,
        metadata: {
          latest_block: blockNumber.toString(),
          endpoint: configManager.rpcUrls[0],
        },
      };
    } catch (error) {
      return {
        name: 'rpc_connection',
        status: 'unhealthy',
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'RPC check failed',
      };
    }
  }

  private async checkRpcProviders(): Promise<HealthCheck> {
    try {
      // Initialize RPC manager if not already done
      if (!rpcManager.getCurrentProviderUrl()) {
        rpcManager.initialize();
      }
      
      const providersHealth = rpcManager.getProvidersHealth();
      const providersCount = rpcManager.getProviderCount();
      
      // Test current connection
      const connectionTest = await rpcManager.testConnection();
      
      // Calculate overall status
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (!connectionTest || providersCount.healthy === 0) {
        status = 'unhealthy';
      } else if (providersCount.healthy < providersCount.total * 0.5) {
        status = 'degraded';
      }
      
      // Find current provider health
      const currentUrl = rpcManager.getCurrentProviderUrl();
      const currentProvider = providersHealth.find(p => p.url === currentUrl);
      
      // Check for high latency
      const highLatencyProviders = providersHealth.filter(p => p.latency > 890);
      if (highLatencyProviders.length > 0) {
        status = status === 'healthy' ? 'degraded' : status;
      }
      
      return {
        name: 'rpc_provider',
        status,
        latency: currentProvider?.latency || 0,
        metadata: {
          current_provider: currentUrl,
          total_providers: providersCount.total,
          healthy_providers: providersCount.healthy,
          unhealthy_providers: providersCount.unhealthy,
          high_latency_count: highLatencyProviders.length,
          connection_test_passed: connectionTest,
          providers_details: providersHealth.map(p => ({
            url: p.url,
            healthy: p.isHealthy,
            latency: p.latency,
            last_check: new Date(p.lastCheck).toISOString(),
            error_count: p.errorCount
          }))
        },
      };
    } catch (error) {
      return {
        name: 'rpc_provider',
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'RPC providers check failed',
      };
    }
  }

  private async checkEmergencyStatus(): Promise<HealthCheck> {
    const emergencyState = emergencyManager.getEmergencyState();
    
    return {
      name: 'emergency_status',
      status: emergencyState ? 'unhealthy' : 'healthy',
      metadata: emergencyState ? {
        reason: emergencyState.reason,
        level: emergencyState.level,
        triggered_by: emergencyState.triggeredBy,
        since: emergencyState.timestamp,
      } : {
        message: 'No emergency stop active',
      },
    };
  }

  private async checkMemoryUsage(): Promise<HealthCheck> {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const rssUsageMB = Math.round(usage.rss / 1024 / 1024);
    
    const heapPercentage = (usage.heapUsed / usage.heapTotal) * 100;
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (heapPercentage > 90) {
      status = 'unhealthy';
    } else if (heapPercentage > 75) {
      status = 'degraded';
    }

    return {
      name: 'memory_usage',
      status,
      metadata: {
        heap_used_mb: heapUsedMB,
        heap_total_mb: heapTotalMB,
        rss_mb: rssUsageMB,
        heap_percentage: Math.round(heapPercentage),
      },
    };
  }

  private async checkDiskSpace(): Promise<HealthCheck> {
    try {
      const fs = require('fs');
      const stats = fs.statSync(configManager.dbPath);
      const sizeMB = Math.round(stats.size / 1024 / 1024);

      return {
        name: 'disk_usage',
        status: sizeMB > 1000 ? 'degraded' : 'healthy', // Warn if DB > 1GB
        metadata: {
          db_size_mb: sizeMB,
          db_path: configManager.dbPath,
        },
      };
    } catch (error) {
      return {
        name: 'disk_usage',
        status: 'degraded',
        error: 'Could not check disk usage',
      };
    }
  }

  private determineOverallStatus(checks: HealthCheck[]): 'healthy' | 'unhealthy' | 'degraded' {
    const unhealthyCount = checks.filter(c => c.status === 'unhealthy').length;
    const degradedCount = checks.filter(c => c.status === 'degraded').length;

    if (unhealthyCount > 0) {
      return 'unhealthy';
    } else if (degradedCount > 0) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  // Quick health check for load balancer
  async isHealthy(): Promise<boolean> {
    try {
      // Quick DB check
      if (!database.connection) {
        throw new Error('Database connection not available');
      }
      await database.connection!.raw('SELECT 1');
      
      // Check emergency status
      const emergencyState = emergencyManager.getEmergencyState();
      if (emergencyState) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error({ error }, 'Health check failed');
      return false;
    }
  }

  private async checkWebSocketHealth(): Promise<HealthCheck> {
    try {
      // Dynamically import to avoid circular dependencies
      const { bscWebSocketClient } = await import('../market/websocket');
      
      // Check if the client is actually available and not just imported
      if (!bscWebSocketClient) {
        throw new Error('WebSocket client instance not available');
      }

      const status = bscWebSocketClient.getStatus();
      
      let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (!status.connected) {
        healthStatus = 'unhealthy';
      } else if (status.reconnectAttempts > 3) {
        healthStatus = 'degraded';
      }

      return {
        name: 'websocket_connection',
        status: healthStatus,
        metadata: {
          connected: status.connected,
          subscriptions: status.subscriptions,
          reconnect_attempts: status.reconnectAttempts,
          buffer_size: status.bufferSize,
          client_initialized: true,
        },
      };
    } catch (error) {
      return {
        name: 'websocket_connection',
        status: 'degraded',
        error: error instanceof Error ? error.message : 'WebSocket client not available',
        metadata: {
          connected: false,
          subscriptions: 0,
          reconnect_attempts: 0,
          buffer_size: 0,
          client_initialized: false,
        },
      };
    }
  }

  private async checkMarketDataProcessor(): Promise<HealthCheck> {
    try {
      // Dynamically import to avoid circular dependencies
      const { marketEventProcessor } = await import('../market/eventProcessor');
      
      // Check if the processor is actually available and not just imported
      if (!marketEventProcessor) {
        throw new Error('Market event processor instance not available');
      }

      const status = marketEventProcessor.getStatus();
      const metrics = marketEventProcessor.getMetrics();
      
      let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      // If processor is not started yet, mark as degraded (not unhealthy)
      if (!status.processing) {
        healthStatus = 'degraded';
      } else if (status.queueSize > status.maxQueueSize * 0.8 || metrics.processingErrors > 50) {
        healthStatus = 'degraded';
      }

      return {
        name: 'market_data_processor',
        status: healthStatus,
        metadata: {
          processing: status.processing,
          queue_size: status.queueSize,
          max_queue_size: status.maxQueueSize,
          events_processed: metrics.eventsProcessed,
          processing_errors: metrics.processingErrors,
          avg_processing_time: Math.round(metrics.avgProcessingTime),
          processor_initialized: true,
        },
      };
    } catch (error) {
      return {
        name: 'market_data_processor',
        status: 'degraded',
        error: error instanceof Error ? error.message : 'Market data processor not available',
        metadata: {
          processing: false,
          queue_size: 0,
          max_queue_size: 0,
          events_processed: 0,
          processing_errors: 0,
          avg_processing_time: 0,
          processor_initialized: false,
        },
      };
    }
  }

  // Get uptime in seconds
  getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  // Get RPC providers detailed status
  getRpcProvidersStatus(): any {
    try {
      const providersHealth = rpcManager.getProvidersHealth();
      const providersCount = rpcManager.getProviderCount();
      const currentUrl = rpcManager.getCurrentProviderUrl();
      
      return {
        success: true,
        current_provider: currentUrl,
        total_providers: providersCount.total,
        healthy_providers: providersCount.healthy,
        unhealthy_providers: providersCount.unhealthy,
        providers: providersHealth
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get RPC status'
      };
    }
  }
}

export const healthMonitor = HealthMonitor.getInstance();