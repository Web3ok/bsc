import { describe, expect, beforeEach, test } from 'vitest';

import { APIServer } from '../../src/server';
import { WalletManager } from '../../src/wallet';

function createMockResponse() {
  return {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
}

describe('APIServer legacy handlers', () => {
  const server = new APIServer(0);
  const walletManager = WalletManager.getInstance();

  beforeEach(async () => {
    const wallets = [...walletManager.getAllWallets()];
    for (const wallet of wallets) {
      await walletManager.removeWallet(wallet.address);
    }
  });

  test('health handler exposes healthy status', () => {
    const handler = server.getLegacyHandler('GET', '/api/health');
    expect(handler).toBeDefined();

    const res = createMockResponse();
    handler!({} as any, res as any, () => undefined);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.timestamp).toBeDefined();
  });

  test('wallet creation, listing, exporting and deletion via handlers', async () => {
    const createHandler = server.getLegacyHandler('POST', '/api/wallets/create');
    const listHandler = server.getLegacyHandler('GET', '/api/wallets');
    const exportHandler = server.getLegacyHandler('POST', '/api/wallets/export');
    const deleteHandler = server.getLegacyHandler('DELETE', '/api/wallets/:address');

    expect(createHandler && listHandler && exportHandler && deleteHandler).toBeTruthy();

    const createRes = createMockResponse();
    await createHandler!({ body: { label: 'legacy-wallet', group: 'legacy' } } as any, createRes as any, () => undefined);
    expect(createRes.statusCode).toBe(200);
    expect(createRes.body.success).toBe(true);
    const createdAddress = createRes.body.data.address;

    const listRes = createMockResponse();
    listHandler!({ query: {} } as any, listRes as any, () => undefined);
    expect(listRes.statusCode).toBe(200);
    expect(listRes.body.data.some((w: any) => w.address === createdAddress)).toBe(true);

    const exportRes = createMockResponse();
    await exportHandler!({ body: { addresses: [createdAddress] } } as any, exportRes as any, () => undefined);
    expect(exportRes.body.data.wallets).toHaveLength(1);
    expect(exportRes.body.data.wallets[0].address).toBe(createdAddress);

    const deleteRes = createMockResponse();
    await deleteHandler!({ params: { address: createdAddress } } as any, deleteRes as any, () => undefined);
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.body.success).toBe(true);

    const remaining = walletManager.getAllWallets();
    expect(remaining.some((wallet) => wallet.address === createdAddress)).toBe(false);
  });

  test('settings handler returns default configuration', () => {
    const handler = server.getLegacyHandler('GET', '/api/settings');
    expect(handler).toBeDefined();

    const res = createMockResponse();
    handler!({} as any, res as any, () => undefined);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.trading).toBeDefined();
    expect(res.body.data.risk_management).toBeDefined();
  });
});
