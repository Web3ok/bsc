import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { WalletManager } from '../wallet';
import { logger } from '../utils/logger';

// PancakeSwap Router V2 地址
const PANCAKE_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';

// Router ABI (简化版,仅包含需要的函数)
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
];

// ERC20 ABI (简化版)
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function allowance(address owner, address spender) public view returns (uint256)',
  'function balanceOf(address account) public view returns (uint256)',
  'function decimals() public view returns (uint8)',
  'function symbol() public view returns (string)'
];

export class TradingAPI {
  private router: Router;
  private walletManager: WalletManager;
  private provider: ethers.JsonRpcProvider;

  constructor() {
    this.router = Router();
    this.walletManager = WalletManager.getInstance();
    this.provider = new ethers.JsonRpcProvider(
      process.env.RPC_URL || 'https://bsc-dataseed1.binance.org/'
    );
    this.setupRoutes();
  }

  getRouter(): Router {
    return this.router;
  }

  private setupRoutes(): void {
    // 获取交易报价
    this.router.post('/quote', async (req: Request, res: Response) => {
      try {
        const { tokenIn, tokenOut, amountIn, slippage = 0.5 } = req.body;

        // 验证输入
        if (!tokenIn || !tokenOut || !amountIn) {
          return res.status(400).json({
            success: false,
            message: 'Missing required parameters: tokenIn, tokenOut, amountIn'
          });
        }

        // 验证代币地址格式 (BNB除外)
        const addressPattern = /^0x[a-fA-F0-9]{40}$/;
        if (tokenIn.toUpperCase() !== 'BNB' && !addressPattern.test(tokenIn)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid tokenIn address format. Must be a valid Ethereum address or "BNB"'
          });
        }
        if (tokenOut.toUpperCase() !== 'BNB' && !addressPattern.test(tokenOut)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid tokenOut address format. Must be a valid Ethereum address or "BNB"'
          });
        }

        // 验证金额
        const amount = parseFloat(amountIn);
        if (isNaN(amount) || amount <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Invalid amountIn. Must be a positive number'
          });
        }

        // 验证滑点
        if (slippage < 0 || slippage > 50) {
          return res.status(400).json({
            success: false,
            message: 'Invalid slippage. Must be between 0 and 50 percent'
          });
        }

        // 获取报价
        const quote = await this.getQuote(tokenIn, tokenOut, amountIn, slippage);

        res.json({
          success: true,
          data: quote
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get quote');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to get quote'
        });
      }
    });

    // 执行交易
    this.router.post('/execute', async (req: Request, res: Response) => {
      try {
        const { tokenIn, tokenOut, amount, slippage, walletAddress, quote } = req.body;

        // 验证输入
        if (!tokenIn || !tokenOut || !amount || !walletAddress) {
          return res.status(400).json({
            success: false,
            message: 'Missing required parameters: tokenIn, tokenOut, amount, walletAddress'
          });
        }

        // 验证地址格式
        const addressPattern = /^0x[a-fA-F0-9]{40}$/;
        if (!addressPattern.test(walletAddress)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid walletAddress format'
          });
        }

        if (tokenIn.toUpperCase() !== 'BNB' && !addressPattern.test(tokenIn)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid tokenIn address format'
          });
        }

        if (tokenOut.toUpperCase() !== 'BNB' && !addressPattern.test(tokenOut)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid tokenOut address format'
          });
        }

        // 验证金额
        const amountNum = parseFloat(amount);
        if (isNaN(amountNum) || amountNum <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Invalid amount. Must be a positive number'
          });
        }

        // 验证滑点
        const slippageNum = slippage || 0.5;
        if (slippageNum < 0 || slippageNum > 50) {
          return res.status(400).json({
            success: false,
            message: 'Invalid slippage. Must be between 0 and 50 percent'
          });
        }

        // 执行交易
        const result = await this.executeTrade({
          tokenIn,
          tokenOut,
          amountIn: amount,
          slippage: slippageNum,
          walletAddress,
          quote
        });

        res.json({
          success: true,
          data: result
        });
      } catch (error) {
        logger.error({ error }, 'Failed to execute trade');
        res.status(500).json({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to execute trade',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // 获取交易历史
    this.router.get('/history', async (req: Request, res: Response) => {
      try {
        // TODO: 实现真实的交易历史查询
        // 目前返回示例数据
        const mockHistory = [
          {
            id: '1',
            type: 'buy',
            tokenSymbol: 'CAKE',
            amount: '100',
            price: '2.45',
            status: 'completed',
            timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
            txHash: '0x1234567890abcdef',
            walletAddress: '0xabcdef123456',
            pnl: '+15.30'
          }
        ];

        res.json({
          success: true,
          data: mockHistory
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get trade history');
        res.status(500).json({
          success: false,
          message: 'Failed to get trade history'
        });
      }
    });

    // 批量交易
    this.router.post('/batch', async (req: Request, res: Response) => {
      try {
        const { trades } = req.body;

        if (!trades || !Array.isArray(trades) || trades.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Invalid trades array'
          });
        }

        // TODO: 实现真实的批量交易逻辑
        // 目前返回模拟结果
        res.json({
          success: true,
          data: {
            totalTrades: trades.length,
            successfulTrades: trades.length,
            failedTrades: 0,
            results: trades.map((trade, index) => ({
              id: `trade_${index}`,
              status: 'completed',
              txHash: `0x${Math.random().toString(16).substr(2, 64)}`
            }))
          }
        });
      } catch (error) {
        logger.error({ error }, 'Failed to execute batch trades');
        res.status(500).json({
          success: false,
          message: 'Failed to execute batch trades'
        });
      }
    });
  }

  private async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    slippage: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    try {
      // 创建Router合约实例
      const routerContract = new ethers.Contract(
        PANCAKE_ROUTER_V2,
        ROUTER_ABI,
        this.provider
      );

      // 处理BNB/WBNB地址
      const tokenInAddress = tokenIn.toUpperCase() === 'BNB' ? WBNB_ADDRESS : tokenIn;
      const tokenOutAddress = tokenOut.toUpperCase() === 'BNB' ? WBNB_ADDRESS : tokenOut;

      // 获取代币信息
      const tokenInContract = new ethers.Contract(tokenInAddress, ERC20_ABI, this.provider);
      const tokenOutContract = new ethers.Contract(tokenOutAddress, ERC20_ABI, this.provider);

      let tokenInSymbol = 'BNB';
      let tokenOutSymbol = 'BNB';
      let tokenInDecimals = 18;
      let tokenOutDecimals = 18;

      try {
        if (tokenIn.toUpperCase() !== 'BNB') {
          tokenInSymbol = await tokenInContract.symbol();
          tokenInDecimals = await tokenInContract.decimals();
        }
        if (tokenOut.toUpperCase() !== 'BNB') {
          tokenOutSymbol = await tokenOutContract.symbol();
          tokenOutDecimals = await tokenOutContract.decimals();
        }
      } catch (e) {
        logger.warn({ error: e }, 'Failed to fetch token info, using defaults');
      }

      // 转换金额为Wei
      const amountInWei = ethers.parseUnits(amountIn, tokenInDecimals);

      // 构建交易路径 - 如果不是直接交易对，通过 WBNB 路由
      let path: string[];
      const needsWBNBRouting = tokenInAddress !== WBNB_ADDRESS && tokenOutAddress !== WBNB_ADDRESS;

      if (needsWBNBRouting) {
        // 尝试直接路径
        try {
          const directPath = [tokenInAddress, tokenOutAddress];
          await routerContract.getAmountsOut(amountInWei, directPath);
          path = directPath;
          logger.info('Using direct swap path (no WBNB routing)');
        } catch {
          // 直接路径失败，使用 WBNB 作为中间token
          path = [tokenInAddress, WBNB_ADDRESS, tokenOutAddress];
          logger.info('Using WBNB routing path');
        }
      } else {
        path = [tokenInAddress, tokenOutAddress];
        logger.info('Direct WBNB swap path');
      }

      // 获取输出金额
      const amounts = await routerContract.getAmountsOut(amountInWei, path);
      const amountOutWei = amounts[amounts.length - 1]; // 最后一个元素是输出金额
      const amountOut = ethers.formatUnits(amountOutWei, tokenOutDecimals);

      // 计算价格影响
      const priceImpact = this.calculatePriceImpact(amountIn, amountOut);

      // 计算最小接收金额(考虑滑点)
      const slippageMultiplier = (100 - slippage) / 100;
      const amountOutMin = (parseFloat(amountOut) * slippageMultiplier).toFixed(6);

      // 估算Gas费用
      const gasEstimate = await this.estimateGas(tokenInAddress, tokenOutAddress, amountInWei);
      const gasPrice = await this.provider.getFeeData();
      const gasCostWei = gasEstimate * (gasPrice.gasPrice || BigInt(5000000000));
      const gasCostBNB = ethers.formatEther(gasCostWei);

      // 计算执行价格
      const executionPrice = (parseFloat(amountOut) / parseFloat(amountIn)).toFixed(6);

      // 生成推荐
      const recommendation = this.generateRecommendation(priceImpact.impact, slippage);

      return {
        tokenIn: {
          address: tokenInAddress,
          symbol: tokenInSymbol,
          amount: amountIn
        },
        tokenOut: {
          address: tokenOutAddress,
          symbol: tokenOutSymbol,
          amount: parseFloat(amountOut).toFixed(6)
        },
        priceImpact: {
          impact: priceImpact.impact,
          category: priceImpact.category
        },
        slippageAnalysis: {
          recommendedSlippage: priceImpact.impact > 1 ? 1.0 : 0.5,
          reason: priceImpact.impact > 1
            ? 'High price impact detected, increased slippage recommended'
            : 'Normal market conditions'
        },
        minimumReceived: amountOutMin,
        executionPrice: executionPrice,
        gasEstimate: (Number(gasEstimate) / 1000000).toFixed(2), // 转换为Gwei
        totalCostBNB: (parseFloat(amountIn) + parseFloat(gasCostBNB)).toFixed(6),
        recommendation
      };
    } catch (error) {
      logger.error({ error, tokenIn, tokenOut }, 'Quote generation failed');
      throw new Error(`Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async executeTrade(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage: number;
    walletAddress: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    quote?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }): Promise<any> {
    const { tokenIn, tokenOut, amountIn, slippage, walletAddress } = params;

    try {
      // 获取钱包
      const wallet = this.walletManager.getWallet(walletAddress);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      // 创建签名者
      const signer = new ethers.Wallet(wallet.privateKey, this.provider);

      // 处理BNB/WBNB地址
      const tokenInAddress = tokenIn.toUpperCase() === 'BNB' ? WBNB_ADDRESS : tokenIn;
      const tokenOutAddress = tokenOut.toUpperCase() === 'BNB' ? WBNB_ADDRESS : tokenOut;

      // 获取代币decimals
      let decimals = 18;
      if (tokenIn.toUpperCase() !== 'BNB') {
        const tokenContract = new ethers.Contract(tokenInAddress, ERC20_ABI, this.provider);
        decimals = await tokenContract.decimals();
      }

      const amountInWei = ethers.parseUnits(amountIn, decimals);

      // 如果不是BNB,需要先approve
      if (tokenIn.toUpperCase() !== 'BNB') {
        await this.approveToken(tokenInAddress, amountInWei, signer);
      }

      // 创建Router合约实例
      const routerContract = new ethers.Contract(
        PANCAKE_ROUTER_V2,
        ROUTER_ABI,
        signer
      );

      // 构建交易路径 - 如果不是直接交易对，通过 WBNB 路由
      let path: string[];
      const needsWBNBRouting = tokenInAddress !== WBNB_ADDRESS && tokenOutAddress !== WBNB_ADDRESS;

      if (needsWBNBRouting) {
        // 尝试直接路径
        try {
          const directPath = [tokenInAddress, tokenOutAddress];
          await routerContract.getAmountsOut(amountInWei, directPath);
          path = directPath;
          logger.info('Using direct swap path (no WBNB routing)');
        } catch {
          // 直接路径失败，使用 WBNB 作为中间token
          path = [tokenInAddress, WBNB_ADDRESS, tokenOutAddress];
          logger.info('Using WBNB routing path');
        }
      } else {
        path = [tokenInAddress, tokenOutAddress];
        logger.info('Direct WBNB swap path');
      }

      // 获取输出金额估算
      const amounts = await routerContract.getAmountsOut(amountInWei, path);
      const amountOutWei = amounts[amounts.length - 1]; // 最后一个元素是输出金额

      // 计算最小输出(考虑滑点)
      const slippageMultiplier = BigInt(Math.floor((100 - slippage) * 100));
      const amountOutMin = (amountOutWei * slippageMultiplier) / BigInt(10000);

      // 设置截止时间(20分钟后)
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      logger.info({
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        amountIn: amountInWei.toString(),
        amountOutMin: amountOutMin.toString(),
        deadline
      }, 'Executing swap');

      // 执行交换
      let tx;
      if (tokenIn.toUpperCase() === 'BNB') {
        // BNB -> Token
        tx = await routerContract.swapExactETHForTokens(
          amountOutMin,
          path,
          walletAddress,
          deadline,
          { value: amountInWei }
        );
      } else if (tokenOut.toUpperCase() === 'BNB') {
        // Token -> BNB
        tx = await routerContract.swapExactTokensForETH(
          amountInWei,
          amountOutMin,
          path,
          walletAddress,
          deadline
        );
      } else {
        // Token -> Token
        tx = await routerContract.swapExactTokensForTokens(
          amountInWei,
          amountOutMin,
          path,
          walletAddress,
          deadline
        );
      }

      logger.info({ txHash: tx.hash }, 'Transaction sent');

      // 等待交易确认
      const receipt = await tx.wait();

      logger.info({
        txHash: receipt.hash,
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString()
      }, 'Transaction confirmed');

      return {
        success: true,
        txHash: receipt.hash,
        status: receipt.status === 1 ? 'completed' : 'failed',
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber
      };
    } catch (error) {
      logger.error({ error, params }, 'Trade execution failed');
      throw error;
    }
  }

  private async approveToken(
    tokenAddress: string,
    amount: bigint,
    signer: ethers.Wallet
  ): Promise<void> {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

      // 检查当前授权额度
      const currentAllowance = await tokenContract.allowance(
        signer.address,
        PANCAKE_ROUTER_V2
      );

      // 如果授权额度不足,进行授权
      if (currentAllowance < amount) {
        logger.info({ tokenAddress, amount: amount.toString() }, 'Approving token');

        const approveTx = await tokenContract.approve(
          PANCAKE_ROUTER_V2,
          ethers.MaxUint256 // 授权最大额度
        );

        await approveTx.wait();

        logger.info({ txHash: approveTx.hash }, 'Token approved');
      }
    } catch (error) {
      logger.error({ error, tokenAddress }, 'Token approval failed');
      throw new Error('Failed to approve token');
    }
  }

  private async estimateGas(
    tokenIn: string,
    tokenOut: string,
    _amountIn: bigint
  ): Promise<bigint> {
    try {
      // 简化的Gas估算
      // 实际应该根据交易类型估算
      if (tokenIn === WBNB_ADDRESS || tokenOut === WBNB_ADDRESS) {
        return BigInt(150000); // BNB交易
      } else {
        return BigInt(200000); // Token交易
      }
    } catch (error) {
      logger.error({ error }, 'Gas estimation failed');
      return BigInt(250000); // 默认值
    }
  }

  private calculatePriceImpact(amountIn: string, amountOut: string): {
    impact: number;
    category: string;
  } {
    // 简化的价格影响计算
    // 实际应该基于池子深度和交易量
    const ratio = parseFloat(amountOut) / parseFloat(amountIn);
    const impact = Math.abs((1 - ratio) * 100);

    let category = 'low';
    if (impact > 5) {
      category = 'very_high';
    } else if (impact > 3) {
      category = 'high';
    } else if (impact > 1) {
      category = 'medium';
    }

    return { impact, category };
  }

  private generateRecommendation(priceImpact: number, _slippage: number): string {
    if (priceImpact > 5) {
      return 'WARNING: Very high price impact detected. Consider reducing trade size or splitting into multiple trades.';
    } else if (priceImpact > 3) {
      return 'High price impact. You may want to increase slippage tolerance or reduce trade size.';
    } else if (priceImpact > 1) {
      return 'Moderate price impact. Trade conditions are acceptable.';
    } else {
      return 'Good trade conditions with minimal price impact.';
    }
  }
}
