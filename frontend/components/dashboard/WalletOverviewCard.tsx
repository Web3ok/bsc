'use client';

import { Card, CardHeader, CardBody } from '@nextui-org/react';
import { Wallet } from 'lucide-react';

export function WalletOverviewCard() {
  return (
    <Card>
      <CardHeader className="flex gap-3">
        <Wallet className="text-blue-500" />
        <div className="flex flex-col">
          <p className="text-md">Wallet Overview</p>
          <p className="text-small text-default-500">Total Balance</p>
        </div>
      </CardHeader>
      <CardBody>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>BNB Balance</span>
            <span>2.45 BNB</span>
          </div>
          <div className="flex justify-between">
            <span>USD Value</span>
            <span>$1,234.56</span>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}