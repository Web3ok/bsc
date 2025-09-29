import { ethers } from 'ethers';
import { configManager } from '../config';
import { rpcManager } from '../blockchain/rpc';
import { gasManager } from '../tx/gas';
import { nonceManager } from '../tx/nonce';
import { logger } from '../utils/logger';
import { PANCAKE_V2_ROUTER_ABI, ERC20_ABI, WBNB_ABI, TOKEN_ADDRESSES } from './constants';

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: string; // in wei
  slippageTolerance: number; // e.g., 0.005 for 0.5%
  deadline?: number; // in seconds from now
  recipient?: string;
}

export interface SwapResult {
  txHash: string;
  amountIn: string;
  amountOut: string;
  gasUsed: string;
  gasCost: string;
  effectivePrice: string;
  priceImpact: string;
}

export interface QuoteResult {
  amountOut: string;
  priceImpact: string;
  minimumAmountOut: string;
  path: string[];
  gasEstimate: string;
}

export class PancakeSwapV2 {
  private router: ethers.Contract;
  private provider: ethers.JsonRpcProvider;
  private routerAddress: string;
  private wbnbAddress: string;

  constructor() {
    this.provider = rpcManager.getProvider();
    const pancakeConfig = configManager.getPancakeSwapConfig();
    this.routerAddress = pancakeConfig.v2Router;
    this.wbnbAddress = configManager.getChainConfig().wbnbAddress;
    
    this.router = new ethers.Contract(
      this.routerAddress,
      PANCAKE_V2_ROUTER_ABI,
      this.provider
    );

    logger.info({ 
      router: this.routerAddress,
      wbnb: this.wbnbAddress 
    }, 'PancakeSwap V2 initialized');
  }

  /**
   * Get quote for token swap
   */
  async getQuote(params: Omit<SwapParams, 'deadline' | 'recipient'>): Promise<QuoteResult> {
    try {
      const path = this.getOptimalPath(params.tokenIn, params.tokenOut);
      const amountIn = BigInt(params.amountIn);

      // Get amounts out from router
      const amounts = await this.router.getAmountsOut(amountIn, path);
      const amountOut = amounts[amounts.length - 1];

      // Calculate minimum amount out with slippage
      const slippageMultiplier = 1 - params.slippageTolerance;
      const minimumAmountOut = (amountOut * BigInt(Math.floor(slippageMultiplier * 10000))) / BigInt(10000);

      // Calculate price impact (simplified)
      const priceImpact = await this.calculatePriceImpact(path, amountIn, amountOut);

      // Estimate gas
      const gasEstimate = await this.estimateSwapGas(params.tokenIn, params.tokenOut, amountIn, path);

      logger.debug({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: amountOut.toString(),
        minimumAmountOut: minimumAmountOut.toString(),
        priceImpact,
        path
      }, 'Generated swap quote');

      return {
        amountOut: amountOut.toString(),
        priceImpact: priceImpact.toString(),
        minimumAmountOut: minimumAmountOut.toString(),
        path,
        gasEstimate: gasEstimate.toString()
      };
    } catch (error) {
      logger.error({ error, params }, 'Failed to get swap quote');
      throw new Error(`Quote failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute token swap
   */
  async executeSwap(params: SwapParams, privateKey: string): Promise<SwapResult> {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider);
      const routerWithSigner = this.router.connect(wallet);

      // Get quote first
      const quote = await this.getQuote(params);
      const path = quote.path;
      const amountIn = BigInt(params.amountIn);
      const minimumAmountOut = BigInt(quote.minimumAmountOut);

      // Calculate deadline
      const deadline = Math.floor(Date.now() / 1000) + (params.deadline || 1200); // 20 minutes default

      // Check if we need approval for token
      if (params.tokenIn.toLowerCase() !== this.wbnbAddress.toLowerCase()) {
        await this.ensureApproval(params.tokenIn, amountIn, wallet.address, wallet);
      }

      // Determine swap function and prepare transaction
      let tx: ethers.ContractTransaction;
      
      if (params.tokenIn.toLowerCase() === this.wbnbAddress.toLowerCase()) {
        // BNB -> Token
        tx = await routerWithSigner.swapExactETHForTokens(
          minimumAmountOut,
          path,
          params.recipient || wallet.address,
          deadline,
          { value: amountIn }
        );
      } else if (params.tokenOut.toLowerCase() === this.wbnbAddress.toLowerCase()) {
        // Token -> BNB
        tx = await routerWithSigner.swapExactTokensForETH(
          amountIn,
          minimumAmountOut,
          path,
          params.recipient || wallet.address,
          deadline
        );
      } else {
        // Token -> Token
        tx = await routerWithSigner.swapExactTokensForTokens(
          amountIn,
          minimumAmountOut,
          path,
          params.recipient || wallet.address,
          deadline
        );
      }

      logger.info({
        txHash: tx.hash,
        from: wallet.address,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        minimumAmountOut: minimumAmountOut.toString()
      }, 'Swap transaction sent');

      // Wait for confirmation
      const receipt = await tx.wait();
      
      if (!receipt) {
        throw new Error('Transaction receipt not available');
      }

      // Mark nonce as confirmed
      nonceManager.markNonceConfirmed(wallet.address, tx.nonce);

      // Parse swap result from logs
      const swapResult = await this.parseSwapResult(receipt, amountIn, quote);

      logger.info({
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.gasPrice?.toString(),
        swapResult
      }, 'Swap completed successfully');

      return swapResult;

    } catch (error) {
      logger.error({ error, params }, 'Swap execution failed');
      throw new Error(`Swap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get optimal trading path between two tokens
   */
  private getOptimalPath(tokenIn: string, tokenOut: string): string[] {
    const tokenInLower = tokenIn.toLowerCase();
    const tokenOutLower = tokenOut.toLowerCase();
    const wbnbLower = this.wbnbAddress.toLowerCase();

    // Direct pair
    if (tokenInLower === wbnbLower || tokenOutLower === wbnbLower) {
      return [tokenIn, tokenOut];
    }

    // Check if direct pair exists (simplified - in reality you'd query the factory)
    // For now, route through WBNB for most pairs
    const commonBases = [this.wbnbAddress, TOKEN_ADDRESSES.USDT, TOKEN_ADDRESSES.BUSD];
    
    for (const base of commonBases) {
      if (base.toLowerCase() !== tokenInLower && base.toLowerCase() !== tokenOutLower) {
        // Try routing through this base token
        return [tokenIn, base, tokenOut];
      }
    }

    // Fallback to direct path
    return [tokenIn, tokenOut];
  }

  /**
   * Calculate price impact for a swap
   */
  private async calculatePriceImpact(path: string[], amountIn: bigint, amountOut: bigint): Promise<number> {
    try {
      // Get small amount quote for price reference
      const smallAmount = amountIn / BigInt(1000); // 0.1% of trade size
      if (smallAmount === BigInt(0)) return 0;

      const smallAmounts = await this.router.getAmountsOut(smallAmount, path);
      const smallAmountOut = smallAmounts[smallAmounts.length - 1];

      // Calculate expected output if no price impact
      const expectedOut = (smallAmountOut * amountIn) / smallAmount;
      
      // Price impact = (expected - actual) / expected
      const impact = Number((expectedOut - amountOut) * BigInt(10000) / expectedOut) / 100;
      
      return Math.max(0, impact);
    } catch (error) {
      logger.warn({ error }, 'Failed to calculate price impact');
      return 0;
    }
  }

  /**
   * Estimate gas for swap transaction
   */
  private async estimateSwapGas(tokenIn: string, tokenOut: string, amountIn: bigint, path: string[]): Promise<bigint> {
    try {
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const minimumAmountOut = BigInt(1); // Minimal amount for estimation

      let data: string;
      let value = BigInt(0);

      if (tokenIn.toLowerCase() === this.wbnbAddress.toLowerCase()) {
        // BNB -> Token
        data = this.router.interface.encodeFunctionData('swapExactETHForTokens', [
          minimumAmountOut,
          path,
          ethers.ZeroAddress, // placeholder recipient
          deadline
        ]);
        value = amountIn;
      } else if (tokenOut.toLowerCase() === this.wbnbAddress.toLowerCase()) {
        // Token -> BNB
        data = this.router.interface.encodeFunctionData('swapExactTokensForETH', [
          amountIn,
          minimumAmountOut,
          path,
          ethers.ZeroAddress,
          deadline
        ]);
      } else {
        // Token -> Token
        data = this.router.interface.encodeFunctionData('swapExactTokensForTokens', [
          amountIn,
          minimumAmountOut,
          path,
          ethers.ZeroAddress,
          deadline
        ]);
      }

      const gasEstimate = await gasManager.getGasEstimate(
        this.routerAddress,
        data,
        value,
        ethers.ZeroAddress // placeholder from
      );

      return gasEstimate.gasLimit;
    } catch (error) {
      logger.warn({ error }, 'Gas estimation failed, using default');
      return BigInt(200000); // Default gas limit for swaps
    }
  }

  /**
   * Ensure token approval for router
   */
  private async ensureApproval(tokenAddress: string, amount: bigint, owner: string, wallet: ethers.Wallet): Promise<void> {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      
      // Check current allowance
      const allowance = await token.allowance(owner, this.routerAddress);
      
      if (allowance >= amount) {
        logger.debug({ tokenAddress, allowance: allowance.toString() }, 'Sufficient allowance exists');
        return;
      }

      // Approve maximum amount to reduce future approval transactions
      const maxApproval = ethers.MaxUint256;
      const tokenWithSigner = token.connect(wallet);
      
      logger.info({ 
        tokenAddress, 
        spender: this.routerAddress,
        amount: maxApproval.toString()
      }, 'Sending approval transaction');

      const approveTx = await tokenWithSigner.approve(this.routerAddress, maxApproval);
      await approveTx.wait();

      // Mark nonce as confirmed
      nonceManager.markNonceConfirmed(wallet.address, approveTx.nonce);

      logger.info({ 
        txHash: approveTx.hash,
        tokenAddress 
      }, 'Token approval confirmed');

    } catch (error) {
      logger.error({ error, tokenAddress }, 'Token approval failed');
      throw new Error(`Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse swap result from transaction receipt
   */
  private async parseSwapResult(receipt: ethers.TransactionReceipt, amountIn: bigint, quote: QuoteResult): Promise<SwapResult> {
    const gasUsed = receipt.gasUsed;
    const effectiveGasPrice = receipt.gasPrice || BigInt(0);
    const gasCost = gasUsed * effectiveGasPrice;

    // In a real implementation, you would parse the swap events from logs
    // For now, we'll use the quote amount as approximation
    const amountOut = quote.amountOut;
    
    // Calculate effective price
    const effectivePrice = (BigInt(amountOut) * BigInt(1e18)) / amountIn;

    return {
      txHash: receipt.hash,
      amountIn: amountIn.toString(),
      amountOut,
      gasUsed: gasUsed.toString(),
      gasCost: gasCost.toString(),
      effectivePrice: effectivePrice.toString(),
      priceImpact: quote.priceImpact
    };
  }

  /**
   * Check if a token pair exists
   */
  async checkPairExists(tokenA: string, tokenB: string): Promise<boolean> {
    try {
      const path = this.getOptimalPath(tokenA, tokenB);
      const testAmount = ethers.parseEther('0.001'); // Small test amount
      
      await this.router.getAmountsOut(testAmount, path);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get token information
   */
  async getTokenInfo(tokenAddress: string): Promise<{
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: string;
  }> {
    try {
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        token.name(),
        token.symbol(),
        token.decimals(),
        token.totalSupply()
      ]);

      return {
        name,
        symbol,
        decimals,
        totalSupply: totalSupply.toString()
      };
    } catch (error) {
      logger.error({ error, tokenAddress }, 'Failed to get token info');
      throw new Error(`Token info failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get token balance for address
   */
  async getTokenBalance(tokenAddress: string, walletAddress: string): Promise<string> {
    try {
      if (tokenAddress.toLowerCase() === this.wbnbAddress.toLowerCase()) {
        // For WBNB, get BNB balance
        const balance = await this.provider.getBalance(walletAddress);
        return balance.toString();
      } else {
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
        const balance = await token.balanceOf(walletAddress);
        return balance.toString();
      }
    } catch (error) {
      logger.error({ error, tokenAddress, walletAddress }, 'Failed to get token balance');
      throw new Error(`Balance check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Wrap BNB to WBNB
   */
  async wrapBNB(amount: string, privateKey: string): Promise<string> {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider);
      const wbnb = new ethers.Contract(this.wbnbAddress, WBNB_ABI, wallet);
      
      const tx = await wbnb.deposit({ value: BigInt(amount) });
      await tx.wait();
      
      nonceManager.markNonceConfirmed(wallet.address, tx.nonce);
      
      logger.info({ txHash: tx.hash, amount }, 'BNB wrapped successfully');
      return tx.hash;
    } catch (error) {
      logger.error({ error, amount }, 'BNB wrap failed');
      throw new Error(`Wrap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Unwrap WBNB to BNB
   */
  async unwrapBNB(amount: string, privateKey: string): Promise<string> {
    try {
      const wallet = new ethers.Wallet(privateKey, this.provider);
      const wbnb = new ethers.Contract(this.wbnbAddress, WBNB_ABI, wallet);
      
      const tx = await wbnb.withdraw(BigInt(amount));
      await tx.wait();
      
      nonceManager.markNonceConfirmed(wallet.address, tx.nonce);
      
      logger.info({ txHash: tx.hash, amount }, 'WBNB unwrapped successfully');
      return tx.hash;
    } catch (error) {
      logger.error({ error, amount }, 'WBNB unwrap failed');
      throw new Error(`Unwrap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export const pancakeSwapV2 = new PancakeSwapV2();