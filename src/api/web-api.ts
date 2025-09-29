import express, { Request, Response } from 'express';
import cors from 'cors';
import http from 'http';
import { body, query, validationResult } from 'express-validator';
import { ethers } from 'ethers';
import { MultiDEXAggregator } from '../dex/multi-dex-aggregator';
import { WalletManager } from '../wallet';
import { BatchWalletManager } from '../wallet/batch-wallet-manager';
import { BatchTradingAPI } from './batch-trading-api';
import { monitoringServer } from '../monitor/server';
import { webSocketServer } from './websocket-server';
import { healthMonitor } from '../monitor/health';
import { logger } from '../utils/logger';
import { tradingStatsService } from '../services/trading-stats-service';
import { dexDataService } from '../services/dex-data-service';
import { priceService } from '../services/price-service';
import { walletBalanceService } from '../services/wallet-balance-service';
import { appConfig } from '../config';

export class WebAPI {
  private static instance: WebAPI;
  private app: express.Application;
  private server: http.Server | null = null;
  private port: number;
  private walletManager: WalletManager;
  private multiDexAggregator: MultiDEXAggregator;
  private batchTradingAPI: BatchTradingAPI;

  private constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || process.env.API_PORT || '10001');
    this.walletManager = WalletManager.getInstance();
    this.multiDexAggregator = new MultiDEXAggregator(this.walletManager);
    this.batchTradingAPI = new BatchTradingAPI();

    this.setupMiddleware();
    this.setupRoutes();
  }

  static getInstance(): WebAPI {
    if (!WebAPI.instance) {
      WebAPI.instance = new WebAPI();
    }
    return WebAPI.instance;
  }

  private setupMiddleware(): void {
    // CORS configuration
    this.app.use(cors({
      origin: [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        'http://localhost:10002',
        'http://localhost:10003', 
        'http://localhost:10004',
      ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));

    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    
    // Request logging
    this.app.use((req, res, next) => {
      logger.info({ method: req.method, url: req.url, ip: req.ip }, 'API request');
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoints
    this.app.get('/health', async (req, res) => {
      try {
        const health = await healthMonitor.getSystemHealth();
        res.json(health);
      } catch (error) {
        res.status(500).json({ error: 'Health check failed' });
      }
    });

    this.app.get('/healthz', async (req, res) => {
      const isHealthy = await healthMonitor.isHealthy();
      res.status(isHealthy ? 200 : 503).json({ status: isHealthy ? 'ok' : 'error' });
    });

    // Dashboard data endpoints
    this.app.get('/api/dashboard/overview', this.handleDashboardOverview.bind(this));
    this.app.get('/api/dashboard/metrics', this.handleDashboardMetrics.bind(this));
    this.app.get('/api/dashboard/status', this.handleSystemStatus.bind(this));

    // Trading endpoints
    this.app.post('/api/trading/quote', [
      body('tokenIn').isEthereumAddress(),
      body('tokenOut').isEthereumAddress(),
      body('amountIn').isDecimal(),
    ], this.handleTradingQuote.bind(this));

    this.app.post('/api/trading/execute', [
      body('walletAddress').isEthereumAddress(),
      body('tokenIn').isEthereumAddress(),
      body('tokenOut').isEthereumAddress(),
      body('amountIn').isDecimal(),
      body('slippage').optional().isFloat({ min: 0, max: 50 }),
    ], this.handleTradingExecute.bind(this));

    // Wallet endpoints
    this.app.get('/api/wallets', this.handleWalletsList.bind(this));
    this.app.post('/api/wallets/generate', [
      body('count').isInt({ min: 1, max: 10 }),
      body('tier').optional().isIn(['hot', 'warm', 'cold', 'vault']),
    ], this.handleWalletsGenerate.bind(this));

    this.app.get('/api/wallets/:address/balance', this.handleWalletBalance.bind(this));

    // DEX information endpoints
    this.app.get('/api/dex/supported', this.handleSupportedDEXes.bind(this));
    this.app.get('/api/dex/health', this.handleDEXHealth.bind(this));

    // Market data endpoints
    this.app.get('/api/market/tokens', this.handleMarketTokens.bind(this));
    this.app.get('/api/market/price/:token', this.handleTokenPrice.bind(this));

    // Use the existing batch trading API
    this.app.use('/api/batch', this.batchTradingAPI.router);

    // Error handling middleware
    this.app.use((error: any, req: Request, res: Response, next: any) => {
      logger.error({ error, url: req.url }, 'API error');
      res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({ error: 'Endpoint not found' });
    });
  }

  private async handleDashboardOverview(req: Request, res: Response): Promise<void> {
    try {
      const health = await healthMonitor.getSystemHealth();
      const wallets = this.walletManager.getAllWallets();
      
      // Get real trading data from database
      const tradingData = await tradingStatsService.getTradingStats();

      // Calculate total wallet balances
      let totalBalanceBNB = 0;
      let totalValueUSD = 0;
      
      if (wallets.length > 0) {
        try {
          const walletAddresses = wallets.map(w => w.address);
          const balanceResults = await walletBalanceService.getMultipleWalletBalances(walletAddresses);
          
          for (const balance of balanceResults.values()) {
            totalBalanceBNB += parseFloat(balance.nativeBalanceFormatted);
            totalValueUSD += parseFloat(balance.totalValueUSD);
          }
        } catch (error) {
          logger.warn({ error }, 'Failed to calculate wallet balances, using fallback');
          totalBalanceBNB = 0;
          totalValueUSD = 0;
        }
      }

      res.json({
        success: true,
        data: {
          system: {
            status: health.overall,
            uptimeSeconds: Math.floor(health.uptime / 1000),
            version: '1.0.0',
            environment: process.env.NODE_ENV || 'development',
          },
          wallets: {
            total: wallets.length,
            totalBalance: `${totalBalanceBNB.toFixed(4)} BNB`,
            totalValueUSD: `$${totalValueUSD.toFixed(2)}`,
          },
          trading: tradingData,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error }, 'Dashboard overview error');
      res.status(500).json({ success: false, error: 'Failed to fetch dashboard data' });
    }
  }

  private async handleDashboardMetrics(req: Request, res: Response): Promise<void> {
    try {
      // Get real metrics from database
      const tradingMetrics = await tradingStatsService.getTradingMetrics();
      const riskMetrics = await tradingStatsService.getRiskMetrics();
      
      const metrics = {
        trading: {
          activeTrades: tradingMetrics.activeTrades,
          pendingOrders: tradingMetrics.pendingOrders,
          completedTrades24h: tradingMetrics.completedTrades24h,
          avgTradeTime: '0.0s', // Will be calculated from actual trade data
        },
        performance: {
          pnl: tradingMetrics.pnl,
          winRate: tradingMetrics.winRate,
          sharpeRatio: tradingMetrics.sharpeRatio,
        },
        risk: {
          score: riskMetrics.score,
          level: riskMetrics.level,
          maxDrawdown: riskMetrics.maxDrawdown,
        },
      };

      res.json({
        success: true,
        data: metrics,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Dashboard metrics error');
      res.status(500).json({ success: false, error: 'Failed to fetch metrics' });
    }
  }

  private async handleSystemStatus(req: Request, res: Response): Promise<void> {
    try {
      const health = await healthMonitor.getSystemHealth();
      const dexHealth = await this.multiDexAggregator.getDEXHealthStatus();
      
      // Get RPC provider details
      const rpcProviderCheck = health.checks.find(c => c.name === 'rpc_provider');
      const rpcConnectionCheck = health.checks.find(c => c.name === 'rpc_connection');
      
      res.json({
        success: true,
        data: {
          overall: health.overall,
          updatedAt: new Date().toISOString(),
          uptimeSeconds: Math.floor(health.uptime / 1000),
          components: {
            api: {
              status: 'healthy',
              latencyMs: 12,
              lastChecked: new Date().toISOString()
            },
            database: {
              status: health.checks.find(c => c.name === 'database')?.status || 'unknown',
              lastChecked: new Date().toISOString(),
              retries: 0
            },
            rpc_provider: {
              status: rpcProviderCheck?.status || 'unknown',
              latency: rpcProviderCheck?.latency || 0,
              lastChecked: new Date().toISOString(),
              metadata: rpcProviderCheck?.metadata || null
            },
            rpc_providers: {
              status: rpcProviderCheck?.status || 'unknown',
              lastChecked: new Date().toISOString(),
              latestBlock: null
            },
            trading_engine: {
              status: 'healthy',
              lastChecked: new Date().toISOString()
            }
          }
        },
      });
    } catch (error) {
      logger.error({ error }, 'System status error');
      res.status(500).json({ success: false, error: 'Failed to fetch system status' });
    }
  }

  private async handleTradingQuote(req: Request, res: Response): Promise<void> {
    if (!this.validateRequest(req, res)) return;

    try {
      const { tokenIn, tokenOut, amountIn, excludeDEXes = [] } = req.body;

      const quote = await this.multiDexAggregator.getBestQuote(
        tokenIn,
        tokenOut,
        amountIn,
        excludeDEXes
      );

      res.json({
        success: true,
        data: quote,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Trading quote error');
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to get quote' 
      });
    }
  }

  private async handleTradingExecute(req: Request, res: Response): Promise<void> {
    if (!this.validateRequest(req, res)) return;

    try {
      const { walletAddress, tokenIn, tokenOut, amountIn, slippage = 0.5 } = req.body;

      // Execute trade through multi-DEX aggregator
      const result = await this.multiDexAggregator.executeBatchTrades({
        walletAddress,
        trades: [{
          tokenIn,
          tokenOut,
          amountIn,
          slippage,
        }],
      });

      // Broadcast trade result via WebSocket
      webSocketServer.broadcastTradeUpdate({
        wallet: walletAddress,
        tokenIn,
        tokenOut,
        amountIn,
        result: result.results[0],
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: result.success,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Trading execute error');
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to execute trade' 
      });
    }
  }

  private async handleWalletsList(req: Request, res: Response): Promise<void> {
    try {
      const wallets = this.walletManager.getAllWallets();
      
      // Remove private keys for security
      const safeWallets = wallets.map(wallet => ({
        ...wallet,
        privateKey: '***HIDDEN***',
      }));

      res.json({
        success: true,
        data: {
          wallets: safeWallets,
          total: wallets.length,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Wallets list error');
      res.status(500).json({ success: false, error: 'Failed to fetch wallets' });
    }
  }

  private async handleWalletsGenerate(req: Request, res: Response): Promise<void> {
    if (!this.validateRequest(req, res)) return;

    try {
      const { count, tier = 'hot', aliasPrefix } = req.body;

      const batchWalletManager = new BatchWalletManager(this.walletManager);
      const result = await batchWalletManager.generateWallets({
        count,
        tier,
        aliasPrefix,
      });

      // Broadcast wallet update via WebSocket
      webSocketServer.broadcastWalletUpdate({
        action: 'generated',
        count: result.processed,
        tier,
        timestamp: new Date().toISOString(),
      });

      res.json({
        success: result.success,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Wallet generation error');
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to generate wallets' 
      });
    }
  }

  private async handleWalletBalance(req: Request, res: Response): Promise<void> {
    try {
      const { address } = req.params;
      
      // Get real blockchain balance
      const balances: { [key: string]: string } = {};
      
      try {
        // Get BNB balance from blockchain using appConfig
        const rpcUrl = appConfig.rpc.primary_urls[0] || 'https://bsc-dataseed1.binance.org/';
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const bnbBalance = await provider.getBalance(address);
        balances.BNB = ethers.formatEther(bnbBalance);
        
        // For now, we'll only show BNB balance since it's the most important
        // TODO: Add support for token balances later
        balances.USDT = "0.00";
        balances.CAKE = "0.00";
      } catch (balanceError) {
        logger.error({ error: balanceError, address }, 'Failed to fetch blockchain balance');
        // Fallback to zero if blockchain query fails
        balances.BNB = "0.0000";
        balances.USDT = "0.00";
        balances.CAKE = "0.00";
      }

      res.json({
        success: true,
        data: {
          address,
          balances,
          BNB: balances.BNB, // For backward compatibility with frontend
          totalValueUSD: (parseFloat(balances.BNB) * 300).toFixed(2), // Rough BNB price estimate
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Wallet balance error');
      res.status(500).json({ success: false, error: 'Failed to fetch wallet balance' });
    }
  }

  private async handleSupportedDEXes(req: Request, res: Response): Promise<void> {
    try {
      const dexes = this.multiDexAggregator.getSupportedDEXes();
      res.json({
        success: true,
        data: dexes,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Supported DEXes error');
      res.status(500).json({ success: false, error: 'Failed to fetch supported DEXes' });
    }
  }

  private async handleDEXHealth(req: Request, res: Response): Promise<void> {
    try {
      const health = await this.multiDexAggregator.getDEXHealthStatus();
      res.json({
        success: true,
        data: {
          overall: health.overall,
          dexes: health.dexes,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'DEX health error');
      res.status(500).json({ success: false, error: 'Failed to fetch DEX health' });
    }
  }

  private async handleMarketTokens(req: Request, res: Response): Promise<void> {
    try {
      // Mock token list - in real app, this would come from token registry
      const tokens = [
        { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18 },
        { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18 },
        { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18 },
        { address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD', name: 'Binance USD', decimals: 18 },
      ];

      res.json({
        success: true,
        data: tokens,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ error }, 'Market tokens error');
      res.status(500).json({ success: false, error: 'Failed to fetch tokens' });
    }
  }

  private async handleTokenPrice(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.params;
      const symbol = this.getTokenSymbol(token);
      
      // Get real price data from integrated sources with full metadata
      let price;
      let warning: string | undefined;
      
      try {
        // Get full price data with metadata
        const priceData = await priceService.getPrice(symbol.toUpperCase());
        
        const [volume24h, change24h] = await Promise.all([
          dexDataService.getTokenVolume(symbol),
          dexDataService.getPriceChange24h(symbol)
        ]);
        
        if (priceData) {
          price = {
            address: token,
            symbol: priceData.symbol,
            priceUSD: priceData.priceUSD.toFixed(6),
            change24h: change24h || priceData.priceChange24h.toFixed(2),
            volume24h: volume24h || priceData.volume24hUSD.toFixed(2),
            lastUpdated: priceData.lastUpdated.toISOString(),
            dataSource: priceData.dataSource,
            isStale: priceData.isStale || false,
          };
          
          // Add warning if using fallback
          if (priceData.dataSource === 'fallback_static') {
            warning = 'Using static fallback price - external API unavailable';
            logger.warn({ symbol, price: priceData.priceUSD }, 'Serving fallback price via web-api');
          }
        } else {
          // If price service returns null, use proper fallback
          const fallbackPrice = this.getFallbackPrice(symbol);
          price = {
            address: token,
            symbol: symbol.toUpperCase(),
            priceUSD: fallbackPrice.toFixed(6),
            change24h: '0.00',
            volume24h: '0',
            lastUpdated: new Date().toISOString(),
            dataSource: 'fallback_static',
            isStale: true,
          };
          warning = 'Price data unavailable - using emergency fallback';
          logger.error({ symbol, token }, 'Price service returned null, using fallback');
        }
      } catch (error) {
        logger.error({ error, token, symbol }, 'Failed to get real price data');
        // Use proper fallback price instead of hardcoded 0.000001
        const fallbackPrice = this.getFallbackPrice(symbol);
        price = {
          address: token,
          symbol: symbol.toUpperCase(),
          priceUSD: fallbackPrice.toFixed(6),
          change24h: '0.00',
          volume24h: '0',
          lastUpdated: new Date().toISOString(),
          dataSource: 'fallback_static',
          isStale: true,
        };
        warning = 'Service error - using static fallback price';
      }

      const response: any = {
        success: true,
        data: price,
        timestamp: new Date().toISOString(),
      };
      
      if (warning) {
        response.warning = warning;
      }
      
      res.json(response);
    } catch (error) {
      logger.error({ error }, 'Token price error');
      res.status(500).json({ success: false, error: 'Failed to fetch token price' });
    }
  }

  private validateRequest(req: Request, res: Response): boolean {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array(),
      });
      return false;
    }
    return true;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.app);
      
      // Start WebSocket server
      webSocketServer.start(this.server);

      this.server.listen(this.port, () => {
        logger.info({ port: this.port }, 'Web API server started');
        resolve();
      });

      this.server.on('error', (error) => {
        logger.error({ error, port: this.port }, 'Web API server error');
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        webSocketServer.stop();
        this.server.close(() => {
          logger.info('Web API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Helper functions for token price handling
  private getTokenSymbol(tokenAddress: string): string {
    const tokenMap: Record<string, string> = {
      '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': 'BNB',
      '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56': 'BUSD',
      '0x55d398326f99059fF775485246999027B3197955': 'USDT',
      '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82': 'CAKE',
      '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d': 'USDC',
    };
    
    return tokenMap[tokenAddress.toLowerCase()] || 'UNKNOWN';
  }
  
  private getFallbackPrice(symbol: string): number {
    // Return reasonable fallback prices for known tokens
    const fallbackPrices: Record<string, number> = {
      'BNB': 300,
      'BUSD': 1,
      'USDT': 1,
      'USDC': 1,
      'CAKE': 3,
      'ETH': 2000,
      'BTC': 40000,
    };
    
    // Return the fallback price or 0.01 for unknown tokens (not 0.000001)
    return fallbackPrices[symbol.toUpperCase()] || 0.01;
  }

  private async getTokenPrice(symbol: string): Promise<string> {
    try {
      // Try to get real price from price service
      const priceData = await priceService.getPrice(symbol.toUpperCase());
      if (priceData && priceData.priceUSD > 0) {
        return priceData.priceUSD.toFixed(6);
      }
    } catch (error) {
      logger.warn({ error, symbol }, 'Failed to get real price, using fallback');
    }

    // Fallback prices for known tokens if real price fails
    const priceMap: Record<string, string> = {
      'BNB': '300.000000',
      'BUSD': '1.000000',
      'USDT': '1.000000',
      'CAKE': '2.500000',
      'USDC': '1.000000',
    };
    
    return priceMap[symbol] || '0.000001';
  }
}

export const webAPI = WebAPI.getInstance();
