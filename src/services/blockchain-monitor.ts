import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { database } from '../persistence/database';
import { configManager } from '../config';

interface TransactionEvent {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed?: string;
  gasPrice: string;
  blockNumber: number;
  blockTimestamp: number;
  status: 'success' | 'failed';
  tokenAddress?: string;
  tokenSymbol?: string;
  tokenAmount?: string;
  operationType?: 'transfer' | 'token_transfer' | 'approve' | 'swap' | 'liquidity_add' | 'liquidity_remove' | 'unknown';
  eventSignature?: string;
  methodId?: string;
}

interface TokenTransferEvent extends TransactionEvent {
  tokenAddress: string;
  tokenSymbol: string;
  tokenAmount: string;
  tokenDecimals: number;
}

export class BlockchainMonitor {
  private static instance: BlockchainMonitor;
  private provider: ethers.JsonRpcProvider;
  private isMonitoring = false;
  private watchedAddresses: Set<string> = new Set();
  private lastProcessedBlock = 0;
  private eventQueue: TransactionEvent[] = [];
  private readonly MAX_QUEUE_SIZE = 1000;

  // Event signatures for different operations
  private readonly TRANSFER_EVENT_SIGNATURE = ethers.id('Transfer(address,address,uint256)');
  private readonly APPROVAL_EVENT_SIGNATURE = ethers.id('Approval(address,address,uint256)');
  private readonly SWAP_EVENT_SIGNATURE = ethers.id('Swap(address,address,int256,int256,uint160,uint128,int24)');
  
  // Method IDs for common operations
  private readonly METHOD_IDS = {
    TRANSFER: '0xa9059cbb', // transfer(address,uint256)
    TRANSFER_FROM: '0x23b872dd', // transferFrom(address,address,uint256)
    APPROVE: '0x095ea7b3', // approve(address,uint256)
    SWAP_EXACT_TOKENS: '0x38ed1739', // swapExactTokensForTokens
    SWAP_EXACT_ETH: '0x7ff36ab5', // swapExactETHForTokens
    ADD_LIQUIDITY: '0xe8e33700', // addLiquidity
    REMOVE_LIQUIDITY: '0xbaa2abde', // removeLiquidity
  };
  
  // Common ERC20 ABI for decoding events
  private readonly ERC20_ABI = [
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)'
  ];

  private constructor() {
    const config = configManager.config;
    this.provider = new ethers.JsonRpcProvider(config.rpc.primary_urls[0]);
  }

  public static getInstance(): BlockchainMonitor {
    if (!BlockchainMonitor.instance) {
      BlockchainMonitor.instance = new BlockchainMonitor();
    }
    return BlockchainMonitor.instance;
  }

  async startMonitoring(watchedAddresses: string[]): Promise<{
    status: 'started' | 'updated';
    addedAddresses: string[];
    skippedAddresses?: string[];
    totalWatched: number;
  }> {
    if (this.isMonitoring) {
      // If already monitoring, just add new addresses
      const beforeCount = this.watchedAddresses.size;
      logger.info({
        currentAddresses: beforeCount,
        requestedAddresses: watchedAddresses.length
      }, 'Blockchain monitoring is already running, checking for new addresses');
      
      const result = this.addWatchedAddresses(watchedAddresses);
      const afterCount = this.watchedAddresses.size;
      
      logger.info({
        actuallyAddedCount: result.added.length,
        skippedCount: result.skipped.length,
        totalWatched: afterCount,
        actuallyAddedAddresses: result.added,
        skippedAddresses: result.skipped
      }, result.added.length > 0 
        ? 'Successfully added new addresses to monitoring' 
        : 'No new addresses added (all were duplicates)');
      
      return {
        status: 'updated',
        addedAddresses: result.added,
        skippedAddresses: result.skipped,
        totalWatched: afterCount
      };
    }

    try {
      // Starting fresh monitoring
      const uniqueAddresses = [...new Set(watchedAddresses.map(addr => addr.toLowerCase()))];
      this.watchedAddresses = new Set(uniqueAddresses);
      this.lastProcessedBlock = await this.provider.getBlockNumber();
      this.isMonitoring = true;

      logger.info({
        watchedAddresses: uniqueAddresses.length,
        startBlock: this.lastProcessedBlock
      }, 'Starting blockchain monitoring');

      // Start monitoring loop
      this.monitoringLoop();

      // Start event processing loop
      this.processEventQueue();

      return {
        status: 'started',
        addedAddresses: uniqueAddresses, // Return normalized addresses when starting
        totalWatched: this.watchedAddresses.size
      };

    } catch (error) {
      logger.error({ error }, 'Failed to start blockchain monitoring');
      throw error;
    }
  }

  stopMonitoring(): void {
    this.isMonitoring = false;
    logger.info('Blockchain monitoring stopped');
  }

  addWatchedAddress(address: string): boolean {
    const normalizedAddr = address.toLowerCase();
    if (this.watchedAddresses.has(normalizedAddr)) {
      logger.debug({ address }, 'Address already being monitored');
      return false;
    }
    this.watchedAddresses.add(normalizedAddr);
    logger.debug({ address }, 'Added address to monitoring');
    return true;
  }

  addWatchedAddresses(addresses: string[]): { added: string[], skipped: string[] } {
    const added: string[] = [];
    const skipped: string[] = [];
    
    addresses.forEach(address => {
      const normalizedAddr = address.toLowerCase();
      if (!this.watchedAddresses.has(normalizedAddr)) {
        this.watchedAddresses.add(normalizedAddr);
        added.push(address);
      } else {
        skipped.push(address);
      }
    });
    
    logger.info({ 
      addressesAdded: added.length,
      addressesSkipped: skipped.length,
      totalWatched: this.watchedAddresses.size,
      newAddresses: added,
      duplicates: skipped
    }, added.length > 0 ? 'Added new addresses to monitoring' : 'No new addresses added (all duplicates)');
    
    return { added, skipped };
  }

  removeWatchedAddress(address: string): void {
    this.watchedAddresses.delete(address.toLowerCase());
    logger.debug({ address }, 'Removed address from monitoring');
  }
  
  getWatchedAddresses(): string[] {
    return Array.from(this.watchedAddresses);
  }

  private async monitoringLoop(): Promise<void> {
    while (this.isMonitoring) {
      try {
        const currentBlock = await this.provider.getBlockNumber();
        
        if (currentBlock > this.lastProcessedBlock) {
          await this.processNewBlocks(this.lastProcessedBlock + 1, currentBlock);
          this.lastProcessedBlock = currentBlock;
        }

        // Wait 10 seconds before next check
        await new Promise(resolve => setTimeout(resolve, 10000));
      } catch (error) {
        logger.error({ error }, 'Error in monitoring loop');
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s on error
      }
    }
  }

  private async processNewBlocks(fromBlock: number, toBlock: number): Promise<void> {
    // Process blocks in batches to avoid overwhelming the RPC
    const batchSize = 10;
    
    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum += batchSize) {
      const endBlock = Math.min(blockNum + batchSize - 1, toBlock);
      
      try {
        await this.processBlockRange(blockNum, endBlock);
      } catch (error) {
        logger.warn({ error, fromBlock: blockNum, toBlock: endBlock }, 'Failed to process block range');
      }

      // Small delay between batches
      if (blockNum + batchSize <= toBlock) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.debug({ fromBlock, toBlock, processedBlocks: toBlock - fromBlock + 1 }, 'Processed block range');
  }

  private async processBlockRange(fromBlock: number, toBlock: number): Promise<void> {
    // Get all transactions for watched addresses in this block range
    const filter = {
      fromBlock,
      toBlock,
      topics: [this.TRANSFER_EVENT_SIGNATURE]
    };

    const logs = await this.provider.getLogs(filter);
    
    for (const log of logs) {
      try {
        const event = await this.parseTransferEvent(log);
        if (event && this.isAddressWatched(event.from) || this.isAddressWatched(event.to)) {
          this.addEventToQueue(event);
        }
      } catch (error) {
        logger.debug({ error, txHash: log.transactionHash }, 'Failed to parse transfer event');
      }
    }

    // Also check for native BNB transfers to/from watched addresses
    await this.processNativeTransfers(fromBlock, toBlock);
  }

  private async processNativeTransfers(fromBlock: number, toBlock: number): Promise<void> {
    for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
      try {
        const block = await this.provider.getBlock(blockNum, true);
        if (!block || !block.transactions) continue;

        for (const tx of block.transactions) {
          if (typeof tx === 'string') continue; // Skip if only hash
          
          const transaction = tx as ethers.TransactionResponse;
          
          if (transaction.value && transaction.value > BigInt(0)) {
            const fromAddress = transaction.from?.toLowerCase();
            const toAddress = transaction.to?.toLowerCase();
            
            if ((fromAddress && this.isAddressWatched(fromAddress)) || 
                (toAddress && this.isAddressWatched(toAddress))) {
              
              const receipt = await transaction.wait();
              if (!receipt) continue;

              const event: TransactionEvent = {
                hash: transaction.hash,
                from: transaction.from,
                to: transaction.to || '',
                value: transaction.value.toString(),
                gasUsed: receipt.gasUsed.toString(),
                gasPrice: transaction.gasPrice?.toString() || '0',
                blockNumber: transaction.blockNumber || 0,
                blockTimestamp: block.timestamp,
                status: receipt.status === 1 ? 'success' : 'failed'
              };

              this.addEventToQueue(event);
            }
          }
        }
      } catch (error) {
        logger.debug({ error, blockNum }, 'Failed to process native transfers for block');
      }
    }
  }

  private async parseTransferEvent(log: ethers.Log): Promise<TokenTransferEvent | null> {
    try {
      const iface = new ethers.Interface(this.ERC20_ABI);
      const decoded = iface.parseLog({
        topics: log.topics as string[],
        data: log.data
      });

      if (!decoded) return null;

      const [from, to, value] = decoded.args;
      
      // Get token info
      const contract = new ethers.Contract(log.address, this.ERC20_ABI, this.provider);
      const [symbol, decimals] = await Promise.all([
        contract.symbol().catch(() => 'UNKNOWN'),
        contract.decimals().catch(() => 18)
      ]);

      // Get transaction receipt for gas info
      const receipt = await this.provider.getTransactionReceipt(log.transactionHash);
      const transaction = await this.provider.getTransaction(log.transactionHash);
      
      if (!receipt || !transaction) return null;

      // Get method ID from transaction data
      const methodId = transaction.data?.slice(0, 10);
      const operationType = this.getOperationType(methodId, log.topics[0]);
      
      return {
        hash: log.transactionHash,
        from: from.toLowerCase(),
        to: to.toLowerCase(),
        value: '0', // Native value is 0 for token transfers
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: transaction.gasPrice?.toString() || '0',
        blockNumber: log.blockNumber,
        blockTimestamp: (await this.provider.getBlock(log.blockNumber))?.timestamp || 0,
        status: receipt.status === 1 ? 'success' : 'failed',
        tokenAddress: log.address.toLowerCase(),
        tokenSymbol: symbol,
        tokenAmount: value.toString(),
        tokenDecimals: Number(decimals),
        operationType,
        methodId,
        eventSignature: log.topics[0]
      };
    } catch (error) {
      logger.debug({ error, txHash: log.transactionHash }, 'Failed to parse transfer event');
      return null;
    }
  }

  private isAddressWatched(address: string): boolean {
    return this.watchedAddresses.has(address.toLowerCase());
  }

  private getOperationType(methodId: string | undefined, eventSignature?: string): TransactionEvent['operationType'] {
    if (!methodId) return 'unknown';
    
    // Check method ID
    const methodIdLower = methodId.toLowerCase();
    if (methodIdLower === this.METHOD_IDS.TRANSFER) return 'token_transfer';
    if (methodIdLower === this.METHOD_IDS.TRANSFER_FROM) return 'token_transfer';
    if (methodIdLower === this.METHOD_IDS.APPROVE) return 'approve';
    if (methodIdLower === this.METHOD_IDS.SWAP_EXACT_TOKENS) return 'swap';
    if (methodIdLower === this.METHOD_IDS.SWAP_EXACT_ETH) return 'swap';
    if (methodIdLower === this.METHOD_IDS.ADD_LIQUIDITY) return 'liquidity_add';
    if (methodIdLower === this.METHOD_IDS.REMOVE_LIQUIDITY) return 'liquidity_remove';
    
    // Check event signature as fallback
    if (eventSignature) {
      if (eventSignature === this.TRANSFER_EVENT_SIGNATURE) return 'token_transfer';
      if (eventSignature === this.APPROVAL_EVENT_SIGNATURE) return 'approve';
      if (eventSignature === this.SWAP_EVENT_SIGNATURE) return 'swap';
    }
    
    return 'unknown';
  }

  private addEventToQueue(event: TransactionEvent): void {
    if (this.eventQueue.length >= this.MAX_QUEUE_SIZE) {
      // Remove oldest event if queue is full
      this.eventQueue.shift();
      logger.warn('Event queue is full, removing oldest event');
    }
    
    this.eventQueue.push(event);
  }

  private async processEventQueue(): Promise<void> {
    while (this.isMonitoring) {
      try {
        if (this.eventQueue.length > 0) {
          const events = this.eventQueue.splice(0, Math.min(50, this.eventQueue.length));
          await this.saveEventsToDatabase(events);
        }

        // Wait 5 seconds before next processing
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        logger.error({ error }, 'Error processing event queue');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  private async saveEventsToDatabase(events: TransactionEvent[]): Promise<void> {
    try {
      await database.ensureConnection();
      
      if (!database.connection) {
        logger.warn('Database not available, skipping event storage');
        return;
      }

      const transactions = events.map(event => ({
        tx_hash: event.hash,
        from_address: event.from,
        to_address: event.to,
        amount: event.tokenAmount || event.value,
        token_address: event.tokenAddress || null,
        token_symbol: event.tokenSymbol || null,
        token_decimals: (event as TokenTransferEvent).tokenDecimals || null,
        gas_used: event.gasUsed || '0',
        gas_price: event.gasPrice,
        transaction_fee: event.gasUsed ? 
          (BigInt(event.gasUsed) * BigInt(event.gasPrice)).toString() : '0',
        status: event.status === 'success' ? 'confirmed' : 'failed',
        operation_type: event.operationType || (event.tokenAddress ? 'token_transfer' : 'transfer'),
        method_id: event.methodId || null,
        event_signature: event.eventSignature || null,
        block_number: event.blockNumber.toString(),
        block_timestamp: event.blockTimestamp,
        created_at: new Date(),
        updated_at: new Date()
      }));

      // Insert transactions, ignore duplicates
      await database.connection('blockchain_transactions')
        .insert(transactions)
        .onConflict('tx_hash')
        .ignore();

      logger.debug({ eventCount: events.length }, 'Saved blockchain events to database');
    } catch (error) {
      logger.error({ error, eventCount: events.length }, 'Failed to save events to database');
    }
  }

  getMonitoringStats(): {
    isMonitoring: boolean;
    watchedAddresses: number;
    lastProcessedBlock: number;
    queueSize: number;
  } {
    return {
      isMonitoring: this.isMonitoring,
      watchedAddresses: this.watchedAddresses.size,
      lastProcessedBlock: this.lastProcessedBlock,
      queueSize: this.eventQueue.length
    };
  }

  async getRecentTransactions(address: string, limit = 50): Promise<any[]> {
    try {
      await database.ensureConnection();
      
      if (!database.connection) {
        return [];
      }

      const transactions = await database.connection('blockchain_transactions')
        .where('from_address', address.toLowerCase())
        .orWhere('to_address', address.toLowerCase())
        .orderBy('created_at', 'desc')
        .limit(limit)
        .select('*');

      return transactions;
    } catch (error) {
      logger.error({ error, address }, 'Failed to get recent transactions');
      return [];
    }
  }
}

export const blockchainMonitor = BlockchainMonitor.getInstance();