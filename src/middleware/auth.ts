import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

interface AuthRequest extends express.Request {
  user?: {
    id: string;
    role: string;
    walletAddress?: string;
  };
}

interface JWTPayload {
  id: string;
  role: string;
  walletAddress?: string;
  iat: number;
  exp: number;
}

class AuthService {
  private static instance: AuthService;
  private jwtSecret: string;
  
  private constructor() {
    // Generate or use JWT secret from environment
    this.jwtSecret = process.env.JWT_SECRET || this.generateSecretKey();
    
    if (!process.env.JWT_SECRET) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('[AUTH] CRITICAL: JWT_SECRET must be set in production environment');
      }
      console.warn('[AUTH] JWT_SECRET not set. Using generated key. This will invalidate tokens on restart.');
      console.warn('[AUTH] Set JWT_SECRET environment variable for production use.');
    } else {
      console.log('[AUTH] JWT_SECRET loaded from environment');
    }
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private generateSecretKey(): string {
    return crypto.randomBytes(64).toString('hex');
  }

  public generateToken(payload: { id: string; role: string; walletAddress?: string }): string {
    return jwt.sign(
      payload,
      this.jwtSecret,
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        issuer: 'bsc-trading-bot',
        audience: 'bsc-api'
      }
    );
  }

  public verifyToken(token: string): JWTPayload {
    return jwt.verify(token, this.jwtSecret, {
      issuer: 'bsc-trading-bot',
      audience: 'bsc-api'
    }) as JWTPayload;
  }

  public createDevToken(): string {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Dev tokens not allowed in production');
    }
    
    return this.generateToken({
      id: 'dev-user',
      role: 'admin',
      walletAddress: '0x0000000000000000000000000000000000000000'
    });
  }
}

const authService = AuthService.getInstance();

export const authenticate = (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    try {
      const decoded = authService.verifyToken(token);
      
      // Check token expiration explicitly
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp && decoded.exp < now) {
        return res.status(401).json({
          success: false,
          message: 'Token expired',
          code: 'TOKEN_EXPIRED'
        });
      }

      req.user = {
        id: decoded.id,
        role: decoded.role,
        walletAddress: decoded.walletAddress
      };

      next();
    } catch (jwtError: any) {
      let message = 'Invalid token';
      let code = 'INVALID_TOKEN';
      
      if (jwtError.name === 'TokenExpiredError') {
        message = 'Token expired';
        code = 'TOKEN_EXPIRED';
      } else if (jwtError.name === 'JsonWebTokenError') {
        message = 'Malformed token';
        code = 'MALFORMED_TOKEN';
      }

      return res.status(401).json({
        success: false,
        message,
        code
      });
    }
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      message: 'Authentication system error',
      code: 'AUTH_ERROR'
    });
  }
};

// Backward compatibility
export const authMiddleware = authenticate;

export interface AuthenticatedRequest extends express.Request {
  user?: {
    id: string;
    role: string;
    walletAddress?: string;
  };
}

export function createAuthMiddleware(allowedRoles: string[] = ['admin', 'trader', 'viewer']) {
  return (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    authenticate(req, res, (error) => {
      if (error) {
        return next(error);
      }
      
      // Check role authorization
      if (req.user && allowedRoles.includes(req.user.role)) {
        return next();
      }
      
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
        code: 'FORBIDDEN'
      });
    });
  };
}

// Login endpoint helper
export const createLoginEndpoint = (app: express.Application) => {
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { walletAddress, signature } = req.body;
      
      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          message: 'Wallet address required'
        });
      }

      // In development, allow login without signature
      if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_LOGIN === 'true') {
        const token = authService.generateToken({
          id: walletAddress,
          role: 'trader',
          walletAddress
        });

        return res.json({
          success: true,
          token,
          user: {
            id: walletAddress,
            role: 'trader',
            walletAddress
          }
        });
      }

      // In production, verify wallet signature
      if (!signature) {
        return res.status(400).json({
          success: false,
          message: 'Signature required for wallet authentication'
        });
      }

      // TODO: Implement signature verification
      // For now, accept any signature in production (should be fixed)
      const token = authService.generateToken({
        id: walletAddress,
        role: 'trader',
        walletAddress
      });

      res.json({
        success: true,
        token,
        user: {
          id: walletAddress,
          role: 'trader',
          walletAddress
        }
      });

    } catch (error) {
      console.error('[AUTH] Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed'
      });
    }
  });

  // Development token endpoint
  if (process.env.NODE_ENV !== 'production') {
    app.get('/api/auth/dev-token', (req, res) => {
      try {
        const token = authService.createDevToken();
        res.json({
          success: true,
          token,
          message: 'Development token created',
          expires: '24h'
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Failed to create dev token'
        });
      }
    });
  }
};

export { authService };