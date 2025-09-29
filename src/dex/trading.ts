import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { WalletManager, WalletInfo } from '../wallet';
import { TokenService } from './token';
import { PricingService, QuoteResult } from './pricing';
import { configManager } from '../config';
import { logger, logTransaction } from '../utils/logger';
import { PANCAKE_V2_ROUTER_ABI, ERC20_ABI } from './constants';

export interface TradeRequest {
  from: string;      // Wallet address
  tokenIn: string;   // Token to sell
  tokenOut: string;  // Token to buy
  amountIn: string;  // Amount to sell
  slippage?: number; // Slippage tolerance
  gasPrice?: number; // Gas price in gwei
  dryRun?: boolean;  // Simulate only
  deadline?: number; // Deadline in minutes
}

export interface TradeResult {
  success: boolean;
  txHash?: string;
  from: string;
  tokenIn: {
    symbol: string;
    amount: string;
  };
  tokenOut: {
    symbol: string;
    amount: string;
    minimumReceived: string;
  };
  gasUsed?: string;
  gasPrice: string;
  priceImpact: number;
  executionPrice: string;
  error?: string;
}

export interface ApprovalRequest {
  from: string;
  token: string;
  spender?: string; // Defaults to PancakeSwap router
  amount?: string;  // Defaults to unlimited
  dryRun?: boolean;
}

export interface ApprovalResult {
  success: boolean;
  txHash?: string;
  from: string;
  token: string;
  spender: string;
  amount: string;
  gasUsed?: string;
  gasPrice: string;
  error?: string;
}

export class TradingService {
  private walletManager: WalletManager;
  private tokenService: TokenService;
  private pricingService: PricingService;
  private publicClient: any;
  private routerAddress: string;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
    this.tokenService = new TokenService();
    this.pricingService = new PricingService();
    
    const rpcUrls = configManager.rpcUrls;
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrls[0]),
    });
    
    this.routerAddress = configManager.addresses.PANCAKE_V2_ROUTER;
  }

  private createWalletClient(wallet: WalletInfo) {
    const account = privateKeyToAccount(wallet.privateKey as `0x${string}`);
    const rpcUrls = configManager.rpcUrls;
    
    return createWalletClient({
      account,
      chain: bsc,
      transport: http(rpcUrls[0]),
    });
  }

  async executeTrade(request: TradeRequest): Promise<TradeResult> {
    const wallet = this.walletManager.getWallet(request.from);
    if (!wallet) {
      throw new Error(`Wallet ${request.from} not found`);
    }

    const txLogger = logTransaction('pending', 'trade', {
      from: request.from,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
    });

    try {
      // Get quote
      const quote = await this.pricingService.getQuote({
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        slippage: request.slippage,
      });

      // Validate trade
      const validation = await this.pricingService.validateTrade(quote);
      if (!validation.valid) {
        throw new Error(validation.reason);
      }

      // Check and handle approvals
      await this.ensureApproval(wallet, quote);

      const walletClient = this.createWalletClient(wallet);
      const deadline = Math.floor(Date.now() / 1000) + (request.deadline || 20) * 60;
      const gasPriceGwei = request.gasPrice || configManager.config.gas.priority_fee_gwei;
      const gasPriceWei = BigInt(gasPriceGwei * 1e9);

      let txHash: string;
      let gasUsed: string | undefined;

      if (request.dryRun) {
        // Simulate the trade
        await this.simulateTrade(quote, deadline, walletClient.account.address, gasPriceWei);
        
        txLogger.info('Trade simulation successful');
        return this.createSuccessResult(request, quote, gasPriceGwei.toString());
      }

      // Execute actual trade
      txHash = await this.submitTrade(quote, deadline, walletClient, gasPriceWei);

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      gasUsed = receipt.gasUsed.toString();
      txLogger.info({ txHash, gasUsed }, 'Trade executed successfully');

      return {
        ...this.createSuccessResult(request, quote, gasPriceGwei.toString()),
        txHash,
        gasUsed,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      txLogger.error({ error }, 'Trade failed');
      
      return {
        success: false,
        from: request.from,
        tokenIn: { symbol: request.tokenIn, amount: request.amountIn },
        tokenOut: { symbol: request.tokenOut, amount: '0', minimumReceived: '0' },
        gasPrice: (request.gasPrice || configManager.config.gas.priority_fee_gwei).toString(),
        priceImpact: 0,
        executionPrice: '0',
        error: errorMessage,
      };
    }
  }

  private async ensureApproval(wallet: WalletInfo, quote: QuoteResult): Promise<void> {
    // BNB doesn't need approval
    if (this.tokenService.isNativeToken(quote.tokenIn.address)) {
      return;
    }

    const currentAllowance = await this.tokenService.getAllowance(
      quote.tokenIn.address,
      wallet.address,
      this.routerAddress
    );

    // Check if approval is sufficient
    if (currentAllowance >= quote.tokenIn.amountWei) {
      logger.debug({ 
        token: quote.tokenIn.symbol,
        currentAllowance: currentAllowance.toString(),
        required: quote.tokenIn.amountWei.toString()
      }, 'Sufficient allowance available');
      return;
    }

    // Need to approve
    logger.info({ 
      token: quote.tokenIn.symbol,
      amount: quote.tokenIn.amount 
    }, 'Approving token spend');

    const approvalResult = await this.approveToken({
      from: wallet.address,
      token: quote.tokenIn.address,
      amount: quote.tokenIn.amount,
    });

    if (!approvalResult.success) {
      throw new Error(`Approval failed: ${approvalResult.error}`);
    }
  }

  private async simulateTrade(
    quote: QuoteResult, 
    deadline: number, 
    from: string,
    gasPrice: bigint
  ): Promise<void> {
    const isNativeIn = this.tokenService.isNativeToken(quote.tokenIn.address);
    const isNativeOut = this.tokenService.isNativeToken(quote.tokenOut.address);

    if (isNativeIn && !isNativeOut) {
      // BNB -> Token
      await this.publicClient.simulateContract({
        address: this.routerAddress as `0x${string}`,
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'swapExactETHForTokens',
        args: [
          quote.minimumReceivedWei,
          quote.path as `0x${string}`[],
          from as `0x${string}`,
          BigInt(deadline),
        ],
        value: quote.tokenIn.amountWei,
        account: from as `0x${string}`,
        gasPrice,
      });
    } else if (!isNativeIn && isNativeOut) {
      // Token -> BNB
      await this.publicClient.simulateContract({
        address: this.routerAddress as `0x${string}`,
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'swapExactTokensForETH',
        args: [
          quote.tokenIn.amountWei,
          quote.minimumReceivedWei,
          quote.path as `0x${string}`[],
          from as `0x${string}`,
          BigInt(deadline),
        ],
        account: from as `0x${string}`,
        gasPrice,
      });
    } else {
      // Token -> Token
      await this.publicClient.simulateContract({
        address: this.routerAddress as `0x${string}`,
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [
          quote.tokenIn.amountWei,
          quote.minimumReceivedWei,
          quote.path as `0x${string}`[],
          from as `0x${string}`,
          BigInt(deadline),
        ],
        account: from as `0x${string}`,
        gasPrice,
      });
    }
  }

  private async submitTrade(
    quote: QuoteResult,
    deadline: number,
    walletClient: any,
    gasPrice: bigint
  ): Promise<string> {
    const isNativeIn = this.tokenService.isNativeToken(quote.tokenIn.address);
    const isNativeOut = this.tokenService.isNativeToken(quote.tokenOut.address);

    if (isNativeIn && !isNativeOut) {
      // BNB -> Token
      return walletClient.writeContract({
        address: this.routerAddress as `0x${string}`,
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'swapExactETHForTokens',
        args: [
          quote.minimumReceivedWei,
          quote.path as `0x${string}`[],
          walletClient.account.address,
          BigInt(deadline),
        ],
        value: quote.tokenIn.amountWei,
        gasPrice,
      });
    } else if (!isNativeIn && isNativeOut) {
      // Token -> BNB
      return walletClient.writeContract({
        address: this.routerAddress as `0x${string}`,
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'swapExactTokensForETH',
        args: [
          quote.tokenIn.amountWei,
          quote.minimumReceivedWei,
          quote.path as `0x${string}`[],
          walletClient.account.address,
          BigInt(deadline),
        ],
        gasPrice,
      });
    } else {
      // Token -> Token
      return walletClient.writeContract({
        address: this.routerAddress as `0x${string}`,
        abi: PANCAKE_V2_ROUTER_ABI,
        functionName: 'swapExactTokensForTokens',
        args: [
          quote.tokenIn.amountWei,
          quote.minimumReceivedWei,
          quote.path as `0x${string}`[],
          walletClient.account.address,
          BigInt(deadline),
        ],
        gasPrice,
      });
    }
  }

  async approveToken(request: ApprovalRequest): Promise<ApprovalResult> {
    const wallet = this.walletManager.getWallet(request.from);
    if (!wallet) {
      throw new Error(`Wallet ${request.from} not found`);
    }

    const tokenInfo = await this.tokenService.getTokenInfo(request.token);
    const spender = request.spender || this.routerAddress;
    const amount = request.amount || 'unlimited';
    
    let amountWei: bigint;
    if (amount === 'unlimited') {
      amountWei = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    } else {
      const parsed = await this.tokenService.parseAmount(amount, request.token);
      amountWei = parsed.parsed;
    }

    const txLogger = logTransaction('pending', 'approve', {
      from: request.from,
      token: tokenInfo.symbol,
      spender,
      amount,
    });

    try {
      const walletClient = this.createWalletClient(wallet);
      const gasPrice = BigInt(configManager.config.gas.priority_fee_gwei * 1e9);

      if (request.dryRun) {
        // Simulate approval
        await this.publicClient.simulateContract({
          address: tokenInfo.address as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spender as `0x${string}`, amountWei],
          account: walletClient.account.address,
          gasPrice,
        });

        txLogger.info('Approval simulation successful');
        return {
          success: true,
          from: request.from,
          token: tokenInfo.symbol,
          spender,
          amount,
          gasPrice: configManager.config.gas.priority_fee_gwei.toString(),
        };
      }

      // Execute approval
      const txHash = await walletClient.writeContract({
        address: tokenInfo.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender as `0x${string}`, amountWei],
        gasPrice,
      });

      // Wait for confirmation
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      const gasUsed = receipt.gasUsed.toString();
      txLogger.info({ txHash, gasUsed }, 'Approval successful');

      return {
        success: true,
        txHash,
        from: request.from,
        token: tokenInfo.symbol,
        spender,
        amount,
        gasUsed,
        gasPrice: configManager.config.gas.priority_fee_gwei.toString(),
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      txLogger.error({ error }, 'Approval failed');
      
      return {
        success: false,
        from: request.from,
        token: tokenInfo.symbol,
        spender,
        amount,
        gasPrice: configManager.config.gas.priority_fee_gwei.toString(),
        error: errorMessage,
      };
    }
  }

  private createSuccessResult(request: TradeRequest, quote: QuoteResult, gasPrice: string): TradeResult {
    return {
      success: true,
      from: request.from,
      tokenIn: {
        symbol: quote.tokenIn.symbol,
        amount: quote.tokenIn.amount,
      },
      tokenOut: {
        symbol: quote.tokenOut.symbol,
        amount: quote.tokenOut.amount,
        minimumReceived: quote.minimumReceived,
      },
      gasPrice,
      priceImpact: quote.priceImpact,
      executionPrice: quote.executionPrice,
    };
  }

  async getQuote(tokenIn: string, tokenOut: string, amountIn: string, slippage?: number): Promise<QuoteResult> {
    return this.pricingService.getQuote({
      tokenIn,
      tokenOut,
      amountIn,
      slippage,
    });
  }

  // Method needed by MultiDEXAggregator
  getWeb3Instance(): any {
    return this.publicClient;
  }
}