#!/usr/bin/env node

const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET || 'dev-secret-key-for-testing-only-256bits-long';

const payload = {
  id: 'test-user',
  role: 'admin',
  walletAddress: '0x1234567890123456789012345678901234567890'
};

const token = jwt.sign(payload, secret, { 
  expiresIn: '24h',
  issuer: 'bsc-trading-bot',
  audience: 'bsc-api'
});

console.log('Generated JWT Token:');
console.log(token);
console.log('\nTest with curl:');
console.log(`curl -H "Authorization: Bearer ${token}" http://localhost:10001/api/trading/history`);
console.log('\nPayload:', payload);
console.log('Secret:', secret);

// Verify token
try {
  const decoded = jwt.verify(token, secret, {
    issuer: 'bsc-trading-bot',
    audience: 'bsc-api'
  });
  console.log('\nVerified payload:', decoded);
} catch (err) {
  console.error('Token verification failed:', err);
}