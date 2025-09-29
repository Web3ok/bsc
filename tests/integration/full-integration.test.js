"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const node_fetch_1 = __importDefault(require("node-fetch"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const API_URL = 'http://localhost:10001';
const JWT_SECRET = 'dev-secret-key-for-testing-only-256bits-long';
// Generate test token
const generateToken = () => {
    return jsonwebtoken_1.default.sign({ id: 'test-user', role: 'admin' }, JWT_SECRET, {
        expiresIn: '1h',
        issuer: 'bsc-trading-bot',
        audience: 'bsc-api'
    });
};
(0, vitest_1.describe)('BSC Trading Bot - Full Integration Test Suite', () => {
    let authToken;
    let db;
    (0, vitest_1.beforeAll)(async () => {
        authToken = generateToken();
        // Setup database connection
        const dbPath = path_1.default.join(__dirname, '../../data/bot.db');
        db = new sqlite3_1.default.Database(dbPath);
        db.runAsync = (0, util_1.promisify)(db.run);
        db.getAsync = (0, util_1.promisify)(db.get);
        db.allAsync = (0, util_1.promisify)(db.all);
    });
    (0, vitest_1.afterAll)(async () => {
        if (db) {
            await new Promise((resolve) => db.close(resolve));
        }
    });
    (0, vitest_1.describe)('1. Health Check & System Status', () => {
        (0, vitest_1.it)('should return healthy status', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/health`);
            const data = await response.json();
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(data.status).toBe('healthy');
            (0, vitest_1.expect)(data.services).toBeDefined();
            (0, vitest_1.expect)(data.services.api).toBe('healthy');
        });
        (0, vitest_1.it)('should return system version', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/health`);
            const data = await response.json();
            (0, vitest_1.expect)(data.version).toBeDefined();
            (0, vitest_1.expect)(data.uptime).toBeGreaterThan(0);
            (0, vitest_1.expect)(data.environment).toBe('development');
        });
    });
    (0, vitest_1.describe)('2. Authentication & Authorization', () => {
        (0, vitest_1.it)('should reject requests without token', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/trading/history`);
            const data = await response.json();
            (0, vitest_1.expect)(response.status).toBe(401);
            (0, vitest_1.expect)(data.success).toBe(false);
            (0, vitest_1.expect)(data.code).toBe('NO_TOKEN');
        });
        (0, vitest_1.it)('should accept valid JWT token', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/trading/history`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await response.json();
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(data.success).toBe(true);
        });
        (0, vitest_1.it)('should reject malformed token', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/trading/history`, {
                headers: { 'Authorization': 'Bearer invalid-token' }
            });
            const data = await response.json();
            (0, vitest_1.expect)(response.status).toBe(401);
            (0, vitest_1.expect)(data.code).toBe('MALFORMED_TOKEN');
        });
    });
    (0, vitest_1.describe)('3. Price Service', () => {
        (0, vitest_1.it)('should return price data with source information', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/prices/BNB`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await response.json();
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(data.data).toBeDefined();
            (0, vitest_1.expect)(data.data.symbol).toBe('BNB');
            (0, vitest_1.expect)(data.data.priceUSD).toBeGreaterThan(0);
            (0, vitest_1.expect)(data.data.dataSource).toMatch(/^(coingecko_live|cached_recent|cached_stale|fallback_static)$/);
        });
        (0, vitest_1.it)('should handle batch price requests', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/prices/batch`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ symbols: ['BNB', 'CAKE', 'BUSD'] })
            });
            const data = await response.json();
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(data.data).toBeDefined();
            (0, vitest_1.expect)(Object.keys(data.data).length).toBe(3);
        });
        (0, vitest_1.it)('should mark fallback prices as stale', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/prices/UNKNOWN_TOKEN`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await response.json();
            if (data.success && data.data && data.data.dataSource === 'fallback_static') {
                (0, vitest_1.expect)(data.data.isStale).toBe(true);
            }
        });
    });
    (0, vitest_1.describe)('4. Database Operations', () => {
        (0, vitest_1.it)('should have all required tables', async () => {
            const tables = await db.allAsync("SELECT name FROM sqlite_master WHERE type='table'");
            const tableNames = tables.map((t) => t.name);
            // Check for core tables
            (0, vitest_1.expect)(tableNames).toContain('wallets');
            (0, vitest_1.expect)(tableNames).toContain('transactions');
            (0, vitest_1.expect)(tableNames).toContain('blockchain_transactions');
            (0, vitest_1.expect)(tableNames).toContain('monitoring_status');
            (0, vitest_1.expect)(tableNames).toContain('monitoring_alerts');
            (0, vitest_1.expect)(tableNames).toContain('strategies');
            (0, vitest_1.expect)(tableNames).toContain('orders');
        });
        (0, vitest_1.it)('should write and read blockchain transactions', async () => {
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
            await db.runAsync(`INSERT INTO blockchain_transactions 
         (tx_hash, from_address, to_address, amount, block_number, block_timestamp, gas_price, status, operation_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [testTx.tx_hash, testTx.from_address, testTx.to_address, testTx.amount,
                testTx.block_number, testTx.block_timestamp, testTx.gas_price, testTx.status, testTx.operation_type]);
            // Read back
            const row = await db.getAsync('SELECT * FROM blockchain_transactions WHERE tx_hash = ?', [testTx.tx_hash]);
            (0, vitest_1.expect)(row).toBeDefined();
            (0, vitest_1.expect)(row.tx_hash).toBe(testTx.tx_hash);
            (0, vitest_1.expect)(row.amount).toBe(testTx.amount);
            // Clean up
            await db.runAsync('DELETE FROM blockchain_transactions WHERE tx_hash = ?', [testTx.tx_hash]);
        });
    });
    (0, vitest_1.describe)('5. Trading History API', () => {
        (0, vitest_1.it)('should return trading history structure', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/trading/history`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await response.json();
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(data.data).toBeDefined();
            (0, vitest_1.expect)(data.data.trades).toBeInstanceOf(Array);
            (0, vitest_1.expect)(data.pagination).toBeDefined();
        });
        (0, vitest_1.it)('should support pagination', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/trading/history?limit=10&offset=0`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            const data = await response.json();
            (0, vitest_1.expect)(response.status).toBe(200);
            (0, vitest_1.expect)(data.pagination.limit).toBe(10);
            (0, vitest_1.expect)(data.pagination.offset).toBe(0);
        });
    });
    (0, vitest_1.describe)('6. WebSocket Connection', () => {
        (0, vitest_1.it)('should have WebSocket endpoint available', async () => {
            // Just check if the server is configured for WebSocket
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/health`);
            const data = await response.json();
            (0, vitest_1.expect)(data.services.websocket).toBe('healthy');
        });
    });
    (0, vitest_1.describe)('7. Monitoring Service', () => {
        (0, vitest_1.it)('should track service health', async () => {
            // This would be tested by checking monitoring data
            const monitoringStatus = await db.allAsync('SELECT * FROM monitoring_status');
            (0, vitest_1.expect)(monitoringStatus).toBeInstanceOf(Array);
        });
        (0, vitest_1.it)('should store alerts in database', async () => {
            const alerts = await db.allAsync('SELECT * FROM monitoring_alerts');
            (0, vitest_1.expect)(alerts).toBeInstanceOf(Array);
        });
    });
    (0, vitest_1.describe)('8. Environment Configuration', () => {
        (0, vitest_1.it)('should have required environment variables', () => {
            (0, vitest_1.expect)(process.env.JWT_SECRET).toBeDefined();
            (0, vitest_1.expect)(process.env.DATABASE_URL || process.env.DB_PATH).toBeDefined();
        });
    });
    (0, vitest_1.describe)('9. Error Handling', () => {
        (0, vitest_1.it)('should handle 404 endpoints gracefully', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/nonexistent`);
            const data = await response.json();
            (0, vitest_1.expect)(response.status).toBe(404);
            (0, vitest_1.expect)(data.success).toBe(false);
            (0, vitest_1.expect)(data.message).toContain('not found');
        });
        (0, vitest_1.it)('should handle invalid JSON in POST requests', async () => {
            const response = await (0, node_fetch_1.default)(`${API_URL}/api/prices/batch`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: 'invalid json'
            });
            (0, vitest_1.expect)(response.status).toBeGreaterThanOrEqual(400);
        });
    });
    (0, vitest_1.describe)('10. Performance', () => {
        (0, vitest_1.it)('should respond to health check quickly', async () => {
            const startTime = Date.now();
            await (0, node_fetch_1.default)(`${API_URL}/api/health`);
            const endTime = Date.now();
            (0, vitest_1.expect)(endTime - startTime).toBeLessThan(100); // Should respond in less than 100ms
        });
        (0, vitest_1.it)('should handle concurrent requests', async () => {
            const promises = Array(10).fill(null).map(() => (0, node_fetch_1.default)(`${API_URL}/api/health`));
            const responses = await Promise.all(promises);
            const allSuccessful = responses.every(r => r.status === 200);
            (0, vitest_1.expect)(allSuccessful).toBe(true);
        });
    });
});
//# sourceMappingURL=full-integration.test.js.map