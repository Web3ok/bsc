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
const wallet_1 = require("../src/wallet");
const batch_wallet_manager_1 = require("../src/wallet/batch-wallet-manager");
const originalPassword = process.env.ENCRYPTION_PASSWORD;
const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;
const tempDirs = [];
async function createWalletManagerWithTempStorage() {
    const tempDir = await (0, promises_1.mkdtemp)(path_1.default.join((0, os_1.tmpdir)(), 'wallet-export-'));
    tempDirs.push(tempDir);
    const manager = new wallet_1.WalletManager('unit-test-password');
    manager.storagePath = tempDir;
    return { manager, tempDir };
}
(0, vitest_1.describe)('Wallet CSV export safeguards', () => {
    (0, vitest_1.beforeEach)(() => {
        process.env.ENCRYPTION_PASSWORD = 'unit-test-password';
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.ENCRYPTION_PASSWORD = originalPassword;
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir) {
                await (0, promises_1.rm)(dir, { recursive: true, force: true });
            }
        }
    });
    (0, vitest_1.test)('WalletManager blocks private key export attempts', async () => {
        const { manager } = await createWalletManagerWithTempStorage();
        await (0, vitest_1.expect)(manager.exportToCSV({ includePrivateKeys: true })).rejects.toThrowError(/Private key export is permanently disabled/);
    });
    (0, vitest_1.test)('BatchWalletManager blocks private key export attempts', async () => {
        const { manager, tempDir } = await createWalletManagerWithTempStorage();
        const batchManager = new batch_wallet_manager_1.BatchWalletManager(manager);
        const exportPath = path_1.default.join(tempDir, 'batch-wallets.csv');
        await (0, vitest_1.expect)(batchManager.exportWalletsToCSV(exportPath, { includePrivateKeys: true })).rejects.toThrowError(/Private key export is permanently disabled/);
    });
    (0, vitest_1.test)('WalletManager CSV export omits private keys from output file', async () => {
        const { manager } = await createWalletManagerWithTempStorage();
        const wallet = ethers_1.ethers.Wallet.createRandom();
        await manager.addWallet({
            address: wallet.address,
            privateKey: wallet.privateKey,
            createdAt: new Date(),
        });
        const filePath = await manager.exportToCSV({ includePrivateKeys: false });
        const csvContent = await (0, promises_1.readFile)(filePath, 'utf8');
        (0, vitest_1.expect)(csvContent.startsWith('Address,Derivation Index,Label,Group,Created At')).toBe(true);
        (0, vitest_1.expect)(csvContent).not.toContain(wallet.privateKey);
        (0, vitest_1.expect)(csvContent).not.toContain(wallet.privateKey.replace('0x', ''));
    });
});
//# sourceMappingURL=wallet-export.test.js.map