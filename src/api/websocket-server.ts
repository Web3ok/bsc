import WebSocket from 'ws';
import http from 'http';
import { logger } from '../utils/logger';
import { healthMonitor } from '../monitor/health';
import { tradingStatsService } from '../services/trading-stats-service';

export interface WebSocketMessage {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  timestamp: string;
}

export class WebSocketServer {
  private static instance: WebSocketServer;
  private wss: WebSocket.Server | null = null;
  private clients: Set<WebSocket> = new Set();
  private metricsInterval: NodeJS.Timeout | null = null;
  private readonly mockEnabled = process.env.ENABLE_MOCK_WEBSOCKET === 'true';

  private constructor() {}

  static getInstance(): WebSocketServer {
    if (!WebSocketServer.instance) {
      WebSocketServer.instance = new WebSocketServer();
    }
    return WebSocketServer.instance;
  }

  async start(server: http.Server): Promise<void> {
    try {
      this.wss = new WebSocket.Server({ 
        server,
        path: '/ws'
      });

      this.wss.on('connection', (ws: WebSocket, req) => {
        logger.info({ clientIP: req.socket.remoteAddress }, 'WebSocket client connected');
        this.clients.add(ws);

        // Send initial data to new client
        this.sendToClient(ws, {
          type: 'connection',
          data: { message: 'Connected to BSC Trading Bot WebSocket' },
          timestamp: new Date().toISOString()
        });

        // Send current metrics immediately
        this.sendMetricsToClient(ws);

        ws.on('message', (message: WebSocket.Data) => {
          try {
            const data = JSON.parse(message.toString());
            this.handleClientMessage(ws, data);
          } catch (error) {
            logger.error({ error }, 'Failed to parse WebSocket message');
            this.sendToClient(ws, {
              type: 'error',
              data: { message: 'Invalid JSON format' },
              timestamp: new Date().toISOString()
            });
          }
        });

        ws.on('close', () => {
          logger.info('WebSocket client disconnected');
          this.clients.delete(ws);
        });

        ws.on('error', (error) => {
          logger.error({ error }, 'WebSocket client error');
          this.clients.delete(ws);
        });
      });

      // Start periodic metrics broadcasting
      this.startMetricsBroadcast();

      logger.info('WebSocket server started on /ws endpoint');
    } catch (error) {
      logger.error({ error }, 'Failed to start WebSocket server');
      throw error;
    }
  }

  private async handleClientMessage(ws: WebSocket, message: any): Promise<void> {
    const { type, data } = message;

    switch (type) {
      case 'subscribe':
        this.handleSubscription(ws, data);
        break;
      case 'unsubscribe':
        this.handleUnsubscription(ws, data);
        break;
      case 'trade':
        await this.handleTradeRequest(ws, data);
        break;
      case 'wallet':
        await this.handleWalletRequest(ws, data);
        break;
      case 'ping':
        this.sendToClient(ws, {
          type: 'pong',
          data: { timestamp: new Date().toISOString() },
          timestamp: new Date().toISOString()
        });
        break;
      default:
        this.sendToClient(ws, {
          type: 'error',
          data: { message: `Unknown message type: ${type}` },
          timestamp: new Date().toISOString()
        });
    }
  }

  private handleSubscription(ws: WebSocket, data: any): void {
    const { channels = [] } = data;
    // Store subscription preferences on the WebSocket instance
    (ws as any).subscriptions = new Set(channels);
    
    this.sendToClient(ws, {
      type: 'subscription',
      data: { subscribed: channels, message: `Subscribed to ${channels.length} channels` },
      timestamp: new Date().toISOString()
    });

    logger.info({ channels }, 'Client subscribed to channels');
  }

  private handleUnsubscription(ws: WebSocket, data: any): void {
    const { channels = [] } = data;
    const subscriptions = (ws as any).subscriptions || new Set();
    
    channels.forEach((channel: string) => subscriptions.delete(channel));
    (ws as any).subscriptions = subscriptions;

    this.sendToClient(ws, {
      type: 'unsubscription',
      data: { unsubscribed: channels, remaining: Array.from(subscriptions) },
      timestamp: new Date().toISOString()
    });
  }

  private async handleTradeRequest(ws: WebSocket, data: any): Promise<void> {
    try {
      if (!this.mockEnabled) {
        this.sendToClient(ws, {
          type: 'error',
          data: {
            message: 'Trading websocket channel disabled. Set ENABLE_MOCK_WEBSOCKET=true to enable stub responses.'
          },
          timestamp: new Date().toISOString()
        });
        return;
      }

      const { action, params } = data;
      
      // Mock response - in real implementation, this would call trading APIs
      let result;
      switch (action) {
        case 'execute':
          result = {
            tradeId: `trade_${Date.now()}`,
            status: 'pending',
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            estimatedOut: (parseFloat(params.amountIn) * 0.98).toFixed(6), // Mock 2% slippage
          };
          break;
        case 'quote':
          result = {
            amountOut: (parseFloat(params.amountIn) * 0.98).toFixed(6),
            priceImpact: '2.1%',
            fee: '0.25%',
            route: ['PancakeSwap V2']
          };
          break;
        default:
          throw new Error(`Unknown trade action: ${action}`);
      }

      this.sendToClient(ws, {
        type: 'trade_response',
        data: result,
        timestamp: new Date().toISOString()
      });

      // Broadcast trade event to all subscribed clients
      this.broadcast({
        type: 'trade_event',
        data: {
          action,
          result,
          wallet: params.wallet || 'unknown'
        },
        timestamp: new Date().toISOString()
      }, ['trades']);

    } catch (error) {
      this.sendToClient(ws, {
        type: 'error',
        data: { 
          message: error instanceof Error ? error.message : 'Trade request failed',
          context: 'trade_request'
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  private async handleWalletRequest(ws: WebSocket, data: any): Promise<void> {
    try {
      if (!this.mockEnabled) {
        this.sendToClient(ws, {
          type: 'error',
          data: {
            message: 'Wallet websocket channel disabled. Set ENABLE_MOCK_WEBSOCKET=true to enable stub responses.'
          },
          timestamp: new Date().toISOString()
        });
        return;
      }

      const { action, params } = data;

      // Mock response - in real implementation, this would call wallet APIs
      let result;
      switch (action) {
        case 'balance':
          result = {
            address: params.address,
            balances: {
              BNB: '2.45',
              USDT: '1234.56',
              CAKE: '50.23'
            }
          };
          break;
        case 'generate':
          result = {
            address: `0x${'0'.repeat(40)}`, // Placeholder - real wallet generation disabled via WebSocket
            alias: params.alias || 'New Wallet',
            tier: params.tier || 'hot'
          };
          break;
        default:
          throw new Error(`Unknown wallet action: ${action}`);
      }

      this.sendToClient(ws, {
        type: 'wallet_response',
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      this.sendToClient(ws, {
        type: 'error',
        data: { 
          message: error instanceof Error ? error.message : 'Wallet request failed',
          context: 'wallet_request'
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  private sendToClient(ws: WebSocket, message: WebSocketMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private broadcast(message: WebSocketMessage, channels?: string[]): void {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        // If channels specified, only send to subscribed clients
        if (channels && channels.length > 0) {
          const subscriptions = (client as any).subscriptions || new Set();
          const hasSubscription = channels.some(channel => subscriptions.has(channel));
          if (!hasSubscription) return;
        }
        
        client.send(JSON.stringify(message));
      }
    });
  }

  private startMetricsBroadcast(): void {
    // Send metrics every 10 seconds
    this.metricsInterval = setInterval(async () => {
      const metrics = await this.collectCurrentMetrics();
      this.broadcast({
        type: 'metrics_update',
        data: metrics,
        timestamp: new Date().toISOString()
      }, ['metrics']);
    }, 10000);
  }

  private async sendMetricsToClient(ws: WebSocket): Promise<void> {
    try {
      const metrics = await this.collectCurrentMetrics();
      this.sendToClient(ws, {
        type: 'metrics_update',
        data: metrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error({ error }, 'Failed to send metrics to client');
    }
  }

  private async collectCurrentMetrics(): Promise<any> {
    try {
      const health = await healthMonitor.getSystemHealth();
      
      // Try to get enhanced market and risk data
      let marketData = null;
      let riskData = null;
      
      try {
        const { marketDataCollector } = await import('../monitor/market-data-collector');
        const { riskMetricsCollector } = await import('../monitor/risk-metrics-collector');
        
        marketData = {
          prices: marketDataCollector.getAllTokenPrices(),
          metrics: await marketDataCollector.getCurrentMarketMetrics(),
          status: marketDataCollector.getStatus(),
        };
        
        riskData = {
          current: riskMetricsCollector.getCurrentRiskMetrics(),
          positions: await riskMetricsCollector.getPositionRisks(),
          status: riskMetricsCollector.getStatus(),
        };
      } catch (error) {
        logger.debug({ error }, 'Enhanced collectors not available, using mock data');
      }
      
      return {
        system: {
          status: health.overall,
          uptime: Math.floor(health.uptime / 1000),
          memory: process.memoryUsage(),
          cpu: process.cpuUsage(),
        },
        trading: await this.getRealTradingStats(),

        wallets: await this.getRealWalletStats(),

        market: marketData ? {
          totalVolume: marketData.metrics.dailyVolume,
          totalLiquidity: marketData.metrics.totalValueLocked,
          activePairs: marketData.metrics.activePairs,
          sentiment: marketData.metrics.marketTrends,
          topGainers: marketData.metrics.priceMovements.gainers,
          topLosers: marketData.metrics.priceMovements.losers,
        } : null,
        risk: riskData?.current ? {
          score: riskData.current.overall.riskScore,
          level: riskData.current.overall.riskLevel,
          portfolio: riskData.current.portfolio,
          liquidity: riskData.current.liquidity,
          market: riskData.current.market,
          operational: riskData.current.operational,
        } : await this.getRealRiskMetrics(),

        connections: this.clients.size,
        lastUpdate: new Date().toISOString(),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to collect metrics');
      return {
        error: 'Failed to collect metrics',
        timestamp: new Date().toISOString(),
      };
    }
  }

  stop(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }

    if (this.wss) {
      this.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1000, 'Server shutting down');
        }
      });
      
      this.wss.close(() => {
        logger.info('WebSocket server stopped');
      });
    }
  }

  // Public methods for external components to send updates
  public broadcastTradeUpdate(data: any): void {
    this.broadcast({
      type: 'trade_update',
      data,
      timestamp: new Date().toISOString()
    }, ['trades']);
  }

  public broadcastWalletUpdate(data: any): void {
    this.broadcast({
      type: 'wallet_update',
      data,
      timestamp: new Date().toISOString()
    }, ['wallets']);
  }

  public broadcastSystemAlert(data: any): void {
    this.broadcast({
      type: 'system_alert',
      data,
      timestamp: new Date().toISOString()
    }, ['alerts', 'system']);
  }

  private async getRealTradingStats(): Promise<any> {
    try {
      const stats = await tradingStatsService.getTradingStats();
      const metrics = await tradingStatsService.getTradingMetrics();
      return {
        totalTrades: stats.totalTrades24h,
        pnl: stats.pnl24h,
        volume24h: stats.volume24h,
        activeBots: metrics.activeTrades,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get real trading stats for WebSocket');
      return {
        totalTrades: 0,
        pnl: '0.00',
        volume24h: '0.00',
        activeBots: 0,
      };
    }
  }

  private async getRealWalletStats(): Promise<any> {
    try {
      // This would integrate with actual wallet manager
      return {
        total: 0,
        active: 0,
        totalBalance: '0.00 BNB',
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get real wallet stats for WebSocket');
      return {
        total: 0,
        active: 0,
        totalBalance: '0.00 BNB',
      };
    }
  }

  private async getRealRiskMetrics(): Promise<any> {
    try {
      const riskMetrics = await tradingStatsService.getRiskMetrics();
      return {
        score: riskMetrics.score,
        level: riskMetrics.level,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get real risk metrics for WebSocket');
      return {
        score: 0,
        level: 'low',
      };
    }
  }
}

export const webSocketServer = WebSocketServer.getInstance();
