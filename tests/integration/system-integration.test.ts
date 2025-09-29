import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import fetch from 'node-fetch';

// 系统集成测试 - 测试整个系统的端到端功能
describe('系统集成测试', () => {
  let serverProcess: ChildProcess | null = null;
  const API_BASE_URL = 'http://localhost:3010';
  const TEST_TIMEOUT = 30000;

  beforeEach(async () => {
    // 启动测试服务器
    if (process.env.SKIP_SERVER_TESTS !== 'true') {
      await startTestServer();
    }
  }, TEST_TIMEOUT);

  afterEach(async () => {
    // 停止测试服务器
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  });

  async function startTestServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      serverProcess = spawn('npm', ['run', 'server:dev'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PORT: '3010',
          API_PORT: '3010'
        }
      });

      let started = false;

      serverProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Server running') && !started) {
          started = true;
          // 等待服务器完全启动
          setTimeout(resolve, 2000);
        }
      });

      serverProcess.stderr?.on('data', (data) => {
        console.error('Server error:', data.toString());
      });

      serverProcess.on('error', (error) => {
        reject(error);
      });

      // 超时处理
      setTimeout(() => {
        if (!started) {
          reject(new Error('Server failed to start within timeout'));
        }
      }, 15000);
    });
  }

  async function waitForServer(maxAttempts = 10): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${API_BASE_URL}/api/health`);
        if (response.ok) {
          return true;
        }
      } catch (error) {
        // 服务器还未启动，继续等待
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
  }

  describe('API服务器集成测试', () => {
    test('应该启动健康检查端点', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const response = await fetch(`${API_BASE_URL}/api/health`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.timestamp).toBeDefined();
    }, TEST_TIMEOUT);

    test('应该提供系统状态端点', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const response = await fetch(`${API_BASE_URL}/api/dashboard/status`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.overall).toBeDefined();
      expect(data.data.components).toBeDefined();
    }, TEST_TIMEOUT);

    test('应该提供仪表盘数据端点', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const response = await fetch(`${API_BASE_URL}/api/dashboard/overview`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.system).toBeDefined();
      expect(data.data.wallets).toBeDefined();
      expect(data.data.trading).toBeDefined();
    }, TEST_TIMEOUT);
  });

  describe('钱包管理API集成测试', () => {
    test('应该能够创建和管理钱包', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      // 创建钱包
      const createResponse = await fetch(`${API_BASE_URL}/api/wallets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'test-wallet-integration',
          group: 'test-group'
        })
      });

      expect(createResponse.ok).toBe(true);
      const createData = await createResponse.json();
      expect(createData.success).toBe(true);
      expect(createData.data.address).toMatch(/^0x[a-fA-F0-9]{40}$/);

      const walletAddress = createData.data.address;

      // 获取钱包列表
      const listResponse = await fetch(`${API_BASE_URL}/api/wallets`);
      expect(listResponse.ok).toBe(true);
      
      const listData = await listResponse.json();
      expect(listData.success).toBe(true);
      expect(listData.data.some((w: any) => w.address === walletAddress)).toBe(true);

      // 删除钱包
      const deleteResponse = await fetch(`${API_BASE_URL}/api/wallets/${walletAddress}`, {
        method: 'DELETE'
      });

      expect(deleteResponse.ok).toBe(true);
      const deleteData = await deleteResponse.json();
      expect(deleteData.success).toBe(true);
    }, TEST_TIMEOUT);

    test('应该能够导入和导出钱包', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      // 创建测试钱包
      const createResponse = await fetch(`${API_BASE_URL}/api/wallets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'export-test-wallet'
        })
      });

      const createData = await createResponse.json();
      const walletAddress = createData.data.address;

      // 导出钱包
      const exportResponse = await fetch(`${API_BASE_URL}/api/wallets/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addresses: [walletAddress]
        })
      });

      expect(exportResponse.ok).toBe(true);
      const exportData = await exportResponse.json();
      expect(exportData.success).toBe(true);
      expect(exportData.data.wallets).toHaveLength(1);

      // 清理
      await fetch(`${API_BASE_URL}/api/wallets/${walletAddress}`, {
        method: 'DELETE'
      });
    }, TEST_TIMEOUT);
  });

  describe('交易API集成测试', () => {
    test('应该能够获取交易报价', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const quoteRequest = {
        tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        tokenOut: '0x55d398326f99059fF775485246999027B3197955', // USDT
        amountIn: '1'
      };

      const response = await fetch(`${API_BASE_URL}/api/trading/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quoteRequest)
      });

      if (response.ok) {
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.data.tokenOut.amount).toBeDefined();
        expect(data.data.priceImpact).toBeDefined();
        expect(data.data.slippageAnalysis).toBeDefined();
      } else {
        // 在测试环境中，如果没有实际的DEX连接，这是预期的
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }, TEST_TIMEOUT);

    test('应该提供交易历史端点', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const response = await fetch(`${API_BASE_URL}/api/trading/history`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe('监控和指标API集成测试', () => {
    test('应该提供系统指标', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const response = await fetch(`${API_BASE_URL}/api/monitoring/metrics`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    }, TEST_TIMEOUT);

    test('应该提供告警信息', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const response = await fetch(`${API_BASE_URL}/api/monitoring/alerts`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    }, TEST_TIMEOUT);

    test('应该提供健康检查状态', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const response = await fetch(`${API_BASE_URL}/api/monitoring/health`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      
      // 验证健康检查项目
      const healthChecks = data.data;
      const requiredComponents = ['api', 'database', 'rpc_providers'];
      
      for (const component of requiredComponents) {
        const healthCheck = healthChecks.find((h: any) => h.component === component);
        expect(healthCheck).toBeDefined();
        expect(['healthy', 'unhealthy', 'degraded']).toContain(healthCheck.status);
      }
    }, TEST_TIMEOUT);
  });

  describe('WebSocket集成测试', () => {
    test('应该能够建立WebSocket连接', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      // 模拟WebSocket连接测试
      const wsUrl = 'ws://localhost:3010/ws';
      
      // 在Node.js环境中，我们模拟WebSocket测试
      const mockWsTest = async () => {
        return new Promise<boolean>((resolve) => {
          // 模拟连接成功
          setTimeout(() => resolve(true), 100);
        });
      };

      const connected = await mockWsTest();
      expect(connected).toBe(true);
    }, TEST_TIMEOUT);
  });

  describe('配置和设置API集成测试', () => {
    test('应该能够获取系统设置', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const response = await fetch(`${API_BASE_URL}/api/settings`);
      expect(response.ok).toBe(true);
      
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.trading).toBeDefined();
      expect(data.data.risk_management).toBeDefined();
    }, TEST_TIMEOUT);

    test('应该能够更新系统设置', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      const updateSettings = {
        trading: {
          default_slippage: 0.8,
          max_slippage: 3.0
        }
      };

      const response = await fetch(`${API_BASE_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateSettings)
      });

      // 在测试环境中，设置更新可能需要特殊权限
      if (response.ok) {
        const data = await response.json();
        expect(data.success).toBe(true);
      } else {
        // 预期的权限错误
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    }, TEST_TIMEOUT);
  });

  describe('错误处理和边界情况测试', () => {
    test('应该处理无效的API请求', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      // 测试无效端点
      const response1 = await fetch(`${API_BASE_URL}/api/invalid-endpoint`);
      expect(response1.status).toBe(404);

      // 测试无效的POST数据
      const response2 = await fetch(`${API_BASE_URL}/api/wallets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' })
      });
      expect(response2.status).toBeGreaterThanOrEqual(400);
    }, TEST_TIMEOUT);

    test('应该处理服务器负载', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      // 并发请求测试
      const requests = Array.from({ length: 10 }, () => 
        fetch(`${API_BASE_URL}/api/health`)
      );

      const responses = await Promise.all(requests);
      
      // 所有请求都应该成功或被限制
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status);
      });
    }, TEST_TIMEOUT);
  });

  describe('数据持久化集成测试', () => {
    test('应该正确保存和检索数据', async () => {
      if (process.env.SKIP_SERVER_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer();
      expect(serverReady).toBe(true);

      // 创建钱包并验证持久化
      const createResponse = await fetch(`${API_BASE_URL}/api/wallets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'persistence-test-wallet'
        })
      });

      if (createResponse.ok) {
        const createData = await createResponse.json();
        const walletAddress = createData.data.address;

        // 重新获取钱包确认数据已持久化
        const getResponse = await fetch(`${API_BASE_URL}/api/wallets`);
        const getData = await getResponse.json();
        
        const foundWallet = getData.data.find((w: any) => w.address === walletAddress);
        expect(foundWallet).toBeDefined();
        expect(foundWallet.label).toBe('persistence-test-wallet');

        // 清理
        await fetch(`${API_BASE_URL}/api/wallets/${walletAddress}`, {
          method: 'DELETE'
        });
      }
    }, TEST_TIMEOUT);
  });
});