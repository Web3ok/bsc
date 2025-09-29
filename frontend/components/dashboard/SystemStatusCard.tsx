'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Chip, Progress } from '@nextui-org/react';
import { Activity, Database, Wifi, Cpu, MemoryStick } from 'lucide-react';
import { apiClient } from '@/lib/api';

interface SystemHealth {
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

export function SystemStatusCard() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await apiClient.getSystemHealth();
        if (response.success && response.data) {
          setHealth(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch system health:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'success';
      case 'degraded':
        return 'warning';
      case 'unhealthy':
        return 'danger';
      default:
        return 'default';
    }
  };

  const formatUptime = (uptime: number) => {
    const hours = Math.floor(uptime / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return (
      <Card className="h-full">
        <CardBody className="flex items-center justify-center">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 animate-pulse" />
            <span>Loading system status...</span>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (!health) {
    return (
      <Card className="h-full">
        <CardBody className="flex items-center justify-center">
          <div className="text-center">
            <Activity className="w-8 h-8 mx-auto mb-2 text-danger" />
            <p className="text-sm text-foreground-500">Unable to fetch system status</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          <h3 className="text-lg font-semibold">System Status</h3>
          <Chip
            color={getStatusColor(health.overall)}
            variant="flat"
            size="sm"
          >
            {health.overall}
          </Chip>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Uptime */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-foreground-500" />
            <span className="text-sm">Uptime</span>
          </div>
          <span className="text-sm font-medium">{formatUptime(health.uptime)}</span>
        </div>

        {/* Memory Usage */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MemoryStick className="w-4 h-4 text-foreground-500" />
              <span className="text-sm">Memory</span>
            </div>
            <span className="text-sm font-medium">{health.memory.percentage}%</span>
          </div>
          <Progress
            value={health.memory.percentage}
            color={health.memory.percentage > 80 ? 'danger' : health.memory.percentage > 60 ? 'warning' : 'success'}
            size="sm"
          />
          <div className="text-xs text-foreground-400">
            {(health.memory.used / 1024 / 1024).toFixed(1)}MB / {(health.memory.total / 1024 / 1024).toFixed(1)}MB
          </div>
        </div>

        {/* Database Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-foreground-500" />
            <span className="text-sm">Database</span>
          </div>
          <Chip
            color={health.database === 'connected' ? 'success' : 'danger'}
            variant="flat"
            size="sm"
          >
            {health.database}
          </Chip>
        </div>

        {/* DEX Connectivity */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-foreground-500" />
            <span className="text-sm">DEX Connectivity</span>
          </div>
          <div className="space-y-1 ml-6">
            <div className="flex items-center justify-between">
              <span className="text-xs">PancakeSwap</span>
              <Chip
                color={health.dex.pancakeswap ? 'success' : 'danger'}
                variant="flat"
                size="sm"
              >
                {health.dex.pancakeswap ? 'Online' : 'Offline'}
              </Chip>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Uniswap</span>
              <Chip
                color={health.dex.uniswap ? 'success' : 'danger'}
                variant="flat"
                size="sm"
              >
                {health.dex.uniswap ? 'Online' : 'Offline'}
              </Chip>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}