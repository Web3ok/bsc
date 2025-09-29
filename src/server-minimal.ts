import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pino from 'pino';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { database } from './persistence/database';

const logger = pino({ name: 'Server' });
const app = express();

// Core server URL (where the real API is running)
const CORE_SERVER_URL = process.env.CORE_SERVER_URL || 'http://localhost:10001';

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());

// Basic health check
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    let dbStatus = 'disconnected';
    try {
      if (database.connection) {
        await database.connection.raw('SELECT 1');
        dbStatus = 'connected';
      }
    } catch (error) {
      dbStatus = 'error';
    }

    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        coreServer: CORE_SERVER_URL
      }
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      error: (error as Error).message
    });
  }
});

// Debug middleware to log all incoming requests
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url, originalUrl: req.originalUrl, path: req.path }, 'Incoming request');
  next();
});

// Proxy configuration with proper typing
const proxyOptions: any = {
  target: CORE_SERVER_URL,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying
  onError: (err: Error, req: any, res: any) => {
    logger.error({ error: err.message, url: req.url }, 'Proxy error');
    res.status(502).json({
      success: false,
      message: 'Core API server unavailable',
      error: 'BAD_GATEWAY'
    });
  },
  onProxyReq: (proxyReq: any, req: any) => {
    logger.info({ method: req.method, url: req.url, originalUrl: req.originalUrl }, 'Proxying request to core server');
  },
  onProxyRes: (proxyRes: any, req: any) => {
    logger.info({ statusCode: proxyRes.statusCode, url: req.url }, 'Proxy response received');
  }
};

// Proxy all /api requests and WebSocket connections to core server  
app.use('/api', createProxyMiddleware(proxyOptions));
app.use('/ws', createProxyMiddleware(proxyOptions));

// Fallback for unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Error handler
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ error: error.message, stack: error.stack }, 'Server error');
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Proxying API requests to: ${CORE_SERVER_URL}`);
});

export default app;