import { Command } from 'commander';
import { Logger } from 'pino';
import { formatError } from '../utils/logging';
import { createSystemMonitor, getSystemMonitor } from '../../monitoring';
import { metricsCollector } from '../../monitoring/metrics';

export function monitorCommands(program: Command, logger: Logger) {
  const monitorCmd = program
    .command('monitor')
    .description('System monitoring and metrics operations');

  // Start monitoring command
  monitorCmd
    .command('start')
    .description('Start the monitoring system')
    .option('-p, --port <port>', 'metrics server port', '3001')
    .action(async (options) => {
      try {
        console.log('🔍 Starting monitoring system...');
        
        const monitor = createSystemMonitor(logger);
        await monitor.start();
        
        console.log('✅ Monitoring system started successfully');
        console.log(`📊 Metrics available at: http://localhost:${options.port}/metrics`);
        console.log(`🚨 Alerts dashboard at: http://localhost:${options.port}/alerts`);
        console.log(`❤️  Health check at: http://localhost:${options.port}/health`);
        console.log(`📈 System status at: http://localhost:${options.port}/status`);
        
        // Keep the process running
        process.on('SIGINT', async () => {
          console.log('\n🛑 Stopping monitoring system...');
          await monitor.stop();
          console.log('✅ Monitoring system stopped');
          process.exit(0);
        });
        
        console.log('\n🔄 Monitoring system is running... Press Ctrl+C to stop');
        
      } catch (error) {
        console.log('❌ Failed to start monitoring system:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to start monitoring');
        process.exit(1);
      }
    });

  // Stop monitoring command
  monitorCmd
    .command('stop')
    .description('Stop the monitoring system')
    .action(async () => {
      try {
        console.log('🛑 Stopping monitoring system...');
        
        const monitor = getSystemMonitor();
        if (!monitor) {
          console.log('ℹ️  Monitoring system is not running');
          return;
        }
        
        await monitor.stop();
        console.log('✅ Monitoring system stopped');
        
      } catch (error) {
        console.log('❌ Failed to stop monitoring system:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to stop monitoring');
        process.exit(1);
      }
    });

  // Status command
  monitorCmd
    .command('status')
    .description('Show monitoring system status')
    .action(async () => {
      try {
        const monitor = getSystemMonitor();
        if (!monitor) {
          console.log('❌ Monitoring system is not running');
          return;
        }
        
        const status = monitor.getStatus();
        const activeAlerts = monitor.getAlertManager().getActiveAlerts();
        
        console.log('📊 Monitoring System Status');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🔄 Running: ${status.running ? '✅ Yes' : '❌ No'}`);
        console.log(`⏱️  Uptime: ${(status.uptime / 3600).toFixed(2)} hours`);
        console.log(`🚨 Active Alerts: ${status.activeAlerts}`);
        console.log(`📋 Total Alerts: ${status.totalAlerts}`);
        
        if (activeAlerts.length > 0) {
          console.log('\n🚨 Active Alerts:');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          activeAlerts.slice(0, 10).forEach(alert => {
            const severityIcon = {
              critical: '🔴',
              warning: '🟡',
              info: '🔵'
            }[alert.severity];
            
            console.log(`${severityIcon} [${alert.severity.toUpperCase()}] ${alert.component}: ${alert.message}`);
            console.log(`   📅 ${alert.timestamp.toISOString()}`);
            if (alert.count > 1) {
              console.log(`   🔄 Count: ${alert.count}`);
            }
          });
          
          if (activeAlerts.length > 10) {
            console.log(`   ... and ${activeAlerts.length - 10} more alerts`);
          }
        }
        
      } catch (error) {
        console.log('❌ Failed to get monitoring status:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to get monitoring status');
        process.exit(1);
      }
    });

  // Alerts command
  monitorCmd
    .command('alerts')
    .description('Manage alerts')
    .option('-a, --active', 'show only active alerts')
    .option('-l, --limit <number>', 'limit number of alerts shown', '20')
    .option('--ack <alertId>', 'acknowledge an alert')
    .option('--resolve <alertId>', 'resolve an alert')
    .action(async (options) => {
      try {
        const monitor = getSystemMonitor();
        if (!monitor) {
          console.log('❌ Monitoring system is not running');
          return;
        }
        
        const alertManager = monitor.getAlertManager();
        
        // Handle acknowledge
        if (options.ack) {
          const success = alertManager.acknowledgeAlert(options.ack, 'cli-user');
          if (success) {
            console.log(`✅ Alert ${options.ack} acknowledged`);
          } else {
            console.log(`❌ Failed to acknowledge alert ${options.ack}`);
          }
          return;
        }
        
        // Handle resolve
        if (options.resolve) {
          const success = alertManager.resolveAlert(options.resolve, 'cli-user');
          if (success) {
            console.log(`✅ Alert ${options.resolve} resolved`);
          } else {
            console.log(`❌ Failed to resolve alert ${options.resolve}`);
          }
          return;
        }
        
        // Show alerts
        const alerts = options.active 
          ? alertManager.getActiveAlerts()
          : alertManager.getAlertHistory(parseInt(options.limit));
        
        if (alerts.length === 0) {
          console.log(options.active ? '✅ No active alerts' : 'ℹ️  No alerts in history');
          return;
        }
        
        console.log(`🚨 ${options.active ? 'Active' : 'Recent'} Alerts (${alerts.length})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        alerts.forEach(alert => {
          const severityIcon = {
            critical: '🔴',
            warning: '🟡',
            info: '🔵'
          }[alert.severity];
          
          const statusIcon = alert.resolved ? '✅' : alert.acknowledged ? '👀' : '🚨';
          
          console.log(`${statusIcon} ${severityIcon} [${alert.id}] ${alert.component}: ${alert.message}`);
          console.log(`   📅 ${alert.timestamp.toISOString()}`);
          
          if (alert.count > 1) {
            console.log(`   🔄 Count: ${alert.count} (last: ${alert.lastOccurrence.toISOString()})`);
          }
          
          if (alert.acknowledged) {
            console.log(`   👀 Acknowledged by ${alert.acknowledgedBy} at ${alert.acknowledgedAt?.toISOString()}`);
          }
          
          if (alert.resolved) {
            console.log(`   ✅ Resolved at ${alert.resolvedAt?.toISOString()}`);
          }
          
          console.log('');
        });
        
        if (!options.active && alerts.length > 0) {
          console.log('💡 Use --ack <alertId> to acknowledge an alert or --resolve <alertId> to resolve it');
        }
        
      } catch (error) {
        console.log('❌ Failed to get alerts:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to get alerts');
        process.exit(1);
      }
    });

  // Metrics command
  monitorCmd
    .command('metrics')
    .description('Show current metrics summary')
    .option('--raw', 'show raw Prometheus metrics')
    .action(async (options) => {
      try {
        if (options.raw) {
          const metrics = await metricsCollector.getMetrics();
          console.log(metrics);
          return;
        }
        
        console.log('📊 System Metrics Summary');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // System metrics
        const memUsage = process.memoryUsage();
        console.log('🖥️  System:');
        console.log(`   Memory Usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
        console.log(`   RSS Memory: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
        console.log(`   Uptime: ${(process.uptime() / 3600).toFixed(2)} hours`);
        
        const monitor = getSystemMonitor();
        if (monitor) {
          const status = monitor.getStatus();
          console.log(`\n🔍 Monitoring:`);
          console.log(`   Status: ${status.running ? '✅ Running' : '❌ Stopped'}`);
          console.log(`   Active Alerts: ${status.activeAlerts}`);
          console.log(`   Total Alerts: ${status.totalAlerts}`);
        }
        
        console.log('\n💡 Use --raw flag to see full Prometheus metrics');
        
      } catch (error) {
        console.log('❌ Failed to get metrics:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to get metrics');
        process.exit(1);
      }
    });

  // Test alert command
  monitorCmd
    .command('test-alert')
    .description('Trigger a test alert')
    .option('--severity <severity>', 'alert severity (info|warning|critical)', 'info')
    .option('--component <component>', 'component name', 'test')
    .option('--message <message>', 'alert message', 'This is a test alert')
    .action(async (options) => {
      try {
        const monitor = getSystemMonitor();
        if (!monitor) {
          console.log('❌ Monitoring system is not running');
          return;
        }
        
        const alertManager = monitor.getAlertManager();
        
        // Add a temporary test alert rule
        const testRuleId = `test_alert_${Date.now()}`;
        alertManager.addAlertRule({
          id: testRuleId,
          name: 'Test Alert',
          description: 'Test alert for CLI testing',
          severity: options.severity as 'info' | 'warning' | 'critical',
          component: options.component,
          condition: () => true, // Always trigger
          message: () => options.message,
          cooldownMs: 0,
          autoResolve: false
        });
        
        // Trigger the alert
        alertManager.checkAlert(testRuleId, { testAlert: true });
        
        console.log(`✅ Test alert triggered with severity: ${options.severity}`);
        console.log(`📋 Component: ${options.component}`);
        console.log(`💬 Message: ${options.message}`);
        console.log('\nUse `bsc-bot monitor alerts --active` to see the alert');
        
        // Clean up the test rule
        setTimeout(() => {
          alertManager.removeAlertRule(testRuleId);
        }, 1000);
        
      } catch (error) {
        console.log('❌ Failed to trigger test alert:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to trigger test alert');
        process.exit(1);
      }
    });

  // Health check command
  monitorCmd
    .command('health')
    .description('Perform system health check')
    .action(async () => {
      try {
        console.log('🔍 Performing system health check...');
        
        const monitor = getSystemMonitor();
        const isMonitoringHealthy = monitor?.isHealthy() || false;
        
        console.log('\n📊 Health Check Results');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Monitoring system
        console.log(`🔍 Monitoring System: ${isMonitoringHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);
        
        // Memory check
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        const memUsagePercent = (heapUsedMB / heapTotalMB) * 100;
        const isMemoryHealthy = memUsagePercent < 80;
        
        console.log(`🧠 Memory Usage: ${isMemoryHealthy ? '✅' : '⚠️'} ${heapUsedMB}MB / ${heapTotalMB}MB (${memUsagePercent.toFixed(1)}%)`);
        
        // Process uptime
        const uptimeHours = process.uptime() / 3600;
        console.log(`⏱️  Uptime: ✅ ${uptimeHours.toFixed(2)} hours`);
        
        // Alert status
        if (monitor) {
          const activeAlerts = monitor.getAlertManager().getActiveAlerts();
          const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical').length;
          const warningAlerts = activeAlerts.filter(a => a.severity === 'warning').length;
          
          console.log(`🚨 Critical Alerts: ${criticalAlerts === 0 ? '✅' : '🔴'} ${criticalAlerts}`);
          console.log(`⚠️  Warning Alerts: ${warningAlerts === 0 ? '✅' : '🟡'} ${warningAlerts}`);
        }
        
        // Overall health
        const overallHealthy = isMonitoringHealthy && isMemoryHealthy;
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`🎯 Overall Health: ${overallHealthy ? '✅ Healthy' : '⚠️  Issues Detected'}`);
        
        if (!overallHealthy) {
          console.log('\n💡 Run `bsc-bot monitor alerts --active` to see current issues');
        }
        
      } catch (error) {
        console.log('❌ Health check failed:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Health check failed');
        process.exit(1);
      }
    });
}