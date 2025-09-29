"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const commander_1 = require("commander");
const pino_1 = __importDefault(require("pino"));
const trade_1 = require("../src/cli/commands/trade");
async function runTradeCommand(args) {
    const program = new commander_1.Command();
    program.exitOverride();
    const logs = [];
    const jsonLogs = [];
    const originalLog = console.log;
    const originalError = console.error;
    const stream = {
        write(message) {
            const trimmed = message.trim();
            logs.push(trimmed);
            try {
                jsonLogs.push(JSON.parse(trimmed));
            }
            catch {
                // ignore non-JSON log lines
            }
        },
    };
    const logger = (0, pino_1.default)({ level: 'info' }, stream);
    (0, trade_1.tradeCommands)(program, logger);
    try {
        console.log = (...entries) => {
            const line = entries.join(' ');
            logs.push(line);
            try {
                jsonLogs.push(JSON.parse(line));
            }
            catch {
                // ignore
            }
        };
        console.error = (...entries) => {
            const line = entries.join(' ');
            logs.push(line);
            try {
                jsonLogs.push(JSON.parse(line));
            }
            catch {
                // ignore
            }
        };
        await program.parseAsync(['trade', ...args], { from: 'user' });
    }
    finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return {
        output: logs.join('\n'),
        jsonLogs,
    };
}
(0, vitest_1.describe)('CLI trade stubs', () => {
    (0, vitest_1.test)('trade buy logs placeholder details', async () => {
        const result = await runTradeCommand(['buy', '0xtoken', '--amount', '0.5']);
        (0, vitest_1.expect)(result.output).toContain('🚧 Buy command will be implemented in the next phase');
        const infoLog = result.jsonLogs.find(log => log.msg === 'Buy command - not yet implemented');
        (0, vitest_1.expect)(infoLog).toBeDefined();
        (0, vitest_1.expect)(infoLog?.level).toBe(30);
        (0, vitest_1.expect)(infoLog?.token).toBe('0xtoken');
    });
    (0, vitest_1.test)('trade quote logs placeholder and records error when logger throws', async () => {
        const exitSpy = vitest_1.vi.spyOn(process, 'exit').mockImplementation((() => undefined));
        try {
            const result = await runTradeCommand(['quote']);
            const errorLog = result.jsonLogs.find(log => log.msg === 'Failed to get quote');
            (0, vitest_1.expect)(exitSpy).toHaveBeenCalledWith(1);
            (0, vitest_1.expect)(errorLog).toBeDefined();
            (0, vitest_1.expect)(errorLog?.level).toBe(50);
            (0, vitest_1.expect)(errorLog?.err?.message).toMatch(/token-in and token-out are required/i);
        }
        finally {
            exitSpy.mockRestore();
        }
    });
});
//# sourceMappingURL=cli-trade.test.js.map