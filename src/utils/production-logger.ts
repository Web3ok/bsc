import winston from 'winston';
import path from 'path';
import fs from 'fs';
import DailyRotateFile from 'winston-daily-rotate-file';

// Create logs directory if it doesn't exist
const logsDir = process.env.LOG_DIR || './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom log format for production
const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, metadata }) => {
    let meta = '';
    if (metadata && Object.keys(metadata).length > 0) {
      meta = ` ${JSON.stringify(metadata)}`;
    }
    return `[${timestamp}] ${level}: ${message}${meta}`;
  })
);

// Create transport for error logs with rotation
const errorRotateTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: process.env.LOG_MAX_SIZE || '10m',
  maxFiles: process.env.LOG_MAX_FILES || '30',
  level: 'error',
  format: productionFormat,
  zippedArchive: process.env.LOG_COMPRESS === 'true'
});

// Create transport for combined logs with rotation
const combinedRotateTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'combined-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: process.env.LOG_MAX_SIZE || '10m',
  maxFiles: process.env.LOG_MAX_FILES || '30',
  format: productionFormat,
  zippedArchive: process.env.LOG_COMPRESS === 'true'
});

// Create transport for access logs with rotation
const accessRotateTransport = new DailyRotateFile({
  filename: path.join(logsDir, 'access-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: process.env.LOG_MAX_SIZE || '10m',
  maxFiles: process.env.LOG_MAX_FILES || '7',
  level: 'info',
  format: productionFormat,
  zippedArchive: process.env.LOG_COMPRESS === 'true'
});

// Create production logger instance
const productionLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: productionFormat,
  defaultMeta: {
    service: 'bsc-trading-bot',
    environment: process.env.NODE_ENV || 'development',
    version: process.env.DEPLOYMENT_VERSION || '1.0.0'
  },
  transports: [
    errorRotateTransport,
    combinedRotateTransport
  ],
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: productionFormat
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: productionFormat
    })
  ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  productionLogger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'debug'
  }));
} else {
  // In production, only log errors to console
  productionLogger.add(new winston.transports.Console({
    format: consoleFormat,
    level: 'error'
  }));
}

// Create specialized loggers
const accessLogger = winston.createLogger({
  level: 'info',
  format: productionFormat,
  defaultMeta: {
    service: 'bsc-trading-bot-access'
  },
  transports: [accessRotateTransport]
});

// Performance monitoring logger
const performanceLogger = winston.createLogger({
  level: 'info',
  format: productionFormat,
  defaultMeta: {
    service: 'bsc-trading-bot-performance'
  },
  transports: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'performance-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '5m',
      maxFiles: '7',
      format: productionFormat,
      zippedArchive: true
    })
  ]
});

// Security audit logger
const securityLogger = winston.createLogger({
  level: 'info',
  format: productionFormat,
  defaultMeta: {
    service: 'bsc-trading-bot-security'
  },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'security.log'),
      format: productionFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ]
});

// Helper functions for structured logging
export const logMetrics = (metrics: any) => {
  performanceLogger.info('performance_metrics', {
    timestamp: new Date().toISOString(),
    ...metrics
  });
};

export const logSecurity = (event: string, details: any) => {
  securityLogger.warn(event, {
    timestamp: new Date().toISOString(),
    ip: details.ip,
    user: details.user,
    action: details.action,
    result: details.result,
    ...details
  });
};

export const logAccess = (req: any, res: any, responseTime: number) => {
  accessLogger.info('http_request', {
    method: req.method,
    url: req.url,
    status: res.statusCode,
    responseTime: `${responseTime}ms`,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
    referer: req.get('referer')
  });
};

export const logTransaction = (type: string, transaction: any) => {
  productionLogger.info(`transaction_${type}`, {
    txHash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
    value: transaction.value,
    gasUsed: transaction.gasUsed,
    status: transaction.status,
    ...transaction
  });
};

export const logAlert = (level: string, alert: any) => {
  const logMethod = level === 'critical' ? 'error' : 
                   level === 'warning' ? 'warn' : 'info';
  
  productionLogger[logMethod](`alert_${level}`, {
    title: alert.title,
    message: alert.message,
    service: alert.service,
    threshold: alert.threshold,
    value: alert.value,
    ...alert
  });
};

// Log rotation event handlers
errorRotateTransport.on('rotate', (oldFilename, newFilename) => {
  productionLogger.info('Log rotation', {
    oldFile: oldFilename,
    newFile: newFilename,
    type: 'error'
  });
});

combinedRotateTransport.on('rotate', (oldFilename, newFilename) => {
  productionLogger.info('Log rotation', {
    oldFile: oldFilename,
    newFile: newFilename,
    type: 'combined'
  });
});

// Export loggers
export {
  productionLogger as logger,
  accessLogger,
  performanceLogger,
  securityLogger
};

// Express middleware for request logging
export const requestLogger = (req: any, res: any, next: any) => {
  const startTime = Date.now();
  
  // Log response after it's sent
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    logAccess(req, res, responseTime);
    
    // Log slow requests
    if (responseTime > 1000) {
      performanceLogger.warn('slow_request', {
        method: req.method,
        url: req.url,
        responseTime: `${responseTime}ms`
      });
    }
  });
  
  next();
};

// Error logging middleware
export const errorLogger = (err: any, req: any, res: any, next: any) => {
  productionLogger.error('request_error', {
    error: {
      message: err.message,
      stack: err.stack,
      code: err.code
    },
    request: {
      method: req.method,
      url: req.url,
      body: req.body,
      ip: req.ip
    }
  });
  
  next(err);
};

export default productionLogger;