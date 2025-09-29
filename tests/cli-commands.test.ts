import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { WalletManager } from '../src/wallet/legacy-manager';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';

describe('CLI钱包命令测试', () => {
  let walletManager: WalletManager;
  let tempDir: string;

  beforeEach(async () => {
    // 创建临时目录用于测试
    tempDir = await mkdtemp(join(tmpdir(), 'cli-test-'));
    
    // 设置测试环境变量
    process.env.ENCRYPTION_PASSWORD = 'test-cli-password-123';
    process.env.WALLET_STORAGE_PATH = tempDir;
    
    walletManager = new WalletManager(tempDir);
    walletManager.setEncryptionPassword('test-cli-password-123');
  });

  afterEach(async () => {
    // 清理临时目录
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('助记词生成功能', () => {
    test('应该能够生成有效的助记词', () => {
      const mnemonic = walletManager.generateMnemonic();
      
      expect(mnemonic).toBeDefined();
      expect(typeof mnemonic).toBe('string');
      
      // 助记词应该包含12个或更多单词
      const words = mnemonic.split(' ');
      expect(words.length).toBeGreaterThanOrEqual(12);
    });

    test('应该能够验证助记词', () => {
      const mnemonic = walletManager.generateMnemonic();
      
      expect(walletManager.validateMnemonic(mnemonic)).toBe(true);
      expect(walletManager.validateMnemonic('invalid mnemonic phrase')).toBe(false);
    });
  });

  describe('单钱包派生功能', () => {
    test('应该能够从助记词派生钱包', () => {
      const mnemonic = walletManager.generateMnemonic();
      const wallet = walletManager.deriveWallet(mnemonic, 0);
      
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(wallet.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(wallet.mnemonic).toBe(mnemonic);
      expect(wallet.index).toBe(0);
      expect(wallet.derivationPath).toBe("m/44'/60'/0'/0/0");
    });

    test('不同索引应该生成不同的钱包', () => {
      const mnemonic = walletManager.generateMnemonic();
      const wallet1 = walletManager.deriveWallet(mnemonic, 0);
      const wallet2 = walletManager.deriveWallet(mnemonic, 1);
      
      expect(wallet1.address).not.toBe(wallet2.address);
      expect(wallet1.privateKey).not.toBe(wallet2.privateKey);
      expect(wallet1.index).toBe(0);
      expect(wallet2.index).toBe(1);
    });

    test('应该拒绝无效的助记词', () => {
      expect(() => {
        walletManager.deriveWallet('invalid mnemonic phrase', 0);
      }).toThrow('Invalid mnemonic phrase');
    });
  });

  describe('批量钱包生成功能', () => {
    test('应该能够生成指定数量的钱包', () => {
      const result = walletManager.generateBulkWallets(3);
      
      expect(result.wallets).toHaveLength(3);
      expect(result.mnemonic).toBeDefined();
      
      // 验证每个钱包的格式
      result.wallets.forEach((wallet, index) => {
        expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(wallet.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(wallet.index).toBe(index);
        expect(wallet.label).toBe(`Wallet-${index}`);
      });
    });

    test('应该从指定索引开始生成钱包', () => {
      const result = walletManager.generateBulkWallets(2, 5);
      
      expect(result.wallets).toHaveLength(2);
      expect(result.wallets[0].index).toBe(5);
      expect(result.wallets[1].index).toBe(6);
      expect(result.wallets[0].label).toBe('Wallet-5');
      expect(result.wallets[1].label).toBe('Wallet-6');
    });

    test('生成的钱包应该有不同的地址', () => {
      const result = walletManager.generateBulkWallets(5);
      
      const addresses = result.wallets.map(w => w.address);
      const uniqueAddresses = new Set(addresses);
      
      expect(uniqueAddresses.size).toBe(5);
    });
  });

  describe('私钥导入功能', () => {
    test('应该能够导入有效的私钥', () => {
      const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      const wallet = walletManager.importPrivateKey(testPrivateKey, 'imported-wallet');
      
      expect(wallet.privateKey).toBe(testPrivateKey);
      expect(wallet.label).toBe('imported-wallet');
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    test('应该能够处理没有0x前缀的私钥', () => {
      const testPrivateKey = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      const wallet = walletManager.importPrivateKey(testPrivateKey);
      
      expect(wallet.privateKey).toBe(`0x${testPrivateKey}`);
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    test('应该拒绝无效的私钥', () => {
      expect(() => {
        walletManager.importPrivateKey('invalid-private-key');
      }).toThrow('Invalid private key');
    });

    test('导入相同私钥应该覆盖现有钱包', () => {
      const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      const wallet1 = walletManager.importPrivateKey(testPrivateKey, 'wallet1');
      const wallet2 = walletManager.importPrivateKey(testPrivateKey, 'wallet2');
      
      expect(wallet1.address).toBe(wallet2.address);
      expect(walletManager.getWalletCount()).toBe(1);
    });
  });

  describe('钱包存储和加载功能', () => {
    test('应该能够保存和加载钱包', async () => {
      // 生成一些钱包
      const result = walletManager.generateBulkWallets(2);
      result.wallets[0].label = 'Test Wallet 1';
      result.wallets[0].group = 'test-group';
      
      // 保存钱包
      await walletManager.saveWallets('test-wallets.json');
      
      // 创建新的manager并加载
      const newManager = new WalletManager(tempDir);
      newManager.setEncryptionPassword('test-cli-password-123');
      await newManager.loadWallets('test-wallets.json');
      
      // 验证加载的钱包
      const loadedWallets = newManager.getAllWallets();
      expect(loadedWallets).toHaveLength(2);
      
      const wallet1 = loadedWallets.find(w => w.label === 'Test Wallet 1');
      expect(wallet1).toBeDefined();
      expect(wallet1?.group).toBe('test-group');
    });

    test('没有设置加密密码应该无法保存', async () => {
      const manager = new WalletManager(tempDir);
      
      await expect(
        manager.saveWallets('test.json')
      ).rejects.toThrow('Encryption password not set');
    });

    test('没有设置加密密码应该无法加载', async () => {
      const manager = new WalletManager(tempDir);
      
      await expect(
        manager.loadWallets('test.json')
      ).rejects.toThrow('Encryption password not set');
    });
  });

  describe('钱包查询功能', () => {
    beforeEach(() => {
      // 设置测试数据
      const result = walletManager.generateBulkWallets(3);
      result.wallets[0].label = 'Wallet 1';
      result.wallets[0].group = 'group1';
      result.wallets[1].label = 'Wallet 2';
      result.wallets[1].group = 'group1';
      result.wallets[2].label = 'Wallet 3';
      result.wallets[2].group = 'group2';
    });

    test('应该能够获取单个钱包', () => {
      const allWallets = walletManager.getAllWallets();
      const address = allWallets[0].address;
      
      const wallet = walletManager.getWallet(address);
      expect(wallet).toBeDefined();
      expect(wallet?.address).toBe(address);
    });

    test('应该能够获取所有钱包', () => {
      const wallets = walletManager.getAllWallets();
      expect(wallets).toHaveLength(3);
    });

    test('应该能够按组筛选钱包', () => {
      const group1Wallets = walletManager.getWalletsByGroup('group1');
      const group2Wallets = walletManager.getWalletsByGroup('group2');
      
      expect(group1Wallets).toHaveLength(2);
      expect(group2Wallets).toHaveLength(1);
      expect(group1Wallets.every(w => w.group === 'group1')).toBe(true);
      expect(group2Wallets.every(w => w.group === 'group2')).toBe(true);
    });

    test('应该能够获取钱包数量', () => {
      expect(walletManager.getWalletCount()).toBe(3);
    });
  });

  describe('钱包更新功能', () => {
    let testAddress: string;

    beforeEach(() => {
      const result = walletManager.generateBulkWallets(1);
      testAddress = result.wallets[0].address;
    });

    test('应该能够更新钱包标签', () => {
      walletManager.updateWalletLabel(testAddress, 'Updated Label');
      
      const wallet = walletManager.getWallet(testAddress);
      expect(wallet?.label).toBe('Updated Label');
    });

    test('应该能够更新钱包组', () => {
      walletManager.updateWalletGroup(testAddress, 'new-group');
      
      const wallet = walletManager.getWallet(testAddress);
      expect(wallet?.group).toBe('new-group');
    });

    test('更新不存在的钱包应该没有影响', () => {
      const beforeCount = walletManager.getWalletCount();
      
      walletManager.updateWalletLabel('0x1234567890123456789012345678901234567890', 'test');
      
      expect(walletManager.getWalletCount()).toBe(beforeCount);
    });
  });

  describe('钱包删除功能', () => {
    let testAddress: string;

    beforeEach(() => {
      const result = walletManager.generateBulkWallets(2);
      testAddress = result.wallets[0].address;
    });

    test('应该能够删除钱包', () => {
      const removed = walletManager.removeWallet(testAddress);
      
      expect(removed).toBe(true);
      expect(walletManager.getWalletCount()).toBe(1);
      expect(walletManager.getWallet(testAddress)).toBeUndefined();
    });

    test('删除不存在的钱包应该返回false', () => {
      const removed = walletManager.removeWallet('0x1234567890123456789012345678901234567890');
      
      expect(removed).toBe(false);
      expect(walletManager.getWalletCount()).toBe(2);
    });
  });

  describe('CSV导出功能', () => {
    test('应该能够导出钱包到CSV格式', async () => {
      // 生成测试钱包
      const result = walletManager.generateBulkWallets(2);
      result.wallets[0].label = 'Test Wallet 1';
      result.wallets[0].group = 'group1';
      result.wallets[1].label = 'Test Wallet 2';
      result.wallets[1].group = 'group2';
      
      const csv = await walletManager.exportToCSV();
      
      expect(csv).toBeDefined();
      expect(typeof csv).toBe('string');
      
      // 验证CSV格式
      const lines = csv.split('\n');
      expect(lines[0]).toBe('"Address","Label","Group","Index"');
      expect(lines).toHaveLength(3); // 头部 + 2行数据
      
      // 验证数据行包含正确的信息
      expect(lines[1]).toContain(result.wallets[0].address);
      expect(lines[1]).toContain('Test Wallet 1');
      expect(lines[1]).toContain('group1');
      
      expect(lines[2]).toContain(result.wallets[1].address);
      expect(lines[2]).toContain('Test Wallet 2');
      expect(lines[2]).toContain('group2');
    });

    test('空钱包列表应该只返回CSV头部', async () => {
      const csv = await walletManager.exportToCSV();
      
      expect(csv).toBe('"Address","Label","Group","Index"');
    });
  });
});