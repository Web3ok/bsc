"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const server_1 = require("../../src/server");
const wallet_1 = require("../../src/wallet");
function createMockResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}
(0, vitest_1.describe)('APIServer legacy handlers', () => {
    const server = new server_1.APIServer(0);
    const walletManager = wallet_1.WalletManager.getInstance();
    (0, vitest_1.beforeEach)(async () => {
        const wallets = [...walletManager.getAllWallets()];
        for (const wallet of wallets) {
            await walletManager.removeWallet(wallet.address);
        }
    });
    (0, vitest_1.test)('health handler exposes healthy status', () => {
        const handler = server.getLegacyHandler('GET', '/api/health');
        (0, vitest_1.expect)(handler).toBeDefined();
        const res = createMockResponse();
        handler({}, res, () => undefined);
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('healthy');
        (0, vitest_1.expect)(res.body.timestamp).toBeDefined();
    });
    (0, vitest_1.test)('wallet creation, listing, exporting and deletion via handlers', async () => {
        const createHandler = server.getLegacyHandler('POST', '/api/wallets/create');
        const listHandler = server.getLegacyHandler('GET', '/api/wallets');
        const exportHandler = server.getLegacyHandler('POST', '/api/wallets/export');
        const deleteHandler = server.getLegacyHandler('DELETE', '/api/wallets/:address');
        (0, vitest_1.expect)(createHandler && listHandler && exportHandler && deleteHandler).toBeTruthy();
        const createRes = createMockResponse();
        await createHandler({ body: { label: 'legacy-wallet', group: 'legacy' } }, createRes, () => undefined);
        (0, vitest_1.expect)(createRes.statusCode).toBe(200);
        (0, vitest_1.expect)(createRes.body.success).toBe(true);
        const createdAddress = createRes.body.data.address;
        const listRes = createMockResponse();
        listHandler({ query: {} }, listRes, () => undefined);
        (0, vitest_1.expect)(listRes.statusCode).toBe(200);
        (0, vitest_1.expect)(listRes.body.data.some((w) => w.address === createdAddress)).toBe(true);
        const exportRes = createMockResponse();
        await exportHandler({ body: { addresses: [createdAddress] } }, exportRes, () => undefined);
        (0, vitest_1.expect)(exportRes.body.data.wallets).toHaveLength(1);
        (0, vitest_1.expect)(exportRes.body.data.wallets[0].address).toBe(createdAddress);
        const deleteRes = createMockResponse();
        await deleteHandler({ params: { address: createdAddress } }, deleteRes, () => undefined);
        (0, vitest_1.expect)(deleteRes.statusCode).toBe(200);
        (0, vitest_1.expect)(deleteRes.body.success).toBe(true);
        const remaining = walletManager.getAllWallets();
        (0, vitest_1.expect)(remaining.some((wallet) => wallet.address === createdAddress)).toBe(false);
    });
    (0, vitest_1.test)('settings handler returns default configuration', () => {
        const handler = server.getLegacyHandler('GET', '/api/settings');
        (0, vitest_1.expect)(handler).toBeDefined();
        const res = createMockResponse();
        handler({}, res, () => undefined);
        (0, vitest_1.expect)(res.statusCode).toBe(200);
        (0, vitest_1.expect)(res.body.success).toBe(true);
        (0, vitest_1.expect)(res.body.data.trading).toBeDefined();
        (0, vitest_1.expect)(res.body.data.risk_management).toBeDefined();
    });
});
//# sourceMappingURL=server-legacy-handlers.test.js.map