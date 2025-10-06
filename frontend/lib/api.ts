import { toast } from 'react-hot-toast';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface TradeRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage?: number;
  dryRun?: boolean;
}

export interface TradeResult {
  success: boolean;
  txHash?: string;
  amountOut?: string;
  priceImpact?: number;
  gasUsed?: string;
  error?: string;
}

export interface WalletInfo {
  address: string;
  alias?: string;
  tier?: string;
  balance?: string;
  createdAt: string;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  database: 'connected' | 'disconnected' | 'error';
  dex: {
    pancakeswap: boolean;
    uniswap: boolean;
    overall: boolean;
  };
}

export interface DashboardOverview {
  totalWallets: number;
  activeBots: number;
  totalTrades: number;
  volume24h: number;
  pnl24h: number;
  successRate: number;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

class ApiClient {
  private baseURL: string;
  public defaults: {
    headers: {
      common: Record<string, string>;
    };
  };

  constructor(baseURL: string = API_BASE_URL) {
    this.baseURL = baseURL;
    this.defaults = {
      headers: {
        common: {}
      }
    };
  }

  private async request<T = any>(
    endpoint: string,
    options: RequestInit = {},
    retryCount = 0
  ): Promise<ApiResponse<T>> {
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff

    try {
      const url = `${this.baseURL}${endpoint}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...this.defaults.headers.common,
          ...options.headers,
        },
        signal: controller.signal,
        ...options,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch {
          // If not JSON, use the text or default message
          errorMessage = errorText || errorMessage;
        }

        // Only retry on 5xx errors or network issues
        if (response.status >= 500 && retryCount < maxRetries) {
          console.warn(`Request failed, retrying in ${retryDelay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return this.request<T>(endpoint, options, retryCount + 1);
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('API request failed:', error);
      
      let errorMessage = 'Request failed';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timeout - please check your connection';
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = 'Network error - please check your internet connection';
          
          // Retry network errors
          if (retryCount < maxRetries) {
            console.warn(`Network error, retrying in ${retryDelay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            return this.request<T>(endpoint, options, retryCount + 1);
          }
        } else {
          errorMessage = error.message;
        }
      }

      // Only show toast for actual errors, not retries
      if (retryCount === 0 || retryCount >= maxRetries) {
        toast.error(errorMessage);
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  // System endpoints
  async getSystemHealth(): Promise<ApiResponse<SystemHealth>> {
    return this.request<SystemHealth>('/health');
  }

  async getDashboardOverview(): Promise<ApiResponse<DashboardOverview>> {
    return this.request<DashboardOverview>('/api/dashboard/overview');
  }

  // Trading endpoints
  async getQuote(request: Omit<TradeRequest, 'dryRun'>): Promise<ApiResponse<any>> {
    return this.request('/api/trading/quote', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async executeTrade(request: TradeRequest): Promise<ApiResponse<TradeResult>> {
    return this.request<TradeResult>('/api/trading/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getTradingHistory(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/api/trading/history');
  }

  // Wallet endpoints
  async getWallets(): Promise<ApiResponse<WalletInfo[]>> {
    return this.request<WalletInfo[]>('/api/wallets');
  }

  async getWalletBalance(address: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/api/wallets/${address}/balance`);
  }

  async generateWallets(count: number, options?: any): Promise<ApiResponse<any>> {
    return this.request('/api/wallets/generate', {
      method: 'POST',
      body: JSON.stringify({ count, ...options }),
    });
  }

  async importWallets(wallets: Array<{ privateKey: string; label?: string; group?: string }>): Promise<ApiResponse<any>> {
    return this.request('/api/v1/wallets/import', {
      method: 'POST',
      body: JSON.stringify({
        privateKeys: wallets.map(w => w.privateKey),
        config: {
          labels: wallets.map(w => w.label),
          group: wallets[0]?.group,
        },
      }),
    });
  }

  async importWalletsFromCSV(csvData: string): Promise<ApiResponse<any>> {
    return this.request('/api/v1/wallets/import-csv', {
      method: 'POST',
      body: JSON.stringify({ csvData }),
    });
  }

  async batchTransfer(config: {
    type: 'one-to-one' | 'one-to-many' | 'many-to-many';
    fromAddresses: string[];
    toAddresses: string[];
    amount: string;
    tokenAddress?: string;
  }): Promise<ApiResponse<any>> {
    return this.request('/api/v1/wallets/batch-transfer', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // Market data endpoints
  async getMarketData(): Promise<ApiResponse<any>> {
    return this.request<any>('/api/market/overview');
  }

  async getTokenPrices(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/api/market/prices');
  }

  // Risk management endpoints
  async getRiskMetrics(): Promise<ApiResponse<any>> {
    return this.request<any>('/api/risk/metrics');
  }

  async getPositionRisks(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/api/risk/positions');
  }

  // Auth endpoints
  async get(endpoint: string): Promise<ApiResponse<any>> {
    return this.request(endpoint, { method: 'GET' });
  }

  // Make request method public for AuthContext
  public async makeRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, options, 0);
  }
}

export const apiClient = new ApiClient();

// Export individual functions for convenience
export const {
  getSystemHealth,
  getDashboardOverview,
  getQuote,
  executeTrade,
  getTradingHistory,
  getWallets,
  getWalletBalance,
  generateWallets,
  importWallets,
  importWalletsFromCSV,
  batchTransfer,
  getMarketData,
  getTokenPrices,
  getRiskMetrics,
  getPositionRisks,
} = apiClient;

export default apiClient;
