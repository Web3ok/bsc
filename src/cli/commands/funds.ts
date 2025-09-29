import { Command } from 'commander';
import { ethers } from 'ethers';
import { logger } from '../../utils/logger';
import { getFundsManager } from '../../funds/FundsManager';
import { WalletConfig } from '../../funds/types';

const fundsCommand = new Command('funds');
fundsCommand.description('Funds management commands (gas drip, sweep, rebalance)');

// Wallet management commands
const walletCommand = new Command('wallets');
walletCommand.description('Manage wallet configurations');

walletCommand
  .command('add')
  .description('Add a wallet to funds management')
  .requiredOption('-a, --address <address>', 'Wallet address')
  .requiredOption('-g, --group <group>', 'Wallet group (hot|warm|cold|treasury|strategy)')
  .option('-l, --label <label>', 'Human readable label')
  .option('-s, --strategy-id <strategyId>', 'Associated strategy ID')
  .option('--gas-min <amount>', 'Minimum BNB threshold', '0.05')
  .option('--gas-max <amount>', 'Maximum BNB for top-up', '0.2')
  .option('--sweep-min <amount>', 'Minimum threshold for sweep', '0.01')
  .option('--no-managed', 'Disable funds management')
  .option('--no-sweep', 'Disable sweeping')
  .option('--whitelist <assets>', 'Comma-separated whitelist assets')
  .option('--blacklist <assets>', 'Comma-separated blacklist assets')
  .action(async (options) => {
    try {
      const fundsManager = getFundsManager();
      
      const walletConfig: Omit<WalletConfig, 'created_at' | 'updated_at'> = {
        address: options.address,
        group: options.group,
        label: options.label,
        strategy_id: options.strategyId,
        is_managed: options.managed !== false,
        gas_min_bnb: options.gasMin,
        gas_max_bnb: options.gasMax,
        sweep_enabled: options.sweep !== false,
        sweep_min_threshold: options.sweepMin,
        whitelist_assets: options.whitelist ? options.whitelist.split(',') : undefined,
        blacklist_assets: options.blacklist ? options.blacklist.split(',') : undefined
      };

      await fundsManager.addWallet(walletConfig);
      
      console.log(`✅ Wallet ${options.address} added to funds management`);
      console.log(`   Group: ${options.group}`);
      console.log(`   Label: ${options.label || 'N/A'}`);
      console.log(`   Managed: ${walletConfig.is_managed ? 'Yes' : 'No'}`);
      console.log(`   Gas Range: ${options.gasMin} - ${options.gasMax} BNB`);
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to add wallet');
      console.error('❌ Failed to add wallet:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

walletCommand
  .command('list')
  .description('List managed wallets')
  .option('-g, --group <group>', 'Filter by wallet group')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const fundsManager = getFundsManager();
      const wallets = await fundsManager.getWallets(options.group);
      
      if (options.json) {
        console.log(JSON.stringify(wallets, null, 2));
        return;
      }

      if (wallets.length === 0) {
        console.log('No managed wallets found');
        return;
      }

      console.log('\n💰 Managed Wallets:');
      console.log('─'.repeat(120));
      console.log('Address'.padEnd(44) + 'Group'.padEnd(12) + 'Label'.padEnd(20) + 'Managed'.padEnd(8) + 'Gas Range'.padEnd(20) + 'Sweep');
      console.log('─'.repeat(120));

      for (const wallet of wallets) {
        const managedIcon = wallet.is_managed ? '✅' : '❌';
        const sweepIcon = wallet.sweep_enabled ? '✅' : '❌';
        const gasRange = `${wallet.gas_min_bnb}-${wallet.gas_max_bnb} BNB`;

        console.log(
          wallet.address.padEnd(44) + 
          wallet.group.padEnd(12) + 
          (wallet.label || 'N/A').substring(0, 18).padEnd(20) + 
          `${managedIcon}`.padEnd(8) + 
          gasRange.padEnd(20) + 
          `${sweepIcon}`
        );
      }
      console.log('─'.repeat(120));
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to list wallets');
      console.error('❌ Failed to list wallets:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

walletCommand
  .command('remove <address>')
  .description('Remove a wallet from funds management')
  .option('-f, --force', 'Force removal without confirmation')
  .action(async (address, options) => {
    try {
      if (!options.force) {
        console.log('Use --force to confirm removal');
        return;
      }

      const fundsManager = getFundsManager();
      await fundsManager.removeWallet(address);
      
      console.log(`✅ Wallet ${address} removed from funds management`);
      
    } catch (error: unknown) {
      logger.error({ error, address }, 'Failed to remove wallet');
      console.error('❌ Failed to remove wallet:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

fundsCommand.addCommand(walletCommand);

// Balance commands
fundsCommand
  .command('balances')
  .description('Show current balance snapshots')
  .option('-w, --wallet <address>', 'Filter by wallet address')
  .option('-a, --asset <asset>', 'Filter by asset')
  .option('-g, --group <group>', 'Filter by wallet group')
  .option('--export <format>', 'Export format (json|csv)')
  .action(async (options) => {
    try {
      const fundsManager = getFundsManager();
      const snapshots = await fundsManager.getBalanceSnapshotService()
        .getLatestSnapshots(options.wallet, options.asset);
      
      // Filter by group if specified
      const filteredSnapshots = options.group ? 
        snapshots.filter(s => s.wallet_group === options.group) : 
        snapshots;

      if (options.export === 'json') {
        console.log(JSON.stringify(filteredSnapshots, null, 2));
        return;
      }

      if (options.export === 'csv') {
        console.log('wallet_address,wallet_group,asset_symbol,balance,balance_usd,is_below_threshold,is_above_threshold,created_at');
        filteredSnapshots.forEach(s => {
          console.log(`${s.wallet_address},${s.wallet_group},${s.asset_symbol},${s.balance},${s.balance_usd || ''},${s.is_below_threshold},${s.is_above_threshold},${s.created_at.toISOString()}`);
        });
        return;
      }

      if (filteredSnapshots.length === 0) {
        console.log('No balance snapshots found');
        return;
      }

      console.log('\n📊 Balance Snapshots:');
      console.log('─'.repeat(120));
      console.log('Wallet'.padEnd(20) + 'Group'.padEnd(10) + 'Asset'.padEnd(10) + 'Balance'.padEnd(20) + 'USD'.padEnd(12) + 'Below'.padEnd(8) + 'Above'.padEnd(8) + 'Updated');
      console.log('─'.repeat(120));

      for (const snapshot of filteredSnapshots) {
        const belowIcon = snapshot.is_below_threshold ? '⚠️' : '✅';
        const aboveIcon = snapshot.is_above_threshold ? '⚠️' : '✅';
        const balance = ethers.formatEther(snapshot.balance);
        const balanceDisplay = `${parseFloat(balance).toFixed(4)} ${snapshot.asset_symbol}`;
        const usdDisplay = snapshot.balance_usd ? `$${parseFloat(ethers.formatEther(snapshot.balance_usd)).toFixed(2)}` : 'N/A';

        console.log(
          snapshot.wallet_address.substring(0, 18).padEnd(20) + 
          (snapshot.wallet_group || 'N/A').padEnd(10) + 
          snapshot.asset_symbol.padEnd(10) + 
          balanceDisplay.padEnd(20) + 
          usdDisplay.padEnd(12) + 
          belowIcon.padEnd(8) + 
          aboveIcon.padEnd(8) + 
          snapshot.created_at.toISOString().substring(0, 16)
        );
      }
      console.log('─'.repeat(120));
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to get balance snapshots');
      console.error('❌ Failed to get balances:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Gas drip commands
const gasCommand = new Command('gas');
gasCommand.description('Gas top-up management');

gasCommand
  .command('drip')
  .description('Manually trigger gas top-up for wallets')
  .option('-w, --wallet <address>', 'Specific wallet to top up')
  .option('--min <amount>', 'Minimum BNB threshold', '0.05')
  .option('--max <amount>', 'Maximum BNB to add', '0.2')
  .option('-g, --group <group>', 'Target wallet group')
  .action(async (options) => {
    try {
      const fundsManager = getFundsManager();
      
      if (options.wallet) {
        // Manual top-up for specific wallet
        const jobId = await fundsManager.manualGasTopUp(options.wallet, options.max);
        console.log(`✅ Gas top-up job created: ${jobId}`);
        console.log(`   Wallet: ${options.wallet}`);
        console.log(`   Amount: ${options.max} BNB`);
      } else {
        // Check for wallets needing gas and create jobs
        const wallets = await fundsManager.getBalanceSnapshotService()
          .getWalletsNeedingGas(options.min);
        
        if (wallets.length === 0) {
          console.log('✅ No wallets need gas top-up');
          return;
        }

        console.log(`🔍 Found ${wallets.length} wallets needing gas top-up:`);
        for (const wallet of wallets) {
          const balance = ethers.formatEther(wallet.balance);
          console.log(`  ${wallet.wallet_address}: ${balance} BNB`);
        }
      }
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to execute gas drip');
      console.error('❌ Failed to execute gas drip:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

gasCommand
  .command('status')
  .description('Show gas drip service status')
  .action(async () => {
    try {
      const fundsManager = getFundsManager();
      const status = fundsManager.getGasDripService().getStatus();
      
      console.log('\n⛽ Gas Drip Service Status:');
      console.log(`Running: ${status.running ? '✅' : '❌'}`);
      console.log(`Enabled: ${status.enabled ? '✅' : '❌'}`);
      console.log(`Dry Run: ${status.dryRun ? '⚠️  Yes' : '✅ No'}`);
      console.log(`Processing Jobs: ${status.processingJobs}`);
      console.log(`Max Concurrent: ${status.maxConcurrentJobs}`);
      console.log(`Check Interval: ${status.checkIntervalMs}ms`);
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to get gas drip status');
      console.error('❌ Failed to get status:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

gasCommand
  .command('history')
  .description('Show gas top-up job history')
  .option('-w, --wallet <address>', 'Filter by wallet')
  .option('-l, --limit <limit>', 'Limit results', '20')
  .action(async (options) => {
    try {
      const fundsManager = getFundsManager();
      const jobs = await fundsManager.getGasDripService()
        .getJobHistory(options.wallet, parseInt(options.limit));
      
      if (jobs.length === 0) {
        console.log('No gas top-up jobs found');
        return;
      }

      console.log('\n⛽ Gas Top-Up History:');
      console.log('─'.repeat(100));
      console.log('Job ID'.padEnd(20) + 'Wallet'.padEnd(20) + 'Amount'.padEnd(12) + 'Status'.padEnd(12) + 'TX Hash'.padEnd(20) + 'Created');
      console.log('─'.repeat(100));

      for (const job of jobs) {
        const statusIconMap = {
          pending: '🟡',
          processing: '🔄',
          completed: '✅',
          failed: '❌',
          cancelled: '⏹️'
        } as const;
        const statusIcon = statusIconMap[job.status as keyof typeof statusIconMap] || '❓';

        console.log(
          job.id.substring(0, 18).padEnd(20) + 
          job.target_wallet.substring(0, 18).padEnd(20) + 
          `${job.amount_bnb} BNB`.padEnd(12) + 
          `${statusIcon} ${job.status}`.padEnd(12) + 
          (job.tx_hash ? job.tx_hash.substring(0, 18) : 'N/A').padEnd(20) + 
          job.created_at.toISOString().substring(0, 16)
        );
      }
      console.log('─'.repeat(100));
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to get gas drip history');
      console.error('❌ Failed to get history:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

fundsCommand.addCommand(gasCommand);

// Sweep commands
const sweepCommand = new Command('sweep');
sweepCommand.description('Balance sweep management');

sweepCommand
  .command('execute')
  .description('Execute balance sweeps')
  .option('-w, --wallet <address>', 'Specific source wallet')
  .option('-t, --target <address>', 'Target wallet (default: treasury)')
  .option('-a, --asset <asset>', 'Specific asset to sweep')
  .option('--min <amount>', 'Minimum balance to trigger sweep', '0.01')
  .option('--tokens <tokens>', 'Comma-separated list of tokens (USDT,USDC,WBNB)')
  .action(async (options) => {
    try {
      const fundsManager = getFundsManager();
      const sweepService = fundsManager.getSweeperService();
      
      if (options.wallet && options.asset) {
        // Manual sweep
        const targetWallet = options.target || fundsManager.getStatus().config.treasuryAddress;
        const amount = options.min;
        
        const jobId = await fundsManager.manualSweep(options.wallet, targetWallet, options.asset, amount);
        console.log(`✅ Sweep job created: ${jobId}`);
        console.log(`   From: ${options.wallet}`);
        console.log(`   To: ${targetWallet}`);
        console.log(`   Asset: ${options.asset}`);
        console.log(`   Amount: ${amount}`);
      } else {
        // Check for wallets ready for sweep
        const assets = options.tokens ? options.tokens.split(',') : ['USDT', 'USDC', 'WBNB'];
        
        for (const asset of assets) {
          const wallets = await fundsManager.getBalanceSnapshotService()
            .getWalletsReadyForSweep(asset);
          
          console.log(`🔍 ${asset}: Found ${wallets.length} wallets ready for sweep`);
          
          for (const wallet of wallets) {
            const balance = ethers.formatEther(wallet.balance);
            console.log(`  ${wallet.wallet_address}: ${balance} ${asset}`);
          }
        }
      }
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to execute sweep');
      console.error('❌ Failed to execute sweep:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

sweepCommand
  .command('status')
  .description('Show sweep service status')
  .action(async () => {
    try {
      const fundsManager = getFundsManager();
      const status = fundsManager.getSweeperService().getStatus();
      
      console.log('\n🧹 Sweep Service Status:');
      console.log(`Running: ${status.running ? '✅' : '❌'}`);
      console.log(`Enabled: ${status.enabled ? '✅' : '❌'}`);
      console.log(`Dry Run: ${status.dryRun ? '⚠️  Yes' : '✅ No'}`);
      console.log(`Processing Jobs: ${status.processingJobs}`);
      console.log(`Max Concurrent: ${status.maxConcurrentJobs}`);
      console.log(`Supported Assets: ${status.supportedAssets.join(', ')}`);
      console.log(`Check Interval: ${status.checkIntervalMs}ms`);
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to get sweep status');
      console.error('❌ Failed to get status:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

fundsCommand.addCommand(sweepCommand);

// Rebalance commands
const rebalanceCommand = new Command('rebalance');
rebalanceCommand.description('Portfolio rebalancing');

rebalanceCommand
  .command('execute')
  .description('Execute portfolio rebalancing')
  .option('-g, --group <group>', 'Target wallet group')
  .option('--target <allocation>', 'Target allocation (e.g., "BNB:30,USDT:50,WBNB:20")')
  .action(async (options) => {
    try {
      const fundsManager = getFundsManager();
      
      const jobId = await fundsManager.manualRebalance(options.group);
      console.log(`✅ Rebalance job created: ${jobId}`);
      
      if (options.group) {
        console.log(`   Wallet Group: ${options.group}`);
      }
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to execute rebalance');
      console.error('❌ Failed to execute rebalance:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

rebalanceCommand
  .command('status')
  .description('Show current portfolio allocation')
  .action(async () => {
    try {
      const fundsManager = getFundsManager();
      const rebalancerService = fundsManager.getRebalancerService();
      
      const status = rebalancerService.getStatus();
      const portfolioState = await rebalancerService.getPortfolioStatus();
      
      console.log('\n⚖️  Portfolio Rebalancing Status:');
      console.log(`Service Running: ${status.running ? '✅' : '❌'}`);
      console.log(`Enabled: ${status.enabled ? '✅' : '❌'}`);
      console.log(`Dry Run: ${status.dryRun ? '⚠️  Yes' : '✅ No'}`);
      console.log(`Total Value: $${portfolioState.total_value_usd.toFixed(2)}`);
      console.log(`Max Drift: ${portfolioState.max_drift.toFixed(2)}%`);
      console.log(`Needs Rebalancing: ${portfolioState.needs_rebalancing ? '⚠️  Yes' : '✅ No'}`);
      console.log(`Tolerance Band: ${status.toleranceBand}%`);
      
      console.log('\n📊 Asset Allocation:');
      console.log('─'.repeat(80));
      console.log('Asset'.padEnd(10) + 'Current'.padEnd(12) + 'Target'.padEnd(12) + 'Drift'.padEnd(10) + 'Value USD'.padEnd(15) + 'Action');
      console.log('─'.repeat(80));
      
      for (const allocation of portfolioState.allocations) {
        const actionIcon = allocation.needs_rebalancing ? '⚠️  Rebalance' : '✅ OK';
        
        console.log(
          allocation.asset.padEnd(10) + 
          `${allocation.current_percentage.toFixed(2)}%`.padEnd(12) + 
          `${allocation.target_percentage.toFixed(2)}%`.padEnd(12) + 
          `${allocation.drift.toFixed(2)}%`.padEnd(10) + 
          `$${allocation.current_value_usd.toFixed(2)}`.padEnd(15) + 
          actionIcon
        );
      }
      console.log('─'.repeat(80));
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to get rebalance status');
      console.error('❌ Failed to get status:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

fundsCommand.addCommand(rebalanceCommand);

// General status and metrics
fundsCommand
  .command('status')
  .description('Show overall funds management status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const fundsManager = getFundsManager();
      const status = fundsManager.getStatus();
      const metrics = await fundsManager.getFundsMetrics();
      const alerts = await fundsManager.getUnresolvedAlerts();
      
      if (options.json) {
        console.log(JSON.stringify({ status, metrics, alerts }, null, 2));
        return;
      }

      console.log('\n💰 Funds Management Status:');
      console.log(`Running: ${status.running ? '✅' : '❌'}`);
      console.log(`Treasury: ${status.config.treasuryAddress}`);
      console.log(`Managed Groups: ${status.config.managedWalletGroups.join(', ')}`);
      console.log(`Supported Assets: ${status.config.supportedAssets.join(', ')}`);
      
      console.log('\n📊 Metrics (24h):');
      console.log(`Total Managed Wallets: ${metrics.total_managed_wallets}`);
      console.log(`Gas Top-ups: ${metrics.gas_top_ups_24h}`);
      console.log(`Sweeps: ${metrics.sweeps_24h}`);
      console.log(`Rebalances: ${metrics.rebalances_24h}`);
      console.log(`Wallets Below Gas Threshold: ${metrics.wallets_below_gas_threshold}`);
      console.log(`Wallets Ready for Sweep: ${metrics.wallets_ready_for_sweep}`);
      console.log(`Last Balance Update: ${metrics.last_balance_update.toISOString()}`);
      
      if (alerts.length > 0) {
        console.log('\n🚨 Active Alerts:');
        console.log('─'.repeat(80));
        console.log('Type'.padEnd(15) + 'Wallet'.padEnd(20) + 'Severity'.padEnd(10) + 'Message');
        console.log('─'.repeat(80));
        
        for (const alert of alerts.slice(0, 10)) {
          const severityIcon = {
            low: '🟢',
            medium: '🟡',
            high: '🟠',
            critical: '🔴'
          }[alert.severity] || '❓';
          
          console.log(
            alert.alert_type.padEnd(15) + 
            (alert.wallet_address?.substring(0, 18) || 'N/A').padEnd(20) + 
            `${severityIcon} ${alert.severity}`.padEnd(10) + 
            alert.message.substring(0, 40)
          );
        }
        console.log('─'.repeat(80));
      }
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to get funds status');
      console.error('❌ Failed to get status:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

// Force balance snapshot
fundsCommand
  .command('snapshot')
  .description('Force balance snapshot update')
  .action(async () => {
    try {
      const fundsManager = getFundsManager();
      console.log('🔄 Taking balance snapshots...');
      
      await fundsManager.forceBalanceSnapshot();
      console.log('✅ Balance snapshots completed');
      
    } catch (error: unknown) {
      logger.error({ error }, 'Failed to take balance snapshot');
      console.error('❌ Failed to take snapshot:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });

export { fundsCommand };