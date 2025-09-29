import pino from 'pino';
import { configManager } from '../config';

const logger = pino({
  level: process.env.PINO_LOG_LEVEL || configManager.config.monitoring.log_level || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: {
    error: pino.stdSerializers.err,
  },
  transport: configManager.isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export { logger };

export function createContextLogger(context: Record<string, any>) {
  return logger.child(context);
}

export function logTransaction(txHash: string, operation: string, additional?: Record<string, any>) {
  return logger.child({
    txHash,
    operation,
    type: 'transaction',
    ...additional,
  });
}

export function logWallet(walletAddress: string, additional?: Record<string, any>) {
  return logger.child({
    walletAddress,
    type: 'wallet',
    ...additional,
  });
}