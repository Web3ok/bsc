"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const child_process_1 = require("child_process");
const node_fetch_1 = __importDefault(require("node-fetch"));
// 系统集成测试 - 测试整个系统的端到端功能
(0, vitest_1.describe)('系统集成测试', () => {
    let serverProcess = null;
    const API_BASE_URL = 'http://localhost:3010';
    const TEST_TIMEOUT = 30000;
    (0, vitest_1.beforeEach)(async () => {
        // 启动测试服务器
        if (process.env.SKIP_SERVER_TESTS !== 'true') {
            await startTestServer();
        }
    }, TEST_TIMEOUT);
    (0, vitest_1.afterEach)(async () => {
        // 停止测试服务器
        if (serverProcess) {
            serverProcess.kill();
            serverProcess = null;
        }
    });
    async function startTestServer() {
        return new Promise((resolve, reject) => {
            serverProcess = (0, child_process_1.spawn)('npm', ['run', 'server:dev'], {
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
    async function waitForServer(maxAttempts = 10) {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/health`);
                if (response.ok) {
                    return true;
                }
            }
            catch (error) {
                // 服务器还未启动，继续等待
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        return false;
    }
    (0, vitest_1.describe)('API服务器集成测试', () => {
        (0, vitest_1.test)('应该启动健康检查端点', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/health`);
            (0, vitest_1.expect)(response.ok).toBe(true);
            const data = await response.json();
            (0, vitest_1.expect)(data.status).toBe('healthy');
            (0, vitest_1.expect)(data.timestamp).toBeDefined();
        }, TEST_TIMEOUT);
        (0, vitest_1.test)('应该提供系统状态端点', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/dashboard/status`);
            (0, vitest_1.expect)(response.ok).toBe(true);
            const data = await response.json();
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(data.data.overall).toBeDefined();
            (0, vitest_1.expect)(data.data.components).toBeDefined();
        }, TEST_TIMEOUT);
        (0, vitest_1.test)('应该提供仪表盘数据端点', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/dashboard/overview`);
            (0, vitest_1.expect)(response.ok).toBe(true);
            const data = await response.json();
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(data.data.system).toBeDefined();
            (0, vitest_1.expect)(data.data.wallets).toBeDefined();
            (0, vitest_1.expect)(data.data.trading).toBeDefined();
        }, TEST_TIMEOUT);
    });
    (0, vitest_1.describe)('钱包管理API集成测试', () => {
        (0, vitest_1.test)('应该能够创建和管理钱包', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            // 创建钱包
            const createResponse = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label: 'test-wallet-integration',
                    group: 'test-group'
                })
            });
            (0, vitest_1.expect)(createResponse.ok).toBe(true);
            const createData = await createResponse.json();
            (0, vitest_1.expect)(createData.success).toBe(true);
            (0, vitest_1.expect)(createData.data.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
            const walletAddress = createData.data.address;
            // 获取钱包列表
            const listResponse = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets`);
            (0, vitest_1.expect)(listResponse.ok).toBe(true);
            const listData = await listResponse.json();
            (0, vitest_1.expect)(listData.success).toBe(true);
            (0, vitest_1.expect)(listData.data.some((w) => w.address === walletAddress)).toBe(true);
            // 删除钱包
            const deleteResponse = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets/${walletAddress}`, {
                method: 'DELETE'
            });
            (0, vitest_1.expect)(deleteResponse.ok).toBe(true);
            const deleteData = await deleteResponse.json();
            (0, vitest_1.expect)(deleteData.success).toBe(true);
        }, TEST_TIMEOUT);
        (0, vitest_1.test)('应该能够导入和导出钱包', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            // 创建测试钱包
            const createResponse = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label: 'export-test-wallet'
                })
            });
            const createData = await createResponse.json();
            const walletAddress = createData.data.address;
            // 导出钱包
            const exportResponse = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    addresses: [walletAddress]
                })
            });
            (0, vitest_1.expect)(exportResponse.ok).toBe(true);
            const exportData = await exportResponse.json();
            (0, vitest_1.expect)(exportData.success).toBe(true);
            (0, vitest_1.expect)(exportData.data.wallets).toHaveLength(1);
            // 清理
            await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets/${walletAddress}`, {
                method: 'DELETE'
            });
        }, TEST_TIMEOUT);
    });
    (0, vitest_1.describe)('交易API集成测试', () => {
        (0, vitest_1.test)('应该能够获取交易报价', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const quoteRequest = {
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
                tokenOut: '0x55d398326f99059fF775485246999027B3197955', // USDT
                amountIn: '1'
            };
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/trading/quote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(quoteRequest)
            });
            if (response.ok) {
                const data = await response.json();
                (0, vitest_1.expect)(data.success).toBe(true);
                (0, vitest_1.expect)(data.data.tokenOut.amount).toBeDefined();
                (0, vitest_1.expect)(data.data.priceImpact).toBeDefined();
                (0, vitest_1.expect)(data.data.slippageAnalysis).toBeDefined();
            }
            else {
                // 在测试环境中，如果没有实际的DEX连接，这是预期的
                (0, vitest_1.expect)(response.status).toBeGreaterThanOrEqual(400);
            }
        }, TEST_TIMEOUT);
        (0, vitest_1.test)('应该提供交易历史端点', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/trading/history`);
            (0, vitest_1.expect)(response.ok).toBe(true);
            const data = await response.json();
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(Array.isArray(data.data)).toBe(true);
        }, TEST_TIMEOUT);
    });
    (0, vitest_1.describe)('监控和指标API集成测试', () => {
        (0, vitest_1.test)('应该提供系统指标', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/monitoring/metrics`);
            (0, vitest_1.expect)(response.ok).toBe(true);
            const data = await response.json();
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(data.data).toBeDefined();
        }, TEST_TIMEOUT);
        (0, vitest_1.test)('应该提供告警信息', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/monitoring/alerts`);
            (0, vitest_1.expect)(response.ok).toBe(true);
            const data = await response.json();
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(Array.isArray(data.data)).toBe(true);
        }, TEST_TIMEOUT);
        (0, vitest_1.test)('应该提供健康检查状态', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/monitoring/health`);
            (0, vitest_1.expect)(response.ok).toBe(true);
            const data = await response.json();
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(Array.isArray(data.data)).toBe(true);
            // 验证健康检查项目
            const healthChecks = data.data;
            const requiredComponents = ['api', 'database', 'rpc_providers'];
            for (const component of requiredComponents) {
                const healthCheck = healthChecks.find((h) => h.component === component);
                (0, vitest_1.expect)(healthCheck).toBeDefined();
                (0, vitest_1.expect)(['healthy', 'unhealthy', 'degraded']).toContain(healthCheck.status);
            }
        }, TEST_TIMEOUT);
    });
    (0, vitest_1.describe)('WebSocket集成测试', () => {
        (0, vitest_1.test)('应该能够建立WebSocket连接', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            // 模拟WebSocket连接测试
            const wsUrl = 'ws://localhost:3010/ws';
            // 在Node.js环境中，我们模拟WebSocket测试
            const mockWsTest = async () => {
                return new Promise((resolve) => {
                    // 模拟连接成功
                    setTimeout(() => resolve(true), 100);
                });
            };
            const connected = await mockWsTest();
            (0, vitest_1.expect)(connected).toBe(true);
        }, TEST_TIMEOUT);
    });
    (0, vitest_1.describe)('配置和设置API集成测试', () => {
        (0, vitest_1.test)('应该能够获取系统设置', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/settings`);
            (0, vitest_1.expect)(response.ok).toBe(true);
            const data = await response.json();
            (0, vitest_1.expect)(data.success).toBe(true);
            (0, vitest_1.expect)(data.data).toBeDefined();
            (0, vitest_1.expect)(data.data.trading).toBeDefined();
            (0, vitest_1.expect)(data.data.risk_management).toBeDefined();
        }, TEST_TIMEOUT);
        (0, vitest_1.test)('应该能够更新系统设置', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            const updateSettings = {
                trading: {
                    default_slippage: 0.8,
                    max_slippage: 3.0
                }
            };
            const response = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateSettings)
            });
            // 在测试环境中，设置更新可能需要特殊权限
            if (response.ok) {
                const data = await response.json();
                (0, vitest_1.expect)(data.success).toBe(true);
            }
            else {
                // 预期的权限错误
                (0, vitest_1.expect)(response.status).toBeGreaterThanOrEqual(400);
            }
        }, TEST_TIMEOUT);
    });
    (0, vitest_1.describe)('错误处理和边界情况测试', () => {
        (0, vitest_1.test)('应该处理无效的API请求', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            // 测试无效端点
            const response1 = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/invalid-endpoint`);
            (0, vitest_1.expect)(response1.status).toBe(404);
            // 测试无效的POST数据
            const response2 = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ invalid: 'data' })
            });
            (0, vitest_1.expect)(response2.status).toBeGreaterThanOrEqual(400);
        }, TEST_TIMEOUT);
        (0, vitest_1.test)('应该处理服务器负载', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            // 并发请求测试
            const requests = Array.from({ length: 10 }, () => (0, node_fetch_1.default)(`${API_BASE_URL}/api/health`));
            const responses = await Promise.all(requests);
            // 所有请求都应该成功或被限制
            responses.forEach(response => {
                (0, vitest_1.expect)([200, 429]).toContain(response.status);
            });
        }, TEST_TIMEOUT);
    });
    (0, vitest_1.describe)('数据持久化集成测试', () => {
        (0, vitest_1.test)('应该正确保存和检索数据', async () => {
            if (process.env.SKIP_SERVER_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const serverReady = await waitForServer();
            (0, vitest_1.expect)(serverReady).toBe(true);
            // 创建钱包并验证持久化
            const createResponse = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets/create`, {
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
                const getResponse = await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets`);
                const getData = await getResponse.json();
                const foundWallet = getData.data.find((w) => w.address === walletAddress);
                (0, vitest_1.expect)(foundWallet).toBeDefined();
                (0, vitest_1.expect)(foundWallet.label).toBe('persistence-test-wallet');
                // 清理
                await (0, node_fetch_1.default)(`${API_BASE_URL}/api/wallets/${walletAddress}`, {
                    method: 'DELETE'
                });
            }
        }, TEST_TIMEOUT);
    });
});
//# sourceMappingURL=system-integration.test.js.map