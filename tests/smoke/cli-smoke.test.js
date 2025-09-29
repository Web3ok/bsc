"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const commander_1 = require("commander");
const pino_1 = __importDefault(require("pino"));
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
const os_1 = require("os");
const wallet_1 = require("../../src/cli/commands/wallet");
const legacy_manager_1 = require("../../src/wallet/legacy-manager");
async function runWalletCommand(args) {
    const program = new commander_1.Command();
    program.exitOverride();
    const logs = [];
    const jsonLogs = [];
    const originalLog = console.log;
    const originalError = console.error;
    let caughtError;
    const stream = {
        write(msg) {
            const trimmed = msg.trim();
            logs.push(trimmed);
            try {
                jsonLogs.push(JSON.parse(trimmed));
            }
            catch (error) {
                // ignore non-json lines
            }
        },
    };
    const logger = (0, pino_1.default)({ level: 'info' }, stream);
    (0, wallet_1.walletCommands)(program, logger);
    try {
        console.log = (...entries) => {
            const line = entries.join(' ');
            logs.push(line);
            try {
                jsonLogs.push(JSON.parse(line));
            }
            catch (error) {
                // ignore
            }
        };
        console.error = (...entries) => {
            const line = entries.join(' ');
            logs.push(line);
            try {
                jsonLogs.push(JSON.parse(line));
            }
            catch (error) {
                // ignore
            }
        };
        await program.parseAsync(['wallet', ...args], { from: 'user' });
    }
    catch (error) {
        caughtError = error;
    }
    finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return { output: logs.join('\n'), jsonLogs, error: caughtError };
}
(0, vitest_1.describe)('CLI smoke', () => {
    const originalPassword = process.env.ENCRYPTION_PASSWORD;
    const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;
    const originalWalletPath = process.env.WALLET_STORAGE_PATH;
    const originalTokens = process.env.API_TOKENS;
    let tempDir;
    const password = 'cli-test-password';
    (0, vitest_1.beforeEach)(async () => {
        tempDir = await (0, promises_1.mkdtemp)(path_1.default.join((0, os_1.tmpdir)(), 'cli-smoke-'));
        process.env.ENCRYPTION_PASSWORD = password;
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
        process.env.WALLET_STORAGE_PATH = tempDir;
        process.env.API_TOKENS = 'test-token';
        vitest_1.vi.resetModules();
    });
    (0, vitest_1.afterEach)(async () => {
        process.env.ENCRYPTION_PASSWORD = originalPassword;
        process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;
        process.env.WALLET_STORAGE_PATH = originalWalletPath;
        process.env.API_TOKENS = originalTokens;
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    });
    (0, vitest_1.test)('wallet generate/list/export/import round-trip', async () => {
        const generateResult = await runWalletCommand([
            'generate',
            '--count',
            '1',
            '--label-prefix',
            'Smoke',
        ]);
        (0, vitest_1.expect)(generateResult.error).toBeUndefined();
        (0, vitest_1.expect)(generateResult.output).toContain('Wallets generated successfully');
        const generateLog = generateResult.jsonLogs.find(log => log.msg === 'Generating wallets');
        (0, vitest_1.expect)(generateLog).toBeDefined();
        (0, vitest_1.expect)(generateLog?.level).toBe(30);
        const manager = new legacy_manager_1.WalletManager(tempDir);
        manager.setEncryptionPassword(password);
        await manager.loadWallets();
        const storedWallets = manager.getAllWallets();
        (0, vitest_1.expect)(storedWallets.length).toBe(1);
        const [wallet] = storedWallets;
        const listResult = await runWalletCommand([
            'list',
            '--format',
            'json',
        ]);
        (0, vitest_1.expect)(listResult.error).toBeUndefined();
        const jsonStart = listResult.output.indexOf('[');
        const jsonEnd = listResult.output.lastIndexOf(']');
        (0, vitest_1.expect)(jsonStart).toBeGreaterThan(-1);
        (0, vitest_1.expect)(jsonEnd).toBeGreaterThan(jsonStart);
        const payload = JSON.parse(listResult.output.slice(jsonStart, jsonEnd + 1));
        (0, vitest_1.expect)(Array.isArray(payload)).toBe(true);
        (0, vitest_1.expect)(payload.length).toBe(1);
        (0, vitest_1.expect)(payload[0].address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        (0, vitest_1.expect)(payload[0].label).toContain('Smoke');
        const exportPath = path_1.default.join(tempDir, 'wallets.csv');
        const exportResult = await runWalletCommand([
            'export',
            '--format',
            'csv',
            '--output',
            exportPath,
        ]);
        (0, vitest_1.expect)(exportResult.error).toBeUndefined();
        (0, vitest_1.expect)(exportResult.output).toContain('Exported 1 wallets');
        const csvContent = await (0, promises_1.readFile)(exportPath, 'utf8');
        const csvHeader = csvContent.trim().split('\n')[0];
        (0, vitest_1.expect)(csvHeader).toBe('"Address","Label","Group","Index"');
        (0, vitest_1.expect)(csvContent).toContain(wallet.address);
        (0, vitest_1.expect)(csvContent).not.toContain(wallet.privateKey);
        const importDir = await (0, promises_1.mkdtemp)(path_1.default.join(tempDir, 'import-'));
        process.env.WALLET_STORAGE_PATH = importDir;
        const importResult = await runWalletCommand([
            'import',
            '--private-key',
            wallet.privateKey,
            '--label',
            'Imported',
        ]);
        (0, vitest_1.expect)(importResult.error).toBeUndefined();
        (0, vitest_1.expect)(importResult.output).toContain('Wallet imported successfully');
        (0, vitest_1.expect)(importResult.jsonLogs.some(log => log.msg === 'Imported wallet' && log.level === 30)).toBe(true);
        const importManager = new legacy_manager_1.WalletManager(importDir);
        importManager.setEncryptionPassword(password);
        await importManager.loadWallets();
        const importedWallets = importManager.getAllWallets();
        (0, vitest_1.expect)(importedWallets.length).toBe(1);
        (0, vitest_1.expect)(importedWallets[0].label).toBe('Imported');
        process.env.WALLET_STORAGE_PATH = tempDir;
    });
    (0, vitest_1.test)('wallet import rejects invalid private key with structured error', async () => {
        const generateResult = await runWalletCommand([
            'generate',
            '--count',
            '1',
        ]);
        (0, vitest_1.expect)(generateResult.error).toBeUndefined();
        const exitSpy = vitest_1.vi
            .spyOn(process, 'exit')
            .mockImplementation((() => undefined));
        const invalidKeyResult = await runWalletCommand([
            'import',
            '--private-key',
            '0x1234',
        ]);
        (0, vitest_1.expect)(exitSpy).toHaveBeenCalledWith(1);
        const errorLog = invalidKeyResult.jsonLogs.find(log => log.msg === 'Failed to import wallet');
        (0, vitest_1.expect)(errorLog).toBeDefined();
        (0, vitest_1.expect)(errorLog?.level).toBe(50);
        (0, vitest_1.expect)(errorLog?.msg).toBe('Failed to import wallet');
        (0, vitest_1.expect)(errorLog?.err?.message).toMatch(/Invalid private key/i);
        (0, vitest_1.expect)(invalidKeyResult.output).toMatch(/Failed to import wallet/);
        const manager = new legacy_manager_1.WalletManager(tempDir);
        manager.setEncryptionPassword(password);
        await manager.loadWallets();
        (0, vitest_1.expect)(manager.getAllWallets().length).toBe(1);
        exitSpy.mockRestore();
    });
});
//# sourceMappingURL=cli-smoke.test.js.map