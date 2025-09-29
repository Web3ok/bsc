import { IncomingMessage } from 'http';
import { logger } from './logger';

export interface AuthConfig {
  enabled: boolean;
  tokens: string[];
  ipWhitelist: string[];
  basicAuth?: {
    username: string;
    password: string;
  };
}

export class SimpleAuth {
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  /**
   * Validate request authentication
   */
  authenticate(req: IncomingMessage): { authorized: boolean; reason?: string } {
    if (!this.config.enabled) {
      return { authorized: true };
    }

    // IP whitelist check
    if (this.config.ipWhitelist.length > 0) {
      const clientIP = this.getClientIP(req);
      if (clientIP && this.config.ipWhitelist.includes(clientIP)) {
        return { authorized: true };
      }
    }

    // Token-based auth
    const authHeader = req.headers.authorization;
    if (authHeader) {
      // Bearer token
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        if (this.config.tokens.includes(token)) {
          return { authorized: true };
        }
      }
      
      // Basic auth
      if (authHeader.startsWith('Basic ') && this.config.basicAuth) {
        try {
          const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
          const [username, password] = credentials.split(':');
          
          if (username === this.config.basicAuth.username && 
              password === this.config.basicAuth.password) {
            return { authorized: true };
          }
        } catch (error) {
          logger.warn({ error }, 'Failed to parse Basic auth credentials');
        }
      }
    }

    // API key via query parameter (less secure, for convenience)
    const url = new URL(req.url || '', 'http://localhost');
    const apiKey = url.searchParams.get('api_key');
    if (apiKey && this.config.tokens.includes(apiKey)) {
      return { authorized: true };
    }

    return { authorized: false, reason: 'Invalid or missing authentication' };
  }

  /**
   * Get client IP address
   */
  private getClientIP(req: IncomingMessage): string | undefined {
    // Check X-Forwarded-For header (common with reverse proxies)
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (xForwardedFor) {
      const ips = Array.isArray(xForwardedFor) ? xForwardedFor[0] : xForwardedFor;
      return ips.split(',')[0].trim();
    }

    // Check X-Real-IP header
    const xRealIP = req.headers['x-real-ip'];
    if (xRealIP) {
      return Array.isArray(xRealIP) ? xRealIP[0] : xRealIP;
    }

    // Fallback to socket remote address
    return req.socket.remoteAddress;
  }

  /**
   * Create middleware for express-like frameworks
   */
  middleware() {
    return (req: IncomingMessage, res: any, next: Function) => {
      const auth = this.authenticate(req);
      
      if (!auth.authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Unauthorized',
          message: auth.reason || 'Authentication required'
        }));
        return;
      }

      next();
    };
  }

  /**
   * Generate a secure random token
   */
  static generateToken(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const randomArray = new Uint8Array(length);
    
    // Use crypto.getRandomValues if available, fallback to Math.random
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(randomArray);
      for (let i = 0; i < length; i++) {
        result += chars[randomArray[i] % chars.length];
      }
    } else {
      for (let i = 0; i < length; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    
    return result;
  }
}

// Default auth configuration from environment
export const createAuthConfig = (): AuthConfig => {
  return {
    enabled: process.env.AUTH_ENABLED === 'true',
    tokens: process.env.API_TOKENS ? process.env.API_TOKENS.split(',') : [],
    ipWhitelist: process.env.IP_WHITELIST ? process.env.IP_WHITELIST.split(',') : ['127.0.0.1', '::1'],
    basicAuth: process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS ? {
      username: process.env.BASIC_AUTH_USER,
      password: process.env.BASIC_AUTH_PASS
    } : undefined
  };
};