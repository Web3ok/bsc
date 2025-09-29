"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const legacy_manager_1 = require("../src/wallet/legacy-manager");
const os_1 = require("os");
const path_1 = require("path");
const promises_1 = require("fs/promises");
(0, vitest_1.describe)('CLI钱包命令测试', () => {
    let walletManager;
    let tempDir;
    (0, vitest_1.beforeEach)(async () => {
        // 创建临时目录用于测试
        tempDir = await (0, promises_1.mkdtemp)((0, path_1.join)((0, os_1.tmpdir)(), 'cli-test-'));
        // 设置测试环境变量
        process.env.ENCRYPTION_PASSWORD = 'test-cli-password-123';
        process.env.WALLET_STORAGE_PATH = tempDir;
        walletManager = new legacy_manager_1.WalletManager(tempDir);
        walletManager.setEncryptionPassword('test-cli-password-123');
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
    (0, vitest_1.describe)('助记词生成功能', () => {
        (0, vitest_1.test)('应该能够生成有效的助记词', () => {
            const mnemonic = walletManager.generateMnemonic();
            (0, vitest_1.expect)(mnemonic).toBeDefined();
            (0, vitest_1.expect)(typeof mnemonic).toBe('string');
            // 助记词应该包含12个或更多单词
            const words = mnemonic.split(' ');
            (0, vitest_1.expect)(words.length).toBeGreaterThanOrEqual(12);
        });
        (0, vitest_1.test)('应该能够验证助记词', () => {
            const mnemonic = walletManager.generateMnemonic();
            (0, vitest_1.expect)(walletManager.validateMnemonic(mnemonic)).toBe(true);
            (0, vitest_1.expect)(walletManager.validateMnemonic('invalid mnemonic phrase')).toBe(false);
        });
    });
    (0, vitest_1.describe)('单钱包派生功能', () => {
        (0, vitest_1.test)('应该能够从助记词派生钱包', () => {
            const mnemonic = walletManager.generateMnemonic();
            const wallet = walletManager.deriveWallet(mnemonic, 0);
            (0, vitest_1.expect)(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
            (0, vitest_1.expect)(wallet.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
            (0, vitest_1.expect)(wallet.mnemonic).toBe(mnemonic);
            (0, vitest_1.expect)(wallet.index).toBe(0);
            (0, vitest_1.expect)(wallet.derivationPath).toBe("m/44'/60'/0'/0/0");
        });
        (0, vitest_1.test)('不同索引应该生成不同的钱包', () => {
            const mnemonic = walletManager.generateMnemonic();
            const wallet1 = walletManager.deriveWallet(mnemonic, 0);
            const wallet2 = walletManager.deriveWallet(mnemonic, 1);
            (0, vitest_1.expect)(wallet1.address).not.toBe(wallet2.address);
            (0, vitest_1.expect)(wallet1.privateKey).not.toBe(wallet2.privateKey);
            (0, vitest_1.expect)(wallet1.index).toBe(0);
            (0, vitest_1.expect)(wallet2.index).toBe(1);
        });
        (0, vitest_1.test)('应该拒绝无效的助记词', () => {
            (0, vitest_1.expect)(() => {
                walletManager.deriveWallet('invalid mnemonic phrase', 0);
            }).toThrow('Invalid mnemonic phrase');
        });
    });
    (0, vitest_1.describe)('批量钱包生成功能', () => {
        (0, vitest_1.test)('应该能够生成指定数量的钱包', () => {
            const result = walletManager.generateBulkWallets(3);
            (0, vitest_1.expect)(result.wallets).toHaveLength(3);
            (0, vitest_1.expect)(result.mnemonic).toBeDefined();
            // 验证每个钱包的格式
            result.wallets.forEach((wallet, index) => {
                (0, vitest_1.expect)(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
                (0, vitest_1.expect)(wallet.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
                (0, vitest_1.expect)(wallet.index).toBe(index);
                (0, vitest_1.expect)(wallet.label).toBe(`Wallet-${index}`);
            });
        });
        (0, vitest_1.test)('应该从指定索引开始生成钱包', () => {
            const result = walletManager.generateBulkWallets(2, 5);
            (0, vitest_1.expect)(result.wallets).toHaveLength(2);
            (0, vitest_1.expect)(result.wallets[0].index).toBe(5);
            (0, vitest_1.expect)(result.wallets[1].index).toBe(6);
            (0, vitest_1.expect)(result.wallets[0].label).toBe('Wallet-5');
            (0, vitest_1.expect)(result.wallets[1].label).toBe('Wallet-6');
        });
        (0, vitest_1.test)('生成的钱包应该有不同的地址', () => {
            const result = walletManager.generateBulkWallets(5);
            const addresses = result.wallets.map(w => w.address);
            const uniqueAddresses = new Set(addresses);
            (0, vitest_1.expect)(uniqueAddresses.size).toBe(5);
        });
    });
    (0, vitest_1.describe)('私钥导入功能', () => {
        (0, vitest_1.test)('应该能够导入有效的私钥', () => {
            const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
            const wallet = walletManager.importPrivateKey(testPrivateKey, 'imported-wallet');
            (0, vitest_1.expect)(wallet.privateKey).toBe(testPrivateKey);
            (0, vitest_1.expect)(wallet.label).toBe('imported-wallet');
            (0, vitest_1.expect)(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        });
        (0, vitest_1.test)('应该能够处理没有0x前缀的私钥', () => {
            const testPrivateKey = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
            const wallet = walletManager.importPrivateKey(testPrivateKey);
            (0, vitest_1.expect)(wallet.privateKey).toBe(`0x${testPrivateKey}`);
            (0, vitest_1.expect)(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        });
        (0, vitest_1.test)('应该拒绝无效的私钥', () => {
            (0, vitest_1.expect)(() => {
                walletManager.importPrivateKey('invalid-private-key');
            }).toThrow('Invalid private key');
        });
        (0, vitest_1.test)('导入相同私钥应该覆盖现有钱包', () => {
            const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
            const wallet1 = walletManager.importPrivateKey(testPrivateKey, 'wallet1');
            const wallet2 = walletManager.importPrivateKey(testPrivateKey, 'wallet2');
            (0, vitest_1.expect)(wallet1.address).toBe(wallet2.address);
            (0, vitest_1.expect)(walletManager.getWalletCount()).toBe(1);
        });
    });
    (0, vitest_1.describe)('钱包存储和加载功能', () => {
        (0, vitest_1.test)('应该能够保存和加载钱包', async () => {
            // 生成一些钱包
            const result = walletManager.generateBulkWallets(2);
            result.wallets[0].label = 'Test Wallet 1';
            result.wallets[0].group = 'test-group';
            // 保存钱包
            await walletManager.saveWallets('test-wallets.json');
            // 创建新的manager并加载
            const newManager = new legacy_manager_1.WalletManager(tempDir);
            newManager.setEncryptionPassword('test-cli-password-123');
            await newManager.loadWallets('test-wallets.json');
            // 验证加载的钱包
            const loadedWallets = newManager.getAllWallets();
            (0, vitest_1.expect)(loadedWallets).toHaveLength(2);
            const wallet1 = loadedWallets.find(w => w.label === 'Test Wallet 1');
            (0, vitest_1.expect)(wallet1).toBeDefined();
            (0, vitest_1.expect)(wallet1?.group).toBe('test-group');
        });
        (0, vitest_1.test)('没有设置加密密码应该无法保存', async () => {
            const manager = new legacy_manager_1.WalletManager(tempDir);
            await (0, vitest_1.expect)(manager.saveWallets('test.json')).rejects.toThrow('Encryption password not set');
        });
        (0, vitest_1.test)('没有设置加密密码应该无法加载', async () => {
            const manager = new legacy_manager_1.WalletManager(tempDir);
            await (0, vitest_1.expect)(manager.loadWallets('test.json')).rejects.toThrow('Encryption password not set');
        });
    });
    (0, vitest_1.describe)('钱包查询功能', () => {
        (0, vitest_1.beforeEach)(() => {
            // 设置测试数据
            const result = walletManager.generateBulkWallets(3);
            result.wallets[0].label = 'Wallet 1';
            result.wallets[0].group = 'group1';
            result.wallets[1].label = 'Wallet 2';
            result.wallets[1].group = 'group1';
            result.wallets[2].label = 'Wallet 3';
            result.wallets[2].group = 'group2';
        });
        (0, vitest_1.test)('应该能够获取单个钱包', () => {
            const allWallets = walletManager.getAllWallets();
            const address = allWallets[0].address;
            const wallet = walletManager.getWallet(address);
            (0, vitest_1.expect)(wallet).toBeDefined();
            (0, vitest_1.expect)(wallet?.address).toBe(address);
        });
        (0, vitest_1.test)('应该能够获取所有钱包', () => {
            const wallets = walletManager.getAllWallets();
            (0, vitest_1.expect)(wallets).toHaveLength(3);
        });
        (0, vitest_1.test)('应该能够按组筛选钱包', () => {
            const group1Wallets = walletManager.getWalletsByGroup('group1');
            const group2Wallets = walletManager.getWalletsByGroup('group2');
            (0, vitest_1.expect)(group1Wallets).toHaveLength(2);
            (0, vitest_1.expect)(group2Wallets).toHaveLength(1);
            (0, vitest_1.expect)(group1Wallets.every(w => w.group === 'group1')).toBe(true);
            (0, vitest_1.expect)(group2Wallets.every(w => w.group === 'group2')).toBe(true);
        });
        (0, vitest_1.test)('应该能够获取钱包数量', () => {
            (0, vitest_1.expect)(walletManager.getWalletCount()).toBe(3);
        });
    });
    (0, vitest_1.describe)('钱包更新功能', () => {
        let testAddress;
        (0, vitest_1.beforeEach)(() => {
            const result = walletManager.generateBulkWallets(1);
            testAddress = result.wallets[0].address;
        });
        (0, vitest_1.test)('应该能够更新钱包标签', () => {
            walletManager.updateWalletLabel(testAddress, 'Updated Label');
            const wallet = walletManager.getWallet(testAddress);
            (0, vitest_1.expect)(wallet?.label).toBe('Updated Label');
        });
        (0, vitest_1.test)('应该能够更新钱包组', () => {
            walletManager.updateWalletGroup(testAddress, 'new-group');
            const wallet = walletManager.getWallet(testAddress);
            (0, vitest_1.expect)(wallet?.group).toBe('new-group');
        });
        (0, vitest_1.test)('更新不存在的钱包应该没有影响', () => {
            const beforeCount = walletManager.getWalletCount();
            walletManager.updateWalletLabel('0x1234567890123456789012345678901234567890', 'test');
            (0, vitest_1.expect)(walletManager.getWalletCount()).toBe(beforeCount);
        });
    });
    (0, vitest_1.describe)('钱包删除功能', () => {
        let testAddress;
        (0, vitest_1.beforeEach)(() => {
            const result = walletManager.generateBulkWallets(2);
            testAddress = result.wallets[0].address;
        });
        (0, vitest_1.test)('应该能够删除钱包', () => {
            const removed = walletManager.removeWallet(testAddress);
            (0, vitest_1.expect)(removed).toBe(true);
            (0, vitest_1.expect)(walletManager.getWalletCount()).toBe(1);
            (0, vitest_1.expect)(walletManager.getWallet(testAddress)).toBeUndefined();
        });
        (0, vitest_1.test)('删除不存在的钱包应该返回false', () => {
            const removed = walletManager.removeWallet('0x1234567890123456789012345678901234567890');
            (0, vitest_1.expect)(removed).toBe(false);
            (0, vitest_1.expect)(walletManager.getWalletCount()).toBe(2);
        });
    });
    (0, vitest_1.describe)('CSV导出功能', () => {
        (0, vitest_1.test)('应该能够导出钱包到CSV格式', async () => {
            // 生成测试钱包
            const result = walletManager.generateBulkWallets(2);
            result.wallets[0].label = 'Test Wallet 1';
            result.wallets[0].group = 'group1';
            result.wallets[1].label = 'Test Wallet 2';
            result.wallets[1].group = 'group2';
            const csv = await walletManager.exportToCSV();
            (0, vitest_1.expect)(csv).toBeDefined();
            (0, vitest_1.expect)(typeof csv).toBe('string');
            // 验证CSV格式
            const lines = csv.split('\n');
            (0, vitest_1.expect)(lines[0]).toBe('"Address","Label","Group","Index"');
            (0, vitest_1.expect)(lines).toHaveLength(3); // 头部 + 2行数据
            // 验证数据行包含正确的信息
            (0, vitest_1.expect)(lines[1]).toContain(result.wallets[0].address);
            (0, vitest_1.expect)(lines[1]).toContain('Test Wallet 1');
            (0, vitest_1.expect)(lines[1]).toContain('group1');
            (0, vitest_1.expect)(lines[2]).toContain(result.wallets[1].address);
            (0, vitest_1.expect)(lines[2]).toContain('Test Wallet 2');
            (0, vitest_1.expect)(lines[2]).toContain('group2');
        });
        (0, vitest_1.test)('空钱包列表应该只返回CSV头部', async () => {
            const csv = await walletManager.exportToCSV();
            (0, vitest_1.expect)(csv).toBe('"Address","Label","Group","Index"');
        });
    });
});
//# sourceMappingURL=cli-commands.test.js.map