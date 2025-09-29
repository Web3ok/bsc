import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { configManager } from '../config';
import { emergencyManager } from '../utils/emergency';
import { createPublicClient, http, parseAbiItem, Log } from 'viem';
import { bsc } from 'viem/chains';
import { eventParser, ParsedSwapEvent } from './eventParser';
import { SWAP_EVENT_TOPIC } from './abi';

export interface SwapEvent {
  id: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
  address: string;
  sender: string;
  to: string;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  timestamp: Date;
  processed: boolean;
}

export interface PriceUpdate {
  pair: string;
  token0: string;
  token1: string;
  price: string;
  volume24h?: string;
  timestamp: Date;
}

export class BSCWebSocketClient extends EventEmitter {
  private static instance: BSCWebSocketClient;
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private subscriptions = new Set<string>();
  private eventBuffer = new Map<string, SwapEvent>();
  private bufferSize = 1000;
  private publicClient: any;

  // PancakeSwap V2 Factory and key pairs
  private readonly PANCAKE_V2_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
  private readonly MONITORED_PAIRS = [
    // BNB/USDT, BNB/BUSD, CAKE/BNB, ETH/BNB pairs
    '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE', // BNB/USDT
    '0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16', // BNB/BUSD
    '0x0eD7e52944161450477ee417DE9Cd3a859b14fD0', // CAKE/BNB
    '0x74E4716E431f45807DCF19f284c7aA99F18a4fbc', // ETH/BNB
  ];

  private constructor() {
    super();
    this.setupPublicClient();
  }

  public static getInstance(): BSCWebSocketClient {
    if (!BSCWebSocketClient.instance) {
      BSCWebSocketClient.instance = new BSCWebSocketClient();
    }
    return BSCWebSocketClient.instance;
  }

  private setupPublicClient(): void {
    const rpcUrls = configManager.rpcUrls;
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrls[0]),
    });
  }

  async start(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      logger.warn('WebSocket is already connected or connecting');
      return;
    }

    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.isConnecting) return;
    
    this.isConnecting = true;
    const wsUrl = `wss://bsc-ws-node.nariox.org:443`;

    try {
      logger.info({ url: wsUrl }, 'Connecting to BSC WebSocket');
      
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketHandlers();

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        this.ws!.once('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.ws!.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      logger.info('BSC WebSocket connected successfully');
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      
      // Subscribe to monitored pairs
      await this.subscribeToSwapEvents();
      
    } catch (error) {
      this.isConnecting = false;
      logger.error({ error }, 'Failed to connect to BSC WebSocket');
      await this.scheduleReconnect();
    }
  }

  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.on('open', () => {
      this.emit('connected');
      logger.info('BSC WebSocket connection established');
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        logger.error({ error, data: data.toString() }, 'Failed to parse WebSocket message');
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      logger.warn({ code, reason: reason.toString() }, 'BSC WebSocket connection closed');
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (error: Error) => {
      logger.error({ error }, 'BSC WebSocket error');
      this.emit('error', error);
    });

    this.ws.on('pong', () => {
      // Handle pong response for heartbeat
    });
  }

  private async subscribeToSwapEvents(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot subscribe - WebSocket not connected');
      return;
    }

    // Subscribe to logs for Swap events on monitored pairs
    const swapEventSignature = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'; // Swap(address,uint256,uint256,uint256,uint256,address)
    
    for (const pairAddress of this.MONITORED_PAIRS) {
      const subscription = {
        jsonrpc: '2.0',
        id: Date.now() + Math.random(),
        method: 'eth_subscribe',
        params: [
          'logs',
          {
            address: pairAddress,
            topics: [swapEventSignature]
          }
        ]
      };

      this.ws.send(JSON.stringify(subscription));
      logger.info({ pairAddress }, 'Subscribed to swap events for pair');
    }
  }

  private handleMessage(message: any): void {
    try {
      // Handle subscription confirmations
      if (message.result && typeof message.result === 'string') {
        this.subscriptions.add(message.result);
        logger.info({ subscriptionId: message.result }, 'WebSocket subscription confirmed');
        return;
      }

      // Handle event notifications
      if (message.params?.subscription && message.params?.result) {
        this.handleLogEvent(message.params.result);
        return;
      }

    } catch (error) {
      logger.error({ error, message }, 'Error handling WebSocket message');
    }
  }

  private async handleLogEvent(logData: any): Promise<void> {
    try {
      const eventId = `${logData.transactionHash}-${logData.logIndex}`;
      
      // Deduplicate events
      if (this.eventBuffer.has(eventId)) {
        return;
      }

      // Parse the swap event
      const swapEvent = await this.parseSwapEvent(logData);
      if (!swapEvent) return;

      // Add to buffer with size limit
      this.eventBuffer.set(eventId, swapEvent);
      if (this.eventBuffer.size > this.bufferSize) {
        const firstKey = this.eventBuffer.keys().next().value;
        if (firstKey) {
          this.eventBuffer.delete(firstKey);
        }
      }

      // Check emergency status before processing
      const emergencyStatus = emergencyManager.checkEmergencyStatus();
      if (!emergencyStatus.allowed) {
        logger.debug({ eventId }, 'Skipping event processing - emergency stop active');
        return;
      }

      // Emit the event for processing
      this.emit('swapEvent', swapEvent);
      
      // Calculate and emit price updates
      const priceUpdate = await this.calculatePriceUpdate(swapEvent);
      if (priceUpdate) {
        this.emit('priceUpdate', priceUpdate);
      }

    } catch (error) {
      logger.error({ error, logData }, 'Failed to handle log event');
    }
  }

  private async parseSwapEvent(logData: any): Promise<SwapEvent | null> {
    try {
      // Use the new event parser for proper ABI decoding
      const parsedEvent = await eventParser.parseSwapEvent(logData);
      if (!parsedEvent) {
        return null;
      }

      // Convert ParsedSwapEvent to SwapEvent (maintain compatibility)
      const swapEvent: SwapEvent = {
        id: parsedEvent.id,
        blockNumber: parsedEvent.blockNumber,
        transactionHash: parsedEvent.transactionHash,
        logIndex: parsedEvent.logIndex,
        address: parsedEvent.address,
        sender: parsedEvent.sender,
        to: parsedEvent.to,
        amount0In: parsedEvent.amount0In,
        amount1In: parsedEvent.amount1In,
        amount0Out: parsedEvent.amount0Out,
        amount1Out: parsedEvent.amount1Out,
        timestamp: parsedEvent.timestamp,
        processed: parsedEvent.processed,
      };

      return swapEvent;

    } catch (error) {
      logger.error({ error, logData }, 'Failed to parse swap event');
      return null;
    }
  }

  private async calculatePriceUpdate(swapEvent: SwapEvent): Promise<PriceUpdate | null> {
    try {
      // First, get the parsed event with proper ABI decoding
      const logData = {
        transactionHash: swapEvent.transactionHash,
        logIndex: `0x${swapEvent.logIndex.toString(16)}`,
        address: swapEvent.address,
        blockNumber: `0x${swapEvent.blockNumber.toString(16)}`,
        topics: [SWAP_EVENT_TOPIC], // This would need to be stored or reconstructed
        data: '0x' // This would need to be stored or reconstructed
      };

      const parsedEvent = await eventParser.parseSwapEvent(logData);
      if (!parsedEvent) {
        // Fallback to old calculation if parsing fails
        return this.calculatePriceUpdateLegacy(swapEvent);
      }

      // Use the sophisticated price calculation from eventParser
      const priceCalc = eventParser.calculatePriceUpdate(parsedEvent);
      if (!priceCalc) {
        return this.calculatePriceUpdateLegacy(swapEvent);
      }

      return {
        pair: `${parsedEvent.token0Symbol || 'TOKEN0'}/${parsedEvent.token1Symbol || 'TOKEN1'}`,
        token0: parsedEvent.token0Symbol || 'TOKEN0',
        token1: parsedEvent.token1Symbol || 'TOKEN1', 
        price: priceCalc.price.toString(),
        timestamp: swapEvent.timestamp,
      };

    } catch (error) {
      logger.error({ error, swapEvent }, 'Failed to calculate price update');
      return this.calculatePriceUpdateLegacy(swapEvent);
    }
  }

  private calculatePriceUpdateLegacy(swapEvent: SwapEvent): PriceUpdate | null {
    try {
      // Simple price calculation based on swap amounts (fallback)
      let price = '0';
      
      if (swapEvent.amount0In > 0n && swapEvent.amount1Out > 0n) {
        price = (Number(swapEvent.amount0In) / Number(swapEvent.amount1Out)).toString();
      } else if (swapEvent.amount1In > 0n && swapEvent.amount0Out > 0n) {
        price = (Number(swapEvent.amount1In) / Number(swapEvent.amount0Out)).toString();
      }

      // Get pair info (this would need to be enhanced with actual token data)
      const pairInfo = this.getPairInfo(swapEvent.address);
      
      return {
        pair: pairInfo.pair,
        token0: pairInfo.token0,
        token1: pairInfo.token1,
        price,
        timestamp: swapEvent.timestamp,
      };

    } catch (error) {
      logger.error({ error, swapEvent }, 'Failed to calculate legacy price update');
      return null;
    }
  }

  private getPairInfo(pairAddress: string): { pair: string; token0: string; token1: string } {
    // Map pair addresses to token info
    const pairMap: Record<string, { pair: string; token0: string; token1: string }> = {
      '0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae': {
        pair: 'BNB/USDT',
        token0: 'BNB',
        token1: 'USDT'
      },
      '0x58f876857a02d6762e0101bb5c46a8c1ed44dc16': {
        pair: 'BNB/BUSD',
        token0: 'BNB',
        token1: 'BUSD'
      },
      '0x0ed7e52944161450477ee417de9cd3a859b14fd0': {
        pair: 'CAKE/BNB',
        token0: 'CAKE',
        token1: 'BNB'
      },
      '0x74e4716e431f45807dcf19f284c7aa99f18a4fbc': {
        pair: 'ETH/BNB',
        token0: 'ETH',
        token1: 'BNB'
      },
    };

    return pairMap[pairAddress.toLowerCase()] || {
      pair: 'UNKNOWN',
      token0: 'TOKEN0',
      token1: 'TOKEN1'
    };
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached - stopping WebSocket client');
      await emergencyManager.emergencyStop(
        'WebSocket max reconnect attempts exceeded',
        'warning',
        'websocket-client'
      );
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    logger.info({ 
      attempt: this.reconnectAttempts, 
      delay,
      maxAttempts: this.maxReconnectAttempts 
    }, 'Scheduling WebSocket reconnect');

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        logger.error({ error }, 'Reconnect attempt failed');
      });
    }, delay);
  }

  async stop(): Promise<void> {
    logger.info('Stopping BSC WebSocket client');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Unsubscribe from all subscriptions
      for (const subscriptionId of this.subscriptions) {
        try {
          this.ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'eth_unsubscribe',
            params: [subscriptionId]
          }));
        } catch (error) {
          logger.error({ error, subscriptionId }, 'Failed to unsubscribe');
        }
      }

      this.ws.close();
      this.ws = null;
    }

    this.subscriptions.clear();
    this.eventBuffer.clear();
    this.reconnectAttempts = 0;
    
    logger.info('BSC WebSocket client stopped');
  }

  // Health check method
  isHealthy(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.subscriptions.size > 0;
  }

  getStatus(): {
    connected: boolean;
    subscriptions: number;
    reconnectAttempts: number;
    bufferSize: number;
  } {
    return {
      connected: this.ws?.readyState === WebSocket.OPEN || false,
      subscriptions: this.subscriptions.size,
      reconnectAttempts: this.reconnectAttempts,
      bufferSize: this.eventBuffer.size,
    };
  }
}

export const bscWebSocketClient = BSCWebSocketClient.getInstance();