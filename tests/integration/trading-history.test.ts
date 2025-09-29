import { expect } from 'chai';
import request from 'supertest';
import { database } from '../../src/persistence/database';
import { Express } from 'express';

describe('Trading History API Integration Tests', () => {
  let app: Express;
  let authToken: string;

  before(async () => {
    // Import server after setting test environment
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-integration-tests';
    
    const serverModule = await import('../../src/server');
    app = serverModule.default || serverModule.app;
    
    // Ensure database connection
    await database.ensureConnection();
    
    // Run migrations to ensure proper table structure
    await database.migrate();
    
    // Get auth token for API calls
    const authResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: 'admin123'
      });
    
    authToken = authResponse.body.token;
    expect(authToken).to.be.a('string');
  });

  after(async () => {
    await database.close();
  });

  describe('Database Table Fallback Strategy', () => {
    it('should handle blockchain_transactions table when available', async () => {
      // Check if blockchain_transactions table exists
      const hasBlockchainTable = await database.connection.schema.hasTable('blockchain_transactions');
      
      if (hasBlockchainTable) {
        // Insert test data into blockchain_transactions
        await database.connection('blockchain_transactions').insert({
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
        const response = await request(app)
          .get('/api/trading/history')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.success).to.be.true;
        expect(response.body.data).to.be.an('array');
        expect(response.body.data.length).to.be.greaterThan(0);
        
        const transaction = response.body.data[0];
        expect(transaction).to.have.property('tx_hash');
        expect(transaction).to.have.property('from_address');
        expect(transaction).to.have.property('to_address');
        expect(transaction).to.have.property('amount');
      }
    });

    it('should fallback to transactions table when blockchain_transactions unavailable', async () => {
      // Temporarily rename blockchain_transactions table to simulate unavailability
      const hasBlockchainTable = await database.connection.schema.hasTable('blockchain_transactions');
      
      if (hasBlockchainTable) {
        await database.connection.schema.renameTable('blockchain_transactions', 'blockchain_transactions_backup');
      }

      // Ensure regular transactions table exists and has data
      const hasTransactionsTable = await database.connection.schema.hasTable('transactions');
      if (!hasTransactionsTable) {
        await database.connection.schema.createTable('transactions', (table) => {
          table.increments('id').primary();
          table.string('hash').notNullable();
          table.string('from').notNullable();
          table.string('to').notNullable();
          table.string('amount').notNullable();
          table.timestamp('timestamp').defaultTo(database.connection.fn.now());
        });
      }

      // Insert test data
      await database.connection('transactions').insert({
        hash: '0xfallback1234567890abcdef1234567890abcdef12345678901234567890ab',
        from: '0xfallback1234567890abcdef1234567890abcdef123',
        to: '0xfallback9876543210fedcba9876543210fedcba987',
        amount: '2000000000000000000' // 2 BNB
      });

      // Test API response uses fallback table
      const response = await request(app)
        .get('/api/trading/history')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).to.be.true;
      expect(response.body.data).to.be.an('array');

      // Restore blockchain_transactions table if it existed
      if (hasBlockchainTable) {
        await database.connection.schema.renameTable('blockchain_transactions_backup', 'blockchain_transactions');
      }
    });

    it('should handle pagination correctly across both table types', async () => {
      const response = await request(app)
        .get('/api/trading/history?page=1&limit=5')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).to.be.true;
      expect(response.body.data).to.be.an('array');
      expect(response.body.data.length).to.be.at.most(5);
      expect(response.body).to.have.property('pagination');
      expect(response.body.pagination).to.have.property('page', 1);
      expect(response.body.pagination).to.have.property('limit', 5);
      expect(response.body.pagination).to.have.property('total');
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Temporarily close database connection
      await database.close();

      const response = await request(app)
        .get('/api/trading/history')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);

      expect(response.body.success).to.be.false;
      expect(response.body.error).to.include('database');

      // Restore connection
      await database.ensureConnection();
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/trading/history')
        .expect(401);

      expect(response.body.success).to.be.false;
      expect(response.body.error).to.include('token');
    });
  });

  describe('Data Integrity', () => {
    it('should return consistent data format regardless of source table', async () => {
      const response = await request(app)
        .get('/api/trading/history')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      if (response.body.data.length > 0) {
        const transaction = response.body.data[0];
        
        // Check required fields are present
        expect(transaction).to.have.property('id');
        expect(transaction).to.have.property('timestamp');
        
        // Check that either new format or old format fields exist
        const hasNewFormat = transaction.hasOwnProperty('tx_hash') && 
                            transaction.hasOwnProperty('from_address');
        const hasOldFormat = transaction.hasOwnProperty('hash') && 
                            transaction.hasOwnProperty('from');
        
        expect(hasNewFormat || hasOldFormat).to.be.true;
      }
    });
  });
});