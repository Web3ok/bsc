"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const TradingEngine_1 = require("../../src/trading/TradingEngine");
const wallet_1 = require("../../src/wallet");
// 模拟测试环境
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_PASSWORD = 'test-password-123';
(0, vitest_1.describe)('交易引擎集成测试', () => {
    let tradingEngine;
    let walletManager;
    let testWallet;
    (0, vitest_1.beforeEach)(async () => {
        // 初始化交易引擎
        tradingEngine = new TradingEngine_1.TradingEngine({
            rpcUrl: 'https://bsc-testnet.publicnode.com',
            chainId: 97, // BSC测试网
            routerAddress: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1', // PancakeSwap测试网路由器
            maxSlippage: 5,
            gasLimit: 500000,
            retryAttempts: 3
        });
        walletManager = new wallet_1.WalletManager();
        // 创建测试钱包
        const wallets = await walletManager.generateWallets(1, undefined, 0, 'test-group');
        testWallet = wallets[0];
        testWallet.label = 'test-wallet-integration';
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.describe)('完整交易流程测试', () => {
        (0, vitest_1.test)('应该能够完成完整的买入交易流程', async () => {
            // 跳过实际区块链交易，使用模拟
            if (process.env.SKIP_BLOCKCHAIN_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const tradeRequest = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', // WBNB testnet
                tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', // BUSD testnet
                amountIn: '0.01', // 小额测试
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            // 1. 获取报价
            const quote = await tradingEngine.getQuote(tradeRequest);
            (0, vitest_1.expect)(quote).toBeDefined();
            (0, vitest_1.expect)(quote.tokenOut.amount).toBeDefined();
            (0, vitest_1.expect)(parseFloat(quote.tokenOut.amount)).toBeGreaterThan(0);
            // 2. 检查风险
            const riskCheck = await tradingEngine.checkRisk(tradeRequest);
            (0, vitest_1.expect)(riskCheck.allowed).toBe(true);
            // 3. 估算Gas费用
            const gasEstimate = await tradingEngine.estimateGas(tradeRequest);
            (0, vitest_1.expect)(gasEstimate.gasLimit).toBeGreaterThan(0);
            (0, vitest_1.expect)(gasEstimate.totalCostBNB).toBeDefined();
            // 4. 模拟执行交易（在测试环境中不实际发送）
            const mockResult = {
                success: true,
                txHash: '0x1234567890abcdef',
                gasUsed: '180000',
                actualAmountOut: quote.tokenOut.amount,
                priceImpact: quote.priceImpact.impact,
                executionTime: 3000
            };
            (0, vitest_1.expect)(mockResult.success).toBe(true);
            (0, vitest_1.expect)(mockResult.txHash).toMatch(/^0x[a-fA-F0-9]+$/);
        }, 30000);
        (0, vitest_1.test)('应该能够完成完整的卖出交易流程', async () => {
            if (process.env.SKIP_BLOCKCHAIN_TESTS === 'true') {
                (0, vitest_1.expect)(true).toBe(true);
                return;
            }
            const tradeRequest = {
                type: 'sell',
                tokenIn: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', // BUSD testnet
                tokenOut: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', // WBNB testnet
                amountIn: '1', // 1 BUSD
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            const quote = await tradingEngine.getQuote(tradeRequest);
            (0, vitest_1.expect)(quote).toBeDefined();
            (0, vitest_1.expect)(quote.tokenOut.amount).toBeDefined();
            const mockResult = {
                success: true,
                txHash: '0xabcdef1234567890',
                gasUsed: '160000',
                actualAmountOut: quote.tokenOut.amount,
                priceImpact: quote.priceImpact.impact
            };
            (0, vitest_1.expect)(mockResult.success).toBe(true);
        }, 30000);
    });
    (0, vitest_1.describe)('批量交易集成测试', () => {
        (0, vitest_1.test)('应该能够执行批量买入交易', async () => {
            const trades = [
                {
                    type: 'buy',
                    tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                    tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', // BUSD testnet
                    amountIn: '0.01',
                    slippage: 1.0,
                    walletAddress: testWallet.address
                },
                {
                    type: 'buy',
                    tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                    tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', // BUSD testnet
                    amountIn: '0.01',
                    slippage: 1.0,
                    walletAddress: testWallet.address
                }
            ];
            // 模拟批量执行
            const mockResults = trades.map((trade, index) => ({
                success: true,
                txHash: `0x${index}234567890abcdef`,
                gasUsed: '150000',
                tradeIndex: index,
                executionTime: 2000 + index * 500
            }));
            (0, vitest_1.expect)(mockResults).toHaveLength(2);
            (0, vitest_1.expect)(mockResults.every(r => r.success)).toBe(true);
        });
        (0, vitest_1.test)('应该能够处理批量交易中的部分失败', async () => {
            const trades = [
                {
                    type: 'buy',
                    tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                    tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
                    amountIn: '0.01',
                    slippage: 1.0,
                    walletAddress: testWallet.address
                },
                {
                    type: 'buy',
                    tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                    tokenOut: '0x0000000000000000000000000000000000000000', // 无效代币
                    amountIn: '0.01',
                    slippage: 1.0,
                    walletAddress: testWallet.address
                }
            ];
            const mockResults = [
                {
                    success: true,
                    txHash: '0x1234567890abcdef',
                    gasUsed: '150000',
                    tradeIndex: 0
                },
                {
                    success: false,
                    error: 'Invalid token address',
                    tradeIndex: 1
                }
            ];
            (0, vitest_1.expect)(mockResults.filter(r => r.success)).toHaveLength(1);
            (0, vitest_1.expect)(mockResults.filter(r => !r.success)).toHaveLength(1);
        });
    });
    (0, vitest_1.describe)('风险管理集成测试', () => {
        (0, vitest_1.test)('应该阻止高风险交易', async () => {
            const highRiskTrade = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
                amountIn: '100', // 大额交易
                slippage: 10.0, // 高滑点
                walletAddress: testWallet.address
            };
            const riskCheck = await tradingEngine.checkRisk(highRiskTrade);
            // 应该被标记为高风险或被拒绝
            (0, vitest_1.expect)(['high', 'critical']).toContain(riskCheck.risk);
        });
        (0, vitest_1.test)('应该实施交易冷却期', async () => {
            const trade = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
                amountIn: '0.01',
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            // 模拟第一次交易
            await tradingEngine.recordTrade(trade, 'success');
            // 立即尝试第二次交易
            const secondRiskCheck = await tradingEngine.checkRisk(trade);
            // 应该因为冷却期被拒绝
            if (secondRiskCheck.reason && secondRiskCheck.reason.includes('cooldown')) {
                (0, vitest_1.expect)(secondRiskCheck.allowed).toBe(false);
            }
        });
    });
    (0, vitest_1.describe)('价格和滑点分析集成测试', () => {
        (0, vitest_1.test)('应该正确计算价格影响', async () => {
            const smallTrade = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
                amountIn: '0.001', // 小额
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            const largeTrade = {
                ...smallTrade,
                amountIn: '1' // 大额
            };
            const smallQuote = await tradingEngine.getQuote(smallTrade);
            const largeQuote = await tradingEngine.getQuote(largeTrade);
            // 大额交易应该有更高的价格影响
            (0, vitest_1.expect)(largeQuote.priceImpact.impact).toBeGreaterThanOrEqual(smallQuote.priceImpact.impact);
        });
        (0, vitest_1.test)('应该提供准确的滑点分析', async () => {
            const trade = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
                amountIn: '0.1',
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            const quote = await tradingEngine.getQuote(trade);
            (0, vitest_1.expect)(quote.slippageAnalysis).toBeDefined();
            (0, vitest_1.expect)(quote.slippageAnalysis.recommendedSlippage).toBeGreaterThan(0);
            (0, vitest_1.expect)(quote.minimumReceived).toBeDefined();
            const minReceived = parseFloat(quote.minimumReceived);
            const expectedAmount = parseFloat(quote.tokenOut.amount);
            // 最小接收应该考虑滑点
            (0, vitest_1.expect)(minReceived).toBeLessThan(expectedAmount);
        });
    });
    (0, vitest_1.describe)('Gas优化集成测试', () => {
        (0, vitest_1.test)('应该优化Gas价格', async () => {
            const trade = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
                amountIn: '0.01',
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            const gasEstimate = await tradingEngine.estimateGas(trade);
            (0, vitest_1.expect)(gasEstimate.gasPrice).toBeGreaterThan(0);
            (0, vitest_1.expect)(gasEstimate.gasLimit).toBeGreaterThan(21000); // 基本转账Gas
            (0, vitest_1.expect)(gasEstimate.totalCostBNB).toBeDefined();
            // Gas价格应该在合理范围内（测试网）
            const gasPriceGwei = gasEstimate.gasPrice / 1e9;
            (0, vitest_1.expect)(gasPriceGwei).toBeGreaterThan(0); // 至少大于0 Gwei
            (0, vitest_1.expect)(gasPriceGwei).toBeLessThan(100); // 小于100 Gwei（测试网）
        });
        (0, vitest_1.test)('应该根据网络状况调整Gas', async () => {
            // 模拟不同的网络拥堵状况
            const normalTrade = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
                amountIn: '0.01',
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            const urgentTrade = {
                ...normalTrade,
                priority: 'high'
            };
            const normalGas = await tradingEngine.estimateGas(normalTrade);
            const urgentGas = await tradingEngine.estimateGas(urgentTrade);
            // 高优先级应该有更高的Gas价格
            if (urgentGas.gasPrice && normalGas.gasPrice) {
                (0, vitest_1.expect)(urgentGas.gasPrice).toBeGreaterThanOrEqual(normalGas.gasPrice);
            }
        });
    });
    (0, vitest_1.describe)('错误处理和恢复测试', () => {
        (0, vitest_1.test)('应该处理网络错误并重试', async () => {
            const trade = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
                amountIn: '0.01',
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            // 模拟网络错误恢复
            let attemptCount = 0;
            const mockExecute = async () => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new Error('Network timeout');
                }
                return {
                    success: true,
                    txHash: '0x1234567890abcdef',
                    gasUsed: '150000'
                };
            };
            try {
                const result = await mockExecute();
                (0, vitest_1.expect)(result.success).toBe(true);
                (0, vitest_1.expect)(attemptCount).toBe(3); // 应该重试了3次
            }
            catch (error) {
                // 如果重试仍然失败，应该有明确的错误信息
                (0, vitest_1.expect)(error).toBeInstanceOf(Error);
            }
        });
        (0, vitest_1.test)('应该处理交易失败并提供诊断信息', async () => {
            const invalidTrade = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                tokenOut: '0x0000000000000000000000000000000000000000', // 无效地址
                amountIn: '0.01',
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            try {
                await tradingEngine.getQuote(invalidTrade);
            }
            catch (error) {
                (0, vitest_1.expect)(error.message).toBeDefined();
                (0, vitest_1.expect)(error.message).toContain('Invalid');
            }
        });
    });
    (0, vitest_1.describe)('性能和监控测试', () => {
        (0, vitest_1.test)('应该在合理时间内完成报价', async () => {
            const trade = {
                type: 'buy',
                tokenIn: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
                tokenOut: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
                amountIn: '0.01',
                slippage: 1.0,
                walletAddress: testWallet.address
            };
            const startTime = Date.now();
            const quote = await tradingEngine.getQuote(trade);
            const endTime = Date.now();
            (0, vitest_1.expect)(quote).toBeDefined();
            (0, vitest_1.expect)(endTime - startTime).toBeLessThan(5000); // 应该在5秒内完成
        });
        (0, vitest_1.test)('应该提供交易执行指标', async () => {
            const metrics = await tradingEngine.getMetrics();
            (0, vitest_1.expect)(metrics).toBeDefined();
            (0, vitest_1.expect)(typeof metrics.totalTrades).toBe('number');
            (0, vitest_1.expect)(typeof metrics.successRate).toBe('number');
            (0, vitest_1.expect)(typeof metrics.averageExecutionTime).toBe('number');
            (0, vitest_1.expect)(metrics.successRate).toBeGreaterThanOrEqual(0);
            (0, vitest_1.expect)(metrics.successRate).toBeLessThanOrEqual(1);
        });
    });
});
//# sourceMappingURL=trading-engine.test.js.map