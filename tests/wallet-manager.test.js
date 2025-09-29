"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const wallet_1 = require("../src/wallet");
const os_1 = require("os");
const path_1 = require("path");
const promises_1 = require("fs/promises");
(0, vitest_1.describe)('WalletManager 实际功能测试', () => {
    let walletManager;
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        // 创建临时目录用于测试
        tempDir = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'wallet-test-'));
        // 设置测试环境变量
        process.env.ENCRYPTION_PASSWORD = 'test-password-123';
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
        walletManager = new wallet_1.WalletManager('test-password-123');
    });
    (0, vitest_1.afterEach)(async () => {
        // 清理临时目录
        try {
            await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
        }
        catch (error) {
            // 忽略清理错误
        }
    });
    (0, vitest_1.describe)('助记词生成', () => {
        (0, vitest_1.test)('应该能够生成有效的助记词', async () => {
            const mnemonic = await walletManager.generateMnemonic();
            (0, vitest_1.expect)(mnemonic).toBeDefined();
            (0, vitest_1.expect)(typeof mnemonic).toBe('string');
            // 助记词应该包含12个或更多单词
            const words = mnemonic.split(' ');
            (0, vitest_1.expect)(words.length).toBeGreaterThanOrEqual(12);
        });
    });
    (0, vitest_1.describe)('钱包生成', () => {
        (0, vitest_1.test)('应该能够生成指定数量的钱包', async () => {
            const wallets = await walletManager.generateWallets(3);
            (0, vitest_1.expect)(wallets).toHaveLength(3);
            (0, vitest_1.expect)(wallets[0].address).toMatch(/^0x[a-fA-F0-9]{40}$/);
            (0, vitest_1.expect)(wallets[0].privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
            (0, vitest_1.expect)(wallets[0].derivationIndex).toBeDefined();
            (0, vitest_1.expect)(wallets[0].createdAt).toBeInstanceOf(Date);
        });
        (0, vitest_1.test)('应该能够为钱包指定组', async () => {
            const testGroup = 'test-group';
            const wallets = await walletManager.generateWallets(2, undefined, 0, testGroup);
            (0, vitest_1.expect)(wallets[0].group).toBe(testGroup);
            (0, vitest_1.expect)(wallets[1].group).toBe(testGroup);
        });
        (0, vitest_1.test)('生成的钱包应该有不同的地址', async () => {
            const wallets = await walletManager.generateWallets(3);
            const addresses = wallets.map(w => w.address);
            const uniqueAddresses = new Set(addresses);
            (0, vitest_1.expect)(uniqueAddresses.size).toBe(3);
        });
    });
    (0, vitest_1.describe)('钱包导入', () => {
        (0, vitest_1.test)('应该能够导入有效的私钥', async () => {
            const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
            const wallet = await walletManager.importWallet(testPrivateKey, 'imported-wallet', 'imported-group');
            (0, vitest_1.expect)(wallet.privateKey).toBe(testPrivateKey);
            (0, vitest_1.expect)(wallet.label).toBe('imported-wallet');
            (0, vitest_1.expect)(wallet.group).toBe('imported-group');
            (0, vitest_1.expect)(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        });
        (0, vitest_1.test)('应该拒绝重复导入同一个钱包', async () => {
            const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
            await walletManager.importWallet(testPrivateKey, 'wallet1');
            await (0, vitest_1.expect)(walletManager.importWallet(testPrivateKey, 'wallet2')).rejects.toThrow('already exists');
        });
    });
    (0, vitest_1.describe)('钱包管理', () => {
        (0, vitest_1.test)('应该能够获取所有钱包', async () => {
            await walletManager.generateWallets(2);
            const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
            await walletManager.importWallet(testPrivateKey, 'imported');
            const allWallets = walletManager.getAllWallets();
            (0, vitest_1.expect)(allWallets).toHaveLength(3);
        });
        (0, vitest_1.test)('应该能够按组筛选钱包', async () => {
            await walletManager.generateWallets(2, undefined, 0, 'group1');
            await walletManager.generateWallets(1, undefined, 0, 'group2');
            const group1Wallets = walletManager.getWallets('group1');
            const group2Wallets = walletManager.getWallets('group2');
            (0, vitest_1.expect)(group1Wallets).toHaveLength(2);
            (0, vitest_1.expect)(group2Wallets).toHaveLength(1);
            (0, vitest_1.expect)(group1Wallets.every(w => w.group === 'group1')).toBe(true);
        });
        (0, vitest_1.test)('应该能够获取钱包总数', async () => {
            (0, vitest_1.expect)(walletManager.getWalletCount()).toBe(0);
            await walletManager.generateWallets(3);
            (0, vitest_1.expect)(walletManager.getWalletCount()).toBe(3);
        });
        (0, vitest_1.test)('应该能够获取所有组名', async () => {
            await walletManager.generateWallets(1, undefined, 0, 'group1');
            await walletManager.generateWallets(1, undefined, 0, 'group2');
            const groups = walletManager.getGroups();
            (0, vitest_1.expect)(groups).toContain('group1');
            (0, vitest_1.expect)(groups).toContain('group2');
            (0, vitest_1.expect)(groups).toHaveLength(2);
        });
    });
    (0, vitest_1.describe)('钱包标签系统', () => {
        (0, vitest_1.test)('应该能够为钱包添加和获取标签', async () => {
            const wallets = await walletManager.generateWallets(1);
            const address = wallets[0].address;
            await walletManager.addWalletTag(address, 'high-priority');
            await walletManager.addWalletTag(address, 'trading');
            const tags = walletManager.getWalletTags(address);
            (0, vitest_1.expect)(tags).toContain('high-priority');
            (0, vitest_1.expect)(tags).toContain('trading');
            (0, vitest_1.expect)(tags).toHaveLength(2);
        });
        (0, vitest_1.test)('应该能够按标签查找钱包', async () => {
            const wallets = await walletManager.generateWallets(2);
            await walletManager.addWalletTag(wallets[0].address, 'vip');
            await walletManager.addWalletTag(wallets[1].address, 'regular');
            const vipWallets = walletManager.getWalletsByTag('vip');
            (0, vitest_1.expect)(vipWallets).toHaveLength(1);
            (0, vitest_1.expect)(vipWallets[0].address).toBe(wallets[0].address);
        });
        (0, vitest_1.test)('应该能够移除钱包标签', async () => {
            const wallets = await walletManager.generateWallets(1);
            const address = wallets[0].address;
            await walletManager.addWalletTag(address, 'temp-tag');
            (0, vitest_1.expect)(walletManager.getWalletTags(address)).toContain('temp-tag');
            await walletManager.removeWalletTag(address, 'temp-tag');
            (0, vitest_1.expect)(walletManager.getWalletTags(address)).not.toContain('temp-tag');
        });
    });
    (0, vitest_1.describe)('批量私钥导入', () => {
        (0, vitest_1.test)('应该能够批量导入多个私钥', async () => {
            const privateKeys = [
                '0x1111111111111111111111111111111111111111111111111111111111111111',
                '0x2222222222222222222222222222222222222222222222222222222222222222',
                '0x3333333333333333333333333333333333333333333333333333333333333333'
            ];
            const result = await walletManager.importFromPrivateKeys(privateKeys, {
                group: 'batch-imported',
                tier: 'hot',
                labels: ['Wallet-1', 'Wallet-2', 'Wallet-3']
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.imported).toBe(3);
            (0, vitest_1.expect)(result.errors).toHaveLength(0);
            const importedWallets = walletManager.getWallets('batch-imported');
            (0, vitest_1.expect)(importedWallets).toHaveLength(3);
        });
        (0, vitest_1.test)('应该正确处理无效的私钥', async () => {
            const privateKeys = [
                '0x1111111111111111111111111111111111111111111111111111111111111111', // 有效
                'invalid-key', // 无效
                '0x3333333333333333333333333333333333333333333333333333333333333333' // 有效
            ];
            const result = await walletManager.importFromPrivateKeys(privateKeys);
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.imported).toBe(2); // 只有2个成功
            (0, vitest_1.expect)(result.errors).toHaveLength(1);
            (0, vitest_1.expect)(result.errors[0].index).toBe(1);
        });
    });
    (0, vitest_1.describe)('钱包CRUD操作', () => {
        (0, vitest_1.test)('应该能够更新钱包信息', async () => {
            const wallets = await walletManager.generateWallets(1);
            const address = wallets[0].address;
            await walletManager.updateWallet(address, {
                label: 'Updated Label',
                tier: 'cold'
            });
            const updatedWallet = walletManager.getWallet(address);
            (0, vitest_1.expect)(updatedWallet?.label).toBe('Updated Label');
            (0, vitest_1.expect)(updatedWallet?.tier).toBe('cold');
        });
        (0, vitest_1.test)('应该能够删除钱包', async () => {
            const wallets = await walletManager.generateWallets(1);
            const address = wallets[0].address;
            const removed = await walletManager.removeWallet(address);
            (0, vitest_1.expect)(removed).toBe(true);
            const wallet = walletManager.getWallet(address);
            (0, vitest_1.expect)(wallet).toBeUndefined();
        });
        (0, vitest_1.test)('删除不存在的钱包应该返回false', async () => {
            const removed = await walletManager.removeWallet('0x1234567890123456789012345678901234567890');
            (0, vitest_1.expect)(removed).toBe(false);
        });
    });
    (0, vitest_1.describe)('CSV导出功能', () => {
        (0, vitest_1.test)('应该能够导出钱包到CSV', async () => {
            await walletManager.generateWallets(2, undefined, 0, 'test-group');
            const csvPath = await walletManager.exportToCSV();
            (0, vitest_1.expect)(csvPath).toBeDefined();
            (0, vitest_1.expect)(csvPath).toMatch(/\.csv$/);
        });
        (0, vitest_1.test)('应该阻止导出私钥', async () => {
            await walletManager.generateWallets(1);
            await (0, vitest_1.expect)(walletManager.exportToCSV({ includePrivateKeys: true })).rejects.toThrow('SECURITY ERROR');
        });
    });
    (0, vitest_1.describe)('助记词管理', () => {
        (0, vitest_1.test)('应该能够获取当前的助记词', async () => {
            const mnemonic = await walletManager.generateMnemonic();
            await walletManager.generateWallets(1, mnemonic);
            const storedMnemonic = walletManager.getMnemonic();
            (0, vitest_1.expect)(storedMnemonic).toBe(mnemonic);
        });
    });
});
//# sourceMappingURL=wallet-manager.test.js.map