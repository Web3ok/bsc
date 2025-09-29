import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { WalletManager } from '../../src/wallet';

describe('WalletManager 核心功能测试', () => {
  let walletManager: WalletManager;
  const testPassword = 'test-encryption-password-123';

  beforeEach(() => {
    process.env.ENCRYPTION_PASSWORD = testPassword;
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'false';
    walletManager = new WalletManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('钱包创建', () => {
    test('应该能够创建新钱包', async () => {
      const wallet = await walletManager.createWallet('test-wallet');
      
      expect(wallet).toBeDefined();
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(wallet.label).toBe('test-wallet');
    });

    test('应该能够创建带组的钱包', async () => {
      const wallet = await walletManager.createWallet('test-wallet', 'test-group');
      
      expect(wallet.group).toBe('test-group');
    });

    test('不同钱包应该有不同的地址', async () => {
      const wallet1 = await walletManager.createWallet('wallet1');
      const wallet2 = await walletManager.createWallet('wallet2');
      
      expect(wallet1.address).not.toBe(wallet2.address);
    });
  });

  describe('钱包导入', () => {
    test('应该能够通过私钥导入钱包', async () => {
      const privateKey = '0x' + randomBytes(32).toString('hex');
      const wallet = await walletManager.importWallet(privateKey, 'imported-wallet');
      
      expect(wallet).toBeDefined();
      expect(wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(wallet.label).toBe('imported-wallet');
    });

    test('导入相同私钥应该得到相同地址', async () => {
      const privateKey = '0x' + randomBytes(32).toString('hex');
      const wallet1 = await walletManager.importWallet(privateKey, 'wallet1');
      const wallet2 = await walletManager.importWallet(privateKey, 'wallet2', 'group2');
      
      expect(wallet1.address).toBe(wallet2.address);
    });

    test('无效私钥应该抛出错误', async () => {
      await expect(
        walletManager.importWallet('invalid-key', 'test')
      ).rejects.toThrow();
    });
  });

  describe('钱包管理', () => {
    test('应该能够列出所有钱包', async () => {
      await walletManager.createWallet('wallet1');
      await walletManager.createWallet('wallet2', 'group1');
      
      const wallets = await walletManager.getAllWallets();
      expect(wallets).toHaveLength(2);
    });

    test('应该能够按组筛选钱包', async () => {
      await walletManager.createWallet('wallet1', 'group1');
      await walletManager.createWallet('wallet2', 'group1');
      await walletManager.createWallet('wallet3', 'group2');
      
      const group1Wallets = await walletManager.getWalletsByGroup('group1');
      expect(group1Wallets).toHaveLength(2);
      expect(group1Wallets.every(w => w.group === 'group1')).toBe(true);
    });

    test('应该能够删除钱包', async () => {
      const wallet = await walletManager.createWallet('test');
      await walletManager.deleteWallet(wallet.address);
      
      const wallets = await walletManager.getAllWallets();
      expect(wallets.find(w => w.address === wallet.address)).toBeUndefined();
    });
  });

  describe('钱包加密', () => {
    test('私钥应该被加密存储', async () => {
      const wallet = await walletManager.createWallet('test');
      
      // 私钥应该被加密，不应该是明文
      expect(wallet.encryptedPrivateKey).toBeDefined();
      expect(wallet.encryptedPrivateKey).not.toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    test('应该能够解密私钥', async () => {
      const wallet = await walletManager.createWallet('test');
      const decryptedKey = await walletManager.getPrivateKey(wallet.address);
      
      expect(decryptedKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    test('错误的加密密码应该无法解密', async () => {
      const wallet = await walletManager.createWallet('test');
      
      // 更改加密密码
      process.env.ENCRYPTION_PASSWORD = 'wrong-password';
      const newManager = new WalletManager();
      
      await expect(
        newManager.getPrivateKey(wallet.address)
      ).rejects.toThrow();
    });
  });
});