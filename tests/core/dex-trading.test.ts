import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { DEXIntegration } from '../../src/dex/DEXIntegration';
import { RiskManager } from '../../src/risk/RiskManager';

// Mock ethers provider
const mockProvider = {
  getNetwork: vi.fn().mockResolvedValue({ chainId: 56 }),
  getBalance: vi.fn().mockResolvedValue('1000000000000000000'), // 1 ETH in wei
  getTransactionCount: vi.fn().mockResolvedValue(1),
  estimateGas: vi.fn().mockResolvedValue('21000'),
  getGasPrice: vi.fn().mockResolvedValue('5000000000'), // 5 gwei
  sendTransaction: vi.fn(),
  waitForTransaction: vi.fn(),
  getBlock: vi.fn().mockResolvedValue({ baseFeePerGas: '1000000000' })
};

// Mock contract calls
const mockContract = {
  getAmountsOut: vi.fn(),
  swapExactETHForTokens: vi.fn(),
  swapExactTokensForETH: vi.fn(),
  swapExactTokensForTokens: vi.fn(),
  WETH: vi.fn().mockResolvedValue('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'),
  factory: vi.fn().mockResolvedValue('0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73')
};

vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn(() => mockProvider),
    Contract: vi.fn(() => mockContract),
    Wallet: vi.fn(() => ({
      address: '0x1234567890123456789012345678901234567890',
      connect: vi.fn().mockReturnThis()
    })),
    parseEther: vi.fn((value) => (parseFloat(value) * 1e18).toString()),
    formatEther: vi.fn((value) => (parseInt(value) / 1e18).toString()),
    parseUnits: vi.fn((value, decimals) => (parseFloat(value) * Math.pow(10, decimals)).toString()),
    formatUnits: vi.fn((value, decimals) => (parseInt(value) / Math.pow(10, decimals)).toString()),
    ZeroAddress: '0x0000000000000000000000000000000000000000'
  }
}));

describe('DEX交易集成测试', () => {
  let dexIntegration: DEXIntegration;
  let riskManager: RiskManager;

  beforeEach(() => {
    vi.clearAllMocks();
    dexIntegration = new DEXIntegration({
      rpcUrl: 'https://bsc-dataseed.binance.org',
      chainId: 56,
      routerAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E'
    });
    riskManager = new RiskManager({
      maxDailyVolume: '100',
      maxSingleTrade: '10',
      requireWhitelist: false,
      blacklistEnabled: true,
      maxConcurrentTrades: 5,
      coolDownPeriod: 60
    });
  });

  describe('价格查询', () => {
    test('应该能够获取代币价格', async () => {
      const mockAmounts = ['1000000000000000000', '400000000000000000000']; // 1 BNB = 400 USDT
      mockContract.getAmountsOut.mockResolvedValue(mockAmounts);

      const price = await dexIntegration.getTokenPrice(
        '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
        '0x55d398326f99059fF775485246999027B3197955', // USDT
        '1'
      );

      expect(price).toBeDefined();
      expect(parseFloat(price.amountOut)).toBeGreaterThan(0);
      expect(mockContract.getAmountsOut).toHaveBeenCalledWith(
        '1000000000000000000',
        expect.any(Array)
      );
    });

    test('价格查询失败时应该抛出错误', async () => {
      mockContract.getAmountsOut.mockRejectedValue(new Error('No liquidity'));

      await expect(
        dexIntegration.getTokenPrice(
          '0xInvalidToken',
          '0x55d398326f99059fF775485246999027B3197955',
          '1'
        )
      ).rejects.toThrow();
    });
  });

  describe('滑点计算', () => {
    test('应该正确计算价格影响', async () => {
      const mockAmounts = ['1000000000000000000', '400000000000000000000'];
      mockContract.getAmountsOut.mockResolvedValue(mockAmounts);

      const quote = await dexIntegration.getQuote({
        tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        tokenOut: '0x55d398326f99059fF775485246999027B3197955',
        amountIn: '1',
        slippage: 0.5
      });

      expect(quote.priceImpact).toBeDefined();
      expect(quote.slippageAnalysis).toBeDefined();
      expect(quote.minimumReceived).toBeDefined();
      expect(parseFloat(quote.minimumReceived)).toBeLessThan(parseFloat(quote.tokenOut.amount));
    });

    test('大额交易应该有更高的价格影响', async () => {
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

      expect(largeQuote.priceImpact.impact).toBeGreaterThan(smallQuote.priceImpact.impact);
    });
  });

  describe('交易执行', () => {
    test('应该能够执行买入交易', async () => {
      const mockTxResponse = {
        hash: '0xabcdef123456789',
        wait: vi.fn().mockResolvedValue({
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

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xabcdef123456789');
      expect(mockProvider.sendTransaction).toHaveBeenCalled();
    });

    test('应该能够执行卖出交易', async () => {
      const mockTxResponse = {
        hash: '0xabcdef123456789',
        wait: vi.fn().mockResolvedValue({
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

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xabcdef123456789');
    });

    test('交易失败时应该返回错误', async () => {
      mockProvider.sendTransaction.mockRejectedValue(new Error('Insufficient balance'));

      const result = await dexIntegration.executeTrade({
        type: 'buy',
        tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        tokenOut: '0x55d398326f99059fF775485246999027B3197955',
        amountIn: '1000', // 余额不足
        slippage: 0.5,
        walletAddress: '0x1234567890123456789012345678901234567890'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient balance');
    });
  });

  describe('Gas估算', () => {
    test('应该能够估算Gas费用', async () => {
      const gasEstimate = await dexIntegration.estimateGas({
        type: 'buy',
        tokenIn: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        tokenOut: '0x55d398326f99059fF775485246999027B3197955',
        amountIn: '1',
        walletAddress: '0x1234567890123456789012345678901234567890'
      });

      expect(gasEstimate).toBeDefined();
      expect(gasEstimate.gasLimit).toBeGreaterThan(0);
      expect(gasEstimate.gasPrice).toBeGreaterThan(0);
      expect(gasEstimate.totalCostBNB).toBeDefined();
    });

    test('复杂交易应该需要更多Gas', async () => {
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

      expect(complexGas.gasLimit).toBeGreaterThan(simpleGas.gasLimit);
    });
  });
});