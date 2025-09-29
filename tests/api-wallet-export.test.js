"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path_1 = __importDefault(require("path"));
const ethers_1 = require("ethers");
const executeBatchTradesMock = vitest_1.vi.fn();
vitest_1.vi.mock('../src/dex/multi-dex-aggregator', () => {
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
const batch_trading_api_1 = require("../src/api/batch-trading-api");
const wallet_1 = require("../src/wallet");
const loader_1 = require("../src/config/loader");
const router_test_utils_1 = require("./helpers/router-test-utils");
const tempDirs = [];
const originalPassword = process.env.ENCRYPTION_PASSWORD;
const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;
const originalTokens = process.env.API_TOKENS;
async function createTempDir(prefix) {
    const dir = await (0, promises_1.mkdtemp)(path_1.default.join((0, os_1.tmpdir)(), prefix));
    tempDirs.push(dir);
    return dir;
}
async function setupApiWithWallet() {
    wallet_1.WalletManager.instance = undefined;
    loader_1.ConfigLoader.instance = undefined;
    const storageDir = await createTempDir('wallet-api-export-');
    process.env.ENCRYPTION_PASSWORD = 'unit-test-password';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
    process.env.API_TOKENS = 'test-token';
    const manager = wallet_1.WalletManager.getInstance('unit-test-password');
    manager.storagePath = storageDir;
    const wallet = ethers_1.ethers.Wallet.createRandom();
    await manager.addWallet({
        address: wallet.address,
        privateKey: wallet.privateKey,
        createdAt: new Date(),
    });
    const api = new batch_trading_api_1.BatchTradingAPI();
    return { router: api.router, wallet };
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
(0, vitest_1.describe)('GET /api/batch/wallets/export', () => {
    (0, vitest_1.test)('rejects attempts to include private keys', async () => {
        const { router } = await setupApiWithWallet();
        const { res } = await (0, router_test_utils_1.invokeRoute)(router, '/wallets/export', {
            method: 'get',
            query: { includePrivateKeys: 'true' },
            headers: { authorization: 'Bearer test-token' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(403);
        (0, vitest_1.expect)(res.body?.message).toMatch(/Private key export is disabled/);
    });
    (0, vitest_1.test)('returns CSV without any private keys', async () => {
        const { router, wallet } = await setupApiWithWallet();
        const { res } = await (0, router_test_utils_1.invokeRoute)(router, '/wallets/export', {
            method: 'get',
            headers: { authorization: 'Bearer test-token' },
        });
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        (0, vitest_1.expect)(res.headers['content-type']).toMatch(/text\/csv/);
        const csvContent = res.body?.toString('utf8') || '';
        (0, vitest_1.expect)(csvContent.split('\n')[0]).toContain('address');
        (0, vitest_1.expect)(csvContent).not.toContain(wallet.privateKey);
        (0, vitest_1.expect)(csvContent).not.toContain(wallet.privateKey.replace('0x', ''));
    });
});
//# sourceMappingURL=api-wallet-export.test.js.map