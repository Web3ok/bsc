'use client';

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';

interface WebSocketContextType {
  socket: WebSocket | null;
  connected: boolean;
  lastMessage: any;
  sendMessage: (message: any) => void;
  reconnect: () => void;
  connectionAttempts: number;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);

  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const socketRef = useRef<WebSocket | null>(null);
  const shouldConnectRef = useRef(true);

  const calculateReconnectDelay = useCallback((attempts: number) => {
    // Exponential backoff with jitter
    const exponentialDelay = Math.min(
      INITIAL_RECONNECT_DELAY * Math.pow(2, attempts),
      MAX_RECONNECT_DELAY
    );
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    return exponentialDelay + jitter;
  }, []);

  const connect = useCallback(() => {
    if (!shouldConnectRef.current) {
      console.log('WebSocket connection cancelled by cleanup');
      return;
    }

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001';
      const wsUrl = apiUrl.replace('http', 'ws');

      console.log(`WebSocket connecting to: ${wsUrl} (attempt ${connectionAttempts + 1})`);

      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        setConnected(true);
        setSocket(ws);
        setConnectionAttempts(0); // Reset attempts on successful connection
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
          console.log('WebSocket message received:', data.type || 'unknown');
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log(`WebSocket disconnected (code: ${event.code}, reason: ${event.reason || 'none'})`);
        setConnected(false);
        setSocket(null);
        socketRef.current = null;

        if (shouldConnectRef.current && connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = calculateReconnectDelay(connectionAttempts);
          console.log(`Reconnecting in ${Math.round(delay / 1000)}s...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            setConnectionAttempts(prev => prev + 1);
            connect();
          }, delay);
        } else if (connectionAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error('Max reconnection attempts reached. Giving up.');
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnected(false);
        // onclose will handle reconnection
      };

    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setConnected(false);

      if (shouldConnectRef.current && connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = calculateReconnectDelay(connectionAttempts);
        reconnectTimeoutRef.current = setTimeout(() => {
          setConnectionAttempts(prev => prev + 1);
          connect();
        }, delay);
      }
    }
  }, [connectionAttempts, calculateReconnectDelay]);

  const reconnect = useCallback(() => {
    console.log('Manual reconnection triggered');

    // Clean up existing connection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (socketRef.current) {
      socketRef.current.close();
    }

    // Reset state and reconnect
    setConnectionAttempts(0);
    setConnected(false);
    setSocket(null);
    shouldConnectRef.current = true;
    connect();
  }, [connect]);

  useEffect(() => {
    shouldConnectRef.current = true;
    connect();

    return () => {
      console.log('WebSocket cleanup triggered');
      shouldConnectRef.current = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect]);

  const sendMessage = useCallback((message: any) => {
    if (socketRef.current && connected && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(JSON.stringify(message));
        console.log('WebSocket message sent:', message.type || 'unknown');
      } catch (error) {
        console.error('Failed to send WebSocket message:', error);
      }
    } else {
      console.warn('WebSocket not connected or not ready, message not sent:', message);
    }
  }, [connected]);

  return (
    <WebSocketContext.Provider value={{
      socket,
      connected,
      lastMessage,
      sendMessage,
      reconnect,
      connectionAttempts
    }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}