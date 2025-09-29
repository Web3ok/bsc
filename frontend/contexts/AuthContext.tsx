'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { toast } from 'react-hot-toast';
import { apiClient } from '@/lib/api';

interface User {
  id: string;
  username: string;
  avatar?: string;
  role: 'admin' | 'trader' | 'viewer';
  permissions: string[];
  lastLogin?: Date;
  settings: {
    theme: 'light' | 'dark' | 'system';
    notifications: boolean;
    tradingEnabled: boolean;
  };
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string, remember?: boolean) => Promise<boolean>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  hasPermission: (permission: string) => boolean;
  refreshToken: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  // Initialize auth state from localStorage
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        let storedToken = localStorage.getItem('bsc_bot_token');
        let storedUser = localStorage.getItem('bsc_bot_user');

        // Check sessionStorage if not found in localStorage
        if (!storedToken || !storedUser) {
          storedToken = sessionStorage.getItem('bsc_bot_token');
          storedUser = sessionStorage.getItem('bsc_bot_user');
        }

        if (storedToken && storedUser) {
          const userData = JSON.parse(storedUser);
          
          // Verify token is still valid
          try {
            apiClient.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
            const response = await apiClient.get('/auth/verify');
            
            if (response.success) {
              setToken(storedToken);
              setUser(userData);
            } else {
              // Token invalid, clear storage
              localStorage.removeItem('bsc_bot_token');
              localStorage.removeItem('bsc_bot_user');
              sessionStorage.removeItem('bsc_bot_token');
              sessionStorage.removeItem('bsc_bot_user');
            }
          } catch (error) {
            // Token verification failed
            localStorage.removeItem('bsc_bot_token');
            localStorage.removeItem('bsc_bot_user');
            sessionStorage.removeItem('bsc_bot_token');
            sessionStorage.removeItem('bsc_bot_user');
            delete apiClient.defaults.headers.common['Authorization'];
          }
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  // Token management (simplified without interceptors for now)
  useEffect(() => {
    if (token) {
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
  }, [token]);

  const login = async (username: string, password: string, remember: boolean = false): Promise<boolean> => {
    try {
      setIsLoading(true);
      
      const response = await apiClient.makeRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username,
          password,
          remember,
        }),
      });

      if (response.success) {
        const { token: authToken, user: userData, expires_in } = response.data;

        // Store auth data
        if (remember) {
          localStorage.setItem('bsc_bot_token', authToken);
          localStorage.setItem('bsc_bot_user', JSON.stringify(userData));
        } else {
          sessionStorage.setItem('bsc_bot_token', authToken);
          sessionStorage.setItem('bsc_bot_user', JSON.stringify(userData));
        }

        // Set API client default header
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;

        // Update state
        setToken(authToken);
        setUser(userData);

        toast.success(`Welcome back, ${userData.username}!`);
        return true;
      } else {
        toast.error(response.data.message || 'Login failed');
        return false;
      }
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || 'Login failed';
      toast.error(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    // Clear storage
    localStorage.removeItem('bsc_bot_token');
    localStorage.removeItem('bsc_bot_user');
    sessionStorage.removeItem('bsc_bot_token');
    sessionStorage.removeItem('bsc_bot_user');

    // Clear API client header
    delete apiClient.defaults.headers.common['Authorization'];

    // Clear state
    setToken(null);
    setUser(null);

    toast.success('Logged out successfully');
  };

  const updateUser = (updates: Partial<User>) => {
    if (user) {
      const updatedUser = { ...user, ...updates };
      setUser(updatedUser);
      
      // Update storage
      const storage = localStorage.getItem('bsc_bot_user') ? localStorage : sessionStorage;
      storage.setItem('bsc_bot_user', JSON.stringify(updatedUser));
    }
  };

  const hasPermission = (permission: string): boolean => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.permissions.includes(permission);
  };

  const refreshToken = async (): Promise<boolean> => {
    try {
      if (!token) return false;

      const response = await apiClient.makeRequest('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });

      if (response.success) {
        const { token: newToken } = response.data;

        // Update storage
        const storage = localStorage.getItem('bsc_bot_token') ? localStorage : sessionStorage;
        storage.setItem('bsc_bot_token', newToken);

        // Update API client header
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;

        // Update state
        setToken(newToken);

        return true;
      }
      return false;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return false;
    }
  };

  const contextValue: AuthContextType = {
    user,
    token,
    isAuthenticated,
    isLoading,
    login,
    logout,
    updateUser,
    hasPermission,
    refreshToken,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Higher-order component for protected routes
export function withAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  requiredPermission?: string
) {
  return function ProtectedComponent(props: P) {
    const { isAuthenticated, isLoading, hasPermission } = useAuth();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
        </div>
      );
    }

    if (!isAuthenticated) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Authentication Required</h1>
            <p className="text-muted-foreground">Please login to access this page.</p>
          </div>
        </div>
      );
    }

    if (requiredPermission && !hasPermission(requiredPermission)) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
            <p className="text-muted-foreground">
              You don't have permission to access this page.
            </p>
          </div>
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };
}

// Permission constants
export const PERMISSIONS = {
  // Trading permissions
  TRADE_EXECUTE: 'trade:execute',
  TRADE_BATCH: 'trade:batch',
  TRADE_LIMITS: 'trade:limits',
  
  // Strategy permissions
  STRATEGY_CREATE: 'strategy:create',
  STRATEGY_MANAGE: 'strategy:manage',
  STRATEGY_DELETE: 'strategy:delete',
  
  // Wallet permissions
  WALLET_VIEW: 'wallet:view',
  WALLET_MANAGE: 'wallet:manage',
  WALLET_IMPORT: 'wallet:import',
  WALLET_EXPORT: 'wallet:export',
  
  // Risk permissions
  RISK_VIEW: 'risk:view',
  RISK_MANAGE: 'risk:manage',
  RISK_EMERGENCY: 'risk:emergency',
  
  // System permissions
  SYSTEM_ADMIN: 'system:admin',
  SYSTEM_CONFIG: 'system:config',
  SYSTEM_LOGS: 'system:logs',
  
  // Analytics permissions
  ANALYTICS_VIEW: 'analytics:view',
  ANALYTICS_EXPORT: 'analytics:export',
} as const;