import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

const originalPassword = process.env.ENCRYPTION_PASSWORD;
const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;

describe('Config encryption password handling', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ENCRYPTION_PASSWORD = originalPassword;
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;
  });

  afterEach(() => {
    process.env.ENCRYPTION_PASSWORD = originalPassword;
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;
  });

  test('ConfigLoader throws when encryption password missing and fallback disabled', async () => {
    process.env.ENCRYPTION_PASSWORD = '';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'false';

    const { ConfigLoader } = await import('../src/config/loader');
    (ConfigLoader as any).instance = undefined;

    expect(() => ConfigLoader.getInstance().getEncryptionPassword()).toThrowError(/ENCRYPTION_PASSWORD is required/);
  });

  test('ConfigLoader reuses generated fallback password when allowed', async () => {
    process.env.ENCRYPTION_PASSWORD = '';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';

    const { ConfigLoader } = await import('../src/config/loader');
    (ConfigLoader as any).instance = undefined;

    const loader = ConfigLoader.getInstance();
    const firstPassword = loader.getEncryptionPassword();
    const secondPassword = loader.getEncryptionPassword();

    expect(firstPassword).toMatch(/^[0-9a-f]{64}$/);
    expect(secondPassword).toBe(firstPassword);
  });

  test('ConfigManager throws when encryption password missing and fallback disabled', async () => {
    process.env.ENCRYPTION_PASSWORD = '';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'false';

    const { configManager } = await import('../src/config');

    expect(() => configManager.encryptionPassword).toThrowError(/ENCRYPTION_PASSWORD is required/);
  });

  test('ConfigManager reuses generated fallback password when allowed', async () => {
    process.env.ENCRYPTION_PASSWORD = '';
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';

    const { configManager } = await import('../src/config');

    const firstPassword = configManager.encryptionPassword;
    const secondPassword = configManager.encryptionPassword;

    expect(firstPassword).toMatch(/^[0-9a-f]{64}$/);
    expect(secondPassword).toBe(firstPassword);
  });
});
