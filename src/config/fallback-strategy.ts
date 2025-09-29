import { logger } from '../utils/logger';

export interface FallbackPriceStrategy {
  allowTrading: boolean;
  requireConfirmation: boolean;
  maxAmountBNB: number;
  alertChannels: string[];
  action: 'block' | 'warn' | 'allow' | 'confirm';
}

export class FallbackPriceHandler {
  private static instance: FallbackPriceHandler;
  private strategy: FallbackPriceStrategy;

  private constructor() {
    // Default conservative strategy
    this.strategy = {
      allowTrading: false,
      requireConfirmation: true,
      maxAmountBNB: 0.1, // Only allow small trades with fallback prices
      alertChannels: ['slack', 'discord', 'email'],
      action: process.env.FALLBACK_PRICE_ACTION as any || 'block'
    };
  }

  public static getInstance(): FallbackPriceHandler {
    if (!FallbackPriceHandler.instance) {
      FallbackPriceHandler.instance = new FallbackPriceHandler();
    }
    return FallbackPriceHandler.instance;
  }

  public setStrategy(strategy: Partial<FallbackPriceStrategy>): void {
    this.strategy = { ...this.strategy, ...strategy };
    logger.info({ strategy: this.strategy }, 'Fallback price strategy updated');
  }

  public async handleFallbackPrice(context: {
    symbol: string;
    price: number;
    dataSource: string;
    operation: 'trade' | 'quote' | 'display';
    amount?: number;
  }): Promise<{
    allowed: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
    suggestions?: string[];
  }> {
    const { symbol, price, dataSource, operation, amount } = context;

    // Log fallback usage
    logger.warn({
      symbol,
      price,
      dataSource,
      operation,
      amount
    }, 'Handling fallback price scenario');

    // For display operations, always allow but mark clearly
    if (operation === 'display') {
      return {
        allowed: true,
        reason: 'Display only - no trading action'
      };
    }

    // Check strategy action
    switch (this.strategy.action) {
      case 'block':
        return {
          allowed: false,
          reason: 'Trading blocked: External price API unavailable, using fallback prices',
          suggestions: [
            'Wait for API recovery',
            'Check network connectivity',
            'Contact support if issue persists'
          ]
        };

      case 'warn':
        return {
          allowed: true,
          reason: 'Warning: Using fallback price, may not reflect current market',
          requiresConfirmation: true,
          suggestions: [
            `Fallback price for ${symbol}: $${price}`,
            'Actual market price may differ significantly',
            'Proceed with caution'
          ]
        };

      case 'confirm':
        // Check amount limits for confirmation mode
        if (amount && amount > this.strategy.maxAmountBNB) {
          return {
            allowed: false,
            reason: `Trade amount (${amount} BNB) exceeds fallback price limit (${this.strategy.maxAmountBNB} BNB)`,
            suggestions: [
              `Reduce trade size to ${this.strategy.maxAmountBNB} BNB or less`,
              'Wait for live price data to trade larger amounts'
            ]
          };
        }
        
        return {
          allowed: true,
          requiresConfirmation: true,
          reason: 'Manual confirmation required for fallback price trade',
          suggestions: [
            `Using fallback price: ${symbol} = $${price}`,
            'Please confirm you accept the price risk'
          ]
        };

      case 'allow':
        // Only for non-production or testing
        logger.warn('Allowing trade with fallback price (not recommended for production)');
        return {
          allowed: true,
          reason: 'Fallback price accepted (test mode)'
        };

      default:
        // Default to safe behavior
        return {
          allowed: false,
          reason: 'Invalid fallback strategy configuration',
          suggestions: ['Check system configuration']
        };
    }
  }

  public getStrategy(): FallbackPriceStrategy {
    return { ...this.strategy };
  }

  public async validatePriceData(priceData: any): Promise<{
    isValid: boolean;
    isStale: boolean;
    isFallback: boolean;
    confidence: number;
  }> {
    const isFallback = priceData.dataSource === 'fallback_static';
    const isStale = priceData.isStale || false;
    
    // Calculate confidence score
    let confidence = 100;
    if (isFallback) confidence -= 50;
    if (isStale) confidence -= 30;
    if (!priceData.lastUpdated) confidence -= 20;
    
    // Check age of data
    if (priceData.lastUpdated) {
      const ageMinutes = (Date.now() - new Date(priceData.lastUpdated).getTime()) / 60000;
      if (ageMinutes > 60) confidence -= 20;
      else if (ageMinutes > 30) confidence -= 10;
      else if (ageMinutes > 10) confidence -= 5;
    }

    return {
      isValid: confidence > 20, // Minimum confidence threshold
      isStale,
      isFallback,
      confidence: Math.max(0, confidence)
    };
  }
}

export const fallbackPriceHandler = FallbackPriceHandler.getInstance();