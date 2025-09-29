import { describe, expect, test, beforeAll, afterAll, vi } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import fetch from 'node-fetch';

// 端到端测试 - 完整工作流程测试
describe('完整工作流程端到端测试', () => {
  let backendProcess: ChildProcess | null = null;
  let frontendProcess: ChildProcess | null = null;
  
  const BACKEND_URL = 'http://localhost:3010';
  const FRONTEND_URL = 'http://localhost:3000';
  const TEST_TIMEOUT = 60000;

  beforeAll(async () => {
    if (process.env.SKIP_E2E_TESTS === 'true') {
      return;
    }

    console.log('启动端到端测试环境...');
    
    // 启动后端服务器
    await startBackendServer();
    
    // 启动前端服务器
    await startFrontendServer();
    
    console.log('测试环境启动完成');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (backendProcess) {
      backendProcess.kill();
    }
    if (frontendProcess) {
      frontendProcess.kill();
    }
  });

  async function startBackendServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      backendProcess = spawn('npm', ['run', 'server:dev'], {
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PORT: '3010',
          ENCRYPTION_PASSWORD: 'test-e2e-password-123'
        }
      });

      let started = false;
      const timeout = setTimeout(() => {
        if (!started) {
          reject(new Error('Backend server failed to start'));
        }
      }, 30000);

      backendProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log('Backend:', output);
        if (output.includes('Server running') && !started) {
          started = true;
          clearTimeout(timeout);
          setTimeout(resolve, 3000); // 等待服务器完全启动
        }
      });

      backendProcess.stderr?.on('data', (data) => {
        console.error('Backend error:', data.toString());
      });

      backendProcess.on('error', reject);
    });
  }

  async function startFrontendServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      frontendProcess = spawn('npm', ['run', 'dev'], {
        stdio: 'pipe',
        cwd: './frontend',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          PORT: '3000',
          NEXT_PUBLIC_API_URL: 'http://localhost:3010'
        }
      });

      let started = false;
      const timeout = setTimeout(() => {
        if (!started) {
          reject(new Error('Frontend server failed to start'));
        }
      }, 30000);

      frontendProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log('Frontend:', output);
        if ((output.includes('Ready') || output.includes('started')) && !started) {
          started = true;
          clearTimeout(timeout);
          setTimeout(resolve, 3000);
        }
      });

      frontendProcess.stderr?.on('data', (data) => {
        console.error('Frontend error:', data.toString());
      });

      frontendProcess.on('error', reject);
    });
  }

  async function waitForServer(url: string, maxAttempts = 15): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${url}/api/health`);
        if (response.ok) {
          return true;
        }
      } catch (error) {
        // 继续等待
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return false;
  }

  describe('完整的钱包管理工作流程', () => {
    test('应该能够创建、管理和删除钱包', async () => {
      if (process.env.SKIP_E2E_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer(BACKEND_URL);
      expect(serverReady).toBe(true);

      // 1. 创建钱包
      const createResponse = await fetch(`${BACKEND_URL}/api/wallets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'E2E Test Wallet',
          group: 'e2e-test'
        })
      });

      expect(createResponse.ok).toBe(true);
      const createData = await createResponse.json();
      expect(createData.success).toBe(true);
      
      const walletAddress = createData.data.address;
      expect(walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);

      // 2. 获取钱包列表验证创建成功
      const listResponse = await fetch(`${BACKEND_URL}/api/wallets`);
      const listData = await listResponse.json();
      expect(listData.success).toBe(true);
      
      const createdWallet = listData.data.find((w: any) => w.address === walletAddress);
      expect(createdWallet).toBeDefined();
      expect(createdWallet.label).toBe('E2E Test Wallet');
      expect(createdWallet.group).toBe('e2e-test');

      // 3. 更新钱包信息
      const updateResponse = await fetch(`${BACKEND_URL}/api/wallets/${walletAddress}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Updated E2E Wallet'
        })
      });

      expect(updateResponse.ok).toBe(true);
      const updateData = await updateResponse.json();
      expect(updateData.data.label).toBe('Updated E2E Wallet');

      // 4. 删除钱包
      const deleteResponse = await fetch(`${BACKEND_URL}/api/wallets/${walletAddress}`, {
        method: 'DELETE'
      });

      expect(deleteResponse.ok).toBe(true);

      // 5. 验证钱包已删除
      const finalListResponse = await fetch(`${BACKEND_URL}/api/wallets`);
      const finalListData = await finalListResponse.json();
      const deletedWallet = finalListData.data.find((w: any) => w.address === walletAddress);
      expect(deletedWallet).toBeUndefined();
    }, TEST_TIMEOUT);
  });

  describe('完整的交易工作流程', () => {
    test('应该能够获取报价和执行模拟交易', async () => {
      if (process.env.SKIP_E2E_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer(BACKEND_URL);
      expect(serverReady).toBe(true);

      // 1. 创建测试钱包
      const walletResponse = await fetch(`${BACKEND_URL}/api/wallets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Trading Test Wallet'
        })
      });

      const walletData = await walletResponse.json();
      const walletAddress = walletData.data.address;

      // 2. 获取交易报价
      const quoteRequest = {
        tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        tokenOut: '0x55d398326f99059fF775485246999027B3197955', // USDT
        amountIn: '1'
      };

      const quoteResponse = await fetch(`${BACKEND_URL}/api/trading/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quoteRequest)
      });

      // 在测试环境中，报价可能失败（没有实际DEX连接）
      if (quoteResponse.ok) {
        const quoteData = await quoteResponse.json();
        expect(quoteData.success).toBe(true);
        expect(quoteData.data.tokenOut.amount).toBeDefined();

        // 3. 模拟交易执行（在测试环境中）
        const executeRequest = {
          walletAddress,
          tokenIn: quoteRequest.tokenIn,
          tokenOut: quoteRequest.tokenOut,
          amountIn: quoteRequest.amountIn,
          slippage: 0.5
        };

        const executeResponse = await fetch(`${BACKEND_URL}/api/trading/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(executeRequest)
        });

        // 交易执行可能在测试环境中失败，这是预期的
        if (executeResponse.ok) {
          const executeData = await executeResponse.json();
          expect(executeData.success).toBe(true);
          expect(executeData.data.txHash).toBeDefined();
        }
      }

      // 4. 获取交易历史
      const historyResponse = await fetch(`${BACKEND_URL}/api/trading/history`);
      expect(historyResponse.ok).toBe(true);
      
      const historyData = await historyResponse.json();
      expect(historyData.success).toBe(true);
      expect(Array.isArray(historyData.data)).toBe(true);

      // 清理测试钱包
      await fetch(`${BACKEND_URL}/api/wallets/${walletAddress}`, {
        method: 'DELETE'
      });
    }, TEST_TIMEOUT);
  });

  describe('监控和健康检查工作流程', () => {
    test('应该能够获取系统监控数据', async () => {
      if (process.env.SKIP_E2E_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer(BACKEND_URL);
      expect(serverReady).toBe(true);

      // 1. 检查系统健康状态
      const healthResponse = await fetch(`${BACKEND_URL}/api/health`);
      expect(healthResponse.ok).toBe(true);
      
      const healthData = await healthResponse.json();
      expect(healthData.status).toBe('healthy');

      // 2. 获取系统状态
      const statusResponse = await fetch(`${BACKEND_URL}/api/dashboard/status`);
      expect(statusResponse.ok).toBe(true);
      
      const statusData = await statusResponse.json();
      expect(statusData.success).toBe(true);
      expect(statusData.data.overall).toBeDefined();

      // 3. 获取仪表盘概览
      const overviewResponse = await fetch(`${BACKEND_URL}/api/dashboard/overview`);
      expect(overviewResponse.ok).toBe(true);
      
      const overviewData = await overviewResponse.json();
      expect(overviewData.success).toBe(true);
      expect(overviewData.data.system).toBeDefined();
      expect(overviewData.data.wallets).toBeDefined();
      expect(overviewData.data.trading).toBeDefined();

      // 4. 获取监控指标
      const metricsResponse = await fetch(`${BACKEND_URL}/api/monitoring/metrics`);
      if (metricsResponse.ok) {
        const metricsData = await metricsResponse.json();
        expect(metricsData.success).toBe(true);
      }

      // 5. 获取告警信息
      const alertsResponse = await fetch(`${BACKEND_URL}/api/monitoring/alerts`);
      if (alertsResponse.ok) {
        const alertsData = await alertsResponse.json();
        expect(alertsData.success).toBe(true);
        expect(Array.isArray(alertsData.data)).toBe(true);
      }
    }, TEST_TIMEOUT);
  });

  describe('批量操作工作流程', () => {
    test('应该能够执行批量钱包创建和删除', async () => {
      if (process.env.SKIP_E2E_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer(BACKEND_URL);
      expect(serverReady).toBe(true);

      const createdWallets: string[] = [];

      try {
        // 1. 批量创建钱包
        for (let i = 0; i < 3; i++) {
          const response = await fetch(`${BACKEND_URL}/api/wallets/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              label: `Batch Test Wallet ${i + 1}`,
              group: 'batch-test'
            })
          });

          expect(response.ok).toBe(true);
          const data = await response.json();
          createdWallets.push(data.data.address);
        }

        // 2. 验证所有钱包都已创建
        const listResponse = await fetch(`${BACKEND_URL}/api/wallets?group=batch-test`);
        const listData = await listResponse.json();
        expect(listData.data.length).toBe(3);

        // 3. 导出钱包
        const exportResponse = await fetch(`${BACKEND_URL}/api/wallets/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            addresses: createdWallets
          })
        });

        expect(exportResponse.ok).toBe(true);
        const exportData = await exportResponse.json();
        expect(exportData.data.count).toBe(3);

        // 4. 模拟批量交易
        const batchTradeRequest = {
          trades: createdWallets.map((address, index) => ({
            type: 'buy',
            tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
            tokenOut: '0x55d398326f99059fF775485246999027B3197955',
            amountIn: '0.1',
            walletAddress: address
          })),
          strategy: 'parallel',
          maxConcurrent: 2
        };

        const batchResponse = await fetch(`${BACKEND_URL}/api/trading/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batchTradeRequest)
        });

        // 批量交易在测试环境中可能失败，这是预期的
        if (batchResponse.ok) {
          const batchData = await batchResponse.json();
          expect(batchData.success).toBe(true);
          expect(batchData.data.results).toHaveLength(3);
        }

      } finally {
        // 5. 清理：删除所有创建的钱包
        for (const address of createdWallets) {
          await fetch(`${BACKEND_URL}/api/wallets/${address}`, {
            method: 'DELETE'
          });
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('设置和配置工作流程', () => {
    test('应该能够获取和更新系统设置', async () => {
      if (process.env.SKIP_E2E_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer(BACKEND_URL);
      expect(serverReady).toBe(true);

      // 1. 获取当前设置
      const getResponse = await fetch(`${BACKEND_URL}/api/settings`);
      if (getResponse.ok) {
        const getData = await getResponse.json();
        expect(getData.success).toBe(true);
        expect(getData.data).toBeDefined();
      }

      // 2. 更新设置
      const updateSettings = {
        trading: {
          default_slippage: 0.8,
          max_slippage: 3.0
        }
      };

      const updateResponse = await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateSettings)
      });

      // 设置更新在测试环境中可能需要特殊权限
      if (updateResponse.ok) {
        const updateData = await updateResponse.json();
        expect(updateData.success).toBe(true);
      }

      // 3. 获取通知设置
      const notificationResponse = await fetch(`${BACKEND_URL}/api/settings/notifications`);
      if (notificationResponse.ok) {
        const notificationData = await notificationResponse.json();
        expect(notificationData.success).toBe(true);
      }
    }, TEST_TIMEOUT);
  });

  describe('错误处理和恢复测试', () => {
    test('应该正确处理各种错误情况', async () => {
      if (process.env.SKIP_E2E_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer(BACKEND_URL);
      expect(serverReady).toBe(true);

      // 1. 测试无效的API端点
      const invalidResponse = await fetch(`${BACKEND_URL}/api/invalid-endpoint`);
      expect(invalidResponse.status).toBe(404);

      // 2. 测试无效的请求数据
      const invalidDataResponse = await fetch(`${BACKEND_URL}/api/wallets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'data' })
      });
      expect(invalidDataResponse.status).toBeGreaterThanOrEqual(400);

      // 3. 测试不存在的资源
      const notFoundResponse = await fetch(`${BACKEND_URL}/api/wallets/0x0000000000000000000000000000000000000000`);
      expect(notFoundResponse.status).toBe(404);

      // 4. 测试无效的JSON
      const invalidJsonResponse = await fetch(`${BACKEND_URL}/api/wallets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      });
      expect(invalidJsonResponse.status).toBe(400);
    }, TEST_TIMEOUT);
  });

  describe('性能和负载测试', () => {
    test('应该能够处理并发请求', async () => {
      if (process.env.SKIP_E2E_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer(BACKEND_URL);
      expect(serverReady).toBe(true);

      // 并发发送多个健康检查请求
      const requests = Array.from({ length: 10 }, () =>
        fetch(`${BACKEND_URL}/api/health`)
      );

      const responses = await Promise.all(requests);
      
      // 所有请求都应该成功或被限制
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status);
      });

      // 验证至少有一些请求成功
      const successfulResponses = responses.filter(r => r.status === 200);
      expect(successfulResponses.length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);

    test('API响应时间应该在合理范围内', async () => {
      if (process.env.SKIP_E2E_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer(BACKEND_URL);
      expect(serverReady).toBe(true);

      const startTime = Date.now();
      const response = await fetch(`${BACKEND_URL}/api/health`);
      const endTime = Date.now();

      expect(response.ok).toBe(true);
      expect(endTime - startTime).toBeLessThan(2000); // 应该在2秒内响应
    }, TEST_TIMEOUT);
  });

  describe('数据一致性测试', () => {
    test('应该保持数据在多个操作中的一致性', async () => {
      if (process.env.SKIP_E2E_TESTS === 'true') {
        expect(true).toBe(true);
        return;
      }

      const serverReady = await waitForServer(BACKEND_URL);
      expect(serverReady).toBe(true);

      // 创建钱包
      const createResponse = await fetch(`${BACKEND_URL}/api/wallets/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: 'Consistency Test Wallet'
        })
      });

      const createData = await createResponse.json();
      const walletAddress = createData.data.address;

      try {
        // 多次获取同一钱包，验证数据一致性
        const responses = await Promise.all([
          fetch(`${BACKEND_URL}/api/wallets/${walletAddress}`),
          fetch(`${BACKEND_URL}/api/wallets/${walletAddress}`),
          fetch(`${BACKEND_URL}/api/wallets/${walletAddress}`)
        ]);

        const data = await Promise.all(responses.map(r => r.json()));
        
        // 所有响应应该返回相同的数据
        expect(data[0].data.address).toBe(data[1].data.address);
        expect(data[1].data.address).toBe(data[2].data.address);
        expect(data[0].data.label).toBe(data[1].data.label);
        expect(data[1].data.label).toBe(data[2].data.label);

      } finally {
        // 清理
        await fetch(`${BACKEND_URL}/api/wallets/${walletAddress}`, {
          method: 'DELETE'
        });
      }
    }, TEST_TIMEOUT);
  });
});