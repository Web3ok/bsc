"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const BatchExecutor_1 = require("../../src/batch/BatchExecutor");
// Mock dependencies
const mockWalletManager = {
    getWallet: vitest_1.vi.fn(),
    getAllWallets: vitest_1.vi.fn(),
    getWalletsByGroup: vitest_1.vi.fn()
};
const mockDEXIntegration = {
    executeTrade: vitest_1.vi.fn(),
    getQuote: vitest_1.vi.fn(),
    estimateGas: vitest_1.vi.fn()
};
vitest_1.vi.mock('../../src/wallet', () => ({
    WalletManager: vitest_1.vi.fn(() => mockWalletManager)
}));
vitest_1.vi.mock('../../src/dex/DEXIntegration', () => ({
    DEXIntegration: vitest_1.vi.fn(() => mockDEXIntegration)
}));
(0, vitest_1.describe)('批量执行引擎测试', () => {
    let batchExecutor;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        batchExecutor = new BatchExecutor_1.BatchExecutor({
            maxConcurrent: 3,
            defaultDelay: 1000,
            retryAttempts: 2
        });
    });
    (0, vitest_1.describe)('批量交易执行', () => {
        (0, vitest_1.test)('应该能够并发执行多个交易', async () => {
            const trades = [
                {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: '0x1111111111111111111111111111111111111111'
                },
                {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: '0x2222222222222222222222222222222222222222'
                },
                {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: '0x3333333333333333333333333333333333333333'
                }
            ];
            // Mock成功的交易执行
            mockDEXIntegration.executeTrade.mockResolvedValue({
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '150000'
            });
            const startTime = Date.now();
            const results = await batchExecutor.executeParallel(trades);
            const endTime = Date.now();
            (0, vitest_1.expect)(results).toHaveLength(3);
            (0, vitest_1.expect)(results.every(r => r.success)).toBe(true);
            (0, vitest_1.expect)(mockDEXIntegration.executeTrade).toHaveBeenCalledTimes(3);
            // 并发执行应该比顺序执行快
            (0, vitest_1.expect)(endTime - startTime).toBeLessThan(1000); // 应该在1秒内完成
        });
        (0, vitest_1.test)('应该能够顺序执行交易', async () => {
            const trades = [
                {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: '0x1111111111111111111111111111111111111111'
                },
                {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: '0x2222222222222222222222222222222222222222'
                }
            ];
            // Mock带延迟的交易执行
            mockDEXIntegration.executeTrade.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '150000'
            }), 100)));
            const startTime = Date.now();
            const results = await batchExecutor.executeSequential(trades, 50);
            const endTime = Date.now();
            (0, vitest_1.expect)(results).toHaveLength(2);
            (0, vitest_1.expect)(results.every(r => r.success)).toBe(true);
            // 顺序执行应该包含延迟时间
            (0, vitest_1.expect)(endTime - startTime).toBeGreaterThan(200); // 2 * 100ms 执行时间 + 50ms 延迟
        });
        (0, vitest_1.test)('应该能够按时间错开执行交易', async () => {
            const trades = Array.from({ length: 5 }, (_, i) => ({
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: `0x111111111111111111111111111111111111111${i}`
            }));
            mockDEXIntegration.executeTrade.mockResolvedValue({
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '150000'
            });
            const results = await batchExecutor.executeStaggered(trades, 100, 2);
            (0, vitest_1.expect)(results).toHaveLength(5);
            (0, vitest_1.expect)(results.every(r => r.success)).toBe(true);
            (0, vitest_1.expect)(mockDEXIntegration.executeTrade).toHaveBeenCalledTimes(5);
        });
    });
    (0, vitest_1.describe)('错误处理和重试', () => {
        (0, vitest_1.test)('应该能够重试失败的交易', async () => {
            const trade = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: '0x1111111111111111111111111111111111111111'
            };
            // 第一次失败，第二次成功
            mockDEXIntegration.executeTrade
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '150000'
            });
            const result = await batchExecutor.executeWithRetry(trade, 2);
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(mockDEXIntegration.executeTrade).toHaveBeenCalledTimes(2);
        });
        (0, vitest_1.test)('应该在达到最大重试次数后失败', async () => {
            const trade = {
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: '0x1111111111111111111111111111111111111111'
            };
            mockDEXIntegration.executeTrade.mockRejectedValue(new Error('Persistent error'));
            const result = await batchExecutor.executeWithRetry(trade, 2);
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toContain('Persistent error');
            (0, vitest_1.expect)(mockDEXIntegration.executeTrade).toHaveBeenCalledTimes(3); // 初始调用 + 2次重试
        });
        (0, vitest_1.test)('部分失败的批量交易应该返回混合结果', async () => {
            const trades = [
                {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: '0x1111111111111111111111111111111111111111'
                },
                {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: '0x2222222222222222222222222222222222222222'
                }
            ];
            // 第一个成功，第二个失败
            mockDEXIntegration.executeTrade
                .mockResolvedValueOnce({
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '150000'
            })
                .mockRejectedValueOnce(new Error('Insufficient balance'));
            const results = await batchExecutor.executeParallel(trades);
            (0, vitest_1.expect)(results).toHaveLength(2);
            (0, vitest_1.expect)(results[0].success).toBe(true);
            (0, vitest_1.expect)(results[1].success).toBe(false);
            (0, vitest_1.expect)(results[1].error).toContain('Insufficient balance');
        });
    });
    (0, vitest_1.describe)('批量转账', () => {
        (0, vitest_1.test)('应该能够批量转账到多个地址', async () => {
            const transfers = [
                {
                    from: '0x1111111111111111111111111111111111111111',
                    to: '0x2222222222222222222222222222222222222222',
                    amount: '1',
                    token: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
                },
                {
                    from: '0x1111111111111111111111111111111111111111',
                    to: '0x3333333333333333333333333333333333333333',
                    amount: '1',
                    token: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
                }
            ];
            const mockTransferResult = {
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '21000'
            };
            // Mock transfer method
            const mockTransfer = vitest_1.vi.fn().mockResolvedValue(mockTransferResult);
            batchExecutor['transfer'] = mockTransfer;
            const results = await batchExecutor.executeBatchTransfer(transfers);
            (0, vitest_1.expect)(results).toHaveLength(2);
            (0, vitest_1.expect)(results.every(r => r.success)).toBe(true);
            (0, vitest_1.expect)(mockTransfer).toHaveBeenCalledTimes(2);
        });
        (0, vitest_1.test)('应该能够从多个钱包转账到单个地址', async () => {
            const consolidationTransfers = [
                {
                    from: '0x1111111111111111111111111111111111111111',
                    to: '0xCentralWallet1111111111111111111111111111',
                    amount: '5',
                    token: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
                },
                {
                    from: '0x2222222222222222222222222222222222222222',
                    to: '0xCentralWallet1111111111111111111111111111',
                    amount: '3',
                    token: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
                }
            ];
            const mockTransferResult = {
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '21000'
            };
            const mockTransfer = vitest_1.vi.fn().mockResolvedValue(mockTransferResult);
            batchExecutor['transfer'] = mockTransfer;
            const results = await batchExecutor.executeBatchTransfer(consolidationTransfers);
            (0, vitest_1.expect)(results).toHaveLength(2);
            (0, vitest_1.expect)(results.every(r => r.success)).toBe(true);
        });
    });
    (0, vitest_1.describe)('性能和限制', () => {
        (0, vitest_1.test)('应该限制最大并发数', async () => {
            const trades = Array.from({ length: 10 }, (_, i) => ({
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: `0x111111111111111111111111111111111111111${i}`
            }));
            let activeTrades = 0;
            let maxConcurrent = 0;
            mockDEXIntegration.executeTrade.mockImplementation(() => {
                activeTrades++;
                maxConcurrent = Math.max(maxConcurrent, activeTrades);
                return new Promise(resolve => {
                    setTimeout(() => {
                        activeTrades--;
                        resolve({
                            success: true,
                            txHash: '0xabcdef123456789',
                            gasUsed: '150000'
                        });
                    }, 100);
                });
            });
            await batchExecutor.executeParallel(trades);
            (0, vitest_1.expect)(maxConcurrent).toBeLessThanOrEqual(3); // 配置的最大并发数
        });
        (0, vitest_1.test)('应该能够取消正在执行的批量操作', async () => {
            const trades = Array.from({ length: 5 }, (_, i) => ({
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: `0x111111111111111111111111111111111111111${i}`
            }));
            mockDEXIntegration.executeTrade.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '150000'
            }), 1000)));
            const batchPromise = batchExecutor.executeParallel(trades);
            // 500ms后取消
            setTimeout(() => {
                batchExecutor.cancelAll();
            }, 500);
            const results = await batchPromise;
            // 应该有一些交易被取消
            (0, vitest_1.expect)(results.some(r => !r.success && r.error?.includes('cancelled'))).toBe(true);
        });
    });
    (0, vitest_1.describe)('监控和报告', () => {
        (0, vitest_1.test)('应该提供批量操作的进度报告', async () => {
            const trades = Array.from({ length: 5 }, (_, i) => ({
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: `0x111111111111111111111111111111111111111${i}`
            }));
            let progressUpdates = [];
            batchExecutor.on('progress', (progress) => {
                progressUpdates.push(progress);
            });
            mockDEXIntegration.executeTrade.mockResolvedValue({
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '150000'
            });
            await batchExecutor.executeSequential(trades);
            (0, vitest_1.expect)(progressUpdates.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(progressUpdates[progressUpdates.length - 1].completed).toBe(5);
            (0, vitest_1.expect)(progressUpdates[progressUpdates.length - 1].total).toBe(5);
        });
        (0, vitest_1.test)('应该生成批量操作的执行报告', async () => {
            const trades = [
                {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: '0x1111111111111111111111111111111111111111'
                },
                {
                    type: 'buy',
                    tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                    amountIn: '1',
                    walletAddress: '0x2222222222222222222222222222222222222222'
                }
            ];
            mockDEXIntegration.executeTrade
                .mockResolvedValueOnce({
                success: true,
                txHash: '0xabcdef123456789',
                gasUsed: '150000'
            })
                .mockRejectedValueOnce(new Error('Failed'));
            const results = await batchExecutor.executeParallel(trades);
            const report = batchExecutor.generateReport(results);
            (0, vitest_1.expect)(report.total).toBe(2);
            (0, vitest_1.expect)(report.successful).toBe(1);
            (0, vitest_1.expect)(report.failed).toBe(1);
            (0, vitest_1.expect)(report.successRate).toBe(0.5);
            (0, vitest_1.expect)(report.totalGasUsed).toBe('150000');
            (0, vitest_1.expect)(report.errors).toHaveLength(1);
        });
    });
});
//# sourceMappingURL=batch-execution.test.js.map