import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Command } from 'commander';
import pino from 'pino';
import { mkdtemp, rm, readFile } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';

import { walletCommands } from '../../src/cli/commands/wallet';
import { WalletManager as LegacyWalletManager } from '../../src/wallet/legacy-manager';

interface CliResult {
  output: string;
  jsonLogs: Array<Record<string, any>>;
  error?: unknown;
}

async function runWalletCommand(args: string[]): Promise<CliResult> {
  const program = new Command();
  program.exitOverride();

  const logs: string[] = [];
  const jsonLogs: Array<Record<string, any>> = [];
  const originalLog = console.log;
  const originalError = console.error;
  let caughtError: unknown;

  const stream = {
    write(msg: string) {
      const trimmed = msg.trim();
      logs.push(trimmed);
      try {
        jsonLogs.push(JSON.parse(trimmed));
      } catch (error) {
        // ignore non-json lines
      }
    },
  };

  const logger = pino({ level: 'info' }, stream as any);

  walletCommands(program, logger);

  try {
    console.log = (...entries: any[]) => {
      const line = entries.join(' ');
      logs.push(line);
      try {
        jsonLogs.push(JSON.parse(line));
      } catch (error) {
        // ignore
      }
    };

    console.error = (...entries: any[]) => {
      const line = entries.join(' ');
      logs.push(line);
      try {
        jsonLogs.push(JSON.parse(line));
      } catch (error) {
        // ignore
      }
    };

    await program.parseAsync(['wallet', ...args], { from: 'user' });
  } catch (error) {
    caughtError = error;
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return { output: logs.join('\n'), jsonLogs, error: caughtError };
}

describe('CLI smoke', () => {
  const originalPassword = process.env.ENCRYPTION_PASSWORD;
  const originalFallback = process.env.ALLOW_DEV_ENCRYPTION_FALLBACK;
  const originalWalletPath = process.env.WALLET_STORAGE_PATH;
  const originalTokens = process.env.API_TOKENS;

  let tempDir: string;
  const password = 'cli-test-password';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'cli-smoke-'));
    process.env.ENCRYPTION_PASSWORD = password;
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = 'true';
    process.env.WALLET_STORAGE_PATH = tempDir;
    process.env.API_TOKENS = 'test-token';
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.ENCRYPTION_PASSWORD = originalPassword;
    process.env.ALLOW_DEV_ENCRYPTION_FALLBACK = originalFallback;
    process.env.WALLET_STORAGE_PATH = originalWalletPath;
    process.env.API_TOKENS = originalTokens;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('wallet generate/list/export/import round-trip', async () => {
    const generateResult = await runWalletCommand([
      'generate',
      '--count',
      '1',
      '--label-prefix',
      'Smoke',
    ]);

    expect(generateResult.error).toBeUndefined();
    expect(generateResult.output).toContain('Wallets generated successfully');
    const generateLog = generateResult.jsonLogs.find(log => log.msg === 'Generating wallets');
    expect(generateLog).toBeDefined();
    expect(generateLog?.level).toBe(30);

    const manager = new LegacyWalletManager(tempDir);
    manager.setEncryptionPassword(password);
    await manager.loadWallets();
    const storedWallets = manager.getAllWallets();
    expect(storedWallets.length).toBe(1);
    const [wallet] = storedWallets;

    const listResult = await runWalletCommand([
      'list',
      '--format',
      'json',
    ]);

    expect(listResult.error).toBeUndefined();

    const jsonStart = listResult.output.indexOf('[');
    const jsonEnd = listResult.output.lastIndexOf(']');
    expect(jsonStart).toBeGreaterThan(-1);
    expect(jsonEnd).toBeGreaterThan(jsonStart);

    const payload = JSON.parse(listResult.output.slice(jsonStart, jsonEnd + 1));
    expect(Array.isArray(payload)).toBe(true);
    expect(payload.length).toBe(1);
    expect(payload[0].address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(payload[0].label).toContain('Smoke');

    const exportPath = path.join(tempDir, 'wallets.csv');
    const exportResult = await runWalletCommand([
      'export',
      '--format',
      'csv',
      '--output',
      exportPath,
    ]);

    expect(exportResult.error).toBeUndefined();
    expect(exportResult.output).toContain('Exported 1 wallets');

    const csvContent = await readFile(exportPath, 'utf8');
    const csvHeader = csvContent.trim().split('\n')[0];
    expect(csvHeader).toBe('"Address","Label","Group","Index"');
    expect(csvContent).toContain(wallet.address);
    expect(csvContent).not.toContain(wallet.privateKey);

    const importDir = await mkdtemp(path.join(tempDir, 'import-'));
    process.env.WALLET_STORAGE_PATH = importDir;

    const importResult = await runWalletCommand([
      'import',
      '--private-key',
      wallet.privateKey,
      '--label',
      'Imported',
    ]);

    expect(importResult.error).toBeUndefined();
    expect(importResult.output).toContain('Wallet imported successfully');
    expect(importResult.jsonLogs.some(log => log.msg === 'Imported wallet' && log.level === 30)).toBe(true);

    const importManager = new LegacyWalletManager(importDir);
    importManager.setEncryptionPassword(password);
    await importManager.loadWallets();
    const importedWallets = importManager.getAllWallets();
    expect(importedWallets.length).toBe(1);
    expect(importedWallets[0].label).toBe('Imported');

    process.env.WALLET_STORAGE_PATH = tempDir;
  });

  test('wallet import rejects invalid private key with structured error', async () => {
    const generateResult = await runWalletCommand([
      'generate',
      '--count',
      '1',
    ]);
    expect(generateResult.error).toBeUndefined();

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as any);

    const invalidKeyResult = await runWalletCommand([
      'import',
      '--private-key',
      '0x1234',
    ]);

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorLog = invalidKeyResult.jsonLogs.find(log => log.msg === 'Failed to import wallet');
    expect(errorLog).toBeDefined();
    expect(errorLog?.level).toBe(50);
    expect(errorLog?.msg).toBe('Failed to import wallet');
    expect(errorLog?.err?.message).toMatch(/Invalid private key/i);
    expect(invalidKeyResult.output).toMatch(/Failed to import wallet/);

    const manager = new LegacyWalletManager(tempDir);
    manager.setEncryptionPassword(password);
    await manager.loadWallets();
    expect(manager.getAllWallets().length).toBe(1);

    exitSpy.mockRestore();
  });
});
