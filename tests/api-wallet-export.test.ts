import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { ethers } from 'ethers';

const executeBatchTradesMock = vi.fn();

vi.mock('../src/dex/multi-dex-aggregator', () => {
  class MockMultiDEXAggregator {
    getSupportedDEXes = vi.fn(() => ['pancakeswap-v2']);
    getDEXHealthStatus = vi.fn(async () => ({ overall: 'healthy', dexes: {} }));
    getBestQuote = vi.fn();
    executeBatchTrades = executeBatchTradesMock;
  }

  return {
    MultiDEXAggregator: MockMultiDEXAggregator,
    DEXType: { PANCAKESWAP_V2: 'pancakeswap-v2' },
  };
});

import { BatchTradingAPI } from '../src/api/batch-trading-api';
import { WalletManager } from '../src/wallet';
import { ConfigLoader } from '../src/config/loader';
import { invokeRoute } from './helpers/router-test-utils';

const tempDirs: string[] = [];
const originalPassword = process.env.ENCRYPTION_PASSWORD;
const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;
const originalTokens = process.env.API_TOKENS;

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setupApiWithWallet() {
  (WalletManager as any).instance = undefined;
  (ConfigLoader as any).instance = undefined;

  const storageDir = await createTempDir('wallet-api-export-');

  process.env.ENCRYPTION_PASSWORD = 'unit-test-password';
  process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
  process.env.API_TOKENS = 'test-token';

  const manager = WalletManager.getInstance('unit-test-password');
  (manager as any).storagePath = storageDir;

  const wallet = ethers.Wallet.createRandom();
  await manager.addWallet({
    address: wallet.address,
    privateKey: wallet.privateKey,
    createdAt: new Date(),
  });

  const api = new BatchTradingAPI();

  return { router: api.router, wallet };
}

beforeEach(() => {
  vi.clearAllMocks();
  executeBatchTradesMock.mockReset();
});

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }

  process.env.ENCRYPTION_PASSWORD = originalPassword;
  process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;
  process.env.API_TOKENS = originalTokens;

  (WalletManager as any).instance = undefined;
  (ConfigLoader as any).instance = undefined;
});

describe('GET /api/batch/wallets/export', () => {
  test('rejects attempts to include private keys', async () => {
    const { router } = await setupApiWithWallet();

    const { res } = await invokeRoute(router, '/wallets/export', {
      method: 'get',
      query: { includePrivateKeys: 'true' },
      headers: { authorization: 'Bearer test-token' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body?.message).toMatch(/Private key export is disabled/);
  });

  test('returns CSV without any private keys', async () => {
    const { router, wallet } = await setupApiWithWallet();

    const { res } = await invokeRoute(router, '/wallets/export', {
      method: 'get',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);

    const csvContent = res.body?.toString('utf8') || '';

    expect(csvContent.split('\n')[0]).toContain('address');
    expect(csvContent).not.toContain(wallet.privateKey);
    expect(csvContent).not.toContain(wallet.privateKey.replace('0x', ''));
  });
});
