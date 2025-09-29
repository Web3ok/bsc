"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const originalPassword = process.env.ENCRYPTION_PASSWORD;
const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;
(0, vitest_1.describe)('Config encryption password handling', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.resetModules();
        process.env.ENCRYPTION_PASSWORD = originalPassword;
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;
    });
    (0, vitest_1.afterEach)(() => {
        process.env.ENCRYPTION_PASSWORD = originalPassword;
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;
    });
    (0, vitest_1.test)('ConfigLoader throws when encryption password missing and fallback disabled', async () => {
        process.env.ENCRYPTION_PASSWORD = '';
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'false';
        const { ConfigLoader } = await Promise.resolve().then(() => __importStar(require('../src/config/loader')));
        ConfigLoader.instance = undefined;
        (0, vitest_1.expect)(() => ConfigLoader.getInstance().getEncryptionPassword()).toThrowError(/ENCRYPTION_PASSWORD is required/);
    });
    (0, vitest_1.test)('ConfigLoader reuses generated fallback password when allowed', async () => {
        process.env.ENCRYPTION_PASSWORD = '';
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
        const { ConfigLoader } = await Promise.resolve().then(() => __importStar(require('../src/config/loader')));
        ConfigLoader.instance = undefined;
        const loader = ConfigLoader.getInstance();
        const firstPassword = loader.getEncryptionPassword();
        const secondPassword = loader.getEncryptionPassword();
        (0, vitest_1.expect)(firstPassword).toMatch(/^[0-9a-f]{64}$/);
        (0, vitest_1.expect)(secondPassword).toBe(firstPassword);
    });
    (0, vitest_1.test)('ConfigManager throws when encryption password missing and fallback disabled', async () => {
        process.env.ENCRYPTION_PASSWORD = '';
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'false';
        const { configManager } = await Promise.resolve().then(() => __importStar(require('../src/config')));
        (0, vitest_1.expect)(() => configManager.encryptionPassword).toThrowError(/ENCRYPTION_PASSWORD is required/);
    });
    (0, vitest_1.test)('ConfigManager reuses generated fallback password when allowed', async () => {
        process.env.ENCRYPTION_PASSWORD = '';
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
        const { configManager } = await Promise.resolve().then(() => __importStar(require('../src/config')));
        const firstPassword = configManager.encryptionPassword;
        const secondPassword = configManager.encryptionPassword;
        (0, vitest_1.expect)(firstPassword).toMatch(/^[0-9a-f]{64}$/);
        (0, vitest_1.expect)(secondPassword).toBe(firstPassword);
    });
});
//# sourceMappingURL=config-encryption.test.js.map