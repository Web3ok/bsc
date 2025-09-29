#!/usr/bin/env node

const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const API_URL = 'http://localhost:10001';
const SECRET = process.env.JWT_SECRET || 'dev-secret-key-for-testing-only-256bits-long';

// Generate admin token
const token = jwt.sign(
  { id: 'admin', role: 'admin' },
  SECRET,
  { 
    expiresIn: '24h',
    issuer: 'bsc-trading-bot',
    audience: 'bsc-api'
  }
);

async function startMonitoring() {
  console.log('🚀 Starting blockchain monitoring...');
  
  // Test wallet addresses to monitor
  const wallets = [
    '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3', // Binance Hot Wallet
    '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', // ETH Token on BSC
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  ];

  for (const wallet of wallets) {
    console.log(`\n📍 Monitoring wallet: ${wallet}`);
    
    try {
      const response = await fetch(`${API_URL}/api/blockchain/monitor`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          address: wallet,
          label: `Test Wallet ${wallets.indexOf(wallet) + 1}`
        })
      });

      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ Successfully started monitoring: ${wallet}`);
      } else {
        console.log(`❌ Failed to monitor ${wallet}:`, data.message);
      }
    } catch (error) {
      console.error(`❌ Error monitoring ${wallet}:`, error.message);
    }
  }

  // Check monitoring status
  console.log('\n📊 Checking monitoring status...');
  
  try {
    const statusResponse = await fetch(`${API_URL}/api/monitoring/stats`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const status = await statusResponse.json();
    console.log('\nMonitoring Status:', JSON.stringify(status, null, 2));
  } catch (error) {
    console.error('❌ Failed to get monitoring status:', error.message);
  }

  // Test wallet balance
  console.log('\n💰 Checking wallet balances...');
  
  for (const wallet of wallets.slice(0, 1)) {
    try {
      const balanceResponse = await fetch(`${API_URL}/api/wallet/balance/${wallet}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const balance = await balanceResponse.json();
      
      if (balance.success) {
        console.log(`\nBalance for ${wallet}:`);
        console.log(`  BNB: ${balance.data.bnb || '0'}`);
        if (balance.data.tokens && balance.data.tokens.length > 0) {
          console.log('  Tokens:');
          balance.data.tokens.forEach(token => {
            console.log(`    ${token.symbol}: ${token.balance}`);
          });
        }
      } else {
        console.log(`❌ Failed to get balance for ${wallet}:`, balance.message);
      }
    } catch (error) {
      console.error(`❌ Error getting balance for ${wallet}:`, error.message);
    }
  }

  console.log('\n✨ Monitoring setup complete!');
}

startMonitoring().catch(console.error);