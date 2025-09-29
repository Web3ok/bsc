/**
 * Risk Management CLI Commands
 * 
 * Provides comprehensive CLI interface for risk management operations:
 * - Position risk assessment and monitoring
 * - Portfolio risk metrics and analysis
 * - Risk alerts management and resolution
 * - Position sizing and adjustment recommendations
 * - Risk limits configuration and management
 */

import { Command } from 'commander';
import { logger } from '../../utils/logger';
import { database } from '../../persistence/database';
import chalk from 'chalk';

export function createRiskCommands(): Command {
  const risk = new Command('risk');
  risk.description('Advanced risk management and position optimization commands');

  // Position risk assessment
  risk
    .command('positions')
    .description('Show position risk analysis')
    .option('-l, --limit <number>', 'Maximum number of positions to show', '20')
    .option('--symbol <symbol>', 'Filter by specific symbol')
    .option('--high-risk', 'Show only high-risk positions (score > 70)')
    .option('--export <format>', 'Export to format: json|csv', '')
    .action(async (options) => {
      try {
        console.log('📊 Position Risk Analysis\n');

        if (!database.connection) {
          console.error('❌ Database connection not available');
          process.exit(1);
        }
        let query = database.connection('position_risks')
          .orderBy('risk_score', 'desc')
          .limit(parseInt(options.limit));

        if (options.symbol) {
          query = query.where('symbol', options.symbol);
        }

        if (options.highRisk) {
          query = query.where('risk_score', '>', 70);
        }

        const positions = await query;

        if (positions.length === 0) {
          console.log('No positions found matching criteria.');
          return;
        }

        if (options.export === 'json') {
          console.log(JSON.stringify(positions, null, 2));
          return;
        }

        if (options.export === 'csv') {
          const headers = ['Position ID', 'Symbol', 'Size (USD)', 'PnL (USD)', 'Risk Score', 'VaR 1D (USD)', 'Exposure %', 'Max DD %'];
          console.log(headers.join(','));
          
          positions.forEach(pos => {
            const row = [
              pos.position_id,
              pos.symbol,
              parseFloat(pos.current_size_usd).toFixed(2),
              parseFloat(pos.unrealized_pnl_usd).toFixed(2),
              parseFloat(pos.risk_score).toFixed(2),
              parseFloat(pos.var_1d_usd).toFixed(2),
              parseFloat(pos.exposure_pct).toFixed(2),
              parseFloat(pos.max_drawdown_pct).toFixed(2)
            ];
            console.log(row.join(','));
          });
          return;
        }

        // Display formatted table
        console.log('┌─────────────┬─────────┬──────────────┬──────────────┬────────────┬──────────────┬─────────────┬─────────────┐');
        console.log('│ Position ID │ Symbol  │ Size (USD)   │ PnL (USD)    │ Risk Score │ VaR 1D (USD) │ Exposure %  │ Max DD %    │');
        console.log('├─────────────┼─────────┼──────────────┼──────────────┼────────────┼──────────────┼─────────────┼─────────────┤');

        positions.forEach(pos => {
          const riskScore = parseFloat(pos.risk_score);
          const pnl = parseFloat(pos.unrealized_pnl_usd);
          
          const riskColor = riskScore > 80 ? chalk.red : riskScore > 60 ? chalk.yellow : chalk.green;
          const pnlColor = pnl >= 0 ? chalk.green : chalk.red;

          console.log(
            `│ ${pos.position_id.substring(0, 11).padEnd(11)} │ ${pos.symbol.padEnd(7)} │ ${parseFloat(pos.current_size_usd).toFixed(2).padStart(12)} │ ${pnlColor(pnl.toFixed(2).padStart(12))} │ ${riskColor(riskScore.toFixed(2).padStart(10))} │ ${parseFloat(pos.var_1d_usd).toFixed(2).padStart(12)} │ ${parseFloat(pos.exposure_pct).toFixed(2).padStart(11)} │ ${parseFloat(pos.max_drawdown_pct).toFixed(2).padStart(11)} │`
          );
        });

        console.log('└─────────────┴─────────┴──────────────┴──────────────┴────────────┴──────────────┴─────────────┴─────────────┘');
      } catch (error) {
        logger.error({ error }, 'Failed to fetch position risks');
        console.error('❌ Error fetching position risks:', error instanceof Error ? error.message : String(error));
      }
    });

  // Portfolio risk overview
  risk
    .command('portfolio')
    .description('Show portfolio-wide risk metrics')
    .option('--portfolio-id <id>', 'Portfolio ID', 'main')
    .action(async (options) => {
      try {
        console.log('📈 Portfolio Risk Overview\n');

        if (!database.connection) {
          console.error('❌ Database connection not available');
          process.exit(1);
        }
        const portfolioRisk = await database.connection('portfolio_risks')
          .where('portfolio_id', options.portfolioId)
          .first();

        if (!portfolioRisk) {
          console.log('No portfolio risk data found. Run risk assessment first.');
          return;
        }

        const totalExposure = parseFloat(portfolioRisk.total_exposure_usd);
        const totalVar = parseFloat(portfolioRisk.total_var_1d_usd);
        const maxDrawdown = parseFloat(portfolioRisk.max_drawdown_pct);
        const overallRisk = parseFloat(portfolioRisk.overall_risk_score);

        console.log('┌──────────────────────────────┬──────────────────────┐');
        console.log('│ Metric                       │ Value                │');
        console.log('├──────────────────────────────┼──────────────────────┤');
        console.log(`│ Total Exposure (USD)         │ ${totalExposure.toLocaleString().padStart(20)} │`);
        console.log(`│ Value at Risk 1D (USD)      │ ${totalVar.toLocaleString().padStart(20)} │`);
        console.log(`│ Portfolio Beta               │ ${parseFloat(portfolioRisk.portfolio_beta).toFixed(4).padStart(20)} │`);
        console.log(`│ Sharpe Ratio                 │ ${parseFloat(portfolioRisk.sharpe_ratio).toFixed(4).padStart(20)} │`);
        console.log(`│ Max Drawdown (%)             │ ${maxDrawdown.toFixed(2).padStart(20)} │`);
        console.log(`│ Concentration Risk           │ ${parseFloat(portfolioRisk.concentration_risk).toFixed(2).padStart(20)} │`);
        console.log(`│ Correlation Risk             │ ${parseFloat(portfolioRisk.correlation_risk).toFixed(2).padStart(20)} │`);
        console.log(`│ Liquidity Risk               │ ${parseFloat(portfolioRisk.liquidity_risk).toFixed(2).padStart(20)} │`);
        
        const riskColor = overallRisk > 80 ? chalk.red : overallRisk > 60 ? chalk.yellow : chalk.green;
        console.log(`│ Overall Risk Score           │ ${riskColor(overallRisk.toFixed(2)).padStart(20)} │`);
        console.log(`│ Breach Count                 │ ${portfolioRisk.breach_count.toString().padStart(20)} │`);
        console.log(`│ Last Assessment              │ ${new Date(portfolioRisk.last_assessment).toISOString().padStart(20)} │`);
        console.log('└──────────────────────────────┴──────────────────────┘');

        // Risk level interpretation
        console.log('\n📊 Risk Level Interpretation:');
        if (overallRisk <= 30) {
          console.log(chalk.green('🟢 LOW RISK') + ' - Portfolio is operating within safe parameters');
        } else if (overallRisk <= 60) {
          console.log(chalk.yellow('🟡 MODERATE RISK') + ' - Monitor closely and consider risk reduction');
        } else if (overallRisk <= 80) {
          console.log(chalk.red('🟠 HIGH RISK') + ' - Take action to reduce risk exposure');
        } else {
          console.log(chalk.red('🔴 CRITICAL RISK') + ' - Immediate action required!');
        }

      } catch (error) {
        logger.error({ error }, 'Failed to fetch portfolio risk');
        console.error('❌ Error fetching portfolio risk:', error instanceof Error ? error.message : String(error));
      }
    });

  // Risk alerts management
  risk
    .command('alerts')
    .description('Manage risk alerts and notifications')
    .option('-s, --severity <level>', 'Filter by severity: low|medium|high|critical')
    .option('-t, --type <type>', 'Filter by alert type')
    .option('--resolved', 'Show only resolved alerts')
    .option('--unresolved', 'Show only unresolved alerts')
    .option('-l, --limit <number>', 'Maximum number of alerts to show', '50')
    .action(async (options) => {
      try {
        console.log('🚨 Risk Alerts Management\n');

        if (!database.connection) {
          console.error('❌ Database connection not available');
          process.exit(1);
        }
        let query = database.connection('risk_alerts')
          .orderBy('created_at', 'desc')
          .limit(parseInt(options.limit));

        if (options.severity) {
          query = query.where('severity', options.severity);
        }

        if (options.type) {
          query = query.where('alert_type', options.type);
        }

        if (options.resolved) {
          query = query.whereNotNull('resolved_at');
        } else if (options.unresolved) {
          query = query.whereNull('resolved_at');
        }

        const alerts = await query;

        if (alerts.length === 0) {
          console.log('No alerts found matching criteria.');
          return;
        }

        console.log(`Found ${alerts.length} alerts:\n`);

        alerts.forEach((alert, index) => {
          const severityColors = {
            low: chalk.blue,
            medium: chalk.yellow,
            high: chalk.red,
            critical: chalk.red.bold
          };

          const severityColor = severityColors[alert.severity as keyof typeof severityColors] || chalk.white;
          const resolved = alert.resolved_at ? chalk.green('✅ RESOLVED') : chalk.red('🔴 ACTIVE');

          console.log(`${index + 1}. ${severityColor(alert.severity.toUpperCase())} - ${alert.alert_type}`);
          console.log(`   Entity: ${alert.entity_type}/${alert.entity_id}`);
          console.log(`   Message: ${alert.message}`);
          console.log(`   Value: ${parseFloat(alert.current_value).toFixed(2)} (Limit: ${parseFloat(alert.limit_value).toFixed(2)})`);
          console.log(`   Action: ${alert.recommended_action}`);
          console.log(`   Status: ${resolved}`);
          console.log(`   Created: ${new Date(alert.created_at).toISOString()}`);
          if (alert.resolved_at) {
            console.log(`   Resolved: ${new Date(alert.resolved_at).toISOString()} by ${alert.resolved_by}`);
          }
          console.log('');
        });

      } catch (error) {
        logger.error({ error }, 'Failed to fetch risk alerts');
        console.error('❌ Error fetching risk alerts:', error instanceof Error ? error.message : String(error));
      }
    });

  // Resolve alert
  risk
    .command('resolve-alert')
    .description('Mark a risk alert as resolved')
    .requiredOption('-a, --alert-id <id>', 'Alert ID to resolve')
    .option('--resolved-by <name>', 'Name of person resolving the alert', 'CLI User')
    .action(async (options) => {
      try {
        if (!database.connection) {
          console.error('❌ Database connection not available');
          process.exit(1);
        }
        const result = await database.connection('risk_alerts')
          .where('id', options.alertId)
          .update({
            resolved_at: new Date(),
            resolved_by: options.resolvedBy
          });

        if (result === 0) {
          console.log('❌ Alert not found or already resolved');
          return;
        }

        console.log(`✅ Alert ${options.alertId} marked as resolved by ${options.resolvedBy}`);
        logger.info({ alert_id: options.alertId, resolved_by: options.resolvedBy }, 'Risk alert resolved via CLI');

      } catch (error) {
        logger.error({ error }, 'Failed to resolve risk alert');
        console.error('❌ Error resolving alert:', error instanceof Error ? error.message : String(error));
      }
    });

  // Risk actions history
  risk
    .command('actions')
    .description('Show risk management actions history')
    .option('-t, --type <type>', 'Filter by action type')
    .option('-s, --status <status>', 'Filter by status: pending|executing|completed|failed|cancelled')
    .option('-l, --limit <number>', 'Maximum number of actions to show', '50')
    .action(async (options) => {
      try {
        console.log('⚡ Risk Actions History\n');

        if (!database.connection) {
          console.error('❌ Database connection not available');
          process.exit(1);
        }
        let query = database.connection('risk_actions')
          .orderBy('created_at', 'desc')
          .limit(parseInt(options.limit));

        if (options.type) {
          query = query.where('action_type', options.type);
        }

        if (options.status) {
          query = query.where('status', options.status);
        }

        const actions = await query;

        if (actions.length === 0) {
          console.log('No risk actions found matching criteria.');
          return;
        }

        console.log('┌─────────────┬──────────────────┬─────────────┬─────────────┬───────────────────┬──────────────────────┐');
        console.log('│ Action ID   │ Type             │ Status      │ Alert ID    │ Created           │ Executed             │');
        console.log('├─────────────┼──────────────────┼─────────────┼─────────────┼───────────────────┼──────────────────────┤');

        actions.forEach(action => {
          const statusColors = {
            pending: chalk.yellow,
            executing: chalk.blue,
            completed: chalk.green,
            failed: chalk.red,
            cancelled: chalk.gray
          };

          const statusColor = statusColors[action.status as keyof typeof statusColors] || chalk.white;
          const executionTime = action.execution_time ? 
            new Date(action.execution_time).toISOString().substring(11, 19) : 
            '---';

          console.log(
            `│ ${action.id.substring(0, 11).padEnd(11)} │ ${action.action_type.padEnd(16)} │ ${statusColor(action.status.padEnd(11))} │ ${action.trigger_alert_id.substring(0, 11).padEnd(11)} │ ${new Date(action.created_at).toISOString().substring(11, 19).padEnd(17)} │ ${executionTime.padEnd(20)} │`
          );
        });

        console.log('└─────────────┴──────────────────┴─────────────┴─────────────┴───────────────────┴──────────────────────┘');

      } catch (error) {
        logger.error({ error }, 'Failed to fetch risk actions');
        console.error('❌ Error fetching risk actions:', error instanceof Error ? error.message : String(error));
      }
    });

  // Position sizing calculator
  risk
    .command('size-position')
    .description('Calculate optimal position size')
    .requiredOption('-s, --symbol <symbol>', 'Trading symbol')
    .requiredOption('-p, --entry-price <price>', 'Entry price')
    .option('--stop-loss <price>', 'Stop loss price')
    .option('--confidence <score>', 'Confidence score (0-100)', '75')
    .option('--method <method>', 'Sizing method: fixed|percentage|volatility|kelly', 'percentage')
    .action(async (options) => {
      try {
        console.log('🎯 Position Size Calculator\n');

        const entryPrice = parseFloat(options.entryPrice);
        const stopLoss = options.stopLoss ? parseFloat(options.stopLoss) : undefined;
        const confidence = parseFloat(options.confidence);

        // Mock portfolio value - in real implementation this would come from the system
        const portfolioValue = 100000; // $100k mock portfolio

        let sizeUsd = 0;

        switch (options.method) {
          case 'fixed':
            sizeUsd = 1000; // Fixed $1000
            break;

          case 'percentage':
            sizeUsd = portfolioValue * 0.025; // 2.5% of portfolio
            break;

          case 'volatility':
            // Mock volatility calculation
            const volatility = 0.02; // 2% daily volatility
            const targetRisk = portfolioValue * 0.02; // 2% portfolio risk
            sizeUsd = targetRisk / volatility;
            break;

          case 'kelly':
            // Mock Kelly criterion calculation
            const winRate = 0.6; // 60% win rate
            const avgWin = 0.05; // 5% average win
            const avgLoss = 0.03; // 3% average loss
            const kellyFraction = (avgWin * winRate - avgLoss * (1 - winRate)) / avgWin;
            sizeUsd = portfolioValue * kellyFraction * 0.25; // Quarter Kelly for safety
            break;
        }

        // Apply stop loss risk adjustment
        if (stopLoss) {
          const riskPerShare = Math.abs(entryPrice - stopLoss) / entryPrice;
          const maxRiskUsd = portfolioValue * 0.02; // 2% max risk per trade
          const maxSizeByRisk = maxRiskUsd / riskPerShare;
          sizeUsd = Math.min(sizeUsd, maxSizeByRisk);
        }

        // Apply confidence adjustment
        sizeUsd *= Math.min(confidence / 100, 1.0);

        // Apply limits
        sizeUsd = Math.max(100, sizeUsd); // Min $100
        sizeUsd = Math.min(50000, sizeUsd); // Max $50k
        sizeUsd = Math.min(portfolioValue * 0.2, sizeUsd); // Max 20% of portfolio

        const shares = sizeUsd / entryPrice;
        const portfolioRisk = stopLoss ? (Math.abs(entryPrice - stopLoss) * shares) / portfolioValue * 100 : 0;

        console.log('┌──────────────────────────────┬──────────────────────┐');
        console.log('│ Parameter                    │ Value                │');
        console.log('├──────────────────────────────┼──────────────────────┤');
        console.log(`│ Symbol                       │ ${options.symbol.padStart(20)} │`);
        console.log(`│ Entry Price                  │ $${entryPrice.toFixed(4).padStart(19)} │`);
        if (stopLoss) {
          console.log(`│ Stop Loss                    │ $${stopLoss.toFixed(4).padStart(19)} │`);
        }
        console.log(`│ Confidence Score             │ ${confidence.toFixed(0).padStart(19)}% │`);
        console.log(`│ Sizing Method                │ ${options.method.padStart(20)} │`);
        console.log('├──────────────────────────────┼──────────────────────┤');
        console.log(`│ Recommended Size (USD)       │ $${sizeUsd.toFixed(2).padStart(19)} │`);
        console.log(`│ Recommended Shares           │ ${shares.toFixed(4).padStart(20)} │`);
        console.log(`│ Portfolio Allocation         │ ${(sizeUsd / portfolioValue * 100).toFixed(2).padStart(19)}% │`);
        if (portfolioRisk > 0) {
          const riskColor = portfolioRisk > 3 ? chalk.red : portfolioRisk > 2 ? chalk.yellow : chalk.green;
          console.log(`│ Portfolio Risk               │ ${riskColor(portfolioRisk.toFixed(2) + '%').padStart(20)} │`);
        }
        console.log('└──────────────────────────────┴──────────────────────┘');

        // Risk warnings
        if (portfolioRisk > 3) {
          console.log(chalk.red('\n⚠️  WARNING: Position risk exceeds 3% of portfolio'));
        }

        if (sizeUsd / portfolioValue > 0.15) {
          console.log(chalk.yellow('\n⚠️  CAUTION: Position size exceeds 15% of portfolio'));
        }

      } catch (error) {
        logger.error({ error }, 'Failed to calculate position size');
        console.error('❌ Error calculating position size:', error instanceof Error ? error.message : String(error));
      }
    });

  // Risk limits management
  risk
    .command('limits')
    .description('Manage risk limits configuration')
    .option('--entity-id <id>', 'Entity ID (strategy ID or "global")', 'global')
    .option('--entity-type <type>', 'Entity type: strategy|portfolio|global', 'global')
    .option('--set', 'Set new risk limits (interactive)')
    .action(async (options) => {
      try {
        if (options.set) {
          console.log('🔧 Set Risk Limits (Interactive Mode)\n');
          
          // This would implement interactive prompts for setting limits
          // For now, show current limits
          console.log('Interactive limit setting not implemented in this demo.');
          console.log('Use database queries to modify risk_limits table directly.\n');
        }

        console.log('📊 Current Risk Limits\n');

        if (!database.connection) {
          console.error('❌ Database connection not available');
          process.exit(1);
        }
        const limits = await database.connection('risk_limits')
          .where('entity_id', options.entityId)
          .where('entity_type', options.entityType)
          .first();

        if (!limits) {
          console.log('No risk limits found for the specified entity.');
          return;
        }

        console.log('┌──────────────────────────────┬──────────────────────┐');
        console.log('│ Limit Type                   │ Value                │');
        console.log('├──────────────────────────────┼──────────────────────┤');
        console.log(`│ Max Position Size (USD)     │ $${parseFloat(limits.max_position_size_usd).toLocaleString().padStart(19)} │`);
        console.log(`│ Max Portfolio Exposure (%)  │ ${parseFloat(limits.max_portfolio_exposure_pct).toFixed(2).padStart(19)}% │`);
        console.log(`│ Max Daily Loss (USD)        │ $${parseFloat(limits.max_daily_loss_usd).toLocaleString().padStart(19)} │`);
        console.log(`│ Max Drawdown (%)             │ ${parseFloat(limits.max_drawdown_pct).toFixed(2).padStart(19)}% │`);
        console.log(`│ Max Leverage                 │ ${parseFloat(limits.max_leverage).toFixed(2).padStart(19)}x │`);
        if (limits.stop_loss_pct) {
          console.log(`│ Default Stop Loss (%)       │ ${parseFloat(limits.stop_loss_pct).toFixed(2).padStart(19)}% │`);
        }
        if (limits.take_profit_pct) {
          console.log(`│ Default Take Profit (%)     │ ${parseFloat(limits.take_profit_pct).toFixed(2).padStart(19)}% │`);
        }
        console.log(`│ Position Concentration (%)  │ ${parseFloat(limits.position_concentration_limit_pct).toFixed(2).padStart(19)}% │`);
        console.log(`│ Correlation Limit            │ ${parseFloat(limits.correlation_limit).toFixed(2).padStart(20)} │`);
        console.log(`│ Last Updated                 │ ${new Date(limits.updated_at).toISOString().substring(0, 10).padStart(20)} │`);
        console.log('└──────────────────────────────┴──────────────────────┘');

      } catch (error) {
        logger.error({ error }, 'Failed to fetch risk limits');
        console.error('❌ Error fetching risk limits:', error instanceof Error ? error.message : String(error));
      }
    });

  // Risk assessment trigger
  risk
    .command('assess')
    .description('Trigger manual risk assessment')
    .option('--force', 'Force assessment even if recently run')
    .action(async (options) => {
      try {
        console.log('🔍 Triggering Manual Risk Assessment...\n');

        // This would trigger the risk manager to perform an assessment
        // For now, just show when the last assessment was done
        if (!database.connection) {
          console.error('❌ Database connection not available');
          process.exit(1);
        }
        const lastAssessment = await database.connection('portfolio_risks')
          .where('portfolio_id', 'main')
          .select('last_assessment')
          .first();

        if (lastAssessment) {
          const lastTime = new Date(lastAssessment.last_assessment);
          const timeSince = Date.now() - lastTime.getTime();
          const minutesSince = Math.floor(timeSince / 60000);

          console.log(`Last assessment: ${lastTime.toISOString()}`);
          console.log(`Time since: ${minutesSince} minutes ago`);

          if (minutesSince < 5 && !options.force) {
            console.log('\n⚠️  Assessment was run recently. Use --force to override.');
            return;
          }
        }

        console.log('✅ Manual risk assessment would be triggered here.');
        console.log('In production, this would call riskManager.performRiskAssessment()');

      } catch (error) {
        logger.error({ error }, 'Failed to trigger risk assessment');
        console.error('❌ Error triggering assessment:', error instanceof Error ? error.message : String(error));
      }
    });

  return risk;
}