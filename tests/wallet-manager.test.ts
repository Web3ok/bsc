import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { WalletManager } from '../src/wallet';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';

describe('WalletManager 实际功能测试', () => {
  let walletManager: WalletManager;
  let tempDir: string;

  beforeEach(async () => {
    // 创建临时目录用于测试
    tempDir = await mkdtemp(join(tmpdir(), 'wallet-test-'));
    
    // 设置测试环境变量
    process.env.ENCRYPTION_PASSWORD = 'test-password-123';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
    
    walletManager = new WalletManager('test-password-123');
  });

  afterEach(async () => {
    // 清理临时目录
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('助记词生成', () => {
    test('应该能够生成有效的助记词', async () => {
      const mnemonic = await walletManager.generateMnemonic();
      
      expect(mnemonic).toBeDefined();
      expect(typeof mnemonic).toBe('string');
      
      // 助记词应该包含12个或更多单词
      const words = mnemonic.split(' ');
      expect(words.length).toBeGreaterThanOrEqual(12);
    });
  });

  describe('钱包生成', () => {
    test('应该能够生成指定数量的钱包', async () => {
      const wallets = await walletManager.generateWallets(3);
      
      expect(wallets).toHaveLength(3);
      expect(wallets[0].address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(wallets[0].privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(wallets[0].derivationIndex).toBeDefined();
      expect(wallets[0].createdAt).toBeInstanceOf(Date);
    });

    test('应该能够为钱包指定组', async () => {
      const testGroup = 'test-group';
      const wallets = await walletManager.generateWallets(2, undefined, 0, testGroup);
      
      expect(wallets[0].group).toBe(testGroup);
      expect(wallets[1].group).toBe(testGroup);
    });

    test('生成的钱包应该有不同的地址', async () => {
      const wallets = await walletManager.generateWallets(3);
      
      const addresses = wallets.map(w => w.address);
      const uniqueAddresses = new Set(addresses);
      
      expect(uniqueAddresses.size).toBe(3);
    });
  });

  describe('钱包导入', () => {
    test('应该能够导入有效的私钥', async () => {
      const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      const wallet = await walletManager.importWallet(testPrivateKey, 'imported-wallet', 'imported-group');
      
      expect(wallet.privateKey).toBe(testPrivateKey);
      expect(wallet.label).toBe('imported-wallet');
      expect(wallet.group).toBe('imported-group');
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    test('应该拒绝重复导入同一个钱包', async () => {
      const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      
      await walletManager.importWallet(testPrivateKey, 'wallet1');
      
      await expect(
        walletManager.importWallet(testPrivateKey, 'wallet2')
      ).rejects.toThrow('already exists');
    });
  });

  describe('钱包管理', () => {
    test('应该能够获取所有钱包', async () => {
      await walletManager.generateWallets(2);
      const testPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      await walletManager.importWallet(testPrivateKey, 'imported');
      
      const allWallets = walletManager.getAllWallets();
      expect(allWallets).toHaveLength(3);
    });

    test('应该能够按组筛选钱包', async () => {
      await walletManager.generateWallets(2, undefined, 0, 'group1');
      await walletManager.generateWallets(1, undefined, 0, 'group2');
      
      const group1Wallets = walletManager.getWallets('group1');
      const group2Wallets = walletManager.getWallets('group2');
      
      expect(group1Wallets).toHaveLength(2);
      expect(group2Wallets).toHaveLength(1);
      expect(group1Wallets.every(w => w.group === 'group1')).toBe(true);
    });

    test('应该能够获取钱包总数', async () => {
      expect(walletManager.getWalletCount()).toBe(0);
      
      await walletManager.generateWallets(3);
      expect(walletManager.getWalletCount()).toBe(3);
    });

    test('应该能够获取所有组名', async () => {
      await walletManager.generateWallets(1, undefined, 0, 'group1');
      await walletManager.generateWallets(1, undefined, 0, 'group2');
      
      const groups = walletManager.getGroups();
      expect(groups).toContain('group1');
      expect(groups).toContain('group2');
      expect(groups).toHaveLength(2);
    });
  });

  describe('钱包标签系统', () => {
    test('应该能够为钱包添加和获取标签', async () => {
      const wallets = await walletManager.generateWallets(1);
      const address = wallets[0].address;
      
      await walletManager.addWalletTag(address, 'high-priority');
      await walletManager.addWalletTag(address, 'trading');
      
      const tags = walletManager.getWalletTags(address);
      expect(tags).toContain('high-priority');
      expect(tags).toContain('trading');
      expect(tags).toHaveLength(2);
    });

    test('应该能够按标签查找钱包', async () => {
      const wallets = await walletManager.generateWallets(2);
      
      await walletManager.addWalletTag(wallets[0].address, 'vip');
      await walletManager.addWalletTag(wallets[1].address, 'regular');
      
      const vipWallets = walletManager.getWalletsByTag('vip');
      expect(vipWallets).toHaveLength(1);
      expect(vipWallets[0].address).toBe(wallets[0].address);
    });

    test('应该能够移除钱包标签', async () => {
      const wallets = await walletManager.generateWallets(1);
      const address = wallets[0].address;
      
      await walletManager.addWalletTag(address, 'temp-tag');
      expect(walletManager.getWalletTags(address)).toContain('temp-tag');
      
      await walletManager.removeWalletTag(address, 'temp-tag');
      expect(walletManager.getWalletTags(address)).not.toContain('temp-tag');
    });
  });

  describe('批量私钥导入', () => {
    test('应该能够批量导入多个私钥', async () => {
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
      
      expect(result.success).toBe(true);
      expect(result.imported).toBe(3);
      expect(result.errors).toHaveLength(0);
      
      const importedWallets = walletManager.getWallets('batch-imported');
      expect(importedWallets).toHaveLength(3);
    });

    test('应该正确处理无效的私钥', async () => {
      const privateKeys = [
        '0x1111111111111111111111111111111111111111111111111111111111111111', // 有效
        'invalid-key', // 无效
        '0x3333333333333333333333333333333333333333333333333333333333333333'  // 有效
      ];
      
      const result = await walletManager.importFromPrivateKeys(privateKeys);
      
      expect(result.success).toBe(false);
      expect(result.imported).toBe(2); // 只有2个成功
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].index).toBe(1);
    });
  });

  describe('钱包CRUD操作', () => {
    test('应该能够更新钱包信息', async () => {
      const wallets = await walletManager.generateWallets(1);
      const address = wallets[0].address;
      
      await walletManager.updateWallet(address, {
        label: 'Updated Label',
        tier: 'cold'
      });
      
      const updatedWallet = walletManager.getWallet(address);
      expect(updatedWallet?.label).toBe('Updated Label');
      expect(updatedWallet?.tier).toBe('cold');
    });

    test('应该能够删除钱包', async () => {
      const wallets = await walletManager.generateWallets(1);
      const address = wallets[0].address;
      
      const removed = await walletManager.removeWallet(address);
      expect(removed).toBe(true);
      
      const wallet = walletManager.getWallet(address);
      expect(wallet).toBeUndefined();
    });

    test('删除不存在的钱包应该返回false', async () => {
      const removed = await walletManager.removeWallet('0x1234567890123456789012345678901234567890');
      expect(removed).toBe(false);
    });
  });

  describe('CSV导出功能', () => {
    test('应该能够导出钱包到CSV', async () => {
      await walletManager.generateWallets(2, undefined, 0, 'test-group');
      
      const csvPath = await walletManager.exportToCSV();
      
      expect(csvPath).toBeDefined();
      expect(csvPath).toMatch(/\.csv$/);
    });

    test('应该阻止导出私钥', async () => {
      await walletManager.generateWallets(1);
      
      await expect(
        walletManager.exportToCSV({ includePrivateKeys: true })
      ).rejects.toThrow('SECURITY ERROR');
    });
  });

  describe('助记词管理', () => {
    test('应该能够获取当前的助记词', async () => {
      const mnemonic = await walletManager.generateMnemonic();
      await walletManager.generateWallets(1, mnemonic);
      
      const storedMnemonic = walletManager.getMnemonic();
      expect(storedMnemonic).toBe(mnemonic);
    });
  });
});