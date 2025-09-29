import { describe, expect, test, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

import { WalletManager } from '../src/wallet';

const ORIGINAL_PASSWORD = process.env.ENCRYPTION_PASSWORD;
const ORIGINAL_FALLBACK = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;

function resetEnv() {
  process.env.ENCRYPTION_PASSWORD = ORIGINAL_PASSWORD;
  process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = ORIGINAL_FALLBACK;
}

afterEach(() => {
  resetEnv();
});

describe('WalletManager encryption handling', () => {
  test('throws when encryption password is missing and fallback disabled', () => {
    process.env.ENCRYPTION_PASSWORD = '';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'false';

    expect(() => new WalletManager()).toThrowError(/ENCRYPTION_PASSWORD is required/);
  });

  test('generates fallback password when explicitly allowed', () => {
    process.env.ENCRYPTION_PASSWORD = '';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';

    const manager = new WalletManager();
    const firstPassword = manager['encryptionPassword'];

    expect(firstPassword).toBeDefined();
    expect(firstPassword).toMatch(/^[0-9a-f]+$/);

    const secondManager = new WalletManager();
    expect(secondManager['encryptionPassword']).toBe(firstPassword);
  });
});

