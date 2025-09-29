#!/usr/bin/env node

import { Command } from 'commander';
import { walletCommands } from './commands/wallet';
import { tradeCommands } from './commands/trade';
import { transferCommands } from './commands/transfer';
import { monitorCommands } from './commands/monitor';
import { ConfigLoader } from '../config/loader';
import pino from 'pino';

const program = new Command();
const logger = pino({
  level: ConfigLoader.getInstance().getMonitoringConfig().logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname'
    }
  }
});

program
  .name('bsc-bot')
  .description('BSC Market Maker Bot - Batch wallet management and DEX trading')
  .version('0.1.0');

// Global error handler
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
  process.exit(1);
});

// Register command modules
walletCommands(program, logger);
tradeCommands(program, logger);
transferCommands(program, logger);
monitorCommands(program, logger);

// Global options
program
  .option('-v, --verbose', 'enable verbose logging')
  .option('--dry-run', 'simulate operations without executing')
  .option('--config <path>', 'path to config file');

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}