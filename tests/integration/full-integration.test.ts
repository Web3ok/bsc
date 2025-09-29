import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import path from 'path';
import { promisify } from 'util';

const API_URL = 'http://localhost:10001';
const JWT_SECRET = 'dev-secret-key-for-testing-only-256bits-long';

// Generate test token
const generateToken = () => {
  return jwt.sign(
    { id: 'test-user', role: 'admin' },
    JWT_SECRET,
    { 
      expiresIn: '1h',
      issuer: 'bsc-trading-bot',
      audience: 'bsc-api'
    }
  );
};

describe('BSC Trading Bot - Full Integration Test Suite', () => {
  let authToken: string;
  let db: any;

  beforeAll(async () => {
    authToken = generateToken();
    
    // Setup database connection
    const dbPath = path.join(__dirname, '../../data/bot.db');
    db = new sqlite3.Database(dbPath);
    db.runAsync = promisify(db.run);
    db.getAsync = promisify(db.get);
    db.allAsync = promisify(db.all);
  });

  afterAll(async () => {
    if (db) {
      await new Promise((resolve) => db.close(resolve));
    }
  });

  describe('1. Health Check & System Status', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${API_URL}/api/health`);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.status).toBe('healthy');
      expect(data.services).toBeDefined();
      expect(data.services.api).toBe('healthy');
    });

    it('should return system version', async () => {
      const response = await fetch(`${API_URL}/api/health`);
      const data = await response.json();
      
      expect(data.version).toBeDefined();
      expect(data.uptime).toBeGreaterThan(0);
      expect(data.environment).toBe('development');
    });
  });

  describe('2. Authentication & Authorization', () => {
    it('should reject requests without token', async () => {
      const response = await fetch(`${API_URL}/api/trading/history`);
      const data = await response.json();
      
      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.code).toBe('NO_TOKEN');
    });

    it('should accept valid JWT token', async () => {
      const response = await fetch(`${API_URL}/api/trading/history`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('should reject malformed token', async () => {
      const response = await fetch(`${API_URL}/api/trading/history`, {
        headers: { 'Authorization': 'Bearer invalid-token' }
      });
      const data = await response.json();
      
      expect(response.status).toBe(401);
      expect(data.code).toBe('MALFORMED_TOKEN');
    });
  });

  describe('3. Price Service', () => {
    it('should return price data with source information', async () => {
      const response = await fetch(`${API_URL}/api/prices/BNB`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.symbol).toBe('BNB');
      expect(data.data.priceUSD).toBeGreaterThan(0);
      expect(data.data.dataSource).toMatch(/^(coingecko_live|cached_recent|cached_stale|fallback_static)$/);
    });

    it('should handle batch price requests', async () => {
      const response = await fetch(`${API_URL}/api/prices/batch`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ symbols: ['BNB', 'CAKE', 'BUSD'] })
      });
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(Object.keys(data.data).length).toBe(3);
    });

    it('should mark fallback prices as stale', async () => {
      const response = await fetch(`${API_URL}/api/prices/UNKNOWN_TOKEN`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      
      if (data.success && data.data && data.data.dataSource === 'fallback_static') {
        expect(data.data.isStale).toBe(true);
      }
    });
  });

  describe('4. Database Operations', () => {
    it('should have all required tables', async () => {
      const tables = await db.allAsync(
        "SELECT name FROM sqlite_master WHERE type='table'"
      );
      
      const tableNames = tables.map((t: any) => t.name);
      
      // Check for core tables
      expect(tableNames).toContain('wallets');
      expect(tableNames).toContain('transactions');
      expect(tableNames).toContain('blockchain_transactions');
      expect(tableNames).toContain('monitoring_status');
      expect(tableNames).toContain('monitoring_alerts');
      expect(tableNames).toContain('strategies');
      expect(tableNames).toContain('orders');
    });

    it('should write and read blockchain transactions', async () => {
      const testTx = {
        tx_hash: '0x' + 'test'.padEnd(64, '0'),
        from_address: '0x' + '1'.repeat(40),
        to_address: '0x' + '2'.repeat(40),
        amount: '1000000000000000000',
        block_number: '99999999',
        block_timestamp: Math.floor(Date.now() / 1000),
        gas_price: '5000000000',
        status: 'confirmed',
        operation_type: 'transfer'
      };

      // Insert test transaction
      await db.runAsync(
        `INSERT INTO blockchain_transactions 
         (tx_hash, from_address, to_address, amount, block_number, block_timestamp, gas_price, status, operation_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [testTx.tx_hash, testTx.from_address, testTx.to_address, testTx.amount, 
         testTx.block_number, testTx.block_timestamp, testTx.gas_price, testTx.status, testTx.operation_type]
      );

      // Read back
      const row = await db.getAsync(
        'SELECT * FROM blockchain_transactions WHERE tx_hash = ?',
        [testTx.tx_hash]
      );

      expect(row).toBeDefined();
      expect(row.tx_hash).toBe(testTx.tx_hash);
      expect(row.amount).toBe(testTx.amount);

      // Clean up
      await db.runAsync(
        'DELETE FROM blockchain_transactions WHERE tx_hash = ?',
        [testTx.tx_hash]
      );
    });
  });

  describe('5. Trading History API', () => {
    it('should return trading history structure', async () => {
      const response = await fetch(`${API_URL}/api/trading/history`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.trades).toBeInstanceOf(Array);
      expect(data.pagination).toBeDefined();
    });

    it('should support pagination', async () => {
      const response = await fetch(`${API_URL}/api/trading/history?limit=10&offset=0`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.pagination.limit).toBe(10);
      expect(data.pagination.offset).toBe(0);
    });
  });

  describe('6. WebSocket Connection', () => {
    it('should have WebSocket endpoint available', async () => {
      // Just check if the server is configured for WebSocket
      const response = await fetch(`${API_URL}/api/health`);
      const data = await response.json();
      
      expect(data.services.websocket).toBe('healthy');
    });
  });

  describe('7. Monitoring Service', () => {
    it('should track service health', async () => {
      // This would be tested by checking monitoring data
      const monitoringStatus = await db.allAsync(
        'SELECT * FROM monitoring_status'
      );
      
      expect(monitoringStatus).toBeInstanceOf(Array);
    });

    it('should store alerts in database', async () => {
      const alerts = await db.allAsync(
        'SELECT * FROM monitoring_alerts'
      );
      
      expect(alerts).toBeInstanceOf(Array);
    });
  });

  describe('8. Environment Configuration', () => {
    it('should have required environment variables', () => {
      expect(process.env.JWT_SECRET).toBeDefined();
      expect(process.env.DATABASE_URL || process.env.DB_PATH).toBeDefined();
    });
  });

  describe('9. Error Handling', () => {
    it('should handle 404 endpoints gracefully', async () => {
      const response = await fetch(`${API_URL}/api/nonexistent`);
      const data = await response.json();
      
      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toContain('not found');
    });

    it('should handle invalid JSON in POST requests', async () => {
      const response = await fetch(`${API_URL}/api/prices/batch`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: 'invalid json'
      });
      
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('10. Performance', () => {
    it('should respond to health check quickly', async () => {
      const startTime = Date.now();
      await fetch(`${API_URL}/api/health`);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(100); // Should respond in less than 100ms
    });

    it('should handle concurrent requests', async () => {
      const promises = Array(10).fill(null).map(() => 
        fetch(`${API_URL}/api/health`)
      );
      
      const responses = await Promise.all(promises);
      const allSuccessful = responses.every(r => r.status === 200);
      
      expect(allSuccessful).toBe(true);
    });
  });
});