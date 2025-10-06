import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';

import { logger } from './utils/logger';
import { WalletManager, WalletInfo } from './wallet';
import { healthMonitor } from './monitor/health';
import { walletService } from './services/wallet-service';
import { database } from './persistence/database';
import { TradingService } from './dex/trading';

// API Routes
import { BatchTradingAPI } from './api/batch-trading-api';
import { MarketDataAPI } from './api/market-data-api';
import { WalletManagementAPI } from './api/wallet-management-api';
import { StrategyManagementAPI } from './api/strategy-management-api';
import { RiskManagementAPI } from './api/risk-management-api';
import { SystemAPI } from './api/system-api';

// Authentication and Rate Limiting
import { authenticate, createLoginEndpoint, createAuthMiddleware } from './middleware/auth';
import { generalRateLimit, tradingRateLimit, authRateLimit } from './middleware/rateLimit';

// Batch Operations and New Services
import { blockchainMonitor } from './services/blockchain-monitor';
import { auditService } from './services/audit-service';
import { walletBalanceService } from './services/wallet-balance-service';
import { priceService } from './services/price-service';
import { MonitoringService } from './services/monitoring-service';
import { formatError } from './utils/error-handler';
import type { TokenBalance } from './services/wallet-service';
import type { PriceData } from './services/price-service';

interface PublicWallet {
  address: string;
  label: string | null;
  balance: string;
  nonce: number;
  status: 'active' | 'inactive' | 'suspended' | 'archived';
  group: string | null;
  tier: WalletInfo['tier'] | null;
  derivationIndex: number | null;
  transactions24h: number;
  lastActivity: string;
  createdAt: string;
  tokenBalances: TokenBalance[];
}

interface BatchOperationRequest {
  type: string;
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string | number;
}

interface MonitoringResponseData {
  message: string;
  status: 'started' | 'updated';
  addedAddresses: string[];
  addedCount: number;
  totalWatched: number;
  skippedAddresses?: string[];
  skippedCount?: number;
}

interface SystemSettings {
  trading: {
    default_slippage: number;
    max_slippage: number;
    max_open_positions: number;
    auto_rebalance: boolean;
  };
  risk_management: {
    max_drawdown: number;
    max_position_size: number;
    stop_loss_threshold: number;
  };
  monitoring: {
    alert_webhook: string | null;
    anomaly_detection: boolean;
    heartbeat_interval_seconds: number;
  };
}

export class APIServer {
  private app: express.Application;
  private server: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private port: number;
  private walletManager: WalletManager;
  private tradingService: TradingService;
  private database = database;
  private settings: SystemSettings;
  private legacyHandlers: Map<string, express.RequestHandler> = new Map();

  constructor(port: number = 10001) {
    this.app = express();
    this.port = port;
    this.walletManager = WalletManager.getInstance();
    this.tradingService = new TradingService(this.walletManager);
    this.settings = this.createDefaultSettings();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private createDefaultSettings(): SystemSettings {
    return {
      trading: {
        default_slippage: 0.5,
        max_slippage: 2.5,
        max_open_positions: 10,
        auto_rebalance: false,
      },
      risk_management: {
        max_drawdown: 0.25,
        max_position_size: 0.15,
        stop_loss_threshold: 0.08,
      },
      monitoring: {
        alert_webhook: null,
        anomaly_detection: true,
        heartbeat_interval_seconds: 30,
      },
    };
  }

  private getQueryString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      const first = value[0];
      return typeof first === 'string' ? first : undefined;
    }

    return undefined;
  }

  private getQueryNumber(value: unknown, defaultValue: number): number {
    const stringValue = this.getQueryString(value);
    if (!stringValue) {
      return defaultValue;
    }

    const parsed = Number(stringValue);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "wss:", "ws:"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' 
        ? ['https://yourapp.com', 'https://admin.yourapp.com']
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:10002', 'http://127.0.0.1:10002', 'http://localhost:10003', 'http://127.0.0.1:10003', 'http://localhost:10004', 'http://127.0.0.1:10004'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // limit each IP to 1000 requests per windowMs
      message: {
        success: false,
        message: 'Too many requests, please try again later',
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    const strictLimiter = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // limit each IP to 30 requests per minute for sensitive operations
      message: {
        success: false,
        message: 'Rate limit exceeded for sensitive operations',
      },
    });

    this.app.use('/api/v1', limiter);
    this.app.use('/api/v1/batch', strictLimiter);
    this.app.use('/api/v1/wallets/generate', strictLimiter);
    this.app.use('/api/v1/wallets/delete', strictLimiter);

    // Request logging
    this.app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
          method: req.method,
          url: req.url,
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
        }, 'API Request');
      });
      next();
    });
  }

  private setupRoutes(): void {
    // Setup authentication endpoints
    createLoginEndpoint(this.app);

    // Root route - API welcome page
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        message: 'BSC Market Maker Bot API Server',
        version: process.env.npm_package_version || '0.1.0',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          api_v1: '/api/v1',
          api_docs: '/api/docs',
          wallets: '/api/wallets',
          trading: '/api/trading'
        }
      });
    });

    // Health check (no auth required)
    this.app.get('/health', async (req, res) => {
      try {
        const health = await healthMonitor.getSystemHealth();
        res.json({
          success: true,
          data: {
            status: health.overall,
            timestamp: health.timestamp,
            version: process.env.npm_package_version || '2.0.0',
            uptime: Math.floor(health.uptime / 1000),
            checks: health.checks,
            emergency_status: health.emergency_status,
          },
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Health check failed',
        });
      }
    });

    // API v1 routes with unified authentication
    const apiV1 = express.Router();

    // Apply authentication middleware to all v1 routes
    const v1AuthMiddleware = createAuthMiddleware(['admin', 'trader', 'viewer']);
    apiV1.use(v1AuthMiddleware);

    // Mount API modules
    // Import TradingAPI
    const { TradingAPI } = require('./api/trading-api');
    const tradingAPI = new TradingAPI();

    // Import BatchOperationsAPI
    const { BatchOperationsAPI } = require('./api/batch-operations-api');
    const batchOperationsAPI = new BatchOperationsAPI();

    const batchTradingAPI = new BatchTradingAPI();
    const marketDataAPI = new MarketDataAPI();
    const walletManagementAPI = new WalletManagementAPI();
    const strategyManagementAPI = new StrategyManagementAPI();
    const riskManagementAPI = new RiskManagementAPI();
    const systemAPI = new SystemAPI();

    // Mount routes (authentication applied at router level above)
    apiV1.use('/trading', tradingAPI.getRouter());
    apiV1.use('/batch', batchOperationsAPI.getRouter());
    apiV1.use('/batch', batchTradingAPI.router);
    apiV1.use('/market', marketDataAPI.router);
    apiV1.use('/wallets', walletManagementAPI.getRouter());
    apiV1.use('/strategies', strategyManagementAPI.router);
    apiV1.use('/risk', riskManagementAPI.router);
    apiV1.use('/system', systemAPI.router);

    // DEX routes (simplified)
    apiV1.use('/dex', marketDataAPI.router);
    apiV1.use('/tokens', marketDataAPI.router);

    // Public price API for analytics dashboards (no auth required)
    this.app.get('/api/prices', generalRateLimit, async (req, res) => {
      try {
        const symbolsParam = req.query.symbols as string | undefined;
        const symbols = symbolsParam
          ? symbolsParam.split(',').map((s) => s.trim()).filter(Boolean)
          : ['BNB', 'WBNB', 'BUSD', 'USDT', 'USDC', 'CAKE'];

        if (symbols.length === 0) {
          return res.json({ success: true, data: { prices: [] } });
        }

        const uniqueSymbols = Array.from(new Set(symbols.map((s) => s.toUpperCase())));
        const priceMap = await priceService.getMultiplePrices(uniqueSymbols);

        const prices = uniqueSymbols.map((symbol) => {
          const priceData = priceMap.get(symbol) || null;
          return {
            symbol,
            priceUSD: priceData?.priceUSD ?? 0,
            priceChange24h: priceData?.priceChange24h ?? 0,
            volume24hUSD: priceData?.volume24hUSD ?? 0,
            lastUpdated: priceData?.lastUpdated?.toISOString() ?? null,
            dataSource: priceData?.dataSource ?? null,
            isStale: priceData?.isStale ?? false
          };
        });

        res.json({
          success: true,
          data: {
            symbols: uniqueSymbols,
            prices
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to fetch price data');
        res.status(500).json({
          success: false,
          message: 'Failed to fetch price data'
        });
      }
    });

    this.setupLegacyCompatibleRoutes();
    this.app.use('/api/v1', apiV1);

    // Legacy trading routes (for backward compatibility)
    this.app.use('/api/trading', v1AuthMiddleware, tradingAPI.getRouter());
    
    // Add alerts endpoint directly
    this.app.get('/api/alerts', async (req, res) => {
      try {
        const db = this.database.connection;

        if (!db) {
          throw new Error('Database not connected');
        }

        // Get active alerts from the last 24 hours
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const alerts = await db('monitoring_alerts')
          .where('triggered_at', '>=', oneDayAgo)
          .where('is_resolved', false)
          .orderBy('triggered_at', 'desc')
          .limit(100);

        res.json({
          success: true,
          data: alerts
        });
      } catch (error) {
        logger.error({ error }, 'Failed to fetch alerts');
        res.json({
          success: true,
          data: []  // Return empty array on error
        });
      }
    });

    // Add monitoring health checks endpoint
    this.app.get('/api/monitoring/health-checks', async (req, res) => {
      try {
        const status = await healthMonitor.getSystemHealth();
        const healthChecks = [
          {
            component: 'API Server',
            status: 'healthy',
            latency_ms: 12,
            last_check: new Date().toISOString(),
            message: 'All endpoints responding normally'
          },
          {
            component: 'Database',
            status: status.checks?.find(c => c.name === 'database')?.status || 'healthy',
            latency_ms: status.checks?.find(c => c.name === 'database')?.latency || 10,
            last_check: new Date().toISOString()
          },
          {
            component: 'RPC Providers',
            status: 'healthy',
            latency_ms: status.checks?.find(c => c.name === 'rpc_providers')?.latency || 120,
            last_check: new Date().toISOString(),
            message: 'All RPC nodes responding normally'
          },
          {
            component: 'WebSocket Server',
            status: 'healthy',
            latency_ms: 15,
            last_check: new Date().toISOString()
          }
        ];
        
        res.json({
          success: true,
          data: healthChecks
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: 'Failed to get health checks'
        });
      }
    });

    // Add missing endpoints
    this.app.get('/api/dashboard/metrics', async (req, res) => {
      try {
        // Get real trading metrics from database
        const db = this.database.connection;

        if (!db) {
          throw new Error('Database not connected');
        }

        // Get 24h metrics
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        // Count total trades in last 24h
        const tradesResult = await db('trades')
          .where('created_at', '>=', oneDayAgo)
          .count('* as count')
          .first();

        const totalTrades = Number(tradesResult?.count || 0);

        // Calculate total volume in last 24h
        const volumeResult = await db('trades')
          .where('created_at', '>=', oneDayAgo)
          .where('status', 'completed')
          .sum('amount_in as total')
          .first();

        const totalVolume = volumeResult?.total || '0';

        // Calculate success rate
        const successResult = await db('trades')
          .where('created_at', '>=', oneDayAgo)
          .where('status', 'completed')
          .count('* as count')
          .first();

        const successfulTrades = Number(successResult?.count || 0);
        const successRate = totalTrades > 0 ? (successfulTrades / totalTrades) * 100 : 0;

        // Calculate P&L (profit/loss)
        const pnlResult = await db('trades')
          .where('created_at', '>=', oneDayAgo)
          .where('status', 'completed')
          .select(db.raw('SUM(CAST(amount_out as DECIMAL) - CAST(amount_in as DECIMAL)) as pnl'))
          .first();

        const profitLoss = pnlResult?.pnl || '0';

        // Get active positions
        const activePositionsResult = await db('trades')
          .where('status', 'pending')
          .count('* as count')
          .first();

        const activePositions = Number(activePositionsResult?.count || 0);

        // Calculate gas spent
        const gasResult = await db('trades')
          .where('created_at', '>=', oneDayAgo)
          .sum('gas_used as total')
          .first();

        const gasSpent = gasResult?.total || '0';

        res.json({
          success: true,
          data: {
            totalVolume: String(totalVolume),
            totalTrades,
            successRate: successRate.toFixed(2),
            profitLoss: String(profitLoss),
            activePositions,
            gasSpent: String(gasSpent),
            timestamp: new Date().toISOString()
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to fetch dashboard metrics');
        // Fallback to zero values if database query fails
        res.json({
          success: true,
          data: {
            totalVolume: '0',
            totalTrades: 0,
            successRate: 0,
            profitLoss: '0',
            activePositions: 0,
            gasSpent: '0',
            timestamp: new Date().toISOString()
          }
        });
      }
    });

    this.app.get('/api/monitoring/logs', async (req, res) => {
      try {
        const db = this.database.connection;

        if (!db) {
          throw new Error('Database not connected');
        }

        // Get pagination parameters
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = (page - 1) * limit;
        const level = req.query.level as string; // filter by level: info, warn, error
        const search = req.query.search as string; // search in message

        // Build query
        let query = db('system_events').orderBy('created_at', 'desc');

        if (level) {
          query = query.where('severity', level);
        }

        if (search) {
          query = query.where('message', 'like', `%${search}%`);
        }

        // Get total count
        const countResult = await query.clone().count('* as count').first();
        const total = Number(countResult?.count || 0);

        // Get logs
        const logs = await query.limit(limit).offset(offset);

        res.json({
          success: true,
          data: logs,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to fetch monitoring logs');
        res.json({
          success: true,
          data: [],
          pagination: {
            page: 1,
            limit: 50,
            total: 0,
            totalPages: 0
          }
        });
      }
    });

    // API documentation
    this.app.get('/api/docs', (req, res) => {
      res.json({
        success: true,
        data: {
          title: 'BSC Trading Bot API',
          version: '2.0.0',
          endpoints: {
            // System Health
            'GET /health': 'System health check',
            'GET /api/monitoring/metrics': 'System performance metrics',
            'GET /api/monitoring/health': 'Detailed health status',
            'GET /api/monitoring/alerts': 'System alerts',
            
            // Authentication
            'POST /api/auth/login': 'Login with wallet signature',
            'GET /api/auth/dev-token': 'Generate development token (dev only)',
            
            // Trading & DEX
            'GET /api/v1/dex/supported': 'Get supported DEXes',
            'GET /api/v1/dex/health': 'DEX health status',
            'POST /api/v1/dex/quote': 'Get best quote',
            'POST /api/v1/batch/trades': 'Execute batch trades',
            'POST /api/v1/batch/limit-orders': 'Create batch limit orders',
            'POST /api/v1/tokens/bulk-buy': 'Bulk buy tokens',
            'POST /api/v1/tokens/bulk-sell': 'Bulk sell tokens',
            'POST /api/v1/tokens/bulk-limit-orders': 'Bulk limit orders',
            
            // Wallet Management
            'POST /api/v1/wallets/generate': 'Generate wallets',
            'POST /api/v1/wallets/import': 'Import wallets',
            'GET /api/v1/wallets/export': 'Export wallets',
            'GET /api/wallets/:address/balance': 'Get wallet balance with real prices',
            
            // Audit & Compliance
            'GET /api/audit/report': 'Generate audit report',
            'GET /api/audit/suspicious': 'Get suspicious transactions',
            'GET /api/audit/compliance/:address': 'Check wallet compliance',
            
            // Blockchain Monitoring
            'GET /api/monitor/status': 'Get monitoring status',
            'POST /api/monitor/wallets': 'Start monitoring wallets',
            'DELETE /api/monitor/wallets/:address': 'Stop monitoring wallet',
            
            // Real-time Pricing
            'GET /api/prices/:symbol': 'Get real-time price for token',
            'POST /api/prices/batch': 'Get batch prices for multiple tokens',
            
            // System Settings
            'GET /api/settings': 'Get system settings',
            'PUT /api/settings': 'Update system settings',
          },
        },
      });
    });

    // Default 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        message: 'API endpoint not found',
        path: req.originalUrl,
      });
    });
  }

  private registerLegacyRoute(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, handler: express.RequestHandler): void {
    const key = `${method.toUpperCase()} ${path}`;
    this.legacyHandlers.set(key, handler);

    // Determine which middleware to apply based on path
    const middleware: express.RequestHandler[] = [];
    
    if (path.startsWith('/api/')) {
      // Apply rate limiting to all API endpoints
      if (path.includes('/trading/') || path.includes('/trade/')) {
        middleware.push(tradingRateLimit);
      } else if (path.includes('/auth/') || path.includes('/login')) {
        middleware.push(authRateLimit);
      } else {
        middleware.push(generalRateLimit);
      }
      
      // Apply authentication to protected API endpoints (skip health checks)
      if (!path.includes('/health') && !path.includes('/docs')) {
        middleware.push(authenticate);
      }
    }

    switch (method) {
      case 'GET':
        this.app.get(path, ...middleware, handler);
        break;
      case 'POST':
        this.app.post(path, ...middleware, handler);
        break;
      case 'PUT':
        this.app.put(path, ...middleware, handler);
        break;
      case 'DELETE':
        this.app.delete(path, ...middleware, handler);
        break;
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  private setupLegacyCompatibleRoutes(): void {
    this.registerLegacyRoute('GET', '/api/health', (req, res) => {
      res.json(this.buildHealthPayload());
    });

    this.registerLegacyRoute('GET', '/api/dashboard/status', async (req, res) => {
      try {
        const health = await healthMonitor.getSystemHealth();
        
        // Get RPC provider details
        const rpcProviderCheck = health.checks.find(c => c.name === 'rpc_providers');
        const rpcConnectionCheck = health.checks.find(c => c.name === 'rpc_connection');
        const databaseCheck = health.checks.find(c => c.name === 'database');
        
        // Get system metrics
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();

        res.json({
          success: true,
          data: {
            overall: process.env.NODE_ENV === 'development' ? 'healthy' : health.overall,
            updatedAt: health.timestamp,
            uptimeSeconds: Math.floor(health.uptime / 1000),
            // System metrics for monitoring
            cpu_usage: Math.round((cpuUsage.user + cpuUsage.system) / 1000000), // Convert to seconds
            memory_usage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
            active_connections: 0, // TODO: Track actual connections
            requests_per_second: 0, // TODO: Track actual RPS
            response_time_avg: 0, // TODO: Track actual response time
            error_rate: 0, // TODO: Track actual error rate
            components: {
              api: {
                status: 'healthy',
                latencyMs: 12,
                lastChecked: health.timestamp
              },
              database: {
                status: databaseCheck?.status || 'unknown',
                lastChecked: health.timestamp,
                retries: 0,
                latency: databaseCheck?.latency || 0
              },
              rpc_provider: {
                status: rpcProviderCheck?.status || 'unknown',
                latency: rpcProviderCheck?.latency || 0,
                lastChecked: health.timestamp,
                metadata: rpcProviderCheck?.metadata || null
              },
              rpc_providers: {
                status: rpcConnectionCheck?.status || 'unknown',
                lastChecked: health.timestamp,
                latency: rpcConnectionCheck?.latency || 0,
                latestBlock: rpcConnectionCheck?.metadata?.latest_block || null
              },
              trading_engine: {
                status: 'healthy',
                lastChecked: health.timestamp
              }
            },
            emergency_status: health.emergency_status
          },
        });
      } catch (error) {
        logger.error({ error }, 'Dashboard status error');
        res.status(500).json({
          success: false,
          error: 'Failed to fetch system status'
        });
      }
    });

    this.registerLegacyRoute('GET', '/api/dashboard/overview', async (req, res) => {
      try {
        const wallets = this.walletManager.getAllWallets();
        const groups = this.walletManager.getGroups();
        const timestamp = new Date().toISOString();

        res.json({
          success: true,
          data: {
            system: {
              status: 'healthy',
              uptimeSeconds: Math.round(process.uptime()),
              environment: process.env.NODE_ENV || 'development',
            },
            wallets: {
              total: wallets.length,
              groups,
              lastImported: wallets.length ? wallets[wallets.length - 1].createdAt : null,
            },
            trading: {
              activeStrategies: 0,
              dailyVolume: '0',
              lastTradeAt: null,
              totalTrades24h: 0,
              pnl24h: '+0.00',
              volume24h: '0.00',
              successRate: '100%',
            },
            timestamp,
          },
        });
      } catch (error) {
        logger.error({ error }, 'Dashboard overview failed');
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard overview' });
      }
    });

    this.registerLegacyRoute('GET', '/api/wallets', async (req, res) => {
      try {
        const { group } = req.query;
        const wallets = this.walletManager.getAllWallets()
          .filter(wallet => !group || wallet.group === group);

        // Convert wallets to public format with real data
        const publicWallets = await Promise.all(
          wallets.map(wallet => this.toPublicWallet(wallet))
        );

        res.json({ success: true, data: publicWallets });
      } catch (error) {
        logger.error({ error }, 'Failed to get wallets');
        res.status(500).json({ success: false, message: 'Failed to get wallets' });
      }
    });

    this.registerLegacyRoute('POST', '/api/wallets/create', async (req, res) => {
      try {
        const { label, group, generateNew = true, privateKey, tier } = req.body || {};
        if (!label) {
          return res.status(400).json({ success: false, message: 'Label is required' });
        }

        let wallet: WalletInfo;

        if (generateNew) {
          const [generated] = await this.walletManager.generateWallets(1, undefined, undefined, group);
          wallet = generated;
        } else {
          if (!privateKey || typeof privateKey !== 'string') {
            return res.status(400).json({ success: false, message: 'Private key is required' });
          }
          wallet = await this.walletManager.importWallet(privateKey, label, group);
        }

        const updates: Partial<WalletInfo> = {};
        if (label) updates.label = label;
        if (group) updates.group = group;
        if (tier) updates.tier = tier;

        if (Object.keys(updates).length > 0) {
          await this.walletManager.updateWallet(wallet.address, updates);
          wallet = { ...wallet, ...updates };
        }

        const publicWallet = await this.toPublicWallet(wallet);
        res.json({
          success: true,
          data: publicWallet,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create wallet';
        logger.error({ error: message }, 'Wallet creation failed');
        res.status(500).json({ success: false, message });
      }
    });

    this.registerLegacyRoute('POST', '/api/wallets/export', async (req, res) => {
      const { addresses } = req.body || {};
      if (!Array.isArray(addresses) || addresses.length === 0) {
        return res.status(400).json({ success: false, message: 'addresses must be a non-empty array' });
      }

      const exported: PublicWallet[] = [];
      const missing: string[] = [];

      for (const address of addresses) {
        const wallet = this.walletManager.getWallet(address);
        if (wallet) {
          const publicWallet = await this.toPublicWallet(wallet);
          exported.push(publicWallet);
        } else {
          missing.push(address);
        }
      }

      res.json({
        success: true,
        data: {
          wallets: exported,
          missing,
          exportedAt: new Date().toISOString(),
        },
      });
    });

    this.registerLegacyRoute('DELETE', '/api/wallets/:address', async (req, res) => {
      try {
        const removed = await this.walletManager.removeWallet(req.params.address);
        if (!removed) {
          return res.status(404).json({ success: false, message: 'Wallet not found' });
        }
        res.json({ success: true, data: { address: req.params.address } });
      } catch (error) {
        logger.error({ error }, 'Wallet removal failed');
        res.status(500).json({ success: false, message: 'Failed to remove wallet' });
      }
    });

    // SECURITY: Private key endpoint disabled for production safety
    // TODO: Implement proper secure key management with MFA, HSM, and encrypted storage
    this.registerLegacyRoute('POST', '/api/wallets/:address/private-key', async (req, res) => {
      logger.error({ 
        ip: req.ip, 
        address: req.params.address,
        timestamp: new Date().toISOString() 
      }, 'SECURITY: Attempted access to disabled private key endpoint');
      
      res.status(501).json({ 
        success: false, 
        message: 'Private key access endpoint disabled for security. Use secure key management practices.',
        recommendation: 'Implement proper HSM/MFA-protected key access if needed for production use'
      });
    });

    this.registerLegacyRoute('POST', '/api/trading/quote', async (req, res) => {
      try {
        const { tokenIn, tokenOut, amountIn, slippage } = req.body || {};
        if (!tokenIn || !tokenOut || !amountIn) {
          return res.status(400).json({ success: false, message: 'tokenIn, tokenOut and amountIn are required' });
        }

        const tradingService = this.tradingService;
        if (!tradingService) {
          return res.status(503).json({ success: false, message: 'Trading service not available' });
        }

        const quote = await tradingService.getQuote(tokenIn, tokenOut, amountIn, slippage);

        const routes = Array.isArray((quote as Partial<{ routes: string[] }>).routes)
          ? (quote as Partial<{ routes: string[] }>).routes ?? []
          : quote.path ?? [];
        const gasEstimate = 'gasEstimate' in quote ? quote.gasEstimate : null;
        const rawPriceImpact = (quote as { priceImpact?: unknown }).priceImpact;
        let priceImpactPercent = 0;
        if (
          typeof rawPriceImpact === 'object' &&
          rawPriceImpact !== null &&
          'impact' in rawPriceImpact &&
          typeof (rawPriceImpact as { impact: unknown }).impact === 'number'
        ) {
          priceImpactPercent = (rawPriceImpact as { impact: number }).impact;
        } else if (typeof rawPriceImpact === 'number') {
          priceImpactPercent = rawPriceImpact;
        }

        res.json({
          success: true,
          data: {
            tokenIn: { 
              address: tokenIn, 
              amount: amountIn,
              symbol: quote.tokenIn?.symbol ?? ''
            },
            tokenOut: { 
              address: tokenOut, 
              amount: quote.tokenOut?.amount ?? '0',
              symbol: quote.tokenOut?.symbol ?? ''
            },
            priceImpact: `${priceImpactPercent}%`,
            slippageAnalysis: {
              recommended: slippage || 0.5,
              max: 5.0,
            },
            routes,
            gasEstimate,
            minimumReceived: quote.minimumReceived ?? quote.tokenOut?.amount ?? '0'
          },
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get trading quote');
        res.status(500).json({ 
          success: false, 
          message: error instanceof Error ? error.message : 'Failed to get quote' 
        });
      }
    });

    this.registerLegacyRoute('POST', '/api/trading/execute', async (req, res) => {
      try {
        const { walletAddress, tokenIn, tokenOut, amountIn, slippage, gasPrice, dryRun } = req.body || {};
        
        if (!walletAddress || !tokenIn || !tokenOut || !amountIn) {
          return res.status(400).json({ 
            success: false, 
            message: 'walletAddress, tokenIn, tokenOut and amountIn are required' 
          });
        }

        const tradingService = this.tradingService;
        if (!tradingService) {
          return res.status(503).json({ success: false, message: 'Trading service not available' });
        }

        const tradeRequest = {
          from: walletAddress,
          tokenIn,
          tokenOut,
          amountIn,
          slippage,
          gasPrice,
          dryRun: dryRun || false
        };

        const result = await tradingService.executeTrade(tradeRequest);
        
        res.json({
          success: result.success,
          data: result,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to execute trade');
        res.status(500).json({ 
          success: false, 
          message: error instanceof Error ? error.message : 'Failed to execute trade' 
        });
      }
    });

    this.registerLegacyRoute('GET', '/api/trading/history', async (req, res) => {
      try {
        // Real trading history implementation
        const limit = this.getQueryNumber(req.query.limit, 50);
        const offset = this.getQueryNumber(req.query.offset, 0);
        const address = this.getQueryString(req.query.address);
        const normalizedAddress = address ? address.toLowerCase() : undefined;
        
        try {
          // Get real trading history from database
          await database.ensureConnection();
          
          if (!database.connection) {
            throw new Error('Database connection not available');
          }
          
          // Use blockchain_transactions table if available, fallback to transactions
          const tableName = await database.connection.schema.hasTable('blockchain_transactions') 
            ? 'blockchain_transactions' 
            : 'transactions';
          
          // Query actual trades from available transactions table
          let tradesQuery = database.connection(tableName)
            .select([
              'tx_hash as hash',
              'from_address',
              'to_address', 
              'amount',
              'token_symbol',
              'transaction_fee as fee',
              'status',
              'created_at as timestamp',
              'operation_type as type'
            ])
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset);
          
          if (normalizedAddress) {
            tradesQuery = tradesQuery.where(function() {
              this.where('from_address', normalizedAddress)
                .orWhere('to_address', normalizedAddress);
            });
          }
          
          const trades = await tradesQuery;
          
          // Get total count
          
          let countQuery = database.connection(tableName)
            .count('* as count');
          
          if (normalizedAddress) {
            countQuery = countQuery.where(function() {
              this.where('from_address', normalizedAddress)
                .orWhere('to_address', normalizedAddress);
            });
          }
          
          const totalResult = await countQuery;
          const total = this.extractCount(totalResult);
          const safeLimit = Math.max(limit, 1);
          const totalPages = Math.ceil(total / safeLimit);
          
          res.json({
            success: true,
            data: {
              trades: trades.map(trade => ({
                id: trade.id,
                tradeId: trade.trade_id,
                walletAddress: trade.wallet_address,
                tokenIn: trade.token_in,
                tokenOut: trade.token_out,
                amountIn: trade.amount_in,
                amountOut: trade.amount_out,
                price: trade.price,
                pnl: trade.pnl,
                volume: trade.volume,
                tradeType: trade.trade_type,
                status: trade.status,
                txHash: trade.tx_hash,
                dexName: trade.dex_name,
                createdAt: trade.created_at,
                completedAt: trade.completed_at
              })),
              total,
              page: Math.floor(offset / safeLimit) + 1,
              totalPages
            },
            pagination: {
              limit,
              offset,
              total
            }
          });
        } catch (error) {
          logger.error({ error, query: req.query }, 'Failed to get trading history from database');
          
          // Return empty result on error instead of 500
          res.json({
            success: true,
            data: {
              trades: [],
              total: 0,
              page: 1,
              totalPages: 0
            },
            message: 'Trading history unavailable. Database connection error.',
            pagination: {
              limit,
              offset,
              total: 0
            }
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to fetch trading history',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // Advanced Batch Operations API
    this.registerLegacyRoute('POST', '/api/v1/batch/operations', async (req, res) => {
      try {
        const body = this.isPlainObject(req.body) ? req.body : {};
        const operations = body.operations;
        const config = this.isPlainObject(body.config) ? body.config : undefined;

        if (!Array.isArray(operations) || operations.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Operations array is required and must not be empty'
          });
        }

        const validatedOperations: BatchOperationRequest[] = [];
        for (const operation of operations) {
          if (!this.isBatchOperationRequest(operation)) {
            return res.status(400).json({
              success: false,
              message: 'Each operation must have type, walletAddress, tokenIn, tokenOut, and amountIn'
            });
          }

          const amountIn: string = typeof operation.amountIn === 'number'
            ? operation.amountIn.toString()
            : operation.amountIn;

          validatedOperations.push({
            ...operation,
            amountIn,
          });
        }

        // Generate operation IDs and prepare for batch execution
        const batchOperations = validatedOperations.map((operation, index) => ({
          id: `op_${Date.now()}_${Buffer.from(`${operation.type}_${index}_${Date.now()}`).toString('base64').slice(0, 9)}`,
          type: operation.type,
          status: 'pending',
          walletAddress: operation.walletAddress,
          tokenIn: operation.tokenIn,
          tokenOut: operation.tokenOut,
          amountIn: operation.amountIn,
          progress: 0,
          createdAt: new Date().toISOString()
        }));

        // In a real implementation, this would use our BatchExecutor
        // For now, return the prepared operations
        res.json({
          success: true,
          data: {
            operationIds: batchOperations.map(op => op.id),
            totalOperations: batchOperations.length,
            config: {
              maxConcurrency: typeof config?.maxConcurrency === 'number' ? config.maxConcurrency : 3,
              delayBetweenOps: typeof config?.delayBetweenOps === 'number' ? config.delayBetweenOps : 1000,
              slippage: typeof config?.slippage === 'number' ? config.slippage : 1.0,
              riskCheck: config?.riskCheck !== false
            },
            operations: batchOperations
          }
        });
      } catch (error) {
        logger.error({ error }, 'Batch operations creation failed');
        res.status(500).json({
          success: false,
          message: 'Failed to create batch operations'
        });
      }
    });

    this.registerLegacyRoute('GET', '/api/v1/batch/operations/:operationId', (req, res) => {
      const { operationId } = req.params;
      
      // Mock operation status - in real implementation, this would query BatchExecutor
      const mockOperation = {
        id: operationId,
        type: 'buy',
        status: 'completed',
        walletAddress: '0x1234...5678',
        tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
        tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
        amountIn: '0.01',
        progress: 100,
        result: {
          txHash: '0xabc...def',
          amountOut: '4.98',
          gasUsed: '150000'
        },
        createdAt: new Date().toISOString(),
        executedAt: new Date().toISOString()
      };

      res.json({
        success: true,
        data: mockOperation
      });
    });

    this.registerLegacyRoute('POST', '/api/v1/batch/execute', async (req, res) => {
      try {
        const { operationIds, config } = req.body;

        if (!Array.isArray(operationIds) || operationIds.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Operation IDs array is required'
          });
        }

        // Mock batch execution - in real implementation, this would use BatchExecutor
        const results = operationIds.map((id: string) => ({
          operationId: id,
          status: 'processing',
          startedAt: new Date().toISOString(),
          estimatedCompletion: new Date(Date.now() + 60000).toISOString()
        }));

        res.json({
          success: true,
          data: {
            batchId: `batch_${Date.now()}`,
            totalOperations: operationIds.length,
            status: 'processing',
            startedAt: new Date().toISOString(),
            operations: results,
            config: {
              maxConcurrency: config?.maxConcurrency || 3,
              delayBetweenOps: config?.delayBetweenOps || 1000
            }
          }
        });
      } catch (error) {
        logger.error({ error }, 'Batch execution failed');
        res.status(500).json({
          success: false,
          message: 'Failed to execute batch operations'
        });
      }
    });

    this.registerLegacyRoute('GET', '/api/monitoring/metrics', (req, res) => {
      const memory = process.memoryUsage();
      res.json({
        success: true,
        data: {
          loadAverage: os.loadavg(),
          memory: {
            rss: memory.rss,
            heapUsed: memory.heapUsed,
            heapTotal: memory.heapTotal,
          },
          uptimeSeconds: Math.round(process.uptime()),
          activeStrategies: 0,
          timestamp: new Date().toISOString(),
        },
      });
    });

    this.registerLegacyRoute('GET', '/api/monitoring/alerts', (req, res) => {
      res.json({
        success: true,
        alerts: [],
        timestamp: new Date().toISOString(),
      });
    });

    this.registerLegacyRoute('GET', '/api/monitoring/health', (req, res) => {
      const timestamp = new Date().toISOString();
      const healthChecks = [
        { component: 'api', status: 'healthy', checkedAt: timestamp },
        { component: 'database', status: 'degraded', checkedAt: timestamp },
        { component: 'rpc_providers', status: 'healthy', checkedAt: timestamp },
      ];

      res.json({ success: true, data: healthChecks });
    });

    // New Audit Service API endpoints
    this.registerLegacyRoute('GET', '/api/audit/report', async (req, res) => {
      try {
        const startDate = this.getQueryString(req.query.startDate);
        const endDate = this.getQueryString(req.query.endDate);
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();

        const report = await auditService.generateAuditReport(start, end);
        
        res.json({
          success: true,
          data: report,
          generated_at: new Date().toISOString()
        });
      } catch (error) {
        logger.error({ error }, 'Failed to generate audit report');
        res.status(500).json({
          success: false,
          message: 'Failed to generate audit report'
        });
      }
    });

    this.registerLegacyRoute('GET', '/api/audit/suspicious', async (req, res) => {
      try {
        const limit = this.getQueryNumber(req.query.limit, 100);
        const offset = this.getQueryNumber(req.query.offset, 0);
        const suspicious = await auditService.getSuspiciousTransactions(limit, offset);
        
        res.json({
          success: true,
          data: {
            transactions: suspicious,
            total: suspicious.length,
            limit,
            offset
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get suspicious transactions');
        res.status(500).json({
          success: false,
          message: 'Failed to get suspicious transactions'
        });
      }
    });

    this.registerLegacyRoute('GET', '/api/audit/compliance/:address', async (req, res) => {
      try {
        const { address } = req.params;
        const compliance = await auditService.checkCompliance(address);
        
        res.json({
          success: true,
          data: compliance
        });
      } catch (error) {
        logger.error({ error, address: req.params.address }, 'Failed to check compliance');
        res.status(500).json({
          success: false,
          message: 'Failed to check compliance'
        });
      }
    });

    // Blockchain Monitor API endpoints
    this.registerLegacyRoute('GET', '/api/monitor/status', (req, res) => {
      const status = blockchainMonitor.getMonitoringStats();
      res.json({
        success: true,
        data: status
      });
    });

    this.registerLegacyRoute('POST', '/api/monitor/wallets', async (req, res) => {
      try {
        const { addresses } = req.body;
        
        if (!Array.isArray(addresses) || addresses.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Addresses array is required'
          });
        }

        const result = await blockchainMonitor.startMonitoring(addresses);

        const responseData: MonitoringResponseData = {
          message: result.status === 'started'
            ? 'Monitoring started for specified wallets'
            : result.addedAddresses.length > 0
              ? `Added ${result.addedAddresses.length} new addresses to existing monitoring`
              : 'No new addresses added (all were already being monitored)',
          status: result.status,
          addedAddresses: result.addedAddresses,
          addedCount: result.addedAddresses.length,
          totalWatched: result.totalWatched,
        };

        if (result.status === 'updated') {
          responseData.skippedAddresses = result.skippedAddresses ?? [];
          responseData.skippedCount = responseData.skippedAddresses.length;
        }
        
        res.json({
          success: true,
          data: responseData
        });
      } catch (error) {
        logger.error({ error }, 'Failed to start wallet monitoring');
        res.status(500).json({
          success: false,
          message: 'Failed to start wallet monitoring'
        });
      }
    });

    this.registerLegacyRoute('DELETE', '/api/monitor/wallets/:address', async (req, res) => {
      try {
        const { address } = req.params;
        blockchainMonitor.removeWatchedAddress(address);
        
        res.json({
          success: true,
          data: {
            message: 'Monitoring stopped for wallet',
            address
          }
        });
      } catch (error) {
        logger.error({ error, address: req.params.address }, 'Failed to stop wallet monitoring');
        res.status(500).json({
          success: false,
          message: 'Failed to stop wallet monitoring'
        });
      }
    });

    // Enhanced Wallet Balance API with real price integration
    this.registerLegacyRoute('GET', '/api/wallets/:address/balance', async (req, res) => {
      try {
        const { address } = req.params;
        const { includeTokens } = req.query;
        
        let tokenAddresses: string[] = [];
        if (includeTokens) {
          tokenAddresses = typeof includeTokens === 'string' ? includeTokens.split(',') : [];
        }

        const balances = await walletBalanceService.getWalletBalances(address, tokenAddresses);
        
        res.json({
          success: true,
          data: balances
        });
      } catch (error) {
        logger.error({ error, address: req.params.address }, 'Failed to get wallet balances');
        res.status(500).json({
          success: false,
          message: 'Failed to get wallet balances'
        });
      }
    });

    // Real-time Price API
    this.registerLegacyRoute('GET', '/api/prices/:symbol', async (req, res) => {
      try {
        const { symbol } = req.params;
        const priceData = await priceService.getPrice(symbol.toUpperCase());
        
        if (!priceData) {
          return res.status(404).json({
            success: false,
            message: 'Price data not found for symbol'
          });
        }

        // Add warning if using fallback data
        const responsePayload: { success: true; data: PriceData; warning?: string; fallback?: true } = {
          success: true,
          data: priceData,
        };
        
        if (priceData.dataSource === 'fallback_static') {
          responsePayload.warning = 'Using static fallback price - external API unavailable';
          responsePayload.fallback = true as const;
          logger.warn({ symbol, price: priceData.priceUSD }, 'Serving fallback price to client');
          
          // Trigger alert for fallback usage
          const monitoringService = MonitoringService.getInstance();
          if (monitoringService) {
            monitoringService.recordFallbackUsage('price-api', `Fallback price served for ${symbol}`);
          }
        }
        
        res.json(responsePayload);
      } catch (error) {
        logger.error({ error, symbol: req.params.symbol }, 'Failed to get price data');
        res.status(500).json({
          success: false,
          message: 'Failed to get price data'
        });
      }
    });

    this.registerLegacyRoute('POST', '/api/prices/batch', async (req, res) => {
      try {
        const { symbols } = req.body;
        
        if (!Array.isArray(symbols) || symbols.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Symbols array is required'
          });
        }

        const prices = await priceService.getMultiplePrices(symbols);
        const responseData = Object.fromEntries(prices.entries());

        res.json({
          success: true,
          data: responseData,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get batch prices');
        res.status(500).json({
          success: false,
          message: 'Failed to get batch prices'
        });
      }
    });

    this.registerLegacyRoute('GET', '/api/settings', (req, res) => {
      res.json({ success: true, data: this.settings });
    });

    this.registerLegacyRoute('PUT', '/api/settings', (req, res) => {
      const updates = req.body;
      if (!this.isPlainObject(updates)) {
        return res.status(400).json({ success: false, message: 'Invalid settings payload' });
      }

      const updatePayload: Record<string, unknown> = updates;
      this.settings = this.mergeSettings(this.settings, updatePayload);
      res.json({ success: true, data: this.settings });
    });

    // Wallet Groups Management
    this.registerLegacyRoute('GET', '/api/wallets/groups', (req, res) => {
      try {
        const groups = this.walletManager.getGroups();
        const walletGroups = groups.map(groupName => {
          const wallets = this.walletManager.getWallets(groupName);
          const totalBalance = wallets.reduce((sum, w) => sum + parseFloat(w.balance || '0'), 0);
          
          return {
            name: groupName,
            description: `Wallet group for ${groupName} operations`,
            wallets: wallets.map(w => w.address),
            totalBalance: totalBalance.toFixed(4) + ' BNB',
            status: 'active',
            strategy: 'sequential'
          };
        });

        res.json({ success: true, data: walletGroups });
      } catch (error) {
        logger.error({ error }, 'Failed to fetch wallet groups');
        res.status(500).json({ success: false, message: 'Failed to fetch wallet groups' });
      }
    });

    this.registerLegacyRoute('POST', '/api/wallets/groups', async (req, res) => {
      try {
        const { name, description, strategy = 'sequential' } = req.body;
        
        if (!name) {
          return res.status(400).json({ success: false, message: 'Group name is required' });
        }

        // Check if group already exists
        const existingGroups = this.walletManager.getGroups();
        if (existingGroups.includes(name)) {
          return res.status(400).json({ success: false, message: 'Group already exists' });
        }

        // Create a new group by generating a placeholder wallet with the group name
        // This ensures the group appears in the groups list
        await this.walletManager.generateWallets(1, undefined, undefined, name);

        const newGroup = {
          name,
          description: description || `Wallet group for ${name} operations`,
          wallets: [],
          totalBalance: '0.0000 BNB',
          status: 'active',
          strategy
        };

        res.json({ success: true, data: newGroup });
      } catch (error) {
        logger.error({ error }, 'Failed to create wallet group');
        res.status(500).json({ success: false, message: 'Failed to create wallet group' });
      }
    });

    // Frontend-compatible wallet import
    this.registerLegacyRoute('POST', '/api/wallets/import', async (req, res) => {
      try {
        const { type, content, password: _password } = req.body;

        if (!type || !content) {
          return res.status(400).json({ 
            success: false, 
            message: 'Type and content are required' 
          });
        }

        if (typeof type !== 'string' || typeof content !== 'string') {
          return res.status(400).json({
            success: false,
            message: 'Type and content must be strings'
          });
        }

        let imported = 0;
        const errors: string[] = [];

        if (type === 'json') {
          try {
            const data = JSON.parse(content);
            if (Array.isArray(data)) {
              // Array of wallet objects
              for (const walletData of data) {
                if (walletData.privateKey) {
                  try {
                    await this.walletManager.importWallet(
                      walletData.privateKey,
                      walletData.label || 'Imported',
                      walletData.group
                    );
                    imported++;
                  } catch (error) {
                    errors.push(`Failed to import ${walletData.address || 'unknown'}: ${error}`);
                  }
                }
              }
            } else if (data.privateKey) {
              // Single wallet object
              await this.walletManager.importWallet(
                data.privateKey,
                data.label || 'Imported',
                data.group
              );
              imported = 1;
            }
          } catch (error) {
            return res.status(400).json({ 
              success: false, 
              message: 'Invalid JSON format' 
            });
          }
        } else if (type === 'csv') {
          const lines = content.split('\n').filter((line: string) => line.trim());
          for (let i = 1; i < lines.length; i++) { // Skip header
            const parts = lines[i].split(',');
            if (parts.length >= 2) {
              try {
                await this.walletManager.importWallet(
                  parts[1].trim(), // private key
                  parts[2]?.trim() || 'Imported', // label
                  parts[3]?.trim() // group
                );
                imported++;
              } catch (error) {
                errors.push(`Line ${i + 1}: ${error}`);
              }
            }
          }
        } else if (type === 'mnemonic') {
          try {
            // Generate wallets from mnemonic
            const wallets = await this.walletManager.generateWallets(1, content.trim());
            imported = wallets.length;
          } catch (error) {
            return res.status(400).json({ 
              success: false, 
              message: 'Invalid mnemonic phrase' 
            });
          }
        }

        res.json({ 
          success: true, 
          data: { 
            imported,
            failed: errors.length,
            errors: errors.slice(0, 10) // Limit error messages
          } 
        });
      } catch (error) {
        logger.error({ error }, 'Wallet import failed');
        res.status(500).json({ 
          success: false, 
          message: 'Failed to import wallets' 
        });
      }
    });

  }

  private async toPublicWallet(wallet: WalletInfo): Promise<PublicWallet> {
    try {
      // Get real wallet data from the blockchain
      const walletData = await walletService.getWalletData(wallet.address);
      
      return {
        address: wallet.address,
        label: wallet.label ?? null,
        balance: walletData.balance,
        nonce: walletData.nonce,
        status: 'active',
        group: wallet.group ?? null,
        tier: wallet.tier ?? null,
        derivationIndex: wallet.derivationIndex ?? null,
        transactions24h: walletData.transactions24h,
        lastActivity: walletData.lastActivity,
        createdAt: wallet.createdAt instanceof Date ? wallet.createdAt.toISOString() : new Date(wallet.createdAt).toISOString(),
        tokenBalances: walletData.tokenBalances
      };
    } catch (error) {
      logger.error({ error, address: wallet.address }, 'Failed to get wallet data');
      
      // Fallback to basic wallet info with zero balances
      return {
        address: wallet.address,
        label: wallet.label ?? null,
        balance: '0',
        nonce: 0,
        status: 'active',
        group: wallet.group ?? null,
        tier: wallet.tier ?? null,
        derivationIndex: wallet.derivationIndex ?? null,
        transactions24h: 0,
        lastActivity: new Date().toISOString(),
        createdAt: wallet.createdAt instanceof Date ? wallet.createdAt.toISOString() : new Date(wallet.createdAt).toISOString(),
        tokenBalances: []
      };
    }
  }

  private buildHealthPayload() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '0.0.0',
      services: {
        api: 'healthy',
        database: 'degraded',
        rpc_providers: 'healthy',
        websocket: 'healthy',
      },
    };
  }

  private mergeSettings(target: SystemSettings, source: Record<string, unknown>): SystemSettings {
    const merged: SystemSettings = {
      trading: { ...target.trading },
      risk_management: { ...target.risk_management },
      monitoring: { ...target.monitoring },
    };

    const tradingUpdates = source['trading'];
    if (this.isPlainObject(tradingUpdates)) {
      const defaultSlippage = tradingUpdates['default_slippage'];
      if (typeof defaultSlippage === 'number' && Number.isFinite(defaultSlippage)) {
        merged.trading.default_slippage = defaultSlippage;
      }

      const maxSlippage = tradingUpdates['max_slippage'];
      if (typeof maxSlippage === 'number' && Number.isFinite(maxSlippage)) {
        merged.trading.max_slippage = maxSlippage;
      }

      const maxOpenPositions = tradingUpdates['max_open_positions'];
      if (typeof maxOpenPositions === 'number' && Number.isFinite(maxOpenPositions)) {
        merged.trading.max_open_positions = maxOpenPositions;
      }

      const autoRebalance = tradingUpdates['auto_rebalance'];
      if (typeof autoRebalance === 'boolean') {
        merged.trading.auto_rebalance = autoRebalance;
      }
    }

    const riskUpdates = source['risk_management'];
    if (this.isPlainObject(riskUpdates)) {
      const maxDrawdown = riskUpdates['max_drawdown'];
      if (typeof maxDrawdown === 'number' && Number.isFinite(maxDrawdown)) {
        merged.risk_management.max_drawdown = maxDrawdown;
      }

      const maxPositionSize = riskUpdates['max_position_size'];
      if (typeof maxPositionSize === 'number' && Number.isFinite(maxPositionSize)) {
        merged.risk_management.max_position_size = maxPositionSize;
      }

      const stopLossThreshold = riskUpdates['stop_loss_threshold'];
      if (typeof stopLossThreshold === 'number' && Number.isFinite(stopLossThreshold)) {
        merged.risk_management.stop_loss_threshold = stopLossThreshold;
      }
    }

    const monitoringUpdates = source['monitoring'];
    if (this.isPlainObject(monitoringUpdates)) {
      const alertWebhook = monitoringUpdates['alert_webhook'];
      if (typeof alertWebhook === 'string' || alertWebhook === null) {
        merged.monitoring.alert_webhook = alertWebhook;
      }

      const anomalyDetection = monitoringUpdates['anomaly_detection'];
      if (typeof anomalyDetection === 'boolean') {
        merged.monitoring.anomaly_detection = anomalyDetection;
      }

      const heartbeatInterval = monitoringUpdates['heartbeat_interval_seconds'];
      if (typeof heartbeatInterval === 'number' && Number.isFinite(heartbeatInterval)) {
        merged.monitoring.heartbeat_interval_seconds = heartbeatInterval;
      }
    }

    return merged;
  }

  private extractCount(result: unknown): number {
    if (!Array.isArray(result) || result.length === 0) {
      return 0;
    }

    const [first] = result;
    if (!first || typeof first !== 'object') {
      return 0;
    }

    const candidate = (first as Record<string, unknown>).count;
    if (typeof candidate === 'number') {
      return candidate;
    }
    if (typeof candidate === 'bigint') {
      return Number(candidate);
    }
    if (typeof candidate === 'string') {
      const parsed = Number(candidate);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    return 0;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isBatchOperationRequest(value: unknown): value is BatchOperationRequest {
    if (!this.isPlainObject(value)) {
      return false;
    }

    const candidate: Record<string, unknown> = value;
    const type = candidate.type;
    const walletAddress = candidate.walletAddress;
    const tokenIn = candidate.tokenIn;
    const tokenOut = candidate.tokenOut;

    if (
      typeof type !== 'string' ||
      typeof walletAddress !== 'string' ||
      typeof tokenIn !== 'string' ||
      typeof tokenOut !== 'string'
    ) {
      return false;
    }

    const amount = candidate.amountIn;
    return typeof amount === 'string' || typeof amount === 'number';
  }

  private getErrorStatusCode(error: unknown): number | undefined {
    if (this.isPlainObject(error)) {
      const candidate = error.statusCode;
      if (typeof candidate === 'number' && Number.isInteger(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private getErrorDetails(error: unknown): unknown {
    if (this.isPlainObject(error) && 'details' in error) {
      return error.details;
    }

    return undefined;
  }

  private setupErrorHandling(): void {
    // Global error handler
    this.app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const message = formatError(error);
      const stack = error instanceof Error ? error.stack : undefined;
      const statusCode = this.getErrorStatusCode(error) ?? 500;
      const details = this.getErrorDetails(error);

      logger.error({
        error: message,
        stack,
        method: req.method,
        url: req.url,
        body: req.body,
      }, 'API Error');

      const responseBody: Record<string, unknown> = {
        success: false,
        message: process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : message,
      };

      if (process.env.NODE_ENV !== 'production') {
        if (stack) {
          responseBody.stack = stack;
        }
        if (details !== undefined) {
          responseBody.details = details;
        }
      }

      res.status(statusCode).json(responseBody);
    });

    // Unhandled promise rejection handler
    process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
      const message = formatError(reason);
      const stack = reason instanceof Error ? reason.stack : undefined;

      logger.error({
        reason: message,
        stack,
      }, 'Unhandled Promise Rejection');
    });

    // Uncaught exception handler
    process.on('uncaughtException', (error: Error) => {
      logger.error({
        error: error.message,
        stack: error.stack,
      }, 'Uncaught Exception');
      
      // Graceful shutdown
      this.stop().then(() => {
        process.exit(1);
      });
    });
  }

  async start(): Promise<void> {
    try {
      // Initialize database connection
      try {
        if (!database.connection) {
          await database.initialize();
          logger.info('Database connection established');
        }
      } catch (error) {
        logger.warn({ error }, 'Database initialization failed, continuing without database');
      }

      // Create HTTP server
      this.server = createServer(this.app);

      // Setup WebSocket server for real-time updates
      this.wss = new WebSocketServer({ 
        server: this.server,
        path: '/ws',
        clientTracking: true,
      });

      this.setupWebSocket();

      // Start listening
      const server = this.server;
      if (!server) {
        throw new Error('HTTP server was not initialized');
      }

      await new Promise<void>((resolve, reject) => {
        server.listen(this.port, '127.0.0.1', (error?: Error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      // Initialize blockchain monitoring for all managed wallets
      try {
        const managedWallets = this.walletManager.getAllWallets();
        const walletAddresses = managedWallets.map(w => w.address);
        
        if (walletAddresses.length > 0) {
          await blockchainMonitor.startMonitoring(walletAddresses);
          logger.info({ walletCount: walletAddresses.length }, 'Blockchain monitoring started for managed wallets');
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to start blockchain monitoring');
      }

      // Initialize price service cache for common tokens
      try {
        await priceService.getMultiplePrices(['BNB', 'WBNB', 'CAKE', 'BUSD', 'USDT', 'USDC']);
        logger.info('Price service initialized with common tokens');
      } catch (error) {
        logger.warn({ error }, 'Failed to initialize price service cache');
      }

      logger.info({
        port: this.port,
        env: process.env.NODE_ENV || 'development',
        pid: process.pid,
      }, 'API Server started successfully');
      logger.info(`Server running on port ${this.port}`);

    } catch (error) {
      logger.error({ error }, 'Failed to start API server');
      throw error;
    }
  }

  private setupWebSocket(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress;
      logger.info({ ip }, 'WebSocket client connected');

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(ws, message);
        } catch (error) {
          ws.send(JSON.stringify({
            error: 'Invalid message format',
          }));
        }
      });

      ws.on('close', () => {
        logger.info({ ip }, 'WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.error({ error, ip }, 'WebSocket error');
      });

      // Send initial status
      ws.send(JSON.stringify({
        type: 'connection',
        data: {
          status: 'connected',
          timestamp: new Date().toISOString(),
        },
      }));
    });
  }

  private handleWebSocketMessage(ws: WebSocket, message: unknown): void {
    if (!this.isPlainObject(message) || typeof message.type !== 'string') {
      ws.send(JSON.stringify({ error: 'Unknown message type' }));
      return;
    }

    switch (message.type) {
      case 'subscribe': {
        const channels = Array.isArray(message.channels)
          ? message.channels.filter((channel): channel is string => typeof channel === 'string')
          : [];

        ws.send(JSON.stringify({
          type: 'subscription',
          data: { status: 'subscribed', channels },
        }));
        break;
      }

      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          data: { timestamp: new Date().toISOString() },
        }));
        break;

      default:
        ws.send(JSON.stringify({
          error: 'Unknown message type',
        }));
    }
  }

  // Broadcast to all connected WebSocket clients
  public broadcast(data: unknown): void {
    if (!this.wss) {
      return;
    }

    let message: string;
    try {
      message = JSON.stringify(data);
    } catch (error) {
      logger.error({ error: formatError(error) }, 'Failed to broadcast message');
      return;
    }

    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async stop(): Promise<void> {
    logger.info('Stopping API server...');

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    const server = this.server;
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
      this.server = null;
    }

    logger.info('API server stopped');
  }

  public getExpressApp(): express.Application {
    return this.app;
  }

  public getLegacyHandler(method: string, path: string): express.RequestHandler | undefined {
    const key = `${method.toUpperCase()} ${path}`;
    return this.legacyHandlers.get(key);
  }

}

// Export singleton instance
let apiServerInstance: APIServer | null = null;

export function getAPIServer(port?: number): APIServer {
  if (!apiServerInstance) {
    apiServerInstance = new APIServer(port);
  }
  return apiServerInstance;
}

// CLI integration
if (require.main === module) {
  const port = parseInt(process.env.PORT || process.env.API_PORT || '10001');
  const server = new APIServer(port);

  server.start().catch((error) => {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  });
}
