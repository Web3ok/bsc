import { describe, expect, test, vi } from 'vitest';
import { Command } from 'commander';
import pino from 'pino';

import { tradeCommands } from '../src/cli/commands/trade';

interface CliResult {
  output: string;
  jsonLogs: Array<Record<string, any>>;
}

async function runTradeCommand(args: string[]): Promise<CliResult> {
  const program = new Command();
  program.exitOverride();

  const logs: string[] = [];
  const jsonLogs: Array<Record<string, any>> = [];
  const originalLog = console.log;
  const originalError = console.error;

  const stream = {
    write(message: string) {
      const trimmed = message.trim();
      logs.push(trimmed);
      try {
        jsonLogs.push(JSON.parse(trimmed));
      } catch {
        // ignore non-JSON log lines
      }
    },
  };

  const logger = pino({ level: 'info' }, stream as any);
  tradeCommands(program, logger);

  try {
    console.log = (...entries: any[]) => {
      const line = entries.join(' ');
      logs.push(line);
      try {
        jsonLogs.push(JSON.parse(line));
      } catch {
        // ignore
      }
    };

    console.error = (...entries: any[]) => {
      const line = entries.join(' ');
      logs.push(line);
      try {
        jsonLogs.push(JSON.parse(line));
      } catch {
        // ignore
      }
    };

    await program.parseAsync(['trade', ...args], { from: 'user' });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return {
    output: logs.join('\n'),
    jsonLogs,
  };
}

describe('CLI trade stubs', () => {
  test('trade buy logs placeholder details', async () => {
    const result = await runTradeCommand(['buy', '0xtoken', '--amount', '0.5']);

    expect(result.output).toContain('🚧 Buy command will be implemented in the next phase');
    const infoLog = result.jsonLogs.find(log => log.msg === 'Buy command - not yet implemented');
    expect(infoLog).toBeDefined();
    expect(infoLog?.level).toBe(30);
    expect(infoLog?.token).toBe('0xtoken');
  });

  test('trade quote logs placeholder and records error when logger throws', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    try {
      const result = await runTradeCommand(['quote']);
      const errorLog = result.jsonLogs.find(log => log.msg === 'Failed to get quote');
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(errorLog).toBeDefined();
      expect(errorLog?.level).toBe(50);
      expect(errorLog?.err?.message).toMatch(/token-in and token-out are required/i);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
