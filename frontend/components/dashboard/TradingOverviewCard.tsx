'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Chip } from '@nextui-org/react';
import { TrendingUp, Activity, DollarSign } from 'lucide-react';
import { apiClient } from '@/lib/api';

export function TradingOverviewCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await apiClient.getDashboardOverview();
        if (response.success) setData(response.data);
      } catch (error) {
        console.error('Failed to fetch trading data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card className="h-full">
        <CardBody className="flex items-center justify-center">
          <Activity className="w-4 h-4 animate-pulse" />
          <span className="ml-2">Loading...</span>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Trading Overview</h3>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm">Total Trades</span>
          <span className="text-lg font-bold">{data?.totalTrades || 0}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">Active Bots</span>
          <Chip color="success" variant="flat" size="sm">{data?.activeBots || 0}</Chip>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">24h Volume</span>
          <span className="text-lg font-bold">${(data?.volume24h || 0).toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">24h P&L</span>
          <span className={`text-lg font-bold ${(data?.pnl24h || 0) >= 0 ? 'text-success' : 'text-danger'}`}>
            {(data?.pnl24h || 0) >= 0 ? '+' : ''}${(data?.pnl24h || 0).toFixed(2)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm">Success Rate</span>
          <Chip color={(data?.successRate || 0) >= 70 ? 'success' : 'warning'} variant="flat" size="sm">
            {(data?.successRate || 0).toFixed(1)}%
          </Chip>
        </div>
      </CardBody>
    </Card>
  );
}