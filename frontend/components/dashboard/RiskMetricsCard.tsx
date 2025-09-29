'use client';

import { Card, CardHeader, CardBody } from '@nextui-org/react';
import { Shield } from 'lucide-react';

export function RiskMetricsCard() {
  return (
    <Card>
      <CardHeader className="flex gap-3">
        <Shield className="text-yellow-500" />
        <div className="flex flex-col">
          <p className="text-md">Risk Metrics</p>
          <p className="text-small text-default-500">Current Status</p>
        </div>
      </CardHeader>
      <CardBody>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>Risk Score</span>
            <span className="text-green-500">35/100</span>
          </div>
          <div className="flex justify-between">
            <span>Max Drawdown</span>
            <span>-5.2%</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}