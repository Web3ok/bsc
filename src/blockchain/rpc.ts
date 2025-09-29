import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { configManager } from '../config';

interface ProviderHealth {
  url: string;
  isHealthy: boolean;
  lastCheck: number;
  latency: number;
  blockNumber: number;
  errorCount: number;
  consecutiveErrors: number;
}

interface RpcProviderStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  lastRequestTime: number;
}

export class RpcManager {
  private static instance: RpcManager;
  private provider: ethers.JsonRpcProvider | null = null;
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();
  private healthStatus: Map<string, ProviderHealth> = new Map();
  private stats: Map<string, RpcProviderStats> = new Map();
  private currentProviderUrl: string = '';
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private rateLimitMap: Map<string, number[]> = new Map();

  private constructor() {}

  public static getInstance(): RpcManager {
    if (!RpcManager.instance) {
      RpcManager.instance = new RpcManager();
    }
    return RpcManager.instance;
  }

  /**
   * Initialize RPC providers
   */
  initialize(): void {
    const config = configManager.config;
    const allUrls = [...config.rpc.primary_urls, ...config.rpc.backup_urls];
    
    // Initialize all providers
    for (const url of allUrls) {
      try {
        const provider = new ethers.JsonRpcProvider(url, undefined, {
          polling: false,
          staticNetwork: ethers.Network.from(config.chain.id)
        });
        
        this.providers.set(url, provider);
        this.initializeProviderStats(url);
        this.initializeProviderHealth(url);
        
        logger.info({ url }, 'RPC provider initialized');
      } catch (error) {
        logger.error({ error, url }, 'Failed to initialize RPC provider');
      }
    }

    if (this.providers.size === 0) {
      throw new Error('No RPC providers could be initialized');
    }

    // Set primary provider
    this.currentProviderUrl = config.rpc.primary_urls[0];
    this.provider = this.providers.get(this.currentProviderUrl) || null;

    // Start health check
    this.startHealthCheck();
    
    logger.info({ 
      totalProviders: this.providers.size,
      primaryUrl: this.currentProviderUrl 
    }, 'RPC Manager initialized');
  }

  private initializeProviderStats(url: string): void {
    this.stats.set(url, {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatency: 0,
      lastRequestTime: 0
    });
  }

  private initializeProviderHealth(url: string): void {
    this.healthStatus.set(url, {
      url,
      isHealthy: true,
      lastCheck: 0,
      latency: 0,
      blockNumber: 0,
      errorCount: 0,
      consecutiveErrors: 0
    });
  }

  private startHealthCheck(): void {
    const config = configManager.config;
    const interval = config.rpc.health_check_interval * 1000; // Convert to milliseconds
    
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, interval);

    // Perform initial health check
    this.performHealthCheck();
  }

  private async performHealthCheck(): Promise<void> {
    const promises = Array.from(this.providers.entries()).map(async ([url, provider]) => {
      const startTime = Date.now();
      const health = this.healthStatus.get(url)!;
      
      try {
        const blockNumber = await Promise.race([
          provider.getBlockNumber(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          )
        ]);
        
        const latency = Date.now() - startTime;
        
        health.isHealthy = true;
        health.lastCheck = Date.now();
        health.latency = latency;
        health.blockNumber = blockNumber;
        health.consecutiveErrors = 0;
        
        logger.debug({ url, latency, blockNumber }, 'Provider health check passed');
      } catch (error) {
        health.isHealthy = false;
        health.lastCheck = Date.now();
        health.errorCount++;
        health.consecutiveErrors++;
        
        logger.warn({ url, error: error instanceof Error ? error.message : 'Unknown error' }, 
          'Provider health check failed');
        
        // If current provider fails, switch to healthy one
        if (url === this.currentProviderUrl && health.consecutiveErrors >= 3) {
          this.switchToHealthyProvider();
        }
      }
    });

    await Promise.allSettled(promises);
  }

  private switchToHealthyProvider(): boolean {
    const healthyProviders = Array.from(this.healthStatus.entries())
      .filter(([, health]) => health.isHealthy)
      .sort((a, b) => a[1].latency - b[1].latency); // Sort by latency

    if (healthyProviders.length === 0) {
      logger.error('No healthy providers available');
      return false;
    }

    const [newUrl] = healthyProviders[0];
    const newProvider = this.providers.get(newUrl);
    
    if (newProvider) {
      this.currentProviderUrl = newUrl;
      this.provider = newProvider;
      
      logger.info({ 
        oldUrl: this.currentProviderUrl,
        newUrl 
      }, 'Switched to healthy RPC provider');
      
      return true;
    }

    return false;
  }

  private checkRateLimit(url: string): boolean {
    const config = configManager.config;
    const maxRequestsPerSecond = config.rpc.rate_limit_per_second;
    const now = Date.now();
    
    if (!this.rateLimitMap.has(url)) {
      this.rateLimitMap.set(url, []);
    }
    
    const requests = this.rateLimitMap.get(url)!;
    
    // Remove requests older than 1 second
    const recentRequests = requests.filter(time => now - time < 1000);
    
    if (recentRequests.length >= maxRequestsPerSecond) {
      return false; // Rate limit exceeded
    }
    
    recentRequests.push(now);
    this.rateLimitMap.set(url, recentRequests);
    
    return true;
  }

  private async recordProviderStats(url: string, success: boolean, latency: number): Promise<void> {
    const stats = this.stats.get(url);
    if (!stats) return;

    stats.totalRequests++;
    stats.lastRequestTime = Date.now();
    
    if (success) {
      stats.successfulRequests++;
    } else {
      stats.failedRequests++;
    }
    
    // Update average latency (exponential moving average)
    stats.averageLatency = stats.averageLatency === 0 ? 
      latency : (stats.averageLatency * 0.9 + latency * 0.1);
  }

  /**
   * Get the current active provider
   */
  getProvider(): ethers.JsonRpcProvider {
    if (!this.provider) {
      this.initialize();
    }

    if (!this.provider) {
      throw new Error('No RPC provider available');
    }

    // Check rate limit for current provider
    if (!this.checkRateLimit(this.currentProviderUrl)) {
      logger.warn({ url: this.currentProviderUrl }, 'Rate limit exceeded, switching provider');
      this.switchToHealthyProvider();
    }

    return this.provider;
  }

  /**
   * Switch to the next backup provider
   */
  switchToNextProvider(): boolean {
    return this.switchToHealthyProvider();
  }

  /**
   * Test RPC connection
   */
  async testConnection(): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const provider = this.getProvider();
      const blockNumber = await provider.getBlockNumber();
      const latency = Date.now() - startTime;
      
      await this.recordProviderStats(this.currentProviderUrl, true, latency);
      
      logger.info({ blockNumber, latency, url: this.currentProviderUrl }, 'RPC connection test successful');
      return true;
    } catch (error) {
      const latency = Date.now() - startTime;
      await this.recordProviderStats(this.currentProviderUrl, false, latency);
      
      logger.error({ error, url: this.currentProviderUrl }, 'RPC connection test failed');
      
      // Try to switch to backup provider
      if (this.switchToNextProvider()) {
        return this.testConnection();
      }
      
      return false;
    }
  }

  /**
   * Get network information
   */
  async getNetworkInfo(): Promise<{ chainId: bigint; name: string } | null> {
    try {
      const provider = this.getProvider();
      const network = await provider.getNetwork();
      
      return {
        chainId: network.chainId,
        name: network.name
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get network info');
      return null;
    }
  }

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<bigint | null> {
    try {
      const provider = this.getProvider();
      const gasPrice = await provider.getFeeData();
      
      return gasPrice.gasPrice;
    } catch (error) {
      logger.error({ error }, 'Failed to get gas price');
      return null;
    }
  }

  /**
   * Get block timestamp
   */
  async getBlockTimestamp(blockNumber: number): Promise<number> {
    try {
      const provider = this.getProvider();
      const block = await provider.getBlock(blockNumber);
      
      return block?.timestamp || 0;
    } catch (error) {
      logger.error({ error, blockNumber }, 'Failed to get block timestamp');
      return 0;
    }
  }

  /**
   * Reset to primary provider
   */
  resetToPrimary(): void {
    const config = configManager.config;
    const primaryUrl = config.rpc.primary_urls[0];
    
    const provider = this.providers.get(primaryUrl);
    if (provider) {
      this.currentProviderUrl = primaryUrl;
      this.provider = provider;
      logger.info({ url: primaryUrl }, 'Reset to primary RPC provider');
    } else {
      logger.error({ url: primaryUrl }, 'Failed to reset to primary RPC provider - not found');
    }
  }

  /**
   * Get all provider health status
   */
  getProvidersHealth(): ProviderHealth[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Get all provider statistics
   */
  getProvidersStats(): Map<string, RpcProviderStats> {
    return new Map(this.stats);
  }

  /**
   * Get current provider URL
   */
  getCurrentProviderUrl(): string {
    return this.currentProviderUrl;
  }

  /**
   * Get provider count
   */
  getProviderCount(): { total: number; healthy: number; unhealthy: number } {
    const healthy = Array.from(this.healthStatus.values()).filter(h => h.isHealthy).length;
    const total = this.healthStatus.size;
    
    return {
      total,
      healthy,
      unhealthy: total - healthy
    };
  }

  /**
   * Force switch to specific provider
   */
  switchToProvider(url: string): boolean {
    const provider = this.providers.get(url);
    if (!provider) {
      logger.error({ url }, 'Provider not found');
      return false;
    }

    this.currentProviderUrl = url;
    this.provider = provider;
    
    logger.info({ url }, 'Manually switched to provider');
    return true;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    this.providers.clear();
    this.healthStatus.clear();
    this.stats.clear();
    this.rateLimitMap.clear();
    
    logger.info('RPC Manager cleaned up');
  }
}

export const rpcManager = RpcManager.getInstance();