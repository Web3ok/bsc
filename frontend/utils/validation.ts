/**
 * Frontend Validation Utilities
 * Provides client-side validation for trading forms and inputs
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Ethereum address validation regex
 * Matches addresses like: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
 */
export const ETHEREUM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Validates an Ethereum address format
 */
export function isValidEthereumAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }
  return ETHEREUM_ADDRESS_REGEX.test(address);
}

/**
 * Validates a token address (can be 'BNB' or Ethereum address)
 */
export function isValidTokenAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }

  // Allow 'BNB' as special case
  if (address.toUpperCase() === 'BNB') {
    return true;
  }

  return isValidEthereumAddress(address);
}

/**
 * Validates a numeric amount
 */
export function isValidAmount(amount: string | number): boolean {
  if (typeof amount === 'number') {
    return !isNaN(amount) && isFinite(amount) && amount > 0;
  }

  if (typeof amount === 'string') {
    const num = parseFloat(amount);
    return !isNaN(num) && isFinite(num) && num > 0;
  }

  return false;
}

/**
 * Validates slippage percentage (0-50%)
 */
export function isValidSlippage(slippage: number): boolean {
  return typeof slippage === 'number' &&
         !isNaN(slippage) &&
         isFinite(slippage) &&
         slippage >= 0 &&
         slippage <= 50;
}

/**
 * Validates a trade request object
 */
export interface TradeValidation {
  isValid: boolean;
  errors: string[];
}

export function validateTradeRequest(trade: {
  tokenIn?: string;
  tokenOut?: string;
  amount?: string;
  slippage?: number;
  walletAddress?: string;
}): TradeValidation {
  const errors: string[] = [];

  // Validate tokenIn
  if (!trade.tokenIn) {
    errors.push('Token input is required');
  } else if (!isValidTokenAddress(trade.tokenIn)) {
    errors.push('Invalid token input address. Must be "BNB" or valid contract address (0x...)');
  }

  // Validate tokenOut
  if (!trade.tokenOut) {
    errors.push('Token output is required');
  } else if (!isValidTokenAddress(trade.tokenOut)) {
    errors.push('Invalid token output address. Must be "BNB" or valid contract address (0x...)');
  }

  // Validate amount
  if (!trade.amount) {
    errors.push('Amount is required');
  } else if (!isValidAmount(trade.amount)) {
    errors.push('Amount must be a positive number');
  }

  // Validate slippage (optional, has default)
  if (trade.slippage !== undefined && !isValidSlippage(trade.slippage)) {
    errors.push('Slippage must be between 0 and 50 percent');
  }

  // Validate wallet address (optional)
  if (trade.walletAddress && !isValidEthereumAddress(trade.walletAddress)) {
    errors.push('Invalid wallet address format');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Sanitizes user input to prevent injection attacks
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remove any HTML tags
  return input.replace(/<[^>]*>/g, '').trim();
}

/**
 * Formats error messages for display
 */
export function formatValidationErrors(errors: string[]): string {
  if (errors.length === 0) {
    return '';
  }

  if (errors.length === 1) {
    return errors[0];
  }

  return `Multiple validation errors:\n${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;
}

/**
 * Validates batch operation configuration
 */
export function validateBatchConfig(config: {
  maxConcurrency?: number;
  delayBetweenOps?: number;
  slippage?: number;
}): TradeValidation {
  const errors: string[] = [];

  if (config.maxConcurrency !== undefined) {
    if (!Number.isInteger(config.maxConcurrency) || config.maxConcurrency < 1 || config.maxConcurrency > 10) {
      errors.push('Max concurrency must be between 1 and 10');
    }
  }

  if (config.delayBetweenOps !== undefined) {
    if (!Number.isInteger(config.delayBetweenOps) || config.delayBetweenOps < 0 || config.delayBetweenOps > 60000) {
      errors.push('Delay between operations must be between 0 and 60000 milliseconds');
    }
  }

  if (config.slippage !== undefined && !isValidSlippage(config.slippage)) {
    errors.push('Slippage must be between 0 and 50 percent');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Truncates Ethereum address for display
 * Example: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb -> 0x742d...f0bEb
 */
export function truncateAddress(address: string, startChars: number = 6, endChars: number = 4): string {
  if (!address || !isValidEthereumAddress(address)) {
    return address;
  }

  if (address.length <= startChars + endChars + 3) {
    return address;
  }

  return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
}

/**
 * Validates URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
