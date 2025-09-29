#!/usr/bin/env ts-node

import { Command } from 'commander';
import fs from 'fs';
import pino from 'pino';

import { logger } from '../utils/logger';
import { WalletManager } from '../wallet';
import { BatchWalletManager } from '../wallet/batch-wallet-manager';
import { MultiDEXAggregator } from '../dex/multi-dex-aggregator';
import { walletCommands } from '../cli/commands/wallet';
import { tradeCommands } from '../cli/commands/trade';
import { transferCommands } from '../cli/commands/transfer';
import { formatError } from '../cli/utils/logging';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration: number;
  message?: string;
}

class EndToEndTester {
  private results: TestResult[] = [];

  async run(): Promise<void> {
    logger.info('🚀 Starting minimal end-to-end verification');
    this.ensureDefaultEncryptionPassword();

    try {
      await this.testWalletFlow();
      await this.testAggregatorSmoke();
      await this.testCLIStubs();
    } finally {
      this.printSummary();
    }
  }

  private ensureDefaultEncryptionPassword() {
    if (!process.env.ENCRYPTION_PASSWORD) {
      process.env.ENCRYPTION_PASSWORD = 'e2e-temporary-password';
      logger.warn('ENCRYPTION_PASSWORD not provided – using temporary password for E2E script');
    }
    if (!process.env.ALLOW_DEV_ENCRYPTION_FALLBACK) {
      process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
    }
  }

  private async testWalletFlow() {
    const walletManager = WalletManager.getInstance();
    const batchManager = new BatchWalletManager(walletManager);

    await this.runTest('Wallet generation', async () => {
      const result = await batchManager.generateWallets({ count: 2, aliasPrefix: 'e2e' });
      if (!result.success) throw new Error(`Expected success, got ${result.errors.length} errors`);
    });

    const wallets = walletManager.getAllWallets();

    await this.runTest('Wallet export CSV format', async () => {
      const csvPath = await walletManager.exportToCSV({ includePrivateKeys: false });
      const content = await fs.promises.readFile(csvPath, 'utf8');
      const header = content.trim().split('\n')[0];
      if (header !== 'Address,Derivation Index,Label,Group,Created At') {
        throw new Error(`Unexpected CSV header: ${header}`);
      }
      if (wallets[0] && content.includes(wallets[0].privateKey.slice(2))) {
        throw new Error('CSV should not contain private keys');
      }
    });
  }

  private async testAggregatorSmoke() {
    await this.runTest('DEX supported list', async () => {
      const aggregator = new MultiDEXAggregator(WalletManager.getInstance());
      const supported = aggregator.getSupportedDEXes();
      if (!supported.length) {
        throw new Error('No supported DEXes reported');
      }
    });

    await this.skipTest('Quote execution', 'Requires live pricing services – skipped in minimal E2E run');
    await this.skipTest('Batch trade execution', 'Requires funded wallets – skipped in minimal E2E run');
  }

  private async testCLIStubs() {
    const runCommand = async (args: string[]) => {
      const cli = new Command();
      const stream = {
        write(message: string) {
          logger.info(message.trim());
        },
      };
      const cliLogger = pino({ level: 'info' }, stream as any);
      walletCommands(cli, cliLogger);
      tradeCommands(cli, cliLogger);
      transferCommands(cli, cliLogger);

      await cli.parseAsync(args, { from: 'user' });
    };

    await this.runTest('CLI wallet generate stub', async () => {
      await runCommand(['wallet', 'generate', '--count', '1']);
    });

    await this.runTest('CLI trade quote stub', async () => {
      await runCommand(['trade', 'quote', '--token-in', 'BNB', '--token-out', '0xUSDT']);
    });

    await this.runTest('CLI transfer send stub', async () => {
      await runCommand(['transfer', 'send', '0xRecipient', '--amount', '0.1']);
    });
  }

  private async runTest(name: string, fn: () => Promise<void>) {
    const start = Date.now();
    try {
      await fn();
      this.results.push({ name, status: 'pass', duration: Date.now() - start });
      logger.info({ test: name }, '✅ Test passed');
    } catch (error) {
      this.results.push({
        name,
        status: 'fail',
        duration: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
      });
      logger.error({ test: name, err: formatError(error) }, '❌ Test failed');
    }
  }

  private async skipTest(name: string, reason: string) {
    logger.warn({ test: name, reason }, '⏭️  Test skipped');
    this.results.push({ name, status: 'skip', duration: 0, message: reason });
  }

  private printSummary() {
    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.results.filter(r => r.status === 'fail');
    const skipped = this.results.filter(r => r.status === 'skip').length;

    logger.info({ passed, failed: failed.length, skipped }, '📋 End-to-end summary');
    failed.forEach(result => {
      logger.error({ test: result.name, message: result.message }, '❌ Failed test detail');
    });

    if (failed.length > 0) {
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  new EndToEndTester()
    .run()
    .catch(error => {
      logger.error({ err: formatError(error) }, 'Unexpected error while running E2E script');
      process.exit(1);
    });
}

export default EndToEndTester;
