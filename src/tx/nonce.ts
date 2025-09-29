import { configManager } from '../config';
import { logger } from '../utils/logger';
import { rpcManager } from '../blockchain/rpc';

export interface NonceState {
  address: string;
  currentNonce: number;
  pendingTransactions: Set<number>;
  lastUpdate: Date;
}

export class NonceManager {
  private static instance: NonceManager;
  private nonceStates = new Map<string, NonceState>();
  private reservationTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly RESERVATION_TIMEOUT = 300000; // 5 minutes

  private constructor() {
    // Initialize with RPC manager
    rpcManager.initialize();
  }

  public static getInstance(): NonceManager {
    if (!NonceManager.instance) {
      NonceManager.instance = new NonceManager();
    }
    return NonceManager.instance;
  }

  async getNonce(address: string): Promise<number> {
    const lowerAddress = address.toLowerCase();
    const state = this.nonceStates.get(lowerAddress);
    
    // Get current on-chain nonce
    const provider = rpcManager.getProvider();
    const onChainNonce = await provider.getTransactionCount(address, 'latest');

    if (!state) {
      // Initialize state for new address
      const newState: NonceState = {
        address: lowerAddress,
        currentNonce: onChainNonce,
        pendingTransactions: new Set(),
        lastUpdate: new Date(),
      };
      
      this.nonceStates.set(lowerAddress, newState);
      logger.info({ address: lowerAddress, nonce: onChainNonce }, 'Initialized nonce state');
      return onChainNonce;
    }

    // Update state with latest on-chain nonce
    if (onChainNonce > state.currentNonce) {
      // Some transactions have been confirmed
      const confirmedNonces = Array.from(state.pendingTransactions)
        .filter(nonce => nonce < onChainNonce);
      
      confirmedNonces.forEach(nonce => {
        state.pendingTransactions.delete(nonce);
      });

      state.currentNonce = onChainNonce;
      state.lastUpdate = new Date();
      
      logger.debug({ 
        address: lowerAddress, 
        newNonce: onChainNonce,
        confirmedCount: confirmedNonces.length,
        pendingCount: state.pendingTransactions.size
      }, 'Updated nonce state');
    }

    // Return next available nonce
    let nextNonce = state.currentNonce;
    while (state.pendingTransactions.has(nextNonce)) {
      nextNonce++;
    }

    return nextNonce;
  }

  async reserveNonce(address: string, timeoutMs?: number): Promise<number> {
    const nextNonce = await this.getNonce(address);
    const lowerAddress = address.toLowerCase();
    const state = this.nonceStates.get(lowerAddress)!;
    
    state.pendingTransactions.add(nextNonce);
    state.lastUpdate = new Date();
    
    // Set up timeout to auto-release nonce if not used
    const timeout = timeoutMs || this.RESERVATION_TIMEOUT;
    const timeoutKey = `${lowerAddress}-${nextNonce}`;
    
    const timeoutId = setTimeout(() => {
      if (state.pendingTransactions.has(nextNonce)) {
        state.pendingTransactions.delete(nextNonce);
        logger.warn({ address: lowerAddress, nonce: nextNonce }, 'Auto-released expired nonce reservation');
      }
      this.reservationTimeouts.delete(timeoutKey);
    }, timeout);
    
    this.reservationTimeouts.set(timeoutKey, timeoutId);
    
    logger.debug({ 
      address: lowerAddress, 
      reservedNonce: nextNonce,
      pendingCount: state.pendingTransactions.size,
      timeoutMs: timeout
    }, 'Reserved nonce');
    
    return nextNonce;
  }

  markNonceConfirmed(address: string, nonce: number): void {
    const lowerAddress = address.toLowerCase();
    const state = this.nonceStates.get(lowerAddress);
    
    if (state) {
      state.pendingTransactions.delete(nonce);
      state.lastUpdate = new Date();
      
      // Clear timeout if exists
      const timeoutKey = `${lowerAddress}-${nonce}`;
      const timeoutId = this.reservationTimeouts.get(timeoutKey);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.reservationTimeouts.delete(timeoutKey);
      }
      
      logger.debug({ 
        address: lowerAddress, 
        confirmedNonce: nonce,
        pendingCount: state.pendingTransactions.size
      }, 'Marked nonce as confirmed');
    }
  }

  markNonceFailed(address: string, nonce: number): void {
    const lowerAddress = address.toLowerCase();
    const state = this.nonceStates.get(lowerAddress);
    
    if (state) {
      state.pendingTransactions.delete(nonce);
      state.lastUpdate = new Date();
      
      // Clear timeout if exists
      const timeoutKey = `${lowerAddress}-${nonce}`;
      const timeoutId = this.reservationTimeouts.get(timeoutKey);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.reservationTimeouts.delete(timeoutKey);
      }
      
      logger.debug({ 
        address: lowerAddress, 
        failedNonce: nonce,
        pendingCount: state.pendingTransactions.size
      }, 'Marked nonce as failed');
    }
  }

  async repairNonces(address: string): Promise<{repaired: number, cleaned: number}> {
    const lowerAddress = address.toLowerCase();
    const state = this.nonceStates.get(lowerAddress);
    
    if (!state) {
      return { repaired: 0, cleaned: 0 };
    }

    const provider = rpcManager.getProvider();
    const onChainNonce = await provider.getTransactionCount(address, 'latest');

    // Count pending transactions that are now below on-chain nonce (should be cleaned)
    const stalePending = Array.from(state.pendingTransactions)
      .filter(nonce => nonce < onChainNonce);
    
    // Clean up stale pending transactions
    stalePending.forEach(nonce => {
      state.pendingTransactions.delete(nonce);
    });

    // Reset current nonce to on-chain value
    const oldNonce = state.currentNonce;
    state.currentNonce = onChainNonce;
    state.lastUpdate = new Date();

    const repaired = Math.max(0, onChainNonce - oldNonce);
    const cleaned = stalePending.length;

    logger.info({ 
      address: lowerAddress,
      oldNonce,
      newNonce: onChainNonce,
      repaired,
      cleaned,
      stillPending: state.pendingTransactions.size
    }, 'Repaired nonce state');

    return { repaired, cleaned };
  }

  getPendingCount(address: string): number {
    const state = this.nonceStates.get(address.toLowerCase());
    return state ? state.pendingTransactions.size : 0;
  }

  getState(address: string): NonceState | undefined {
    return this.nonceStates.get(address.toLowerCase());
  }

  // Clean up old states (call periodically)
  cleanupOldStates(olderThanMinutes = 60): number {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    let cleaned = 0;

    for (const [address, state] of this.nonceStates.entries()) {
      if (state.lastUpdate < cutoff && state.pendingTransactions.size === 0) {
        this.nonceStates.delete(address);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned, remaining: this.nonceStates.size }, 'Cleaned up old nonce states');
    }

    return cleaned;
  }

  // Get all addresses being tracked
  getTrackedAddresses(): string[] {
    return Array.from(this.nonceStates.keys());
  }

  // Get nonce gap analysis (missing nonces in sequence)
  analyzeNonceGaps(address: string): number[] {
    const state = this.getState(address);
    if (!state) return [];

    const pending = Array.from(state.pendingTransactions).sort((a, b) => a - b);
    const gaps: number[] = [];
    
    for (let i = state.currentNonce; i < Math.max(...pending); i++) {
      if (!pending.includes(i)) {
        gaps.push(i);
      }
    }
    
    return gaps;
  }

  // Force release nonce reservation
  releaseNonce(address: string, nonce: number): boolean {
    const lowerAddress = address.toLowerCase();
    const state = this.nonceStates.get(lowerAddress);
    
    if (state && state.pendingTransactions.has(nonce)) {
      state.pendingTransactions.delete(nonce);
      state.lastUpdate = new Date();
      
      // Clear timeout
      const timeoutKey = `${lowerAddress}-${nonce}`;
      const timeoutId = this.reservationTimeouts.get(timeoutKey);
      if (timeoutId) {
        clearTimeout(timeoutId);
        this.reservationTimeouts.delete(timeoutKey);
      }
      
      logger.info({ address: lowerAddress, nonce }, 'Manually released nonce');
      return true;
    }
    
    return false;
  }

  // Get comprehensive nonce status
  getFullStatus(): {
    totalAddresses: number;
    totalPendingTransactions: number;
    addressDetails: Array<{
      address: string;
      currentNonce: number;
      pendingCount: number;
      oldestPending?: number;
      newestPending?: number;
      gaps: number[];
      lastUpdate: Date;
    }>;
  } {
    const addressDetails = Array.from(this.nonceStates.entries()).map(([address, state]) => {
      const pending = Array.from(state.pendingTransactions);
      const gaps = this.analyzeNonceGaps(address);
      
      return {
        address,
        currentNonce: state.currentNonce,
        pendingCount: pending.length,
        oldestPending: pending.length > 0 ? Math.min(...pending) : undefined,
        newestPending: pending.length > 0 ? Math.max(...pending) : undefined,
        gaps,
        lastUpdate: state.lastUpdate
      };
    });

    return {
      totalAddresses: this.nonceStates.size,
      totalPendingTransactions: addressDetails.reduce((sum, detail) => sum + detail.pendingCount, 0),
      addressDetails
    };
  }

  // Cleanup all timeouts
  cleanup(): void {
    for (const timeoutId of this.reservationTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.reservationTimeouts.clear();
    logger.info('Cleaned up all nonce reservation timeouts');
  }
}

export const nonceManager = NonceManager.getInstance();