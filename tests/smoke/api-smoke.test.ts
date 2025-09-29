import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const executeBatchTradesMock = vi.fn();

vi.mock('../../src/dex/multi-dex-aggregator', () => {
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

import { BatchTradingAPI } from '../../src/api/batch-trading-api';
import { WalletManager } from '../../src/wallet';
import { ConfigLoader } from '../../src/config/loader';
import { invokeRoute } from '../helpers/router-test-utils';

const tempDirs: string[] = [];
const originalPassword = process.env.ENCRYPTION_PASSWORD;
const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;
const originalTokens = process.env.API_TOKENS;

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function setupApi() {
  (WalletManager as any).instance = undefined;
  (ConfigLoader as any).instance = undefined;

  const storageDir = await createTempDir('wallet-smoke-');

  process.env.ENCRYPTION_PASSWORD = 'unit-test-password';
  process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
  process.env.API_TOKENS = 'test-token';

  const manager = WalletManager.getInstance('unit-test-password');
  (manager as any).storagePath = storageDir;

  const api = new BatchTradingAPI();

  return { router: api.router, manager };
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

describe('API smoke flow', () => {
  test('generates wallets, exports CSV, and triggers batch trade', async () => {
    const { router, manager } = await setupApi();

    executeBatchTradesMock.mockResolvedValue({
      success: true,
      completedTrades: 1,
      totalTrades: 1,
      results: [
        {
          success: true,
          txHash: '0xmockhash',
          dexUsed: 'pancakeswap-v2',
          amountOut: '100',
          gasUsed: '21000',
        },
      ],
      totalGasUsed: '21000',
      totalValue: '0',
    });

    const generateResponse = await invokeRoute(router, '/wallets/generate', {
      method: 'post',
      headers: { authorization: 'Bearer test-token' },
      body: { count: 2, aliasPrefix: 'Smoke' },
    });

    expect(generateResponse.res.statusCode).toBe(200);
    expect(generateResponse.res.body?.success).toBe(true);
    expect(generateResponse.res.body?.data?.processed).toBe(2);

    const storedWallets = manager.getAllWallets();
    expect(storedWallets.length).toBe(2);

    const exportResponse = await invokeRoute(router, '/wallets/export', {
      method: 'get',
      headers: { authorization: 'Bearer test-token' },
    });

    expect(exportResponse.res.statusCode).toBe(200);
    expect(exportResponse.res.headers['content-type']).toMatch(/text\/csv/);

    const csvContent = exportResponse.res.body?.toString('utf8') || '';
    for (const wallet of storedWallets) {
      expect(csvContent).toContain(wallet.address);
      expect(csvContent).not.toContain(wallet.privateKey);
    }

    const tradeRequest = {
      walletAddress: storedWallets[0].address,
      trades: [
        {
          tokenIn: '0x0000000000000000000000000000000000000001',
          tokenOut: '0x0000000000000000000000000000000000000002',
          amountIn: '1.0',
          slippage: 0.5,
        },
      ],
      maxGasPrice: 5,
      deadline: 180,
    };

    const tradeResponse = await invokeRoute(router, '/batch/trades', {
      method: 'post',
      headers: { authorization: 'Bearer test-token' },
      body: tradeRequest,
    });

    expect(tradeResponse.res.statusCode).toBe(200);
    expect(tradeResponse.res.body?.success).toBe(true);
    expect(tradeResponse.res.body?.data?.completedTrades).toBe(1);
    expect(executeBatchTradesMock).toHaveBeenCalledTimes(1);
    expect(executeBatchTradesMock).toHaveBeenCalledWith(expect.objectContaining({
      walletAddress: tradeRequest.walletAddress,
      trades: tradeRequest.trades,
    }));
  });

  test('surfaces batch trade failures with helpful error message', async () => {
    const { router, manager } = await setupApi();

    executeBatchTradesMock.mockRejectedValue(new Error('aggregator offline'));

    const generateResponse = await invokeRoute(router, '/wallets/generate', {
      method: 'post',
      headers: { authorization: 'Bearer test-token' },
      body: { count: 1 },
    });

    expect(generateResponse.res.statusCode).toBe(200);

    const [wallet] = manager.getAllWallets();
    expect(wallet).toBeDefined();

    const tradeBody = {
      walletAddress: wallet.address,
      trades: [
        {
          tokenIn: '0x0000000000000000000000000000000000000001',
          tokenOut: '0x0000000000000000000000000000000000000002',
          amountIn: '1.0',
        },
      ],
      maxGasPrice: 5,
      deadline: 120,
    };

    const tradeResponse = await invokeRoute(router, '/batch/trades', {
      method: 'post',
      headers: { authorization: 'Bearer test-token' },
      body: tradeBody,
    });

    expect(tradeResponse.res.statusCode).toBe(500);
    expect(tradeResponse.res.body?.success).toBe(false);
    expect(tradeResponse.res.body?.message).toBe('Failed to execute batch trades');
    expect(tradeResponse.res.body?.error).toContain('aggregator offline');
    expect(executeBatchTradesMock).toHaveBeenCalledTimes(1);
  });
});
