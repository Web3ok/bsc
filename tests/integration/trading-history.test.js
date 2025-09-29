"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const supertest_1 = __importDefault(require("supertest"));
const database_1 = require("../../src/persistence/database");
describe('Trading History API Integration Tests', () => {
    let app;
    let authToken;
    before(async () => {
        // Import server after setting test environment
        process.env.NODE_ENV = 'test';
        process.env.JWT_SECRET = 'test-jwt-secret-key-for-integration-tests';
        const serverModule = await Promise.resolve().then(() => __importStar(require('../../src/server')));
        app = serverModule.default || serverModule.app;
        // Ensure database connection
        await database_1.database.ensureConnection();
        // Run migrations to ensure proper table structure
        await database_1.database.migrate();
        // Get auth token for API calls
        const authResponse = await (0, supertest_1.default)(app)
            .post('/api/auth/login')
            .send({
            username: 'admin',
            password: 'admin123'
        });
        authToken = authResponse.body.token;
        (0, chai_1.expect)(authToken).to.be.a('string');
    });
    after(async () => {
        await database_1.database.close();
    });
    describe('Database Table Fallback Strategy', () => {
        it('should handle blockchain_transactions table when available', async () => {
            // Check if blockchain_transactions table exists
            const hasBlockchainTable = await database_1.database.connection.schema.hasTable('blockchain_transactions');
            if (hasBlockchainTable) {
                // Insert test data into blockchain_transactions
                await database_1.database.connection('blockchain_transactions').insert({
                    tx_hash: '0x1234567890abcdef1234567890abcdef12345678901234567890abcdef123456',
                    from_address: '0xtest1234567890abcdef1234567890abcdef12345678',
                    to_address: '0xtest9876543210fedcba9876543210fedcba98765432',
                    amount: '1000000000000000000', // 1 BNB in wei
                    token_symbol: 'BNB',
                    gas_used: '21000',
                    gas_price: '5000000000',
                    operation_type: 'transfer',
                    block_number: '12345678',
                    block_timestamp: Math.floor(Date.now() / 1000)
                });
                // Test API response
                const response = await (0, supertest_1.default)(app)
                    .get('/api/trading/history')
                    .set('Authorization', `Bearer ${authToken}`)
                    .expect(200);
                (0, chai_1.expect)(response.body.success).to.be.true;
                (0, chai_1.expect)(response.body.data).to.be.an('array');
                (0, chai_1.expect)(response.body.data.length).to.be.greaterThan(0);
                const transaction = response.body.data[0];
                (0, chai_1.expect)(transaction).to.have.property('tx_hash');
                (0, chai_1.expect)(transaction).to.have.property('from_address');
                (0, chai_1.expect)(transaction).to.have.property('to_address');
                (0, chai_1.expect)(transaction).to.have.property('amount');
            }
        });
        it('should fallback to transactions table when blockchain_transactions unavailable', async () => {
            // Temporarily rename blockchain_transactions table to simulate unavailability
            const hasBlockchainTable = await database_1.database.connection.schema.hasTable('blockchain_transactions');
            if (hasBlockchainTable) {
                await database_1.database.connection.schema.renameTable('blockchain_transactions', 'blockchain_transactions_backup');
            }
            // Ensure regular transactions table exists and has data
            const hasTransactionsTable = await database_1.database.connection.schema.hasTable('transactions');
            if (!hasTransactionsTable) {
                await database_1.database.connection.schema.createTable('transactions', (table) => {
                    table.increments('id').primary();
                    table.string('hash').notNullable();
                    table.string('from').notNullable();
                    table.string('to').notNullable();
                    table.string('amount').notNullable();
                    table.timestamp('timestamp').defaultTo(database_1.database.connection.fn.now());
                });
            }
            // Insert test data
            await database_1.database.connection('transactions').insert({
                hash: '0xfallback1234567890abcdef1234567890abcdef12345678901234567890ab',
                from: '0xfallback1234567890abcdef1234567890abcdef123',
                to: '0xfallback9876543210fedcba9876543210fedcba987',
                amount: '2000000000000000000' // 2 BNB
            });
            // Test API response uses fallback table
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/history')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            (0, chai_1.expect)(response.body.success).to.be.true;
            (0, chai_1.expect)(response.body.data).to.be.an('array');
            // Restore blockchain_transactions table if it existed
            if (hasBlockchainTable) {
                await database_1.database.connection.schema.renameTable('blockchain_transactions_backup', 'blockchain_transactions');
            }
        });
        it('should handle pagination correctly across both table types', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/history?page=1&limit=5')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            (0, chai_1.expect)(response.body.success).to.be.true;
            (0, chai_1.expect)(response.body.data).to.be.an('array');
            (0, chai_1.expect)(response.body.data.length).to.be.at.most(5);
            (0, chai_1.expect)(response.body).to.have.property('pagination');
            (0, chai_1.expect)(response.body.pagination).to.have.property('page', 1);
            (0, chai_1.expect)(response.body.pagination).to.have.property('limit', 5);
            (0, chai_1.expect)(response.body.pagination).to.have.property('total');
        });
    });
    describe('Error Handling', () => {
        it('should handle database connection errors gracefully', async () => {
            // Temporarily close database connection
            await database_1.database.close();
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/history')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(500);
            (0, chai_1.expect)(response.body.success).to.be.false;
            (0, chai_1.expect)(response.body.error).to.include('database');
            // Restore connection
            await database_1.database.ensureConnection();
        });
        it('should require authentication', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/history')
                .expect(401);
            (0, chai_1.expect)(response.body.success).to.be.false;
            (0, chai_1.expect)(response.body.error).to.include('token');
        });
    });
    describe('Data Integrity', () => {
        it('should return consistent data format regardless of source table', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/history')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            if (response.body.data.length > 0) {
                const transaction = response.body.data[0];
                // Check required fields are present
                (0, chai_1.expect)(transaction).to.have.property('id');
                (0, chai_1.expect)(transaction).to.have.property('timestamp');
                // Check that either new format or old format fields exist
                const hasNewFormat = transaction.hasOwnProperty('tx_hash') &&
                    transaction.hasOwnProperty('from_address');
                const hasOldFormat = transaction.hasOwnProperty('hash') &&
                    transaction.hasOwnProperty('from');
                (0, chai_1.expect)(hasNewFormat || hasOldFormat).to.be.true;
            }
        });
    });
});
//# sourceMappingURL=trading-history.test.js.map