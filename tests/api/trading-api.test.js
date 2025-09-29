"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
// API端点测试 - 模拟API服务器进行测试
(0, vitest_1.describe)('交易API端点测试', () => {
    let app;
    (0, vitest_1.beforeAll)(() => {
        // 创建测试用的Express应用
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        // Mock交易路由
        app.post('/api/trading/quote', (req, res) => {
            const { tokenIn, tokenOut, amountIn } = req.body;
            if (!tokenIn || !tokenOut || !amountIn) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameters'
                });
            }
            // 模拟报价响应
            res.json({
                success: true,
                data: {
                    tokenIn: {
                        address: tokenIn,
                        symbol: 'WBNB',
                        amount: amountIn
                    },
                    tokenOut: {
                        address: tokenOut,
                        symbol: 'USDT',
                        amount: (parseFloat(amountIn) * 300).toString() // 假设1 BNB = 300 USDT
                    },
                    priceImpact: {
                        impact: 0.15,
                        category: 'low'
                    },
                    slippageAnalysis: {
                        recommendedSlippage: 0.5,
                        reason: 'Low volatility pair'
                    },
                    minimumReceived: (parseFloat(amountIn) * 300 * 0.995).toString(),
                    executionPrice: '300',
                    gasEstimate: '150000',
                    totalCostBNB: '0.0075',
                    recommendation: 'proceed'
                }
            });
        });
        app.post('/api/trading/execute', (req, res) => {
            const { walletAddress, tokenIn, tokenOut, amountIn, slippage } = req.body;
            if (!walletAddress || !tokenIn || !tokenOut || !amountIn) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required parameters'
                });
            }
            // 模拟余额不足的情况
            if (parseFloat(amountIn) > 10) {
                return res.status(400).json({
                    success: false,
                    error: 'Insufficient balance'
                });
            }
            // 模拟成功的交易执行
            res.json({
                success: true,
                data: {
                    txHash: '0x1234567890abcdef1234567890abcdef12345678',
                    status: 'confirmed',
                    gasUsed: '142350',
                    actualAmountOut: (parseFloat(amountIn) * 299.5).toString(),
                    priceImpact: 0.15,
                    executionTime: 2500
                }
            });
        });
        app.post('/api/trading/batch', (req, res) => {
            const { trades, strategy, maxConcurrent } = req.body;
            if (!trades || !Array.isArray(trades) || trades.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid trades array'
                });
            }
            // 模拟批量交易结果
            const results = trades.map((trade, index) => ({
                tradeIndex: index,
                success: index < trades.length - 1, // 最后一个交易失败
                txHash: index < trades.length - 1 ? `0x${index}234567890abcdef` : null,
                error: index === trades.length - 1 ? 'Network timeout' : null,
                gasUsed: index < trades.length - 1 ? '150000' : null,
                executionTime: 2000 + index * 500
            }));
            res.json({
                success: true,
                data: {
                    batchId: 'batch_' + Date.now(),
                    strategy,
                    results,
                    summary: {
                        total: trades.length,
                        successful: results.filter(r => r.success).length,
                        failed: results.filter(r => !r.success).length,
                        totalGasUsed: results.reduce((sum, r) => sum + (r.gasUsed ? parseInt(r.gasUsed) : 0), 0).toString()
                    }
                }
            });
        });
        app.get('/api/trading/history', (req, res) => {
            const { limit = 50, offset = 0, walletAddress } = req.query;
            // 模拟交易历史数据
            const mockHistory = Array.from({ length: 5 }, (_, index) => ({
                id: `trade_${Date.now()}_${index}`,
                type: index % 2 === 0 ? 'buy' : 'sell',
                tokenIn: {
                    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                    symbol: 'WBNB',
                    amount: '1'
                },
                tokenOut: {
                    address: '0x55d398326f99059fF775485246999027B3197955',
                    symbol: 'USDT',
                    amount: '300'
                },
                walletAddress: walletAddress || '0x1234567890123456789012345678901234567890',
                txHash: `0x${index}abcdef1234567890`,
                status: index === 2 ? 'failed' : 'completed',
                timestamp: new Date(Date.now() - index * 3600000).toISOString(),
                gasUsed: index === 2 ? null : '150000',
                pnl: index % 2 === 0 ? '+5.2' : '-2.1'
            }));
            res.json({
                success: true,
                data: mockHistory.slice(parseInt(offset.toString()), parseInt(offset.toString()) + parseInt(limit.toString())),
                pagination: {
                    total: mockHistory.length,
                    limit: parseInt(limit.toString()),
                    offset: parseInt(offset.toString())
                }
            });
        });
        app.get('/api/trading/stats', (req, res) => {
            res.json({
                success: true,
                data: {
                    totalTrades: 1250,
                    successfulTrades: 1185,
                    failedTrades: 65,
                    successRate: 0.948,
                    totalVolume: '1250.5',
                    totalPnL: '+125.8',
                    averageExecutionTime: 2350,
                    bestPerformingPair: 'WBNB/USDT',
                    worstPerformingPair: 'CAKE/BUSD'
                }
            });
        });
    });
    (0, vitest_1.describe)('POST /api/trading/quote', () => {
        (0, vitest_1.test)('应该返回有效的交易报价', async () => {
            const quoteRequest = {
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1'
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/trading/quote')
                .send(quoteRequest)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.tokenOut.amount).toBe('300');
            (0, vitest_1.expect)(response.body.data.priceImpact.impact).toBe(0.15);
            (0, vitest_1.expect)(response.body.data.slippageAnalysis.recommendedSlippage).toBe(0.5);
            (0, vitest_1.expect)(response.body.data.minimumReceived).toBeDefined();
            (0, vitest_1.expect)(response.body.data.gasEstimate).toBeDefined();
        });
        (0, vitest_1.test)('应该拒绝缺少参数的请求', async () => {
            const invalidRequest = {
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
                // 缺少 tokenOut 和 amountIn
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/trading/quote')
                .send(invalidRequest)
                .expect(400);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Missing required parameters');
        });
        (0, vitest_1.test)('应该处理不同的交易金额', async () => {
            const smallTrade = {
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '0.1'
            };
            const largeTrade = {
                ...smallTrade,
                amountIn: '10'
            };
            const smallResponse = await (0, supertest_1.default)(app)
                .post('/api/trading/quote')
                .send(smallTrade)
                .expect(200);
            const largeResponse = await (0, supertest_1.default)(app)
                .post('/api/trading/quote')
                .send(largeTrade)
                .expect(200);
            (0, vitest_1.expect)(smallResponse.body.data.tokenOut.amount).toBe('30');
            (0, vitest_1.expect)(largeResponse.body.data.tokenOut.amount).toBe('3000');
        });
    });
    (0, vitest_1.describe)('POST /api/trading/execute', () => {
        (0, vitest_1.test)('应该成功执行交易', async () => {
            const executeRequest = {
                walletAddress: '0x1234567890123456789012345678901234567890',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                slippage: 0.5
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/trading/execute')
                .send(executeRequest)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.txHash).toMatch(/^0x[a-fA-F0-9]{40}$/);
            (0, vitest_1.expect)(response.body.data.status).toBe('confirmed');
            (0, vitest_1.expect)(response.body.data.gasUsed).toBe('142350');
            (0, vitest_1.expect)(response.body.data.actualAmountOut).toBe('299.5');
        });
        (0, vitest_1.test)('应该拒绝余额不足的交易', async () => {
            const executeRequest = {
                walletAddress: '0x1234567890123456789012345678901234567890',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '100', // 超过余额
                slippage: 0.5
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/trading/execute')
                .send(executeRequest)
                .expect(400);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Insufficient balance');
        });
        (0, vitest_1.test)('应该验证必需参数', async () => {
            const incompleteRequest = {
                walletAddress: '0x1234567890123456789012345678901234567890',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'
                // 缺少 tokenOut, amountIn
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/trading/execute')
                .send(incompleteRequest)
                .expect(400);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Missing required parameters');
        });
    });
    (0, vitest_1.describe)('POST /api/trading/batch', () => {
        (0, vitest_1.test)('应该成功执行批量交易', async () => {
            const batchRequest = {
                trades: [
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
                ],
                strategy: 'parallel',
                maxConcurrent: 3
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/trading/batch')
                .send(batchRequest)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.batchId).toMatch(/^batch_\d+$/);
            (0, vitest_1.expect)(response.body.data.results).toHaveLength(3);
            (0, vitest_1.expect)(response.body.data.summary.total).toBe(3);
            (0, vitest_1.expect)(response.body.data.summary.successful).toBe(2);
            (0, vitest_1.expect)(response.body.data.summary.failed).toBe(1);
        });
        (0, vitest_1.test)('应该拒绝空的交易数组', async () => {
            const invalidRequest = {
                trades: [],
                strategy: 'parallel'
            };
            const response = await (0, supertest_1.default)(app)
                .post('/api/trading/batch')
                .send(invalidRequest)
                .expect(400);
            (0, vitest_1.expect)(response.body.success).toBe(false);
            (0, vitest_1.expect)(response.body.error).toContain('Invalid trades array');
        });
        (0, vitest_1.test)('应该处理不同的执行策略', async () => {
            const strategies = ['parallel', 'sequential', 'staggered'];
            for (const strategy of strategies) {
                const batchRequest = {
                    trades: [
                        {
                            type: 'buy',
                            tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                            tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                            amountIn: '1',
                            walletAddress: '0x1111111111111111111111111111111111111111'
                        }
                    ],
                    strategy
                };
                const response = await (0, supertest_1.default)(app)
                    .post('/api/trading/batch')
                    .send(batchRequest)
                    .expect(200);
                (0, vitest_1.expect)(response.body.data.strategy).toBe(strategy);
            }
        });
    });
    (0, vitest_1.describe)('GET /api/trading/history', () => {
        (0, vitest_1.test)('应该返回交易历史', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/history')
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(Array.isArray(response.body.data)).toBe(true);
            (0, vitest_1.expect)(response.body.data).toHaveLength(5);
            (0, vitest_1.expect)(response.body.pagination).toBeDefined();
            (0, vitest_1.expect)(response.body.pagination.total).toBe(5);
        });
        (0, vitest_1.test)('应该支持分页参数', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/history?limit=2&offset=1')
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data).toHaveLength(2);
            (0, vitest_1.expect)(response.body.pagination.limit).toBe(2);
            (0, vitest_1.expect)(response.body.pagination.offset).toBe(1);
        });
        (0, vitest_1.test)('应该支持钱包地址筛选', async () => {
            const walletAddress = '0x1234567890123456789012345678901234567890';
            const response = await (0, supertest_1.default)(app)
                .get(`/api/trading/history?walletAddress=${walletAddress}`)
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            (0, vitest_1.expect)(response.body.data.every((trade) => trade.walletAddress === walletAddress)).toBe(true);
        });
        (0, vitest_1.test)('应该包含完整的交易信息', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/history')
                .expect(200);
            const trade = response.body.data[0];
            (0, vitest_1.expect)(trade.id).toBeDefined();
            (0, vitest_1.expect)(['buy', 'sell']).toContain(trade.type);
            (0, vitest_1.expect)(trade.tokenIn).toBeDefined();
            (0, vitest_1.expect)(trade.tokenOut).toBeDefined();
            (0, vitest_1.expect)(trade.walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
            (0, vitest_1.expect)(trade.txHash).toMatch(/^0x[a-fA-F0-9]+$/);
            (0, vitest_1.expect)(['completed', 'failed', 'pending']).toContain(trade.status);
            (0, vitest_1.expect)(trade.timestamp).toBeDefined();
        });
    });
    (0, vitest_1.describe)('GET /api/trading/stats', () => {
        (0, vitest_1.test)('应该返回交易统计信息', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/stats')
                .expect(200);
            (0, vitest_1.expect)(response.body.success).toBe(true);
            const stats = response.body.data;
            (0, vitest_1.expect)(typeof stats.totalTrades).toBe('number');
            (0, vitest_1.expect)(typeof stats.successfulTrades).toBe('number');
            (0, vitest_1.expect)(typeof stats.failedTrades).toBe('number');
            (0, vitest_1.expect)(typeof stats.successRate).toBe('number');
            (0, vitest_1.expect)(stats.successRate).toBeGreaterThanOrEqual(0);
            (0, vitest_1.expect)(stats.successRate).toBeLessThanOrEqual(1);
            (0, vitest_1.expect)(stats.totalVolume).toBeDefined();
            (0, vitest_1.expect)(stats.totalPnL).toBeDefined();
            (0, vitest_1.expect)(typeof stats.averageExecutionTime).toBe('number');
            (0, vitest_1.expect)(stats.bestPerformingPair).toBeDefined();
            (0, vitest_1.expect)(stats.worstPerformingPair).toBeDefined();
        });
        (0, vitest_1.test)('统计数据应该保持一致性', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/trading/stats')
                .expect(200);
            const stats = response.body.data;
            (0, vitest_1.expect)(stats.totalTrades).toBe(stats.successfulTrades + stats.failedTrades);
            (0, vitest_1.expect)(Math.abs(stats.successRate - (stats.successfulTrades / stats.totalTrades))).toBeLessThan(0.001);
        });
    });
    (0, vitest_1.describe)('API错误处理', () => {
        (0, vitest_1.test)('应该处理无效的JSON', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/trading/quote')
                .set('Content-Type', 'application/json')
                .send('invalid json')
                .expect(400);
        });
        (0, vitest_1.test)('应该处理缺少Content-Type的请求', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/trading/quote')
                .send('tokenIn=test&tokenOut=test2')
                .expect(400);
        });
    });
    (0, vitest_1.describe)('API性能测试', () => {
        (0, vitest_1.test)('报价请求应该在合理时间内完成', async () => {
            const quoteRequest = {
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1'
            };
            const startTime = Date.now();
            await (0, supertest_1.default)(app)
                .post('/api/trading/quote')
                .send(quoteRequest)
                .expect(200);
            const endTime = Date.now();
            (0, vitest_1.expect)(endTime - startTime).toBeLessThan(1000); // 应该在1秒内完成
        });
        (0, vitest_1.test)('应该能够处理并发请求', async () => {
            const quoteRequest = {
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1'
            };
            const requests = Array.from({ length: 10 }, () => (0, supertest_1.default)(app)
                .post('/api/trading/quote')
                .send(quoteRequest));
            const responses = await Promise.all(requests);
            responses.forEach(response => {
                (0, vitest_1.expect)(response.status).toBe(200);
                (0, vitest_1.expect)(response.body.success).toBe(true);
            });
        });
    });
});
//# sourceMappingURL=trading-api.test.js.map