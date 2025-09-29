"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForCondition = exports.delay = exports.createMockQuoteResult = exports.createMockTradeRequest = exports.createMockWallet = void 0;
const vitest_1 = require("vitest");
// 全局测试设置
(0, vitest_1.beforeAll)(() => {
    // 设置测试环境变量
    process.env.NODE_ENV = 'test';
    process.env.ENCRYPTION_PASSWORD = 'test-password-123';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
    // 设置测试数据库（如果需要）
    process.env.DATABASE_URL = ':memory:';
    // 禁用某些功能在测试中的执行
    process.env.SKIP_BLOCKCHAIN_TESTS = 'true';
    process.env.SKIP_SERVER_TESTS = 'false';
    process.env.SKIP_E2E_TESTS = 'false';
    // Mock console methods to reduce noise in tests
    vitest_1.vi.spyOn(console, 'log').mockImplementation(() => { });
    vitest_1.vi.spyOn(console, 'info').mockImplementation(() => { });
    vitest_1.vi.spyOn(console, 'warn').mockImplementation(() => { });
    // Keep error and debug for troubleshooting
    // vi.spyOn(console, 'error').mockImplementation(() => {});
    // vi.spyOn(console, 'debug').mockImplementation(() => {});
});
(0, vitest_1.afterAll)(() => {
    // 清理测试环境
    vitest_1.vi.restoreAllMocks();
});
// 全局测试工具函数
const createMockWallet = () => ({
    address: '0x1234567890123456789012345678901234567890',
    label: 'Test Wallet',
    group: 'test',
    balance: '1.0',
    nonce: 0,
    status: 'active',
    transactions24h: 0,
    lastActivity: new Date().toISOString(),
    tokenBalances: [],
    encryptedPrivateKey: 'encrypted_test_key'
});
exports.createMockWallet = createMockWallet;
const createMockTradeRequest = () => ({
    type: 'buy',
    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
    amountIn: '1',
    slippage: 0.5,
    walletAddress: '0x1234567890123456789012345678901234567890'
});
exports.createMockTradeRequest = createMockTradeRequest;
const createMockQuoteResult = () => ({
    tokenIn: {
        address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        symbol: 'WBNB',
        amount: '1'
    },
    tokenOut: {
        address: '0x55d398326f99059fF775485246999027B3197955',
        symbol: 'USDT',
        amount: '300'
    },
    priceImpact: {
        impact: 0.15,
        category: 'low'
    },
    slippageAnalysis: {
        recommendedSlippage: 0.5,
        reason: 'Low volatility pair'
    },
    minimumReceived: '297',
    executionPrice: '300',
    gasEstimate: '150000',
    totalCostBNB: '0.0075',
    recommendation: 'proceed'
});
exports.createMockQuoteResult = createMockQuoteResult;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
exports.delay = delay;
const waitForCondition = async (condition, timeout = 5000, interval = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await condition()) {
            return;
        }
        await (0, exports.delay)(interval);
    }
    throw new Error(`Condition not met within ${timeout}ms`);
};
exports.waitForCondition = waitForCondition;
//# sourceMappingURL=setup.js.map