'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@nextui-org/react';
import { Activity, TrendingUp, Wallet, Shield, RefreshCw, Monitor, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useAccount, useBalance } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

interface DashboardData {
  system: {
    status: string;
    uptimeSeconds: number;
    version: string;
    environment: string;
  };
  wallets: {
    total: number;
    totalBalance: string;
  };
  trading: {
    totalTrades24h: number;
    pnl24h: string;
    volume24h: string;
    successRate: string;
  };
}

export default function Dashboard() {
  const [apiStatus, setApiStatus] = useState('checking...');
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [systemStatus, setSystemStatus] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const refreshInterval = useRef<NodeJS.Timeout | null>(null);

  const { connected, lastMessage, sendMessage } = useWebSocket();
  const { t } = useLanguage();
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({ address });

  // Auto-refresh functionality
  const startAutoRefresh = useCallback(() => {
    if (refreshInterval.current) {
      clearInterval(refreshInterval.current);
    }
    
    refreshInterval.current = setInterval(() => {
      if (autoRefresh) {
        fetchDashboardData();
        fetchSystemStatus();
      }
    }, 15000); // Refresh every 15 seconds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  // Fetch initial data
  useEffect(() => {
    fetchDashboardData();
    fetchSystemStatus();

    if (connected) {
      sendMessage({
        type: 'subscribe',
        data: { channels: ['metrics', 'trades', 'system'] }
      });
    }

    if (autoRefresh) {
      startAutoRefresh();
    }

    return () => {
      if (refreshInterval.current) {
        clearInterval(refreshInterval.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, autoRefresh]);

  const fetchDashboardData = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001';
      if (process.env.NODE_ENV === 'development') {
        console.log('Fetching from:', `${apiUrl}/api/dashboard/overview`);
      }
      const response = await fetch(`${apiUrl}/api/dashboard/overview`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      // 检查HTTP状态码
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.success) {
        setDashboardData(result.data);
        setApiStatus(`✅ ${t('dashboard.connected')}`);
        setLastRefresh(new Date());
      } else {
        setApiStatus('❌ API Error');
        const errorMsg = result.message || result.error || 'Dashboard API returned error';
        if (process.env.NODE_ENV === 'development') {
          console.warn('API returned error:', errorMsg);
        }
        checkForAlerts({ type: 'api_error', message: errorMsg });
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to fetch dashboard data:', error);
      }
      setApiStatus(`❌ ${t('dashboard.disconnected')}`);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      checkForAlerts({
        type: 'connection_error',
        message: `Failed to connect to API: ${errorMsg}`,
        error: errorMsg
      });
    }
  };

  const fetchSystemStatus = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001';
      const response = await fetch(`${apiUrl}/api/dashboard/status`);
      const result = await response.json();

      if (result.success) {
        setSystemStatus(result.data);
        checkSystemHealth(result.data);
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to fetch system status:', error);
      }
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      checkForAlerts({ type: 'system_error', message: 'Failed to fetch system status', error: errorMsg });
    }
  };

  const checkSystemHealth = (status: any) => {
    const newAlerts: any[] = [];

    // In development mode, don't create alerts for expected conditions
    if (process.env.NODE_ENV === 'development') {
      return; // Skip alert generation in development
    }

    // Check overall system health (only in production)
    if (status.overall === 'degraded') {
      newAlerts.push({
        id: `system-degraded-${Date.now()}`,
        type: 'warning',
        title: 'System Performance Degraded',
        message: 'System is experiencing performance issues',
        timestamp: new Date(),
        severity: 'medium'
      });
    } else if (status.overall === 'unhealthy' && status.emergency_status?.active) {
      // Only show critical alert if there's an actual emergency
      newAlerts.push({
        id: `system-unhealthy-${Date.now()}`,
        type: 'error',
        title: 'System Health Critical',
        message: status.emergency_status?.reason || 'System is experiencing critical issues',
        timestamp: new Date(),
        severity: 'high'
      });
    }

    // Check RPC latency (only alert for very high latency)
    if (status.components?.rpc_provider?.latency > 2000) {
      newAlerts.push({
        id: `rpc-latency-${Date.now()}`,
        type: 'warning',
        title: 'High RPC Latency Detected',
        message: `RPC latency is ${status.components.rpc_provider.latency}ms (threshold: 2000ms)`,
        timestamp: new Date(),
        severity: 'medium'
      });
    }

    // Check component health (be less aggressive about alerts)
    if (status.components) {
      Object.entries(status.components).forEach(([component, data]: [string, any]) => {
        // Only alert for truly critical failures, not degraded status
        if (data.status === 'unhealthy' && component !== 'database') {
          newAlerts.push({
            id: `component-${component}-${Date.now()}`,
            type: 'error',
            title: `${component.replace('_', ' ').toUpperCase()} Component Failed`,
            message: `${component} is reporting unhealthy status`,
            timestamp: new Date(),
            severity: 'high'
          });
        }
      });
    }

    if (newAlerts.length > 0) {
      setAlerts(prev => [...prev, ...newAlerts].slice(-10)); // Keep only last 10 alerts
    }
  };

  const checkForAlerts = (alert: any) => {
    const newAlert = {
      id: `alert-${Date.now()}`,
      type: 'error',
      title: alert.type.replace('_', ' ').toUpperCase(),
      message: alert.message,
      timestamp: new Date(),
      severity: 'high'
    };
    setAlerts(prev => [newAlert, ...prev].slice(0, 10));
  };

  const clearAlerts = () => {
    setAlerts([]);
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
    if (!autoRefresh) {
      startAutoRefresh();
    } else if (refreshInterval.current) {
      clearInterval(refreshInterval.current);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white mb-2">{t('dashboard.title')}</h1>
          <p className="text-base sm:text-lg text-gray-600 dark:text-gray-300">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {/* Web3 Wallet Balance (if connected) */}
          {isConnected && balance && (
            <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-purple-100 to-blue-100 dark:from-purple-900 dark:to-blue-900 rounded-lg border-2 border-purple-200 dark:border-purple-700">
              <Wallet className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-semibold text-purple-800 dark:text-purple-200">
                {Number(balance.formatted).toFixed(4)} {balance.symbol}
              </span>
            </div>
          )}

          {/* Connect Wallet Button */}
          <div className="scale-90 sm:scale-100">
            <ConnectButton
              chainStatus="icon"
              accountStatus={{
                smallScreen: 'avatar',
                largeScreen: 'full',
              }}
              showBalance={{
                smallScreen: false,
                largeScreen: true,
              }}
            />
          </div>

          {/* Alerts Badge */}
          {alerts.length > 0 && (
            <Button
              size="sm"
              variant="flat"
              color="warning"
              onPress={() => setShowAlertModal(true)}
              className="relative"
              startContent={<AlertTriangle className="h-4 w-4" />}
            >
              {alerts.length} Alert{alerts.length > 1 ? 's' : ''}
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            </Button>
          )}
          
          <span className={`text-xs sm:text-sm px-3 sm:px-4 py-2 rounded-full font-medium shadow-sm ${
            connected 
              ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-2 border-green-200 dark:border-green-700' 
              : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-2 border-red-200 dark:border-red-700'
          }`}>
            <span className="hidden sm:inline">{t('dashboard.websocket')}: </span>{connected ? t('dashboard.connected') : t('dashboard.disconnected')}
          </span>
          
          {/* Auto-refresh toggle */}
          <Button
            size="sm"
            variant={autoRefresh ? "solid" : "bordered"}
            color={autoRefresh ? "success" : "default"}
            onPress={toggleAutoRefresh}
            className="min-w-20"
          >
            {autoRefresh ? t('dashboard.autoRefresh') : t('dashboard.manualRefresh')}
          </Button>
          
          <Button 
            size="sm" 
            variant="bordered" 
            onPress={() => { fetchDashboardData(); fetchSystemStatus(); }}
            isIconOnly
            className="border-2 hover:bg-blue-50 dark:hover:bg-gray-700"
            aria-label={t('dashboard.refresh')}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          {lastRefresh && (
            <span className="text-xs text-gray-500 dark:text-gray-400 hidden lg:block">
              {t('dashboard.lastRefresh')}: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-8 mb-6 sm:mb-8">
        {/* API Status Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 border-gray-100 dark:border-gray-700 p-4 sm:p-6 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 dark:text-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t('dashboard.apiStatus')}</h3>
            <div className="bg-blue-100 dark:bg-blue-900 p-2 rounded-lg">
              <Activity className="h-5 w-5 text-blue-600" />
            </div>
          </div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{apiStatus}</div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {dashboardData?.system ? `v${dashboardData.system.version} • Uptime: ${Math.floor((dashboardData.system.uptimeSeconds || 0) / 3600)}h` : t('dashboard.loading')}
          </p>
        </div>

        {/* Trading Performance Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 border-gray-100 dark:border-gray-700 p-4 sm:p-6 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 dark:text-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t('dashboard.tradingPerformance')}</h3>
            <div className="bg-green-100 p-2 rounded-lg">
              <TrendingUp className="h-5 w-5 text-green-600" />
            </div>
          </div>
          <div className={`text-3xl font-bold mb-2 ${
            dashboardData?.trading.pnl24h?.startsWith('+') ? 'text-green-600' : 'text-red-600'
          }`}>
            ${dashboardData?.trading.pnl24h || '0.00'}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            24h P&L • {dashboardData?.trading.totalTrades24h || 0} {t('dashboard.trades')}
          </p>
        </div>

        {/* Wallet Balance Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 border-gray-100 dark:border-gray-700 p-4 sm:p-6 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 dark:text-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t('dashboard.walletBalance')}</h3>
            <div className="bg-purple-100 dark:bg-purple-900 p-2 rounded-lg">
              <Wallet className="h-5 w-5 text-purple-600" />
            </div>
          </div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {dashboardData?.wallets.totalBalance || '0.00 BNB'}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{dashboardData?.wallets.total || 0} {t('dashboard.wallets')}</p>
        </div>

        {/* Success Rate Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 border-gray-100 dark:border-gray-700 p-4 sm:p-6 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 dark:text-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t('dashboard.successRate')}</h3>
            <div className="bg-emerald-100 dark:bg-emerald-900 p-2 rounded-lg">
              <Shield className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
          <div className="text-3xl font-bold text-emerald-600 mb-2">
            {dashboardData?.trading.successRate || '0%'}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.tradeSuccessRate')}</p>
        </div>
      </div>

      {/* System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 lg:gap-8">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 border-gray-100 dark:border-gray-700 p-4 sm:p-6 lg:p-8 hover:shadow-xl transition-all duration-300 dark:text-white">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-xl">
              <Monitor className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">{t('dashboard.systemStatus')}</h3>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <span className="font-medium text-gray-700 dark:text-gray-300">{t('dashboard.overallStatus')}</span>
              <div className="flex items-center gap-2">
                {systemStatus?.overall === 'healthy' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                {systemStatus?.overall === 'degraded' && <AlertTriangle className="h-4 w-4 text-yellow-600" />}
                {systemStatus?.overall === 'unhealthy' && <XCircle className="h-4 w-4 text-red-600" />}
                <span className={`capitalize px-4 py-2 rounded-full text-sm font-semibold shadow-sm ${
                  systemStatus?.overall === 'healthy' 
                    ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-700' 
                    : systemStatus?.overall === 'degraded'
                    ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-700'
                    : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-700'
                }`}>
                  {systemStatus?.overall || 'Unknown'}
                </span>
              </div>
            </div>
            
            {systemStatus?.components && Object.entries(systemStatus.components).map(([key, component]: [string, any]) => (
              <div key={key} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex flex-col">
                  <span className="capitalize font-medium text-gray-700 dark:text-gray-300">{key.replace('_', ' ')}</span>
                  {key === 'rpc_provider' && component?.latency && (
                    <span className={`text-xs ${
                      component.latency > 1000 ? 'text-red-500' : 
                      component.latency > 500 ? 'text-yellow-500' : 'text-green-500'
                    }`}>
                      {t('common.latency')}: {component.latency}ms
                      {component.latency > 890 && ` (${t('common.highLatencyDetected')})`}
                    </span>
                  )}
                </div>
                <span className={`text-sm flex items-center gap-2 font-semibold ${
                  component?.status === 'healthy' ? 'text-green-600' : 
                  component?.status === 'degraded' ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {component?.status === 'healthy' ? '✅' : 
                   component?.status === 'degraded' ? '⚠️' : '❌'} 
                  <span className="capitalize">{component?.status || 'unknown'}</span>
                </span>
              </div>
            ))}
            
            {systemStatus?.uptimeSeconds && (
              <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <span className="font-medium text-gray-700 dark:text-gray-300">{t('dashboard.systemUptime')}</span>
                <span className="text-sm font-semibold text-blue-600">
                  {Math.floor(systemStatus.uptimeSeconds / 3600)}h {Math.floor((systemStatus.uptimeSeconds % 3600) / 60)}m
                </span>
              </div>
            )}
          </div>
        </div>
        
        {/* Real-time Metrics Panel */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 border-gray-100 dark:border-gray-700 p-4 sm:p-6 lg:p-8 hover:shadow-xl transition-all duration-300 dark:text-white">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-green-100 dark:bg-green-900 p-3 rounded-xl">
              <Activity className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">{t('dashboard.liveMetrics')}</h3>
          </div>
          <div className="space-y-4">
            <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
              <div className="flex justify-between items-center">
                <span className="font-medium text-gray-700 dark:text-gray-300">{t('dashboard.apiResponseTime')}</span>
                <span className="text-lg font-bold text-blue-600">~45ms</span>
              </div>
              <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
                <div className="bg-blue-600 h-2 rounded-full w-3/4"></div>
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200">
              <div className="flex justify-between items-center">
                <span className="font-medium text-gray-700 dark:text-gray-300">{t('dashboard.memoryUsage')}</span>
                <span className="text-lg font-bold text-green-600">67%</span>
              </div>
              <div className="w-full bg-green-200 rounded-full h-2 mt-2">
                <div className="bg-green-600 h-2 rounded-full w-2/3"></div>
              </div>
            </div>
            
            <div className="p-4 bg-gradient-to-r from-purple-50 to-violet-50 rounded-lg border border-purple-200">
              <div className="flex justify-between items-center">
                <span className="font-medium text-gray-700 dark:text-gray-300">{t('dashboard.activeConnections')}</span>
                <span className="text-lg font-bold text-purple-600">{connected ? '1' : '0'}</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'} animate-pulse`}></div>
                <span className="text-sm text-gray-600 dark:text-gray-400">{t('dashboard.websocket')} {connected ? t('dashboard.active') : t('dashboard.inactive')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Alert Modal */}
      <Modal 
        isOpen={showAlertModal} 
        onOpenChange={setShowAlertModal}
        size="lg"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  {t('dashboard.systemAlerts')} ({alerts.length})
                </div>
              </ModalHeader>
              <ModalBody>
                {alerts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
                    <p>{t('monitoring.noActiveAlerts')}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {alerts.map((alert) => (
                      <div
                        key={alert.id}
                        className={`p-4 rounded-lg border-l-4 ${
                          alert.type === 'error'
                            ? 'bg-red-50 dark:bg-red-900/20 border-red-500'
                            : alert.type === 'warning'
                            ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
                            : 'bg-blue-50 dark:bg-blue-900/20 border-blue-500'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 mt-0.5">
                            {alert.type === 'error' && <XCircle className="h-5 w-5 text-red-600" />}
                            {alert.type === 'warning' && <AlertTriangle className="h-5 w-5 text-yellow-600" />}
                            {alert.type === 'info' && <Activity className="h-5 w-5 text-blue-600" />}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-gray-900 dark:text-white">
                              {alert.title}
                            </h4>
                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                              {alert.message}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                              {alert.timestamp.toLocaleString()}
                            </p>
                          </div>
                          <div className={`text-xs px-2 py-1 rounded ${
                            alert.severity === 'high'
                              ? 'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-200'
                              : alert.severity === 'medium'
                              ? 'bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200'
                              : 'bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200'
                          }`}>
                            {alert.severity?.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button color="danger" variant="light" onPress={clearAlerts}>
                  {t('dashboard.clearAll')}
                </Button>
                <Button color="primary" onPress={onClose}>
                  {t('common.close')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}