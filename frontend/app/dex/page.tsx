'use client';

import { useState } from 'react';
import { Tabs, Tab, Card, CardBody } from '@nextui-org/react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAccount, useChainId, useBalance, useDisconnect } from 'wagmi';
import { bsc, bscTestnet } from 'wagmi/chains';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { SwapInterface } from '@/src/components/dex/SwapInterface';
import { LiquidityInterface } from '@/src/components/dex/LiquidityInterface';
import { AnalyticsInterface } from '@/src/components/dex/AnalyticsInterface';

export default function DEXPage() {
  const { t } = useLanguage();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const [activeTab, setActiveTab] = useState('swap');

  // Get wallet balance
  const { data: balance } = useBalance({
    address: address,
  });

  // Get chain info
  const chain = chainId === bsc.id ? bsc : chainId === bscTestnet.id ? bscTestnet : null;
  const isUnsupportedChain = isConnected && !chain;
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-secondary-50 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <header className="border-b border-default-100 bg-background/70 backdrop-blur-lg sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-4">
              <h1 className="text-2xl font-bold">{t('dex.title')}</h1>
              <div className="text-sm text-default-500">
                {chain?.name || t('dex.notConnected')}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isConnected && balance && (
                <div className="hidden md:flex items-center gap-2 px-3 py-2 bg-success-50 dark:bg-success-900/20 rounded-lg">
                  <span className="text-sm font-semibold text-success">
                    {Number(balance.formatted).toFixed(4)} {balance.symbol}
                  </span>
                </div>
              )}
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
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Network Warning */}
          {isUnsupportedChain && (
            <Card className="mb-6 bg-warning-50 dark:bg-warning-900/20">
              <CardBody>
                <p className="text-warning dark:text-warning-400">
                  Please switch to BNB Smart Chain to use BianDEX
                </p>
              </CardBody>
            </Card>
          )}

          {/* Connection Status */}
          {!isConnected && (
            <Card className="mb-6 bg-primary-50 dark:bg-primary-900/20">
              <CardBody>
                <p className="text-primary dark:text-primary-400 text-center">
                  Connect your wallet to start trading on BianDEX
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
            <Tab key="swap" title={t('dex.swap')}>
              <div className="mt-6">
                <SwapInterface />
              </div>
            </Tab>
            <Tab key="liquidity" title={t('dex.liquidity')}>
              <div className="mt-6">
                <LiquidityInterface />
              </div>
            </Tab>
            <Tab key="analytics" title={t('dex.analytics')}>
              <div className="mt-6">
                <AnalyticsInterface />
              </div>
            </Tab>
          </Tabs>
          
          {/* Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            <Card>
              <CardBody>
                <h3 className="text-sm font-semibold text-default-500 mb-2">{t('dex.totalValueLocked')}</h3>
                <p className="text-2xl font-bold">$0.00</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <h3 className="text-sm font-semibold text-default-500 mb-2">{t('dex.volume24h')}</h3>
                <p className="text-2xl font-bold">$0.00</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <h3 className="text-sm font-semibold text-default-500 mb-2">{t('dex.totalPairs')}</h3>
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
            {t('dex.footer')}
          </div>
        </div>
      </footer>
    </div>
  );
}