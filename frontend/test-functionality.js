#!/usr/bin/env node

/**
 * BSC Trading Bot Frontend 功能验证脚本
 * 用于验证前端功能而不需要浏览器
 */

const fetch = require('node-fetch');
const WebSocket = require('ws');

const FRONTEND_URL = 'http://localhost:10003';
const API_URL = 'http://localhost:10001';
const WS_URL = 'ws://localhost:10001/ws';

console.log('🚀 开始验证 BSC Trading Bot 前端功能...\n');

// 测试API连接
async function testAPIs() {
  console.log('📡 测试API端点...');
  
  const endpoints = [
    '/api/dashboard/overview',
    '/api/dashboard/status', 
    '/api/wallets',
    '/api/wallets/groups'
  ];
  
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${API_URL}${endpoint}`);
      const data = await response.json();
      console.log(`✅ ${endpoint}: ${data.success ? '成功' : '失败'}`);
      
      if (endpoint === '/api/wallets') {
        console.log(`   📊 钱包数量: ${data.data?.length || 0}`);
      }
    } catch (error) {
      console.log(`❌ ${endpoint}: 错误 - ${error.message}`);
    }
  }
  console.log('');
}

// 测试WebSocket连接
async function testWebSocket() {
  console.log('🔌 测试WebSocket连接...');
  
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let connected = false;
    
    const timeout = setTimeout(() => {
      if (!connected) {
        console.log('❌ WebSocket: 连接超时');
        ws.close();
        resolve(false);
      }
    }, 5000);
    
    ws.on('open', () => {
      connected = true;
      clearTimeout(timeout);
      console.log('✅ WebSocket: 连接成功');
      
      // 测试消息发送
      ws.send(JSON.stringify({
        type: 'subscribe',
        data: { channels: ['metrics', 'trades'] }
      }));
      
      setTimeout(() => {
        ws.close();
        resolve(true);
      }, 1000);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log(`📨 收到消息: ${message.type || '未知类型'}`);
      } catch (e) {
        console.log('📨 收到非JSON消息');
      }
    });
    
    ws.on('error', (error) => {
      console.log(`❌ WebSocket错误: ${error.message}`);
      resolve(false);
    });
  });
}

// 测试前端页面加载
async function testPageLoading() {
  console.log('🌐 测试前端页面加载...');
  
  const pages = ['/', '/wallets', '/settings'];
  
  for (const page of pages) {
    try {
      const response = await fetch(`${FRONTEND_URL}${page}`);
      const html = await response.text();
      
      // 检查页面内容
      const hasTitle = html.includes('<title>') || html.includes('BSC Bot');
      const hasNavigation = html.includes('导航') || html.includes('navigation');
      const isChineseUI = html.includes('钱包') || html.includes('设置') || html.includes('仪表板');
      
      console.log(`✅ ${page}: 加载成功 ${hasTitle ? '📄' : ''}${hasNavigation ? '🧭' : ''}${isChineseUI ? '🇨🇳' : ''}`);
      
      // 特殊检查
      if (page === '/wallets') {
        const hasWalletTable = html.includes('钱包列表') && html.includes('地址');
        const hasCreateButton = html.includes('创建') && html.includes('钱包');
        console.log(`   📋 钱包表格: ${hasWalletTable ? '✅' : '❌'}`);
        console.log(`   ➕ 创建按钮: ${hasCreateButton ? '✅' : '❌'}`);
      }
      
      if (page === '/settings') {
        const hasSettings = html.includes('设置') && html.includes('深色模式');
        console.log(`   ⚙️ 设置项: ${hasSettings ? '✅' : '❌'}`);
      }
      
    } catch (error) {
      console.log(`❌ ${page}: 加载失败 - ${error.message}`);
    }
  }
  console.log('');
}

// 测试钱包创建API
async function testWalletCreation() {
  console.log('💰 测试钱包创建功能...');
  
  try {
    const response = await fetch(`${API_URL}/api/wallets/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: 'Test Wallet (验证脚本)',
        group: 'test',
        generateNew: true,
        tier: 'standard'
      })
    });
    
    const result = await response.json();
    if (result.success) {
      console.log(`✅ 钱包创建成功: ${result.data.address.slice(0,8)}...`);
      console.log(`   💰 余额: ${result.data.balance} BNB`);
    } else {
      console.log(`❌ 钱包创建失败: ${result.message}`);
    }
  } catch (error) {
    console.log(`❌ 钱包创建错误: ${error.message}`);
  }
  console.log('');
}

// 主测试函数
async function runAllTests() {
  const startTime = Date.now();
  
  await testAPIs();
  const wsConnected = await testWebSocket();
  await testPageLoading();
  await testWalletCreation();
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log('📋 测试摘要:');
  console.log(`⏱️  总耗时: ${duration}秒`);
  console.log(`🔌 WebSocket: ${wsConnected ? '连接正常' : '连接异常'}`);
  console.log(`🌐 前端服务: http://localhost:10003`);
  console.log(`🔧 后端API: http://localhost:10001`);
  console.log('');
  console.log('💡 建议: 在浏览器中访问 http://localhost:10003 进行交互功能测试');
}

// 运行测试
runAllTests().catch(console.error);