"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const wallet_1 = require("../src/wallet");
const ORIGINAL_PASSWORD = process.env.ENCRYPTION_PASSWORD;
const ORIGINAL_FALLBACK = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;
function resetEnv() {
    process.env.ENCRYPTION_PASSWORD = ORIGINAL_PASSWORD;
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = ORIGINAL_FALLBACK;
}
(0, vitest_1.afterEach)(() => {
    resetEnv();
});
(0, vitest_1.describe)('WalletManager encryption handling', () => {
    (0, vitest_1.test)('throws when encryption password is missing and fallback disabled', () => {
        process.env.ENCRYPTION_PASSWORD = '';
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'false';
        (0, vitest_1.expect)(() => new wallet_1.WalletManager()).toThrowError(/ENCRYPTION_PASSWORD is required/);
    });
    (0, vitest_1.test)('generates fallback password when explicitly allowed', () => {
        process.env.ENCRYPTION_PASSWORD = '';
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
        const manager = new wallet_1.WalletManager();
        const firstPassword = manager['encryptionPassword'];
        (0, vitest_1.expect)(firstPassword).toBeDefined();
        (0, vitest_1.expect)(firstPassword).toMatch(/^[0-9a-f]+$/);
        const secondManager = new wallet_1.WalletManager();
        (0, vitest_1.expect)(secondManager['encryptionPassword']).toBe(firstPassword);
    });
});
//# sourceMappingURL=wallet.test.js.map