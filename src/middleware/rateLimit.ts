import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private clients = new Map<string, RateLimitEntry>();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests = 100, windowMs = 60 * 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  isAllowed(clientId: string): boolean {
    const now = Date.now();
    const entry = this.clients.get(clientId);

    if (!entry || now > entry.resetTime) {
      this.clients.set(clientId, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return true;
    }

    if (entry.count >= this.maxRequests) {
      logger.warn({ clientId, count: entry.count }, 'Rate limit exceeded');
      return false;
    }

    entry.count++;
    return true;
  }

  getRemainingRequests(clientId: string): number {
    const entry = this.clients.get(clientId);
    return entry ? Math.max(0, this.maxRequests - entry.count) : this.maxRequests;
  }

  getResetTime(clientId: string): number {
    const entry = this.clients.get(clientId);
    return entry ? entry.resetTime : Date.now() + this.windowMs;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [clientId, entry] of this.clients) {
      if (now > entry.resetTime) {
        this.clients.delete(clientId);
      }
    }
  }
}

// Different rate limiters for different endpoints
const generalLimiter = new RateLimiter(100, 60 * 1000); // 100 requests per minute
const tradingLimiter = new RateLimiter(50, 60 * 1000);  // 50 requests per minute for trading
const authLimiter = new RateLimiter(10, 60 * 1000);     // 10 requests per minute for auth

// Cleanup expired entries every 5 minutes
setInterval(() => {
  generalLimiter.cleanup();
  tradingLimiter.cleanup();
  authLimiter.cleanup();
}, 5 * 60 * 1000);

export function createRateLimit(limiter: RateLimiter = generalLimiter) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const clientId = req.ip || req.connection.remoteAddress || 'unknown';
    
    if (!limiter.isAllowed(clientId)) {
      const resetTime = limiter.getResetTime(clientId);
      const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
      
      res.status(429).json({
        success: false,
        message: 'Too many requests',
        retryAfter
      });
      return;
    }

    // Add rate limit headers
    res.set({
      'X-RateLimit-Remaining': limiter.getRemainingRequests(clientId).toString(),
      'X-RateLimit-Reset': limiter.getResetTime(clientId).toString()
    });

    next();
  };
}

// Specific rate limiters for different endpoint types
export const generalRateLimit = createRateLimit(generalLimiter);
export const tradingRateLimit = createRateLimit(tradingLimiter);
export const authRateLimit = createRateLimit(authLimiter);