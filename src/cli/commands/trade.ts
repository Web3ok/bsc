import { Command } from 'commander';
import { Logger } from 'pino';
import { ethers } from 'ethers';
import { formatError } from '../utils/logging';
import { pancakeSwapV2 } from '../../dex/pancakeswap-v2';
import { enhancedPricingService } from '../../dex/pricing-enhanced';
import { batchTradeEngine } from '../../batch/engine';
import { enhancedRiskManager } from '../../risk/enhanced-risk-manager';
import { walletManager } from '../../wallet';
import { TOKEN_ADDRESSES } from '../../dex/constants';

// Helper functions
async function resolveTokenAddress(token: string): Promise<string> {
  // If it's already an address, return it
  if (ethers.isAddress(token)) {
    return token;
  }
  
  // Look up by symbol
  const symbolToAddress: Record<string, string> = {
    'WBNB': TOKEN_ADDRESSES.WBNB,
    'BNB': TOKEN_ADDRESSES.WBNB,
    'USDT': TOKEN_ADDRESSES.USDT,
    'BUSD': TOKEN_ADDRESSES.BUSD,
    'USDC': TOKEN_ADDRESSES.USDC,
    'CAKE': TOKEN_ADDRESSES.CAKE,
    'ETH': TOKEN_ADDRESSES.ETH
  };
  
  const address = symbolToAddress[token.toUpperCase()];
  if (!address) {
    throw new Error(`Unknown token symbol: ${token}. Use contract address instead.`);
  }
  
  return address;
}

async function getWalletInfo(options: any, logger: Logger): Promise<{ walletAddress: string; privateKey: string }> {
  if (options.privateKey) {
    const wallet = new ethers.Wallet(options.privateKey);
    return {
      walletAddress: wallet.address,
      privateKey: options.privateKey
    };
  }
  
  if (options.wallet) {
    // Try to find wallet by address
    const wallets = await walletManager.listWallets();
    const found = wallets.find(w => w.address.toLowerCase() === options.wallet.toLowerCase());
    
    if (!found) {
      throw new Error(`Wallet not found: ${options.wallet}`);
    }
    
    // Get private key (this would need to be decrypted in a real implementation)
    throw new Error('Wallet lookup by address not yet implemented. Use --private-key instead.');
  }
  
  throw new Error('Either --wallet or --private-key must be provided');
}

export function tradeCommands(program: Command, logger: Logger) {
  const tradeCmd = program
    .command('trade')
    .description('DEX trading operations (PancakeSwap)');

  // Buy command
  tradeCmd
    .command('buy')
    .description('Buy tokens with BNB')
    .argument('<token>', 'token contract address or symbol')
    .option('-a, --amount <amount>', 'amount to spend (in BNB)', '0.1')
    .option('-s, --slippage <percent>', 'slippage tolerance (%)', '0.5')
    .option('-w, --wallet <address>', 'wallet address to use')
    .option('-k, --private-key <key>', 'private key for the transaction')
    .option('-d, --deadline <minutes>', 'transaction deadline in minutes', '20')
    .option('--dry-run', 'simulate the trade without executing')
    .action(async (token, options) => {
      try {
        console.log('🔄 Executing buy order...');
        
        // Resolve token address
        const tokenAddress = await resolveTokenAddress(token);
        console.log(`📍 Token address: ${tokenAddress}`);
        
        // Get wallet and private key
        const { walletAddress, privateKey } = await getWalletInfo(options, logger);
        console.log(`👛 Using wallet: ${walletAddress}`);
        
        // Convert amount to wei
        const amountWei = ethers.parseEther(options.amount);
        console.log(`💰 Amount: ${options.amount} BNB`);
        
        // Risk check
        console.log('🛡️  Performing risk check...');
        const riskCheck = await enhancedRiskManager.checkTradeRisk({
          walletAddress,
          tokenIn: TOKEN_ADDRESSES.WBNB,
          tokenOut: tokenAddress,
          amountIn: amountWei.toString(),
          slippageTolerance: parseFloat(options.slippage)
        });
        
        if (!riskCheck.allowed) {
          console.log('❌ Trade blocked by risk management:');
          riskCheck.violations.forEach(v => console.log(`   - ${v.message}`));
          return;
        }
        
        if (riskCheck.warnings.length > 0) {
          console.log('⚠️  Risk warnings:');
          riskCheck.warnings.forEach(w => console.log(`   - ${w.message}`));
        }
        
        // Get quote
        console.log('💹 Getting price quote...');
        const quote = await enhancedPricingService.getTradeQuote(
          TOKEN_ADDRESSES.WBNB,
          tokenAddress,
          amountWei.toString(),
          parseFloat(options.slippage)
        );
        
        console.log(`📊 Quote:`);
        console.log(`   Input: ${quote.tokenIn.amount} ${quote.tokenIn.symbol}`);
        console.log(`   Output: ${quote.tokenOut.amount} ${quote.tokenOut.symbol}`);
        console.log(`   Price Impact: ${quote.priceImpact.impact.toFixed(4)}%`);
        console.log(`   Recommended Slippage: ${quote.slippageAnalysis.recommendedSlippage.toFixed(2)}%`);
        console.log(`   Minimum Received: ${quote.minimumReceived} ${quote.tokenOut.symbol}`);
        console.log(`   Gas Estimate: ${ethers.formatUnits(quote.gasEstimate, 'gwei')} gwei`);
        
        if (options.dryRun) {
          console.log('🎭 Dry run mode - transaction not executed');
          return;
        }
        
        // Execute trade
        console.log('⚡ Executing trade...');
        const result = await pancakeSwapV2.executeSwap({
          tokenIn: TOKEN_ADDRESSES.WBNB,
          tokenOut: tokenAddress,
          amountIn: amountWei.toString(),
          slippageTolerance: parseFloat(options.slippage),
          deadline: parseInt(options.deadline) * 60 // Convert to seconds
        }, privateKey);
        
        console.log('✅ Trade completed successfully!');
        console.log(`   Transaction Hash: ${result.txHash}`);
        console.log(`   Amount In: ${ethers.formatEther(result.amountIn)} BNB`);
        console.log(`   Amount Out: ${ethers.formatUnits(result.amountOut, 18)} tokens`);
        console.log(`   Gas Used: ${result.gasUsed}`);
        console.log(`   Gas Cost: ${ethers.formatEther(result.gasCost)} BNB`);
        
        // Record transaction for risk tracking
        enhancedRiskManager.recordTransaction(
          walletAddress,
          amountWei.toString(),
          parseFloat(options.slippage)
        );
        
      } catch (error) {
        console.log('❌ Trade failed:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to execute buy');
        process.exit(1);
      }
    });

  // Sell command
  tradeCmd
    .command('sell')
    .description('Sell tokens for BNB')
    .argument('<token>', 'token contract address or symbol')
    .option('-a, --amount <amount>', 'amount of tokens to sell')
    .option('-p, --percentage <percent>', 'percentage of balance to sell')
    .option('-s, --slippage <percent>', 'slippage tolerance (%)', '0.5')
    .option('-w, --wallet <address>', 'wallet address to use')
    .option('-k, --private-key <key>', 'private key for the transaction')
    .option('-d, --deadline <minutes>', 'transaction deadline in minutes', '20')
    .option('--dry-run', 'simulate the trade without executing')
    .action(async (token, options) => {
      try {
        console.log('💰 Executing sell order...');
        
        // Resolve token address
        const tokenAddress = await resolveTokenAddress(token);
        console.log(`📍 Token address: ${tokenAddress}`);
        
        // Get wallet and private key
        const { walletAddress, privateKey } = await getWalletInfo(options, logger);
        console.log(`👛 Using wallet: ${walletAddress}`);
        
        // Check if selling BNB/WBNB
        if (tokenAddress.toLowerCase() === TOKEN_ADDRESSES.WBNB.toLowerCase()) {
          throw new Error('Cannot sell WBNB for BNB. Use unwrap command instead.');
        }
        
        // Get token info
        const tokenInfo = await pancakeSwapV2.getTokenInfo(tokenAddress);
        console.log(`🪙 Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
        
        // Get wallet balance
        const balance = await pancakeSwapV2.getTokenBalance(tokenAddress, walletAddress);
        const formattedBalance = ethers.formatUnits(balance, tokenInfo.decimals);
        console.log(`💳 Current balance: ${formattedBalance} ${tokenInfo.symbol}`);
        
        if (balance === BigInt(0)) {
          console.log('❌ No tokens to sell');
          return;
        }
        
        // Calculate sell amount
        let sellAmountWei: bigint;
        let sellAmountFormatted: string;
        
        if (options.percentage) {
          const percentage = parseFloat(options.percentage);
          if (percentage <= 0 || percentage > 100) {
            throw new Error('Percentage must be between 0 and 100');
          }
          sellAmountWei = (balance * BigInt(Math.floor(percentage * 100))) / BigInt(10000);
          sellAmountFormatted = ethers.formatUnits(sellAmountWei, tokenInfo.decimals);
          console.log(`📊 Selling ${percentage}% of balance: ${sellAmountFormatted} ${tokenInfo.symbol}`);
        } else if (options.amount) {
          sellAmountWei = ethers.parseUnits(options.amount, tokenInfo.decimals);
          sellAmountFormatted = options.amount;
          
          if (sellAmountWei > balance) {
            throw new Error(`Insufficient balance. Available: ${formattedBalance} ${tokenInfo.symbol}`);
          }
          console.log(`💰 Amount: ${sellAmountFormatted} ${tokenInfo.symbol}`);
        } else {
          // Default to 100% of balance
          sellAmountWei = balance;
          sellAmountFormatted = formattedBalance;
          console.log(`💰 Selling entire balance: ${sellAmountFormatted} ${tokenInfo.symbol}`);
        }
        
        // Risk check
        console.log('🛡️  Performing risk check...');
        const riskCheck = await enhancedRiskManager.checkTradeRisk({
          walletAddress,
          tokenIn: tokenAddress,
          tokenOut: TOKEN_ADDRESSES.WBNB,
          amountIn: sellAmountWei.toString(),
          slippageTolerance: parseFloat(options.slippage)
        });
        
        if (!riskCheck.allowed) {
          console.log('❌ Trade blocked by risk management:');
          riskCheck.violations.forEach(v => console.log(`   - ${v.message}`));
          return;
        }
        
        if (riskCheck.warnings.length > 0) {
          console.log('⚠️  Risk warnings:');
          riskCheck.warnings.forEach(w => console.log(`   - ${w.message}`));
        }
        
        // Get quote
        console.log('💹 Getting price quote...');
        const quote = await enhancedPricingService.getTradeQuote(
          tokenAddress,
          TOKEN_ADDRESSES.WBNB,
          sellAmountWei.toString(),
          parseFloat(options.slippage)
        );
        
        console.log(`📊 Quote:`);
        console.log(`   Input: ${quote.tokenIn.amount} ${quote.tokenIn.symbol}`);
        console.log(`   Output: ${quote.tokenOut.amount} ${quote.tokenOut.symbol}`);
        console.log(`   Price: 1 ${quote.tokenIn.symbol} = ${quote.executionPrice} BNB`);
        console.log(`   Price Impact: ${quote.priceImpact.impact.toFixed(4)}%`);
        console.log(`   Recommended Slippage: ${quote.slippageAnalysis.recommendedSlippage.toFixed(2)}%`);
        console.log(`   Minimum Received: ${quote.minimumReceived} BNB`);
        console.log(`   Gas Estimate: ${ethers.formatUnits(quote.gasEstimate, 'gwei')} gwei`);
        
        if (options.dryRun) {
          console.log('🎭 Dry run mode - transaction not executed');
          return;
        }
        
        // Check token approval
        console.log('🔍 Checking token approval...');
        const routerAddress = await pancakeSwapV2.getRouterAddress();
        const allowance = await pancakeSwapV2.getTokenAllowance(tokenAddress, walletAddress, routerAddress);
        
        if (allowance < sellAmountWei) {
          console.log('⚡ Approving token for trading...');
          const wallet = new ethers.Wallet(privateKey, pancakeSwapV2.getProvider());
          await pancakeSwapV2.ensureApproval(tokenAddress, sellAmountWei, walletAddress, wallet);
          console.log('✅ Token approved successfully');
        }
        
        // Execute trade
        console.log('⚡ Executing sell trade...');
        const result = await pancakeSwapV2.executeSwap({
          tokenIn: tokenAddress,
          tokenOut: TOKEN_ADDRESSES.WBNB,
          amountIn: sellAmountWei.toString(),
          slippageTolerance: parseFloat(options.slippage),
          deadline: parseInt(options.deadline) * 60 // Convert to seconds
        }, privateKey);
        
        console.log('✅ Sell completed successfully!');
        console.log(`   Transaction Hash: ${result.txHash}`);
        console.log(`   Amount Sold: ${ethers.formatUnits(result.amountIn, tokenInfo.decimals)} ${tokenInfo.symbol}`);
        console.log(`   BNB Received: ${ethers.formatEther(result.amountOut)} BNB`);
        console.log(`   Effective Price: ${result.effectivePrice} BNB per ${tokenInfo.symbol}`);
        console.log(`   Gas Used: ${result.gasUsed}`);
        console.log(`   Gas Cost: ${ethers.formatEther(result.gasCost)} BNB`);
        
        // Record transaction for risk tracking
        enhancedRiskManager.recordTransaction(
          walletAddress,
          sellAmountWei.toString(),
          parseFloat(options.slippage)
        );
        
      } catch (error) {
        console.log('❌ Sell failed:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to execute sell');
        process.exit(1);
      }
    });

  // Quote command
  tradeCmd
    .command('quote')
    .description('Get price quote for trading pair')
    .option('--token-in <address>', 'input token address or symbol')
    .option('--token-out <address>', 'output token address or symbol')
    .option('-a, --amount <amount>', 'input amount', '1')
    .option('-s, --slippage <percent>', 'slippage tolerance (%)', '0.5')
    .action(async (options) => {
      try {
        if (!options.tokenIn || !options.tokenOut) {
          throw new Error('token-in and token-out are required');
        }

        console.log('💹 Getting price quote...');
        
        // Resolve token addresses
        const tokenInAddress = await resolveTokenAddress(options.tokenIn);
        const tokenOutAddress = await resolveTokenAddress(options.tokenOut);
        
        console.log(`📍 Token In: ${options.tokenIn} (${tokenInAddress})`);
        console.log(`📍 Token Out: ${options.tokenOut} (${tokenOutAddress})`);
        
        // Get token info to properly format amount
        const tokenInInfo = await pancakeSwapV2.getTokenInfo(tokenInAddress);
        const amountWei = ethers.parseUnits(options.amount, tokenInInfo.decimals);
        
        // Get comprehensive quote
        const quote = await enhancedPricingService.getTradeQuote(
          tokenInAddress,
          tokenOutAddress,
          amountWei.toString(),
          parseFloat(options.slippage)
        );
        
        console.log(`\n📊 Trading Quote:`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`   Input:  ${quote.tokenIn.amount} ${quote.tokenIn.symbol}`);
        console.log(`   Output: ${quote.tokenOut.amount} ${quote.tokenOut.symbol}`);
        console.log(`   Price:  1 ${quote.tokenIn.symbol} = ${quote.executionPrice} ${quote.tokenOut.symbol}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`   💥 Price Impact: ${quote.priceImpact.impact.toFixed(4)}% (${quote.priceImpact.category})`);
        console.log(`   🛡️  Risk Level: ${quote.priceImpact.recommendation}`);
        console.log(`   📉 Min. Received: ${quote.minimumReceived} ${quote.tokenOut.symbol}`);
        console.log(`   ⛽ Gas Estimate: ${ethers.formatUnits(quote.gasEstimate, 'gwei')} gwei`);
        console.log(`   💰 Total Cost: ${quote.totalCostBNB} BNB`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`   📋 Slippage Analysis:`);
        console.log(`      Recommended: ${quote.slippageAnalysis.recommendedSlippage.toFixed(2)}%`);
        console.log(`      Reason: ${quote.slippageAnalysis.reason}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`   💡 ${quote.recommendation}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
      } catch (error) {
        console.log('❌ Failed to get quote:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to get quote');
        process.exit(1);
      }
    });

  // Batch buy command
  tradeCmd
    .command('buy-batch')
    .description('Execute batch buy orders across multiple wallets')
    .argument('<token>', 'token contract address or symbol')
    .option('--csv <file>', 'CSV file with wallet addresses and amounts')
    .option('-a, --amount <amount>', 'amount per wallet (in BNB)', '0.1')
    .option('-s, --slippage <percent>', 'slippage tolerance (%)', '0.5')
    .option('-g, --group <group>', 'wallet group to use')
    .option('--strategy <strategy>', 'execution strategy (sequential|parallel|staggered)', 'parallel')
    .option('--max-concurrent <number>', 'maximum concurrent transactions', '3')
    .option('--delay <ms>', 'delay between transactions in staggered mode (ms)', '1000')
    .option('--dry-run', 'simulate the trades without executing')
    .action(async (token, options) => {
      try {
        console.log('🚀 Executing batch buy orders...');
        
        // Resolve token address
        const tokenAddress = await resolveTokenAddress(token);
        console.log(`📍 Token address: ${tokenAddress}`);
        
        // Get wallets from various sources
        let wallets: Array<{ address: string; privateKey: string; label?: string }> = [];
        
        if (options.csv) {
          console.log(`📄 Loading wallets from CSV: ${options.csv}`);
          // TODO: Implement CSV parsing
          throw new Error('CSV wallet loading not yet implemented. Use --group instead.');
        } else if (options.group) {
          console.log(`👥 Loading wallet group: ${options.group}`);
          const groupWallets = await walletManager.getWalletGroup(options.group);
          if (!groupWallets || groupWallets.length === 0) {
            throw new Error(`No wallets found in group: ${options.group}`);
          }
          wallets = groupWallets.map(w => ({
            address: w.address,
            privateKey: w.encryptedPrivateKey, // TODO: Decrypt in real implementation
            label: w.label
          }));
        } else {
          throw new Error('Either --csv or --group must be specified');
        }
        
        console.log(`👛 Found ${wallets.length} wallets`);
        
        // Prepare batch trade request
        const amountWei = ethers.parseEther(options.amount);
        console.log(`💰 Amount per wallet: ${options.amount} BNB`);
        console.log(`🎯 Execution strategy: ${options.strategy}`);
        console.log(`⚡ Max concurrent: ${options.maxConcurrent}`);
        if (options.strategy === 'staggered') {
          console.log(`⏱️  Delay between trades: ${options.delay}ms`);
        }
        
        // Create trades array
        const trades = wallets.map(wallet => ({
          walletAddress: wallet.address,
          walletLabel: wallet.label || wallet.address.slice(0, 8),
          privateKey: wallet.privateKey,
          tokenIn: TOKEN_ADDRESSES.WBNB,
          tokenOut: tokenAddress,
          amountIn: amountWei.toString(),
          slippageTolerance: parseFloat(options.slippage),
          deadline: 20 * 60 // 20 minutes
        }));
        
        if (options.dryRun) {
          console.log('🎭 Dry run mode - showing trade preview:');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          trades.forEach((trade, index) => {
            console.log(`   ${index + 1}. ${trade.walletLabel}: ${ethers.formatEther(trade.amountIn)} BNB → ${token}`);
          });
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`   Total trades: ${trades.length}`);
          console.log(`   Total volume: ${ethers.formatEther(BigInt(trades.length) * amountWei)} BNB`);
          return;
        }
        
        // Execute batch trade
        console.log('⚡ Submitting batch trade request...');
        const requestId = await batchTradeEngine.submitBatchTrade({
          requestId: `buy-batch-${Date.now()}`,
          trades,
          executionStrategy: options.strategy as 'sequential' | 'parallel' | 'staggered',
          maxConcurrentTrades: parseInt(options.maxConcurrent),
          delayBetweenTrades: parseInt(options.delay),
          enableRiskChecks: true,
          enableRetries: true,
          maxRetries: 2
        });
        
        console.log(`📋 Batch request ID: ${requestId}`);
        console.log('⏳ Executing trades...');
        
        // Execute and monitor
        const result = await batchTradeEngine.executeBatchTrade(requestId);
        
        console.log('✅ Batch execution completed!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   📊 Summary:`);
        console.log(`      Total trades: ${result.totalTrades}`);
        console.log(`      Successful: ${result.successfulTrades} ✅`);
        console.log(`      Failed: ${result.failedTrades} ❌`);
        console.log(`      Success rate: ${((result.successfulTrades / result.totalTrades) * 100).toFixed(1)}%`);
        console.log(`      Total gas used: ${result.totalGasUsed}`);
        console.log(`      Total gas cost: ${ethers.formatEther(result.totalGasCost)} BNB`);
        console.log(`      Execution time: ${(result.executionTimeMs / 1000).toFixed(2)}s`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Show individual results
        if (result.failedTrades > 0) {
          console.log('❌ Failed trades:');
          result.results
            .filter(r => r.status === 'failed')
            .forEach(r => {
              console.log(`   - ${r.walletLabel}: ${r.error}`);
            });
        }
        
        if (result.successfulTrades > 0) {
          console.log('✅ Successful trades:');
          result.results
            .filter(r => r.status === 'success')
            .slice(0, 5) // Show first 5
            .forEach(r => {
              console.log(`   - ${r.walletLabel}: ${r.txHash} (${ethers.formatEther(r.amountOut || '0')} tokens)`);
            });
          if (result.successfulTrades > 5) {
            console.log(`   ... and ${result.successfulTrades - 5} more`);
          }
        }
        
      } catch (error) {
        console.log('❌ Batch buy failed:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to execute batch buy');
        process.exit(1);
      }
    });

  // Batch sell command
  tradeCmd
    .command('sell-batch')
    .description('Execute batch sell orders across multiple wallets')
    .argument('<token>', 'token contract address or symbol')
    .option('--csv <file>', 'CSV file with wallet addresses and amounts')
    .option('-p, --percentage <percent>', 'percentage of balance to sell per wallet', '100')
    .option('-s, --slippage <percent>', 'slippage tolerance (%)', '0.5')
    .option('-g, --group <group>', 'wallet group to use')
    .option('--strategy <strategy>', 'execution strategy (sequential|parallel|staggered)', 'parallel')
    .option('--max-concurrent <number>', 'maximum concurrent transactions', '3')
    .option('--delay <ms>', 'delay between transactions in staggered mode (ms)', '1000')
    .option('--min-balance <amount>', 'minimum token balance to consider for selling', '0')
    .option('--dry-run', 'simulate the trades without executing')
    .action(async (token, options) => {
      try {
        console.log('💰 Executing batch sell orders...');
        
        // Resolve token address
        const tokenAddress = await resolveTokenAddress(token);
        console.log(`📍 Token address: ${tokenAddress}`);
        
        // Check if trying to sell BNB/WBNB
        if (tokenAddress.toLowerCase() === TOKEN_ADDRESSES.WBNB.toLowerCase()) {
          throw new Error('Cannot sell WBNB for BNB. Use unwrap command instead.');
        }
        
        // Get token info
        const tokenInfo = await pancakeSwapV2.getTokenInfo(tokenAddress);
        console.log(`🪙 Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
        
        // Get wallets from various sources
        let wallets: Array<{ address: string; privateKey: string; label?: string }> = [];
        
        if (options.csv) {
          console.log(`📄 Loading wallets from CSV: ${options.csv}`);
          // TODO: Implement CSV parsing
          throw new Error('CSV wallet loading not yet implemented. Use --group instead.');
        } else if (options.group) {
          console.log(`👥 Loading wallet group: ${options.group}`);
          const groupWallets = await walletManager.getWalletGroup(options.group);
          if (!groupWallets || groupWallets.length === 0) {
            throw new Error(`No wallets found in group: ${options.group}`);
          }
          wallets = groupWallets.map(w => ({
            address: w.address,
            privateKey: w.encryptedPrivateKey, // TODO: Decrypt in real implementation
            label: w.label
          }));
        } else {
          throw new Error('Either --csv or --group must be specified');
        }
        
        console.log(`👛 Found ${wallets.length} wallets`);
        console.log('🔍 Checking wallet balances...');
        
        // Check balances and prepare trades
        const trades: Array<{
          walletAddress: string;
          walletLabel: string;
          privateKey: string;
          tokenIn: string;
          tokenOut: string;
          amountIn: string;
          slippageTolerance: number;
          deadline: number;
        }> = [];
        
        const minBalanceWei = ethers.parseUnits(options.minBalance, tokenInfo.decimals);
        const percentage = parseFloat(options.percentage);
        
        if (percentage <= 0 || percentage > 100) {
          throw new Error('Percentage must be between 0 and 100');
        }
        
        let totalEligibleWallets = 0;
        let totalTokensToSell = BigInt(0);
        
        for (const wallet of wallets) {
          const balance = await pancakeSwapV2.getTokenBalance(tokenAddress, wallet.address);
          
          if (balance > minBalanceWei) {
            const sellAmount = (balance * BigInt(Math.floor(percentage * 100))) / BigInt(10000);
            
            if (sellAmount > 0) {
              trades.push({
                walletAddress: wallet.address,
                walletLabel: wallet.label || wallet.address.slice(0, 8),
                privateKey: wallet.privateKey,
                tokenIn: tokenAddress,
                tokenOut: TOKEN_ADDRESSES.WBNB,
                amountIn: sellAmount.toString(),
                slippageTolerance: parseFloat(options.slippage),
                deadline: 20 * 60 // 20 minutes
              });
              
              totalEligibleWallets++;
              totalTokensToSell += sellAmount;
            }
          }
        }
        
        if (trades.length === 0) {
          console.log('❌ No wallets with sufficient balance found');
          console.log(`   Minimum balance required: ${options.minBalance} ${tokenInfo.symbol}`);
          return;
        }
        
        console.log(`📊 Batch sell summary:`);
        console.log(`   Eligible wallets: ${totalEligibleWallets}/${wallets.length}`);
        console.log(`   Sell percentage: ${percentage}%`);
        console.log(`   Total tokens to sell: ${ethers.formatUnits(totalTokensToSell, tokenInfo.decimals)} ${tokenInfo.symbol}`);
        console.log(`   Execution strategy: ${options.strategy}`);
        console.log(`   Max concurrent: ${options.maxConcurrent}`);
        if (options.strategy === 'staggered') {
          console.log(`   Delay between trades: ${options.delay}ms`);
        }
        
        if (options.dryRun) {
          console.log('🎭 Dry run mode - showing trade preview:');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          trades.slice(0, 10).forEach((trade, index) => {
            const amount = ethers.formatUnits(trade.amountIn, tokenInfo.decimals);
            console.log(`   ${index + 1}. ${trade.walletLabel}: ${amount} ${tokenInfo.symbol} → BNB`);
          });
          if (trades.length > 10) {
            console.log(`   ... and ${trades.length - 10} more wallets`);
          }
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`   Total trades: ${trades.length}`);
          console.log(`   Total volume: ${ethers.formatUnits(totalTokensToSell, tokenInfo.decimals)} ${tokenInfo.symbol}`);
          return;
        }
        
        // Execute batch trade
        console.log('⚡ Submitting batch sell request...');
        const requestId = await batchTradeEngine.submitBatchTrade({
          requestId: `sell-batch-${Date.now()}`,
          trades,
          executionStrategy: options.strategy as 'sequential' | 'parallel' | 'staggered',
          maxConcurrentTrades: parseInt(options.maxConcurrent),
          delayBetweenTrades: parseInt(options.delay),
          enableRiskChecks: true,
          enableRetries: true,
          maxRetries: 2
        });
        
        console.log(`📋 Batch request ID: ${requestId}`);
        console.log('⏳ Executing trades...');
        
        // Execute and monitor
        const result = await batchTradeEngine.executeBatchTrade(requestId);
        
        console.log('✅ Batch execution completed!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`   📊 Summary:`);
        console.log(`      Total trades: ${result.totalTrades}`);
        console.log(`      Successful: ${result.successfulTrades} ✅`);
        console.log(`      Failed: ${result.failedTrades} ❌`);
        console.log(`      Success rate: ${((result.successfulTrades / result.totalTrades) * 100).toFixed(1)}%`);
        console.log(`      Total gas used: ${result.totalGasUsed}`);
        console.log(`      Total gas cost: ${ethers.formatEther(result.totalGasCost)} BNB`);
        console.log(`      Execution time: ${(result.executionTimeMs / 1000).toFixed(2)}s`);
        
        // Calculate total BNB received
        const totalBnbReceived = result.results
          .filter(r => r.status === 'success' && r.amountOut)
          .reduce((sum, r) => sum + BigInt(r.amountOut || '0'), BigInt(0));
        
        console.log(`      Total BNB received: ${ethers.formatEther(totalBnbReceived)} BNB`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // Show individual results
        if (result.failedTrades > 0) {
          console.log('❌ Failed trades:');
          result.results
            .filter(r => r.status === 'failed')
            .forEach(r => {
              console.log(`   - ${r.walletLabel}: ${r.error}`);
            });
        }
        
        if (result.successfulTrades > 0) {
          console.log('✅ Successful trades:');
          result.results
            .filter(r => r.status === 'success')
            .slice(0, 5) // Show first 5
            .forEach(r => {
              const bnbReceived = ethers.formatEther(r.amountOut || '0');
              console.log(`   - ${r.walletLabel}: ${r.txHash} (${bnbReceived} BNB)`);
            });
          if (result.successfulTrades > 5) {
            console.log(`   ... and ${result.successfulTrades - 5} more`);
          }
        }
        
      } catch (error) {
        console.log('❌ Batch sell failed:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to execute batch sell');
        process.exit(1);
      }
    });

  // Approve command
  tradeCmd
    .command('approve')
    .description('Approve token spending for DEX router')
    .argument('<token>', 'token contract address or symbol')
    .option('-a, --amount <amount>', 'amount to approve (default: unlimited)')
    .option('-w, --wallet <address>', 'wallet address to use')
    .option('-k, --private-key <key>', 'private key for the transaction')
    .option('--spender <address>', 'spender address (default: PancakeSwap router)')
    .option('--dry-run', 'simulate the approval without executing')
    .action(async (token, options) => {
      try {
        console.log('🔓 Setting token approval...');
        
        // Resolve token address
        const tokenAddress = await resolveTokenAddress(token);
        console.log(`📍 Token address: ${tokenAddress}`);
        
        // Check if trying to approve BNB/WBNB
        if (tokenAddress.toLowerCase() === TOKEN_ADDRESSES.WBNB.toLowerCase()) {
          console.log('ℹ️  WBNB does not require approval for PancakeSwap');
          return;
        }
        
        // Get wallet and private key
        const { walletAddress, privateKey } = await getWalletInfo(options, logger);
        console.log(`👛 Using wallet: ${walletAddress}`);
        
        // Get token info
        const tokenInfo = await pancakeSwapV2.getTokenInfo(tokenAddress);
        console.log(`🪙 Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
        
        // Determine spender address
        const spenderAddress = options.spender || await pancakeSwapV2.getRouterAddress();
        console.log(`🎯 Spender: ${spenderAddress}`);
        
        // Check current allowance
        const currentAllowance = await pancakeSwapV2.getTokenAllowance(tokenAddress, walletAddress, spenderAddress);
        const formattedCurrentAllowance = ethers.formatUnits(currentAllowance, tokenInfo.decimals);
        console.log(`📊 Current allowance: ${formattedCurrentAllowance} ${tokenInfo.symbol}`);
        
        // Determine approval amount
        let approvalAmount: bigint;
        let formattedAmount: string;
        
        if (options.amount) {
          if (options.amount.toLowerCase() === 'max' || options.amount.toLowerCase() === 'unlimited') {
            approvalAmount = ethers.MaxUint256;
            formattedAmount = 'unlimited';
          } else {
            approvalAmount = ethers.parseUnits(options.amount, tokenInfo.decimals);
            formattedAmount = options.amount;
          }
        } else {
          // Default to unlimited approval
          approvalAmount = ethers.MaxUint256;
          formattedAmount = 'unlimited';
        }
        
        console.log(`💰 Approval amount: ${formattedAmount} ${tokenInfo.symbol}`);
        
        // Check if approval is needed
        if (currentAllowance >= approvalAmount && approvalAmount !== ethers.MaxUint256) {
          console.log('✅ Current allowance is already sufficient');
          return;
        }
        
        if (options.dryRun) {
          console.log('🎭 Dry run mode - approval not executed');
          console.log(`   Would approve: ${formattedAmount} ${tokenInfo.symbol}`);
          console.log(`   For spender: ${spenderAddress}`);
          return;
        }
        
        // Execute approval
        console.log('⚡ Executing approval...');
        const wallet = new ethers.Wallet(privateKey, pancakeSwapV2.getProvider());
        
        // Get token contract
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ['function approve(address spender, uint256 amount) returns (bool)'],
          wallet
        );
        
        // Estimate gas
        const gasEstimate = await tokenContract.approve.estimateGas(spenderAddress, approvalAmount);
        console.log(`⛽ Gas estimate: ${gasEstimate.toString()}`);
        
        // Execute approval transaction
        const tx = await tokenContract.approve(spenderAddress, approvalAmount);
        console.log(`📋 Transaction submitted: ${tx.hash}`);
        console.log('⏳ Waiting for confirmation...');
        
        const receipt = await tx.wait();
        console.log('✅ Approval completed successfully!');
        console.log(`   Transaction Hash: ${receipt.hash}`);
        console.log(`   Block Number: ${receipt.blockNumber}`);
        console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
        console.log(`   Gas Cost: ${ethers.formatEther(receipt.gasUsed * (receipt.gasPrice || BigInt(0)))} BNB`);
        
        // Verify approval
        const newAllowance = await pancakeSwapV2.getTokenAllowance(tokenAddress, walletAddress, spenderAddress);
        const formattedNewAllowance = newAllowance === ethers.MaxUint256 ? 'unlimited' : ethers.formatUnits(newAllowance, tokenInfo.decimals);
        console.log(`✅ New allowance: ${formattedNewAllowance} ${tokenInfo.symbol}`);
        
      } catch (error) {
        console.log('❌ Approval failed:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to execute approve');
        process.exit(1);
      }
    });

  // Allowance command
  tradeCmd
    .command('allowance')
    .description('Check token allowance')
    .argument('<token>', 'token contract address or symbol')
    .option('-w, --wallet <address>', 'wallet address to check')
    .option('-k, --private-key <key>', 'private key to derive wallet address from')
    .option('-g, --group <group>', 'check all wallets in a group')
    .option('--spender <address>', 'spender address (default: PancakeSwap router)')
    .option('--csv', 'output in CSV format')
    .action(async (token, options) => {
      try {
        console.log('🔍 Checking token allowances...');
        
        // Resolve token address
        const tokenAddress = await resolveTokenAddress(token);
        console.log(`📍 Token address: ${tokenAddress}`);
        
        // Check if checking BNB/WBNB
        if (tokenAddress.toLowerCase() === TOKEN_ADDRESSES.WBNB.toLowerCase()) {
          console.log('ℹ️  WBNB does not require approval for PancakeSwap');
          return;
        }
        
        // Get token info
        const tokenInfo = await pancakeSwapV2.getTokenInfo(tokenAddress);
        console.log(`🪙 Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
        
        // Determine spender address
        const spenderAddress = options.spender || await pancakeSwapV2.getRouterAddress();
        console.log(`🎯 Spender: ${spenderAddress}`);
        
        // Collect wallets to check
        let wallets: Array<{ address: string; label?: string }> = [];
        
        if (options.privateKey) {
          const wallet = new ethers.Wallet(options.privateKey);
          wallets.push({ address: wallet.address, label: 'From Private Key' });
        } else if (options.wallet) {
          wallets.push({ address: options.wallet, label: 'Specified Wallet' });
        } else if (options.group) {
          console.log(`👥 Loading wallet group: ${options.group}`);
          const groupWallets = await walletManager.getWalletGroup(options.group);
          if (!groupWallets || groupWallets.length === 0) {
            throw new Error(`No wallets found in group: ${options.group}`);
          }
          wallets = groupWallets.map(w => ({
            address: w.address,
            label: w.label || w.address.slice(0, 8)
          }));
        } else {
          throw new Error('Either --wallet, --private-key, or --group must be specified');
        }
        
        console.log(`👛 Checking ${wallets.length} wallet(s)...\n`);
        
        // Check allowances
        const results: Array<{
          address: string;
          label: string;
          allowance: string;
          formattedAllowance: string;
          isUnlimited: boolean;
          needsApproval: boolean;
        }> = [];
        
        for (const wallet of wallets) {
          try {
            const allowance = await pancakeSwapV2.getTokenAllowance(tokenAddress, wallet.address, spenderAddress);
            const isUnlimited = allowance === ethers.MaxUint256;
            const formattedAllowance = isUnlimited ? 'unlimited' : ethers.formatUnits(allowance, tokenInfo.decimals);
            const needsApproval = allowance === BigInt(0);
            
            results.push({
              address: wallet.address,
              label: wallet.label || wallet.address.slice(0, 8),
              allowance: allowance.toString(),
              formattedAllowance,
              isUnlimited,
              needsApproval
            });
          } catch (error) {
            results.push({
              address: wallet.address,
              label: wallet.label || wallet.address.slice(0, 8),
              allowance: '0',
              formattedAllowance: 'ERROR',
              isUnlimited: false,
              needsApproval: true
            });
          }
        }
        
        // Output results
        if (options.csv) {
          console.log('Wallet Address,Label,Allowance,Formatted Allowance,Is Unlimited,Needs Approval');
          results.forEach(result => {
            console.log(`${result.address},${result.label},${result.allowance},${result.formattedAllowance},${result.isUnlimited},${result.needsApproval}`);
          });
        } else {
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`📊 Token Allowances for ${tokenInfo.symbol}`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`Spender: ${spenderAddress}`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          
          // Group results by status
          const unlimited = results.filter(r => r.isUnlimited);
          const withAllowance = results.filter(r => !r.isUnlimited && !r.needsApproval && r.formattedAllowance !== 'ERROR');
          const needsApproval = results.filter(r => r.needsApproval && r.formattedAllowance !== 'ERROR');
          const errors = results.filter(r => r.formattedAllowance === 'ERROR');
          
          if (unlimited.length > 0) {
            console.log('✅ Unlimited Approvals:');
            unlimited.forEach(result => {
              console.log(`   ${result.label} (${result.address}): unlimited`);
            });
            console.log('');
          }
          
          if (withAllowance.length > 0) {
            console.log('📊 Limited Approvals:');
            withAllowance.forEach(result => {
              console.log(`   ${result.label} (${result.address}): ${result.formattedAllowance} ${tokenInfo.symbol}`);
            });
            console.log('');
          }
          
          if (needsApproval.length > 0) {
            console.log('❌ No Approval (Needs Approval):');
            needsApproval.forEach(result => {
              console.log(`   ${result.label} (${result.address}): 0 ${tokenInfo.symbol}`);
            });
            console.log('');
          }
          
          if (errors.length > 0) {
            console.log('⚠️  Errors:');
            errors.forEach(result => {
              console.log(`   ${result.label} (${result.address}): Failed to check`);
            });
            console.log('');
          }
          
          // Summary
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('📈 Summary:');
          console.log(`   Total wallets: ${results.length}`);
          console.log(`   ✅ Unlimited approvals: ${unlimited.length}`);
          console.log(`   📊 Limited approvals: ${withAllowance.length}`);
          console.log(`   ❌ Need approval: ${needsApproval.length}`);
          console.log(`   ⚠️  Errors: ${errors.length}`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          
          if (needsApproval.length > 0) {
            console.log('\n💡 To approve tokens for wallets that need approval, use:');
            console.log(`   bsc-bot trade approve ${token} --wallet <address> --private-key <key>`);
          }
        }
        
      } catch (error) {
        console.log('❌ Failed to check allowance:', error instanceof Error ? error.message : 'Unknown error');
        logger.error({ err: formatError(error) }, 'Failed to check allowance');
        process.exit(1);
      }
    });
}
