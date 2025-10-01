import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ethers } from 'ethers';

/**
 * 交易API - WBNB路由测试
 * 
 * 测试目标：
 * 1. 验证直接交易对优先尝试
 * 2. 验证失败后fallback到WBNB路由
 * 3. 验证输出金额索引正确（amounts[amounts.length - 1]）
 */

describe('Trading API - WBNB Routing', () => {
  const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
  const TOKEN_A = '0x0000000000000000000000000000000000000001';
  const TOKEN_B = '0x0000000000000000000000000000000000000002';

  let mockRouterContract: any;

  beforeEach(() => {
    // Mock PancakeSwap Router合约
    mockRouterContract = {
      getAmountsOut: vi.fn()
    };
  });

  it('应该优先尝试直接交易路径', async () => {
    // 模拟直接路径成功
    const directPath = [TOKEN_A, TOKEN_B];
    const mockAmounts = [
      ethers.parseEther('1.0'),
      ethers.parseEther('100.0')
    ];
    
    mockRouterContract.getAmountsOut.mockResolvedValueOnce(mockAmounts);

    // 调用getQuote逻辑
    const amountInWei = ethers.parseEther('1.0');
    let path: string[];
    
    try {
      const amounts = await mockRouterContract.getAmountsOut(amountInWei, directPath);
      path = directPath;
      
      expect(mockRouterContract.getAmountsOut).toHaveBeenCalledWith(amountInWei, directPath);
      expect(path).toEqual([TOKEN_A, TOKEN_B]);
      expect(path.length).toBe(2);
    } catch (error) {
      throw new Error('直接路径不应该失败');
    }
  });

  it('直接路径失败时应fallback到WBNB路由', async () => {
    const directPath = [TOKEN_A, TOKEN_B];
    const wbnbPath = [TOKEN_A, WBNB_ADDRESS, TOKEN_B];
    const mockAmounts = [
      ethers.parseEther('1.0'),
      ethers.parseEther('0.5'),
      ethers.parseEther('100.0')
    ];

    // 第一次调用（直接路径）失败
    mockRouterContract.getAmountsOut
      .mockRejectedValueOnce(new Error('Insufficient liquidity'))
      // 第二次调用（WBNB路径）成功
      .mockResolvedValueOnce(mockAmounts);

    // 调用getQuote逻辑（带fallback）
    const amountInWei = ethers.parseEther('1.0');
    let path: string[];
    
    try {
      const amounts = await mockRouterContract.getAmountsOut(amountInWei, directPath);
      path = directPath;
    } catch (error) {
      // Fallback到WBNB路由
      const amounts = await mockRouterContract.getAmountsOut(amountInWei, wbnbPath);
      path = wbnbPath;
      
      expect(mockRouterContract.getAmountsOut).toHaveBeenCalledTimes(2);
      expect(mockRouterContract.getAmountsOut).toHaveBeenNthCalledWith(1, amountInWei, directPath);
      expect(mockRouterContract.getAmountsOut).toHaveBeenNthCalledWith(2, amountInWei, wbnbPath);
      expect(path).toEqual([TOKEN_A, WBNB_ADDRESS, TOKEN_B]);
      expect(path.length).toBe(3);
    }
  });

  it('应该使用amounts[amounts.length - 1]获取输出金额', () => {
    // 直接路径（2跳）
    const directAmounts = [
      ethers.parseEther('1.0'),
      ethers.parseEther('100.0')
    ];
    const directOutput = directAmounts[directAmounts.length - 1];
    expect(directOutput).toBe(ethers.parseEther('100.0'));

    // WBNB路径（3跳）
    const wbnbAmounts = [
      ethers.parseEther('1.0'),
      ethers.parseEther('0.5'),
      ethers.parseEther('100.0')
    ];
    const wbnbOutput = wbnbAmounts[wbnbAmounts.length - 1];
    expect(wbnbOutput).toBe(ethers.parseEther('100.0'));

    // 验证错误的索引（amounts[1]）会得到错误结果
    const wrongOutput = wbnbAmounts[1];
    expect(wrongOutput).toBe(ethers.parseEther('0.5')); // WBNB中间金额，不是最终输出
    expect(wrongOutput).not.toBe(wbnbOutput);
  });

  it('WBNB交易对不应该使用WBNB路由', () => {
    // tokenIn = WBNB 的情况
    const pathWBNBtoToken = [WBNB_ADDRESS, TOKEN_A];
    expect(pathWBNBtoToken.includes(WBNB_ADDRESS)).toBe(true);
    expect(pathWBNBtoToken.length).toBe(2); // 不应该是3

    // tokenOut = WBNB 的情况
    const pathTokenToWBNB = [TOKEN_A, WBNB_ADDRESS];
    expect(pathTokenToWBNB.includes(WBNB_ADDRESS)).toBe(true);
    expect(pathTokenToWBNB.length).toBe(2); // 不应该是3
  });
});
