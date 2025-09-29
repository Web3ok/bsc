import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ethers } from 'ethers';

import { WalletManager } from '../src/wallet';
import { BatchWalletManager } from '../src/wallet/batch-wallet-manager';

const originalPassword = process.env.ENCRYPTION_PASSWORD;
const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;

const tempDirs: string[] = [];

async function createWalletManagerWithTempStorage() {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'wallet-export-'));
  tempDirs.push(tempDir);

  const manager = new WalletManager('unit-test-password');
  (manager as any).storagePath = tempDir;

  return { manager, tempDir };
}

describe('Wallet CSV export safeguards', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_PASSWORD = 'unit-test-password';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
  });

  afterEach(async () => {
    process.env.ENCRYPTION_PASSWORD = originalPassword;
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  test('WalletManager blocks private key export attempts', async () => {
    const { manager } = await createWalletManagerWithTempStorage();

    await expect(manager.exportToCSV({ includePrivateKeys: true })).rejects.toThrowError(/Private key export is permanently disabled/);
  });

  test('BatchWalletManager blocks private key export attempts', async () => {
    const { manager, tempDir } = await createWalletManagerWithTempStorage();
    const batchManager = new BatchWalletManager(manager);
    const exportPath = path.join(tempDir, 'batch-wallets.csv');

    await expect(batchManager.exportWalletsToCSV(exportPath, { includePrivateKeys: true })).rejects.toThrowError(/Private key export is permanently disabled/);
  });

  test('WalletManager CSV export omits private keys from output file', async () => {
    const { manager } = await createWalletManagerWithTempStorage();
    const wallet = ethers.Wallet.createRandom();

    await manager.addWallet({
      address: wallet.address,
      privateKey: wallet.privateKey,
      createdAt: new Date(),
    });

    const filePath = await manager.exportToCSV({ includePrivateKeys: false });
    const csvContent = await readFile(filePath, 'utf8');

    expect(csvContent.startsWith('Address,Derivation Index,Label,Group,Created At')).toBe(true);
    expect(csvContent).not.toContain(wallet.privateKey);
    expect(csvContent).not.toContain(wallet.privateKey.replace('0x', ''));
  });
});
