'use client';

import { useState } from 'react';
import { Tabs, Tab, Card, CardBody } from '@nextui-org/react';
import SwapInterface from '@/src/components/dex/SwapInterface';
import LiquidityInterface from '@/src/components/dex/LiquidityInterface';
import { useAccount, useNetwork } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export default function DEXPage() {
  const { isConnected } = useAccount();
  const { chain } = useNetwork();
  const [activeTab, setActiveTab] = useState('swap');
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-secondary-50 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="border-b border-default-100 bg-background/70 backdrop-blur-lg sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold">BianDEX</h1>
              <div className="text-sm text-default-500">
                {chain?.name || 'Not Connected'}
              </div>
            </div>
            <ConnectButton />
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Network Warning */}
          {isConnected && chain?.unsupported && (
            <Card className="mb-6 bg-warning-50 dark:bg-warning-900/20">
              <CardBody>
                <p className="text-warning dark:text-warning-400">
                  Please switch to BNB Smart Chain to use BianDEX
                </p>
              </CardBody>
            </Card>
          )}
          
          {/* DEX Interface */}
          <Tabs 
            selectedKey={activeTab}
            onSelectionChange={(key) => setActiveTab(key as string)}
            className="mb-6"
            classNames={{
              tabList: "bg-default-100 p-1 rounded-xl",
              cursor: "bg-background",
              tab: "px-6 py-3",
              tabContent: "group-data-[selected=true]:text-primary font-medium"
            }}
          >
            <Tab key="swap" title="Swap">
              <div className="mt-6">
                <SwapInterface />
              </div>
            </Tab>
            <Tab key="liquidity" title="Liquidity">
              <div className="mt-6">
                <LiquidityInterface />
              </div>
            </Tab>
            <Tab key="analytics" title="Analytics">
              <Card className="mt-6">
                <CardBody className="text-center py-12 text-default-500">
                  Analytics coming soon...
                </CardBody>
              </Card>
            </Tab>
          </Tabs>
          
          {/* Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            <Card>
              <CardBody>
                <h3 className="text-sm font-semibold text-default-500 mb-2">Total Value Locked</h3>
                <p className="text-2xl font-bold">$0.00</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <h3 className="text-sm font-semibold text-default-500 mb-2">24h Volume</h3>
                <p className="text-2xl font-bold">$0.00</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <h3 className="text-sm font-semibold text-default-500 mb-2">Total Pairs</h3>
                <p className="text-2xl font-bold">0</p>
              </CardBody>
            </Card>
          </div>
        </div>
      </main>
      
      {/* Footer */}
      <footer className="mt-auto border-t border-default-100 bg-background/50">
        <div className="container mx-auto px-4 py-6">
          <div className="text-center text-sm text-default-500">
            BianDEX - A decentralized exchange on BNB Chain
          </div>
        </div>
      </footer>
    </div>
  );
}