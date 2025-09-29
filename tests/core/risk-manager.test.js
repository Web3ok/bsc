"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const RiskManager_1 = require("../../src/risk/RiskManager");
(0, vitest_1.describe)('风险管理系统测试', () => {
    let riskManager;
    (0, vitest_1.beforeEach)(() => {
        riskManager = new RiskManager_1.RiskManager({
            maxDailyVolume: '100', // 100 BNB
            maxSingleTrade: '10', // 10 BNB
            requireWhitelist: false,
            blacklistEnabled: true,
            maxConcurrentTrades: 5,
            coolDownPeriod: 60 // 60秒
        });
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.describe)('交易限额检查', () => {
        (0, vitest_1.test)('应该允许小额交易', async () => {
            const tradeRequest = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1', // 1 BNB，小于限额
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            const result = await riskManager.checkTradeRisk(tradeRequest);
            (0, vitest_1.expect)(result.allowed).toBe(true);
            (0, vitest_1.expect)(result.risk).toBe('low');
        });
        (0, vitest_1.test)('应该拒绝超过单笔限额的交易', async () => {
            const tradeRequest = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '15', // 15 BNB，超过10 BNB限额
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            const result = await riskManager.checkTradeRisk(tradeRequest);
            (0, vitest_1.expect)(result.allowed).toBe(false);
            (0, vitest_1.expect)(result.reason).toContain('exceeds maximum single trade limit');
        });
        (0, vitest_1.test)('应该拒绝超过日交易量限额的交易', async () => {
            // 先执行几笔大额交易接近限额
            for (let i = 0; i < 9; i++) {
                const trade = {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '10',
                    walletAddress: '0x1234567890123456789012345678901234567890'
                };
                await riskManager.recordTrade(trade, 'success');
            }
            // 第10笔交易应该超过日限额
            const tradeRequest = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '10',
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            const result = await riskManager.checkTradeRisk(tradeRequest);
            (0, vitest_1.expect)(result.allowed).toBe(false);
            (0, vitest_1.expect)(result.reason).toContain('exceeds daily volume limit');
        });
    });
    (0, vitest_1.describe)('代币白名单/黑名单', () => {
        (0, vitest_1.test)('启用白名单时应该只允许白名单代币', async () => {
            riskManager = new RiskManager_1.RiskManager({
                maxDailyVolume: '100',
                maxSingleTrade: '10',
                requireWhitelist: true,
                blacklistEnabled: false,
                maxConcurrentTrades: 5,
                coolDownPeriod: 60
            });
            // 添加代币到白名单
            await riskManager.addToWhitelist('0x55d398326f99059fF775485246999027B3197955'); // USDT
            const allowedTrade = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955', // 白名单代币
                amountIn: '1',
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            const blockedTrade = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // 非白名单代币
                amountIn: '1',
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            const allowedResult = await riskManager.checkTradeRisk(allowedTrade);
            const blockedResult = await riskManager.checkTradeRisk(blockedTrade);
            (0, vitest_1.expect)(allowedResult.allowed).toBe(true);
            (0, vitest_1.expect)(blockedResult.allowed).toBe(false);
            (0, vitest_1.expect)(blockedResult.reason).toContain('not whitelisted');
        });
        (0, vitest_1.test)('黑名单代币应该被拒绝', async () => {
            // 添加代币到黑名单
            await riskManager.addToBlacklist('0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'); // CAKE
            const tradeRequest = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // 黑名单代币
                amountIn: '1',
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            const result = await riskManager.checkTradeRisk(tradeRequest);
            (0, vitest_1.expect)(result.allowed).toBe(false);
            (0, vitest_1.expect)(result.reason).toContain('blacklisted');
        });
    });
    (0, vitest_1.describe)('并发交易限制', () => {
        (0, vitest_1.test)('应该限制并发交易数量', async () => {
            // 开始5个并发交易
            const trades = [];
            for (let i = 0; i < 5; i++) {
                const trade = {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: `0x123456789012345678901234567890123456789${i}`
                };
                await riskManager.startTrade(trade);
                trades.push(trade);
            }
            // 第6个交易应该被拒绝
            const newTrade = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            const result = await riskManager.checkTradeRisk(newTrade);
            (0, vitest_1.expect)(result.allowed).toBe(false);
            (0, vitest_1.expect)(result.reason).toContain('maximum concurrent trades');
            // 完成一个交易后应该可以开始新交易
            await riskManager.completeTrade(trades[0], 'success');
            const newResult = await riskManager.checkTradeRisk(newTrade);
            (0, vitest_1.expect)(newResult.allowed).toBe(true);
        });
    });
    (0, vitest_1.describe)('冷却期机制', () => {
        (0, vitest_1.test)('应该在冷却期内阻止相同钱包的交易', async () => {
            const walletAddress = '0x1234567890123456789012345678901234567890';
            const trade = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress
            };
            // 第一个交易应该被允许
            const firstResult = await riskManager.checkTradeRisk(trade);
            (0, vitest_1.expect)(firstResult.allowed).toBe(true);
            await riskManager.recordTrade(trade, 'success');
            // 立即进行第二个交易应该被拒绝（冷却期）
            const secondResult = await riskManager.checkTradeRisk(trade);
            (0, vitest_1.expect)(secondResult.allowed).toBe(false);
            (0, vitest_1.expect)(secondResult.reason).toContain('cooldown period');
        });
        (0, vitest_1.test)('不同钱包不应该受冷却期影响', async () => {
            const trade1 = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: '0x1111111111111111111111111111111111111111'
            };
            const trade2 = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: '0x2222222222222222222222222222222222222222'
            };
            await riskManager.recordTrade(trade1, 'success');
            // 不同钱包的交易应该被允许
            const result = await riskManager.checkTradeRisk(trade2);
            (0, vitest_1.expect)(result.allowed).toBe(true);
        });
    });
    (0, vitest_1.describe)('风险评分', () => {
        (0, vitest_1.test)('应该根据交易特征计算风险等级', async () => {
            // 低风险交易：小额，常见代币对
            const lowRiskTrade = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '0.1',
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            // 高风险交易：大额，不常见代币
            const highRiskTrade = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x1234567890123456789012345678901234567890', // 假设的不知名代币
                amountIn: '5',
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            const lowRiskResult = await riskManager.checkTradeRisk(lowRiskTrade);
            const highRiskResult = await riskManager.checkTradeRisk(highRiskTrade);
            (0, vitest_1.expect)(lowRiskResult.risk).toBe('low');
            (0, vitest_1.expect)(['medium', 'high']).toContain(highRiskResult.risk);
        });
    });
    (0, vitest_1.describe)('统计和报告', () => {
        (0, vitest_1.test)('应该正确记录交易统计', async () => {
            const trade = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: '0x1234567890123456789012345678901234567890'
            };
            await riskManager.recordTrade(trade, 'success');
            await riskManager.recordTrade(trade, 'failed');
            const stats = await riskManager.getTradeStatistics();
            (0, vitest_1.expect)(stats.totalTrades).toBe(2);
            (0, vitest_1.expect)(stats.successfulTrades).toBe(1);
            (0, vitest_1.expect)(stats.failedTrades).toBe(1);
            (0, vitest_1.expect)(stats.successRate).toBe(0.5);
        });
        (0, vitest_1.test)('应该能够生成风险报告', async () => {
            // 执行一些交易
            for (let i = 0; i < 5; i++) {
                const trade = {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: (i + 1).toString(),
                    walletAddress: `0x123456789012345678901234567890123456789${i}`
                };
                await riskManager.recordTrade(trade, i % 2 === 0 ? 'success' : 'failed');
            }
            const report = await riskManager.generateRiskReport();
            (0, vitest_1.expect)(report).toBeDefined();
            (0, vitest_1.expect)(report.totalVolume).toBeGreaterThan(0);
            (0, vitest_1.expect)(report.riskDistribution).toBeDefined();
            (0, vitest_1.expect)(report.recommendedActions).toBeInstanceOf(Array);
        });
    });
});
//# sourceMappingURL=risk-manager.test.js.map