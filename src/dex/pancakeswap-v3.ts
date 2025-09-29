import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { WalletManager, WalletInfo } from '../wallet';
import { configManager } from '../config';
import { logger } from '../utils/logger';

// PancakeSwap V3 Router ABI (key functions)
export const PANCAKE_V3_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint256' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'tokenA', type: 'address' },
          { name: 'tokenB', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'amount0Desired', type: 'uint256' },
          { name: 'amount1Desired', type: 'uint256' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'mint',
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0Min', type: 'uint256' },
      { name: 'amount1Min', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
    name: 'decreaseLiquidity',
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

// PancakeSwap V3 Quoter ABI
export const PANCAKE_V3_QUOTER_ABI = [
  {
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint256' },
    ],
    name: 'quoteExactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export interface PancakeV3SwapParams {
  tokenIn: string;
  tokenOut: string;
  fee: number; // Fee tier: 100, 500, 2500, 10000
  amountIn: string;
  recipient: string;
  deadline: number;
  amountOutMinimum: string;
  sqrtPriceLimitX96?: string;
}

export interface PancakeV3LiquidityParams {
  tokenA: string;
  tokenB: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: string;
  amount1Desired: string;
  amount0Min: string;
  amount1Min: string;
  recipient: string;
  deadline: number;
}

export interface PancakeV3QuoteResult {
  amountOut: string;
  fee: number;
  priceImpact: number;
  route: string[];
}

export class PancakeSwapV3Service {
  private walletManager: WalletManager;
  private publicClient: any;
  private routerAddress: string;
  private quoterAddress: string;
  private nonfungiblePositionManagerAddress: string;

  constructor(walletManager: WalletManager) {
    this.walletManager = walletManager;
    
    const rpcUrls = configManager.rpcUrls;
    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(rpcUrls[0]),
    });
    
    // PancakeSwap V3 contract addresses on BSC
    this.routerAddress = '0x1b81D678ffb9C0263b24A97847620C99d213eB14';
    this.quoterAddress = '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997';
    this.nonfungiblePositionManagerAddress = '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364';
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

  async getQuote(params: {
    tokenIn: string;
    tokenOut: string;
    fee: number;
    amountIn: string;
  }): Promise<PancakeV3QuoteResult> {
    try {
      const amountInWei = parseUnits(params.amountIn, 18);
      
      const amountOut = await this.publicClient.readContract({
        address: this.quoterAddress as `0x${string}`,
        abi: PANCAKE_V3_QUOTER_ABI,
        functionName: 'quoteExactInputSingle',
        args: [
          params.tokenIn as `0x${string}`,
          params.tokenOut as `0x${string}`,
          params.fee,
          amountInWei,
          BigInt(0), // sqrtPriceLimitX96
        ],
      });

      const amountOutFormatted = formatUnits(amountOut, 18);
      
      // Calculate price impact (simplified)
      const inputValue = parseFloat(params.amountIn);
      const outputValue = parseFloat(amountOutFormatted);
      const priceImpact = Math.abs(1 - (outputValue / inputValue)) * 100;

      return {
        amountOut: amountOutFormatted,
        fee: params.fee,
        priceImpact,
        route: [params.tokenIn, params.tokenOut],
      };
    } catch (error) {
      logger.error({ error, params }, 'Failed to get PancakeSwap V3 quote');
      throw new Error(`V3 quote failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async executeSwap(wallet: WalletInfo, params: PancakeV3SwapParams): Promise<string> {
    try {
      const walletClient = this.createWalletClient(wallet);
      const amountInWei = parseUnits(params.amountIn, 18);
      const amountOutMinWei = parseUnits(params.amountOutMinimum, 18);

      const swapParams = {
        tokenIn: params.tokenIn as `0x${string}`,
        tokenOut: params.tokenOut as `0x${string}`,
        fee: params.fee,
        recipient: params.recipient as `0x${string}`,
        deadline: BigInt(params.deadline),
        amountIn: amountInWei,
        amountOutMinimum: amountOutMinWei,
        sqrtPriceLimitX96: params.sqrtPriceLimitX96 ? BigInt(params.sqrtPriceLimitX96) : BigInt(0),
      };

      const gasPrice = BigInt(configManager.config.gas.priority_fee_gwei * 1e9);

      const txHash = await walletClient.writeContract({
        address: this.routerAddress as `0x${string}`,
        abi: PANCAKE_V3_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [swapParams],
        gasPrice,
        value: params.tokenIn === '0x0000000000000000000000000000000000000000' ? amountInWei : BigInt(0),
      });

      logger.info({ 
        txHash, 
        walletAddress: wallet.address, 
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn 
      }, 'PancakeSwap V3 swap executed');

      return txHash;
    } catch (error) {
      logger.error({ error, params }, 'Failed to execute PancakeSwap V3 swap');
      throw new Error(`V3 swap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async addLiquidity(wallet: WalletInfo, params: PancakeV3LiquidityParams): Promise<{
    txHash: string;
    tokenId: string;
    liquidity: string;
  }> {
    try {
      const walletClient = this.createWalletClient(wallet);
      
      const amount0DesiredWei = parseUnits(params.amount0Desired, 18);
      const amount1DesiredWei = parseUnits(params.amount1Desired, 18);
      const amount0MinWei = parseUnits(params.amount0Min, 18);
      const amount1MinWei = parseUnits(params.amount1Min, 18);

      const liquidityParams = {
        tokenA: params.tokenA as `0x${string}`,
        tokenB: params.tokenB as `0x${string}`,
        fee: params.fee,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        amount0Desired: amount0DesiredWei,
        amount1Desired: amount1DesiredWei,
        amount0Min: amount0MinWei,
        amount1Min: amount1MinWei,
        recipient: params.recipient as `0x${string}`,
        deadline: BigInt(params.deadline),
      };

      const gasPrice = BigInt(configManager.config.gas.priority_fee_gwei * 1e9);

      const txHash = await walletClient.writeContract({
        address: this.nonfungiblePositionManagerAddress as `0x${string}`,
        abi: PANCAKE_V3_ROUTER_ABI,
        functionName: 'mint',
        args: [liquidityParams],
        gasPrice,
      });

      // Wait for transaction receipt to get the tokenId
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });

      // Parse logs to get tokenId and liquidity (simplified)
      const tokenId = '0'; // Would need to parse from logs
      const liquidity = '0'; // Would need to parse from logs

      logger.info({ 
        txHash, 
        tokenId, 
        liquidity,
        walletAddress: wallet.address 
      }, 'PancakeSwap V3 liquidity added');

      return {
        txHash,
        tokenId,
        liquidity,
      };
    } catch (error) {
      logger.error({ error, params }, 'Failed to add PancakeSwap V3 liquidity');
      throw new Error(`V3 add liquidity failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async removeLiquidity(wallet: WalletInfo, params: {
    tokenId: string;
    liquidity: string;
    amount0Min: string;
    amount1Min: string;
    deadline: number;
  }): Promise<string> {
    try {
      const walletClient = this.createWalletClient(wallet);
      
      const liquidityWei = BigInt(params.liquidity);
      const amount0MinWei = parseUnits(params.amount0Min, 18);
      const amount1MinWei = parseUnits(params.amount1Min, 18);

      const gasPrice = BigInt(configManager.config.gas.priority_fee_gwei * 1e9);

      const txHash = await walletClient.writeContract({
        address: this.nonfungiblePositionManagerAddress as `0x${string}`,
        abi: PANCAKE_V3_ROUTER_ABI,
        functionName: 'decreaseLiquidity',
        args: [
          BigInt(params.tokenId),
          liquidityWei,
          amount0MinWei,
          amount1MinWei,
          BigInt(params.deadline),
        ],
        gasPrice,
      });

      logger.info({ 
        txHash, 
        tokenId: params.tokenId,
        liquidity: params.liquidity,
        walletAddress: wallet.address 
      }, 'PancakeSwap V3 liquidity removed');

      return txHash;
    } catch (error) {
      logger.error({ error, params }, 'Failed to remove PancakeSwap V3 liquidity');
      throw new Error(`V3 remove liquidity failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get available fee tiers
  getFeeTiers(): number[] {
    return [100, 500, 2500, 10000]; // 0.01%, 0.05%, 0.25%, 1%
  }

  // Helper function to calculate tick from price
  calculateTick(price: number): number {
    return Math.floor(Math.log(price) / Math.log(1.0001));
  }

  // Helper function to calculate price from tick
  calculatePrice(tick: number): number {
    return Math.pow(1.0001, tick);
  }

  // Method needed by MultiDEXAggregator - wrapper around executeSwap
  async swap(params: {
    walletAddress: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOutMinimum: string;
    fee?: number;
    deadline?: number;
  }): Promise<string> {
    const wallet = this.walletManager.getWallet(params.walletAddress);
    if (!wallet) {
      throw new Error(`Wallet ${params.walletAddress} not found`);
    }

    const swapParams: PancakeV3SwapParams = {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: params.fee || 2500, // Default to 0.25% fee tier
      amountIn: params.amountIn,
      recipient: params.walletAddress,
      deadline: params.deadline || Math.floor(Date.now() / 1000) + 1200, // 20 minutes
      amountOutMinimum: params.amountOutMinimum,
    };

    return this.executeSwap(wallet, swapParams);
  }

  // Method needed by MultiDEXAggregator to get Web3 instance
  getWeb3Instance(): any {
    return this.publicClient;
  }
}