"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const crypto_1 = require("crypto");
const wallet_1 = require("../../src/wallet");
(0, vitest_1.describe)('WalletManager 核心功能测试', () => {
    let walletManager;
    const testPassword = 'test-encryption-password-123';
    (0, vitest_1.beforeEach)(() => {
        process.env.ENCRYPTION_PASSWORD = testPassword;
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'false';
        walletManager = new wallet_1.WalletManager();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.describe)('钱包创建', () => {
        (0, vitest_1.test)('应该能够创建新钱包', async () => {
            const wallet = await walletManager.createWallet('test-wallet');
            (0, vitest_1.expect)(wallet).toBeDefined();
            (0, vitest_1.expect)(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
            (0, vitest_1.expect)(wallet.label).toBe('test-wallet');
        });
        (0, vitest_1.test)('应该能够创建带组的钱包', async () => {
            const wallet = await walletManager.createWallet('test-wallet', 'test-group');
            (0, vitest_1.expect)(wallet.group).toBe('test-group');
        });
        (0, vitest_1.test)('不同钱包应该有不同的地址', async () => {
            const wallet1 = await walletManager.createWallet('wallet1');
            const wallet2 = await walletManager.createWallet('wallet2');
            (0, vitest_1.expect)(wallet1.address).not.toBe(wallet2.address);
        });
    });
    (0, vitest_1.describe)('钱包导入', () => {
        (0, vitest_1.test)('应该能够通过私钥导入钱包', async () => {
            const privateKey = '0x' + (0, crypto_1.randomBytes)(32).toString('hex');
            const wallet = await walletManager.importWallet(privateKey, 'imported-wallet');
            (0, vitest_1.expect)(wallet).toBeDefined();
            (0, vitest_1.expect)(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
            (0, vitest_1.expect)(wallet.label).toBe('imported-wallet');
        });
        (0, vitest_1.test)('导入相同私钥应该得到相同地址', async () => {
            const privateKey = '0x' + (0, crypto_1.randomBytes)(32).toString('hex');
            const wallet1 = await walletManager.importWallet(privateKey, 'wallet1');
            const wallet2 = await walletManager.importWallet(privateKey, 'wallet2', 'group2');
            (0, vitest_1.expect)(wallet1.address).toBe(wallet2.address);
        });
        (0, vitest_1.test)('无效私钥应该抛出错误', async () => {
            await (0, vitest_1.expect)(walletManager.importWallet('invalid-key', 'test')).rejects.toThrow();
        });
    });
    (0, vitest_1.describe)('钱包管理', () => {
        (0, vitest_1.test)('应该能够列出所有钱包', async () => {
            await walletManager.createWallet('wallet1');
            await walletManager.createWallet('wallet2', 'group1');
            const wallets = await walletManager.getAllWallets();
            (0, vitest_1.expect)(wallets).toHaveLength(2);
        });
        (0, vitest_1.test)('应该能够按组筛选钱包', async () => {
            await walletManager.createWallet('wallet1', 'group1');
            await walletManager.createWallet('wallet2', 'group1');
            await walletManager.createWallet('wallet3', 'group2');
            const group1Wallets = await walletManager.getWalletsByGroup('group1');
            (0, vitest_1.expect)(group1Wallets).toHaveLength(2);
            (0, vitest_1.expect)(group1Wallets.every(w => w.group === 'group1')).toBe(true);
        });
        (0, vitest_1.test)('应该能够删除钱包', async () => {
            const wallet = await walletManager.createWallet('test');
            await walletManager.deleteWallet(wallet.address);
            const wallets = await walletManager.getAllWallets();
            (0, vitest_1.expect)(wallets.find(w => w.address === wallet.address)).toBeUndefined();
        });
    });
    (0, vitest_1.describe)('钱包加密', () => {
        (0, vitest_1.test)('私钥应该被加密存储', async () => {
            const wallet = await walletManager.createWallet('test');
            // 私钥应该被加密，不应该是明文
            (0, vitest_1.expect)(wallet.encryptedPrivateKey).toBeDefined();
            (0, vitest_1.expect)(wallet.encryptedPrivateKey).not.toMatch(/^0x[a-fA-F0-9]{64}$/);
        });
        (0, vitest_1.test)('应该能够解密私钥', async () => {
            const wallet = await walletManager.createWallet('test');
            const decryptedKey = await walletManager.getPrivateKey(wallet.address);
            (0, vitest_1.expect)(decryptedKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
        });
        (0, vitest_1.test)('错误的加密密码应该无法解密', async () => {
            const wallet = await walletManager.createWallet('test');
            // 更改加密密码
            process.env.ENCRYPTION_PASSWORD = 'wrong-password';
            const newManager = new wallet_1.WalletManager();
            await (0, vitest_1.expect)(newManager.getPrivateKey(wallet.address)).rejects.toThrow();
        });
    });
});
//# sourceMappingURL=wallet-manager.test.js.map