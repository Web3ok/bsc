"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const DEXIntegration_1 = require("../../src/dex/DEXIntegration");
const RiskManager_1 = require("../../src/risk/RiskManager");
// Mock ethers provider
const mockProvider = {
    getNetwork: vitest_1.vi.fn().mockResolvedValue({ chainId: 56 }),
    getBalance: vitest_1.vi.fn().mockResolvedValue('1000000000000000000'), // 1 ETH in wei
    getTransactionCount: vitest_1.vi.fn().mockResolvedValue(1),
    estimateGas: vitest_1.vi.fn().mockResolvedValue('21000'),
    getGasPrice: vitest_1.vi.fn().mockResolvedValue('5000000000'), // 5 gwei
    sendTransaction: vitest_1.vi.fn(),
    waitForTransaction: vitest_1.vi.fn(),
    getBlock: vitest_1.vi.fn().mockResolvedValue({ baseFeePerGas: '1000000000' })
};
// Mock contract calls
const mockContract = {
    getAmountsOut: vitest_1.vi.fn(),
    swapExactETHForTokens: vitest_1.vi.fn(),
    swapExactTokensForETH: vitest_1.vi.fn(),
    swapExactTokensForTokens: vitest_1.vi.fn(),
    WETH: vitest_1.vi.fn().mockResolvedValue('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
    factory: vitest_1.vi.fn().mockResolvedValue('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73')
};
vitest_1.vi.mock('ethers', () => ({
    ethers: {
        JsonRpcProvider: vitest_1.vi.fn(() => mockProvider),
        Contract: vitest_1.vi.fn(() => mockContract),
        Wallet: vitest_1.vi.fn(() => ({
            address: '0x1234567890123456789012345678901234567890',
            connect: vitest_1.vi.fn().mockReturnThis()
        })),
        parseEther: vitest_1.vi.fn((value) => (parseFloat(value) * 1e18).toString()),
        formatEther: vitest_1.vi.fn((value) => (parseInt(value) / 1e18).toString()),
        parseUnits: vitest_1.vi.fn((value, decimals) => (parseFloat(value) * Math.pow(10, decimals)).toString()),
        formatUnits: vitest_1.vi.fn((value, decimals) => (parseInt(value) / Math.pow(10, decimals)).toString()),
        ZeroAddress: '0x0000000000000000000000000000000000000000'
    }
}));
(0, vitest_1.describe)('DEX交易集成测试', () => {
    let dexIntegration;
    let riskManager;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        dexIntegration = new DEXIntegration_1.DEXIntegration({
            rpcUrl: 'https://bsc-dataseed.binance.org',
            chainId: 56,
            routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E'
        });
        riskManager = new RiskManager_1.RiskManager({
            maxDailyVolume: '100',
            maxSingleTrade: '10',
            requireWhitelist: false,
            blacklistEnabled: true,
            maxConcurrentTrades: 5,
            coolDownPeriod: 60
        });
    });
    (0, vitest_1.describe)('价格查询', () => {
        (0, vitest_1.test)('应该能够获取代币价格', async () => {
            const mockAmounts = ['1000000000000000000', '400000000000000000000']; // 1 BNB = 400 USDT
            mockContract.getAmountsOut.mockResolvedValue(mockAmounts);
            const price = await dexIntegration.getTokenPrice('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
            '0x55d398326f99059fF775485246999027B3197955', // USDT
            '1');
            (0, vitest_1.expect)(price).toBeDefined();
            (0, vitest_1.expect)(parseFloat(price.amountOut)).toBeGreaterThan(0);
            (0, vitest_1.expect)(mockContract.getAmountsOut).toHaveBeenCalledWith('1000000000000000000', vitest_1.expect.any(Array));
        });
        (0, vitest_1.test)('价格查询失败时应该抛出错误', async () => {
            mockContract.getAmountsOut.mockRejectedValue(new Error('No liquidity'));
            await (0, vitest_1.expect)(dexIntegration.getTokenPrice('0xInvalidToken', '0x55d398326f99059fF775485246999027B3197955', '1')).rejects.toThrow();
        });
    });
    (0, vitest_1.describe)('滑点计算', () => {
        (0, vitest_1.test)('应该正确计算价格影响', async () => {
            const mockAmounts = ['1000000000000000000', '400000000000000000000'];
            mockContract.getAmountsOut.mockResolvedValue(mockAmounts);
            const quote = await dexIntegration.getQuote({
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                slippage: 0.5
            });
            (0, vitest_1.expect)(quote.priceImpact).toBeDefined();
            (0, vitest_1.expect)(quote.slippageAnalysis).toBeDefined();
            (0, vitest_1.expect)(quote.minimumReceived).toBeDefined();
            (0, vitest_1.expect)(parseFloat(quote.minimumReceived)).toBeLessThan(parseFloat(quote.tokenOut.amount));
        });
        (0, vitest_1.test)('大额交易应该有更高的价格影响', async () => {
            // 小额交易
            const smallAmounts = ['100000000000000000', '40000000000000000000']; // 0.1 BNB
            // 大额交易  
            const largeAmounts = ['10000000000000000000', '3800000000000000000000']; // 10 BNB，价格影响5%
            mockContract.getAmountsOut
                .mockResolvedValueOnce(smallAmounts)
                .mockResolvedValueOnce(largeAmounts);
            const smallQuote = await dexIntegration.getQuote({
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '0.1',
                slippage: 0.5
            });
            const largeQuote = await dexIntegration.getQuote({
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '10',
                slippage: 0.5
            });
            (0, vitest_1.expect)(largeQuote.priceImpact.impact).toBeGreaterThan(smallQuote.priceImpact.impact);
        });
    });
    (0, vitest_1.describe)('交易执行', () => {
        (0, vitest_1.test)('应该能够执行买入交易', async () => {
            const mockTxResponse = {
                hash: '0xabcdef123456789',
                wait: vitest_1.vi.fn().mockResolvedValue({
                    status: 1,
                    gasUsed: '150000',
                    effectiveGasPrice: '5000000000'
                })
            };
            mockProvider.sendTransaction.mockResolvedValue(mockTxResponse);
            const result = await dexIntegration.executeTrade({
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                slippage: 0.5,
                walletAddress: '0x1234567890123456789012345678901234567890'
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.txHash).toBe('0xabcdef123456789');
            (0, vitest_1.expect)(mockProvider.sendTransaction).toHaveBeenCalled();
        });
        (0, vitest_1.test)('应该能够执行卖出交易', async () => {
            const mockTxResponse = {
                hash: '0xabcdef123456789',
                wait: vitest_1.vi.fn().mockResolvedValue({
                    status: 1,
                    gasUsed: '180000',
                    effectiveGasPrice: '5000000000'
                })
            };
            mockProvider.sendTransaction.mockResolvedValue(mockTxResponse);
            const result = await dexIntegration.executeTrade({
                type: 'sell',
                tokenIn: '0x55d398326f99059fF775485246999027B3197955',
                tokenOut: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                amountIn: '100',
                slippage: 0.5,
                walletAddress: '0x1234567890123456789012345678901234567890'
            });
            (0, vitest_1.expect)(result.success).toBe(true);
            (0, vitest_1.expect)(result.txHash).toBe('0xabcdef123456789');
        });
        (0, vitest_1.test)('交易失败时应该返回错误', async () => {
            mockProvider.sendTransaction.mockRejectedValue(new Error('Insufficient balance'));
            const result = await dexIntegration.executeTrade({
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1000', // 余额不足
                slippage: 0.5,
                walletAddress: '0x1234567890123456789012345678901234567890'
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error).toContain('Insufficient balance');
        });
    });
    (0, vitest_1.describe)('Gas估算', () => {
        (0, vitest_1.test)('应该能够估算Gas费用', async () => {
            const gasEstimate = await dexIntegration.estimateGas({
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
                tokenOut: '0x55d398326f99059fF775485246999027B3197955',
                amountIn: '1',
                walletAddress: '0x1234567890123456789012345678901234567890'
            });
            (0, vitest_1.expect)(gasEstimate).toBeDefined();
            (0, vitest_1.expect)(gasEstimate.gasLimit).toBeGreaterThan(0);
            (0, vitest_1.expect)(gasEstimate.gasPrice).toBeGreaterThan(0);
            (0, vitest_1.expect)(gasEstimate.totalCostBNB).toBeDefined();
        });
        (0, vitest_1.test)('复杂交易应该需要更多Gas', async () => {
            // 简单的ETH->Token交易
            mockProvider.estimateGas.mockResolvedValueOnce('150000');
            // 复杂的Token->Token交易
            mockProvider.estimateGas.mockResolvedValueOnce('250000');
            const simpleGas = await dexIntegration.estimateGas({
                type: 'buy',
                tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // BNB
                tokenOut: '0x55d398326f99059fF775485246999027B3197955', // USDT
                amountIn: '1',
                walletAddress: '0x1234567890123456789012345678901234567890'
            });
            const complexGas = await dexIntegration.estimateGas({
                type: 'buy',
                tokenIn: '0x55d398326f99059fF775485246999027B3197955', // USDT
                tokenOut: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // CAKE
                amountIn: '100',
                walletAddress: '0x1234567890123456789012345678901234567890'
            });
            (0, vitest_1.expect)(complexGas.gasLimit).toBeGreaterThan(simpleGas.gasLimit);
        });
    });
});
//# sourceMappingURL=dex-trading.test.js.map