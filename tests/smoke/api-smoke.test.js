"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
const executeBatchTradesMock = vitest_1.vi.fn();
vitest_1.vi.mock('../../src/dex/multi-dex-aggregator', () => {
    class MockMultiDEXAggregator {
        getSupportedDEXes = vitest_1.vi.fn(() => ['pancakeswap-v2']);
        getDEXHealthStatus = vitest_1.vi.fn(async () => ({ overall: 'healthy', dexes: {} }));
        getBestQuote = vitest_1.vi.fn();
        executeBatchTrades = executeBatchTradesMock;
    }
    return {
        MultiDEXAggregator: MockMultiDEXAggregator,
        DEXType: { PANCAKESWAP_V2: 'pancakeswap-v2' },
    };
});
const batch_trading_api_1 = require("../../src/api/batch-trading-api");
const wallet_1 = require("../../src/wallet");
const loader_1 = require("../../src/config/loader");
const router_test_utils_1 = require("../helpers/router-test-utils");
const tempDirs = [];
const originalPassword = process.env.ENCRYPTION_PASSWORD;
const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;
const originalTokens = process.env.API_TOKENS;
async function createTempDir(prefix) {
    const dir = await (0, promises_1.mkdtemp)(path_1.default.join((0, os_1.tmpdir)(), prefix));
    tempDirs.push(dir);
    return dir;
}
async function setupApi() {
    wallet_1.WalletManager.instance = undefined;
    loader_1.ConfigLoader.instance = undefined;
    const storageDir = await createTempDir('wallet-smoke-');
    process.env.ENCRYPTION_PASSWORD = 'unit-test-password';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
    process.env.API_TOKENS = 'test-token';
    const manager = wallet_1.WalletManager.getInstance('unit-test-password');
    manager.storagePath = storageDir;
    const api = new batch_trading_api_1.BatchTradingAPI();
    return { router: api.router, manager };
}
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
    executeBatchTradesMock.mockReset();
});
(0, vitest_1.afterEach)(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            await (0, promises_1.rm)(dir, { recursive: true, force: true });
        }
    }
    process.env.ENCRYPTION_PASSWORD = originalPassword;
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;
    process.env.API_TOKENS = originalTokens;
    wallet_1.WalletManager.instance = undefined;
    loader_1.ConfigLoader.instance = undefined;
});
(0, vitest_1.describe)('API smoke flow', () => {
    (0, vitest_1.test)('generates wallets, exports CSV, and triggers batch trade', async () => {
        const { router, manager } = await setupApi();
        executeBatchTradesMock.mockResolvedValue({
            success: true,
            completedTrades: 1,
            totalTrades: 1,
            results: [
                {
                    success: true,
                    txHash: '0xmockhash',
                    dexUsed: 'pancakeswap-v2',
                    amountOut: '100',
                    gasUsed: '21000',
                },
            ],
            totalGasUsed: '21000',
            totalValue: '0',
        });
        const generateResponse = await (0, router_test_utils_1.invokeRoute)(router, '/wallets/generate', {
            method: 'post',
            headers: { authorization: 'Bearer test-token' },
            body: { count: 2, aliasPrefix: 'Smoke' },
        });
        (0, vitest_1.expect)(generateResponse.res.statusCode).toBe(200);
        (0, vitest_1.expect)(generateResponse.res.body?.success).toBe(true);
        (0, vitest_1.expect)(generateResponse.res.body?.data?.processed).toBe(2);
        const storedWallets = manager.getAllWallets();
        (0, vitest_1.expect)(storedWallets.length).toBe(2);
        const exportResponse = await (0, router_test_utils_1.invokeRoute)(router, '/wallets/export', {
            method: 'get',
            headers: { authorization: 'Bearer test-token' },
        });
        (0, vitest_1.expect)(exportResponse.res.statusCode).toBe(200);
        (0, vitest_1.expect)(exportResponse.res.headers['content-type']).toMatch(/text\/csv/);
        const csvContent = exportResponse.res.body?.toString('utf8') || '';
        for (const wallet of storedWallets) {
            (0, vitest_1.expect)(csvContent).toContain(wallet.address);
            (0, vitest_1.expect)(csvContent).not.toContain(wallet.privateKey);
        }
        const tradeRequest = {
            walletAddress: storedWallets[0].address,
            trades: [
                {
                    tokenIn: '0x0000000000000000000000000000000000000001',
                    tokenOut: '0x0000000000000000000000000000000000000002',
                    amountIn: '1.0',
                    slippage: 0.5,
                },
            ],
            maxGasPrice: 5,
            deadline: 180,
        };
        const tradeResponse = await (0, router_test_utils_1.invokeRoute)(router, '/batch/trades', {
            method: 'post',
            headers: { authorization: 'Bearer test-token' },
            body: tradeRequest,
        });
        (0, vitest_1.expect)(tradeResponse.res.statusCode).toBe(200);
        (0, vitest_1.expect)(tradeResponse.res.body?.success).toBe(true);
        (0, vitest_1.expect)(tradeResponse.res.body?.data?.completedTrades).toBe(1);
        (0, vitest_1.expect)(executeBatchTradesMock).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(executeBatchTradesMock).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            walletAddress: tradeRequest.walletAddress,
            trades: tradeRequest.trades,
        }));
    });
    (0, vitest_1.test)('surfaces batch trade failures with helpful error message', async () => {
        const { router, manager } = await setupApi();
        executeBatchTradesMock.mockRejectedValue(new Error('aggregator offline'));
        const generateResponse = await (0, router_test_utils_1.invokeRoute)(router, '/wallets/generate', {
            method: 'post',
            headers: { authorization: 'Bearer test-token' },
            body: { count: 1 },
        });
        (0, vitest_1.expect)(generateResponse.res.statusCode).toBe(200);
        const [wallet] = manager.getAllWallets();
        (0, vitest_1.expect)(wallet).toBeDefined();
        const tradeBody = {
            walletAddress: wallet.address,
            trades: [
                {
                    tokenIn: '0x0000000000000000000000000000000000000001',
                    tokenOut: '0x0000000000000000000000000000000000000002',
                    amountIn: '1.0',
                },
            ],
            maxGasPrice: 5,
            deadline: 120,
        };
        const tradeResponse = await (0, router_test_utils_1.invokeRoute)(router, '/batch/trades', {
            method: 'post',
            headers: { authorization: 'Bearer test-token' },
            body: tradeBody,
        });
        (0, vitest_1.expect)(tradeResponse.res.statusCode).toBe(500);
        (0, vitest_1.expect)(tradeResponse.res.body?.success).toBe(false);
        (0, vitest_1.expect)(tradeResponse.res.body?.message).toBe('Failed to execute batch trades');
        (0, vitest_1.expect)(tradeResponse.res.body?.error).toContain('aggregator offline');
        (0, vitest_1.expect)(executeBatchTradesMock).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=api-smoke.test.js.map