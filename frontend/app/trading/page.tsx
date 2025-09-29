'use client';

import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Button, Input, Select, SelectItem, Textarea, Switch, Chip, Table, TableHeader, TableBody, TableColumn, TableRow, TableCell, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@nextui-org/react';
import { ArrowUpDown, TrendingUp, Zap, Eye, Play, Pause, Settings, BarChart3, AlertCircle, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import BatchOperations from '../../components/BatchOperations';
import { useLanguage } from '../../contexts/LanguageContext';

interface TradeRequest {
  type: 'buy' | 'sell';
  tokenIn: string;
  tokenOut: string;
  amount: string;
  slippage: number;
  walletAddress?: string;
  walletGroup?: string;
}

interface BatchTradeRequest {
  trades: TradeRequest[];
  strategy: 'sequential' | 'parallel' | 'staggered';
  maxConcurrent: number;
  delay?: number;
}

interface TradeHistory {
  id: string;
  type: 'buy' | 'sell';
  tokenSymbol: string;
  amount: string;
  price: string;
  status: 'pending' | 'completed' | 'failed';
  timestamp: string;
  txHash?: string;
  walletAddress: string;
  pnl?: string;
}

interface QuoteResult {
  tokenIn: {
    address: string;
    symbol: string;
    amount: string;
  };
  tokenOut: {
    address: string;
    symbol: string;
    amount: string;
  };
  priceImpact: {
    impact: number;
    category: string;
  };
  slippageAnalysis: {
    recommendedSlippage: number;
    reason: string;
  };
  minimumReceived: string;
  executionPrice: string;
  gasEstimate: string;
  totalCostBNB: string;
  recommendation: string;
}

const POPULAR_TOKENS = [
  { address: 'BNB', symbol: 'BNB', name: 'Binance Coin (Native)', decimals: 18 },
  { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18 },
  { address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18 },
  { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18 },
  { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18 },
  { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
  { address: '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402', symbol: 'DOT', name: 'Polkadot Token', decimals: 18 },
  { address: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', symbol: 'XRP', name: 'XRP Token', decimals: 18 },
  { address: '0x4338665CBB7B2485A8855A139b75D5e34AB0DB94', symbol: 'LTC', name: 'Litecoin Token', decimals: 18 },
  { address: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', symbol: 'ADA', name: 'Cardano Token', decimals: 18 },
  { address: '0xbF5140A22578168FD562DCcF235E5D43A02ce9B1', symbol: 'UNI', name: 'Uniswap', decimals: 18 },
  { address: '0x1CE0c2827e2eF14D5C4f29a091d735A204794041', symbol: 'AVAX', name: 'Avalanche Token', decimals: 18 }
];

export default function TradingPage() {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'single' | 'batch' | 'advanced' | 'history'>('single');
  
  // Single trade state
  const [singleTrade, setSingleTrade] = useState<TradeRequest>({
    type: 'buy',
    tokenIn: POPULAR_TOKENS[0].address,
    tokenOut: POPULAR_TOKENS[1].address,
    amount: '',
    slippage: 0.5,
    walletAddress: ''
  });

  // Custom token input states
  const [customTokenInAddress, setCustomTokenInAddress] = useState('');
  const [customTokenOutAddress, setCustomTokenOutAddress] = useState('');
  const [showCustomTokenIn, setShowCustomTokenIn] = useState(false);
  const [showCustomTokenOut, setShowCustomTokenOut] = useState(false);
  
  // Batch trade state
  const [batchTrades, setBatchTrades] = useState<TradeRequest[]>([]);
  const [batchConfig, setBatchConfig] = useState<BatchTradeRequest>({
    trades: [],
    strategy: 'parallel',
    maxConcurrent: 3,
    delay: 1000
  });
  
  // Other state
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [walletGroups, setWalletGroups] = useState<string[]>([]);
  const [walletBalances, setWalletBalances] = useState<Record<string, Record<string, string>>>({});
  const [selectedWallet, setSelectedWallet] = useState('');
  const [availableWallets, setAvailableWallets] = useState<Array<{address: string, label: string}>>([]);
  
  const { isOpen: isPreviewOpen, onOpen: onPreviewOpen, onClose: onPreviewClose } = useDisclosure();

  useEffect(() => {
    fetchTradeHistory();
    fetchWalletGroups();
    fetchAvailableWallets();
  }, []);

  useEffect(() => {
    if (selectedWallet) {
      fetchWalletBalance(selectedWallet);
    }
  }, [selectedWallet]);

  const fetchTradeHistory = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/trading/history`);
      const result = await response.json();
      
      if (result.success) {
        setTradeHistory(result.data);
      } else {
        // 如果API失败，显示示例数据
        const mockHistory: TradeHistory[] = [
          {
            id: '1',
            type: 'buy',
            tokenSymbol: 'CAKE',
            amount: '100',
            price: '2.45',
            status: 'completed',
            timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
            txHash: '0x1234...5678',
            walletAddress: '0xabcd...efgh',
            pnl: '+15.30'
          },
          {
            id: '2',
            type: 'sell',
            tokenSymbol: 'USDT',
            amount: '500',
            price: '1.00',
            status: 'completed',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
            txHash: '0x5678...9abc',
            walletAddress: '0xefgh...ijkl',
            pnl: '-2.10'
          },
          {
            id: '3',
            type: 'buy',
            tokenSymbol: 'ETH',
            amount: '0.5',
            price: '2100.00',
            status: 'pending',
            timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
            walletAddress: '0xijkl...mnop'
          }
        ];
        setTradeHistory(mockHistory);
      }
    } catch (error) {
      console.error('Failed to fetch trade history:', error);
      // 在网络错误时也显示示例数据
      const mockHistory: TradeHistory[] = [
        {
          id: '1',
          type: 'buy',
          tokenSymbol: 'CAKE',
          amount: '100',
          price: '2.45',
          status: 'completed',
          timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
          txHash: '0x1234...5678',
          walletAddress: '0xabcd...efgh',
          pnl: '+15.30'
        }
      ];
      setTradeHistory(mockHistory);
    }
  };

  const fetchWalletGroups = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001'}/api/wallets/groups`);
      const result = await response.json();
      if (result.success) {
        setWalletGroups(result.data.map((g: any) => g.name));
      }
    } catch (error) {
      console.error('Failed to fetch wallet groups:', error);
      setWalletGroups(['default', 'trading', 'arbitrage']); // Mock data
    }
  };

  const fetchAvailableWallets = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/wallets/list`);
      const result = await response.json();
      
      if (result.success) {
        const wallets = result.data.wallets.map((wallet: any) => ({
          address: wallet.address,
          label: wallet.label || `钱包 ${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
        }));
        setAvailableWallets(wallets);
        if (wallets.length > 0 && !selectedWallet) {
          setSelectedWallet(wallets[0].address);
        }
      }
    } catch (error) {
      console.error('Failed to fetch available wallets:', error);
    }
  };

  const fetchWalletBalance = async (walletAddress: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/wallets/balance/${walletAddress}`);
      const result = await response.json();
      
      if (result.success) {
        setWalletBalances(prev => ({
          ...prev,
          [walletAddress]: result.data.balances || result.data || {}
        }));
      }
    } catch (error) {
      console.error('Failed to fetch wallet balance:', error);
    }
  };

  const handleGetQuote = async () => {
    if (!singleTrade.tokenIn) {
      toast.error('Please select a token to buy');
      return;
    }
    if (!singleTrade.tokenOut) {
      toast.error('Please select a token to sell');
      return;
    }
    if (!singleTrade.amount || singleTrade.amount.trim() === '') {
      toast.error('Please enter an amount');
      return;
    }
    const amount = parseFloat(singleTrade.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid numeric amount greater than 0');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001'}/api/trading/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokenIn: singleTrade.tokenIn,
          tokenOut: singleTrade.tokenOut,
          amountIn: singleTrade.amount,
          slippage: singleTrade.slippage
        })
      });
      
      const result = await response.json();
      if (result.success) {
        setQuote(result.data);
        toast.success('Quote generated successfully');
      } else {
        toast.error(result.error || 'Failed to get quote');
      }
    } catch (error) {
      console.error('Quote request failed:', error);
      toast.error('Failed to get quote');
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteTrade = async () => {
    if (!quote || (!singleTrade.walletAddress && !singleTrade.walletGroup)) {
      toast.error('Please specify a wallet address or group');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001'}/api/trading/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...singleTrade,
          quote
        })
      });
      
      const result = await response.json();
      if (result.success) {
        toast.success('Trade executed successfully!');
        setQuote(null);
        setSingleTrade({ ...singleTrade, amount: '' });
        fetchTradeHistory();
      } else {
        toast.error(result.error || 'Trade execution failed');
      }
    } catch (error) {
      console.error('Trade execution failed:', error);
      toast.error('Trade execution failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToBatch = () => {
    if (!singleTrade.tokenIn) {
      toast.error('Please select a token to buy');
      return;
    }
    if (!singleTrade.tokenOut) {
      toast.error('Please select a token to sell');
      return;
    }
    if (!singleTrade.amount || singleTrade.amount.trim() === '') {
      toast.error('Please enter an amount');
      return;
    }
    const amount = parseFloat(singleTrade.amount);
    if (Number.isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid numeric amount greater than 0');
      return;
    }

    setBatchTrades([...batchTrades, { ...singleTrade }]);
    setSingleTrade({ ...singleTrade, amount: '' });
    toast.success('Trade added to batch');
  };

  const handleExecuteBatch = async () => {
    if (batchTrades.length === 0) {
      toast.error('No trades in batch');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001'}/api/trading/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...batchConfig,
          trades: batchTrades
        })
      });
      
      const result = await response.json();
      if (result.success) {
        toast.success(`Batch executed: ${result.data.successfulTrades}/${result.data.totalTrades} trades successful`);
        setBatchTrades([]);
        fetchTradeHistory();
      } else {
        toast.error(result.error || 'Batch execution failed');
      }
    } catch (error) {
      console.error('Batch execution failed:', error);
      toast.error('Batch execution failed');
    } finally {
      setLoading(false);
    }
  };

  const getTokenSymbol = (address: string) => {
    if (!address) return 'Unknown';
    const token = POPULAR_TOKENS.find(t => t.address.toLowerCase() === address.toLowerCase());
    return token?.symbol || address.slice(0, 8) + '...';
  };

  const addCustomTokenIn = () => {
    if (customTokenInAddress && customTokenInAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setSingleTrade({ ...singleTrade, tokenIn: customTokenInAddress });
      setCustomTokenInAddress('');
      setShowCustomTokenIn(false);
      toast.success('自定义代币已添加');
    } else {
      toast.error('请输入有效的合约地址');
    }
  };

  const addCustomTokenOut = () => {
    if (customTokenOutAddress && customTokenOutAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      setSingleTrade({ ...singleTrade, tokenOut: customTokenOutAddress });
      setCustomTokenOutAddress('');
      setShowCustomTokenOut(false);
      toast.success('自定义代币已添加');
    } else {
      toast.error('请输入有效的合约地址');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'success';
      case 'pending': return 'warning';
      case 'failed': return 'danger';
      default: return 'default';
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t('trading.title')}</h1>
          <p className="text-base sm:text-lg text-gray-600">{t('trading.subtitle')}</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-1 sm:space-x-1 bg-gray-100 p-1 rounded-lg w-full sm:w-fit overflow-x-auto">
        <button
          className={`px-2 sm:px-4 py-2 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
            activeTab === 'single' 
              ? 'bg-white text-blue-600 shadow-sm' 
              : 'text-gray-600 hover:text-gray-900'
          }`}
          onClick={() => setActiveTab('single')}
        >
          {t('trading.singleTrade')}
        </button>
        <button
          className={`px-2 sm:px-4 py-2 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
            activeTab === 'batch' 
              ? 'bg-white text-blue-600 shadow-sm' 
              : 'text-gray-600 hover:text-gray-900'
          }`}
          onClick={() => setActiveTab('batch')}
        >
          {t('trading.batchTrading')}
        </button>
        <button
          className={`px-2 sm:px-4 py-2 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
            activeTab === 'advanced' 
              ? 'bg-white text-blue-600 shadow-sm' 
              : 'text-gray-600 hover:text-gray-900'
          }`}
          onClick={() => setActiveTab('advanced')}
        >
          {t('trading.advancedBatch')}
        </button>
        <button
          className={`px-2 sm:px-4 py-2 rounded text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
            activeTab === 'history' 
              ? 'bg-white text-blue-600 shadow-sm' 
              : 'text-gray-600 hover:text-gray-900'
          }`}
          onClick={() => setActiveTab('history')}
        >
          {t('trading.tradeHistory')}
        </button>
      </div>

      {/* Single Trade Tab */}
      {activeTab === 'single' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5" />
                {t('trading.tradeConfiguration')}
              </h3>
            </CardHeader>
            <CardBody className="space-y-3 sm:space-y-4 p-4 sm:p-6">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  color={singleTrade.type === 'buy' ? 'primary' : 'default'}
                  variant={singleTrade.type === 'buy' ? 'solid' : 'bordered'}
                  onPress={() => setSingleTrade({ ...singleTrade, type: 'buy' })}
                  className="flex-1"
                >
                  {t('trading.buy')}
                </Button>
                <Button
                  size="sm"
                  color={singleTrade.type === 'sell' ? 'danger' : 'default'}
                  variant={singleTrade.type === 'sell' ? 'solid' : 'bordered'}
                  onPress={() => setSingleTrade({ ...singleTrade, type: 'sell' })}
                  className="flex-1"
                >
                  {t('trading.sell')}
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <Select
                  label={t('trading.tokenIn')}
                  selectedKeys={[singleTrade.tokenIn]}
                  onSelectionChange={(keys) => setSingleTrade({ ...singleTrade, tokenIn: Array.from(keys)[0] as string })}
                >
                  {POPULAR_TOKENS.map((token) => (
                    <SelectItem key={token.address} value={token.address} textValue={`${token.symbol} - ${token.name}`}>
                      {token.symbol} - {token.name}
                    </SelectItem>
                  ))}
                </Select>

                <Select
                  label={t('trading.tokenOut')}
                  selectedKeys={[singleTrade.tokenOut]}
                  onSelectionChange={(keys) => setSingleTrade({ ...singleTrade, tokenOut: Array.from(keys)[0] as string })}
                >
                  {POPULAR_TOKENS.map((token) => (
                    <SelectItem key={token.address} value={token.address} textValue={`${token.symbol} - ${token.name}`}>
                      {token.symbol} - {token.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <Input
                label={t('trading.amount')}
                placeholder="1.0"
                value={singleTrade.amount}
                onChange={(e) => setSingleTrade({ ...singleTrade, amount: e.target.value })}
                endContent={<span className="text-sm text-gray-500">{getTokenSymbol(singleTrade.tokenIn)}</span>}
              />

              <Input
                label={t('trading.slippageTolerance')}
                placeholder="0.5"
                value={singleTrade.slippage.toString()}
                onChange={(e) => setSingleTrade({ ...singleTrade, slippage: parseFloat(e.target.value) || 0 })}
                endContent={<span className="text-sm text-gray-500">%</span>}
              />

              <Input
                label={t('trading.walletAddress')}
                placeholder="0x..."
                value={singleTrade.walletAddress || ''}
                onChange={(e) => setSingleTrade({ ...singleTrade, walletAddress: e.target.value })}
              />

              <Select
                label={t('trading.selectWalletGroup')}
                selectedKeys={singleTrade.walletGroup ? [singleTrade.walletGroup] : []}
                onSelectionChange={(keys) => setSingleTrade({ ...singleTrade, walletGroup: Array.from(keys)[0] as string })}
              >
                {walletGroups.map((group) => (
                  <SelectItem key={group} value={group} textValue={group}>
                    {group}
                  </SelectItem>
                ))}
              </Select>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  onPress={handleGetQuote}
                  isLoading={loading}
                  variant="bordered"
                  startContent={<Eye className="h-4 w-4" />}
                  className="flex-1"
                >
                  {t('trading.getQuote')}
                </Button>
                <Button
                  onPress={handleAddToBatch}
                  variant="bordered"
                  startContent={<Plus className="h-4 w-4" />}
                >
                  {t('trading.addToBatch')}
                </Button>
              </div>

              <Button
                onPress={handleExecuteTrade}
                isLoading={loading}
                color="primary"
                startContent={<Zap className="h-4 w-4" />}
                isDisabled={!quote}
                className="w-full"
              >
                {t('trading.executeTrade')}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                {t('trading.quoteAnalysis')}
              </h3>
            </CardHeader>
            <CardBody className="p-4 sm:p-6">
              {quote ? (
                <div className="space-y-4">
                  <div className="bg-gray-50 p-3 sm:p-4 rounded-lg space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">{t('trading.youPay')}</span>
                      <span className="font-mono">{quote.tokenIn.amount} {quote.tokenIn.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">{t('trading.youReceive')}</span>
                      <span className="font-mono">{quote.tokenOut.amount} {quote.tokenOut.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">{t('trading.price')}</span>
                      <span className="font-mono">{quote.executionPrice}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm">{t('trading.priceImpact')}</span>
                      <Chip 
                        size="sm"
                        color={quote.priceImpact.impact < 1 ? 'success' : quote.priceImpact.impact < 3 ? 'warning' : 'danger'}
                      >
                        {quote.priceImpact.impact.toFixed(3)}% ({quote.priceImpact.category})
                      </Chip>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">{t('trading.recommendedSlippage')}</span>
                      <span className="text-sm">{quote.slippageAnalysis.recommendedSlippage.toFixed(2)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">{t('trading.minimumReceived')}</span>
                      <span className="text-sm font-mono">{quote.minimumReceived} {quote.tokenOut.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">{t('trading.gasEstimate')}</span>
                      <span className="text-sm">{quote.gasEstimate} gwei</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">{t('trading.totalCost')}</span>
                      <span className="text-sm font-mono">{quote.totalCostBNB} BNB</span>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-blue-700">{quote.recommendation}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <BarChart3 className="h-12 w-12 mx-auto mb-4" />
                  <p>{t('trading.clickGetQuote')}</p>
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Batch Trading Tab */}
      {activeTab === 'batch' && (
        <div className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">{t('trading.batchConfiguration')}</h3>
              </CardHeader>
              <CardBody className="space-y-3 sm:space-y-4 p-4 sm:p-6">
                <Select
                  label={t('trading.executionStrategy')}
                  selectedKeys={[batchConfig.strategy]}
                  onSelectionChange={(keys) => setBatchConfig({ ...batchConfig, strategy: Array.from(keys)[0] as 'sequential' | 'parallel' | 'staggered' })}
                >
                  <SelectItem key="parallel" value="parallel" textValue={t('trading.parallel')}>{t('trading.parallel')}</SelectItem>
                  <SelectItem key="sequential" value="sequential" textValue={t('trading.sequential')}>{t('trading.sequential')}</SelectItem>
                  <SelectItem key="staggered" value="staggered" textValue={t('trading.staggered')}>{t('trading.staggered')}</SelectItem>
                </Select>

                <Input
                  label={t('trading.maxConcurrentTrades')}
                  type="number"
                  value={batchConfig.maxConcurrent.toString()}
                  onChange={(e) => setBatchConfig({ ...batchConfig, maxConcurrent: parseInt(e.target.value) || 1 })}
                />

                {batchConfig.strategy === 'staggered' && (
                  <Input
                    label={t('trading.delayBetweenTrades')}
                    type="number"
                    value={batchConfig.delay?.toString() || '1000'}
                    onChange={(e) => setBatchConfig({ ...batchConfig, delay: parseInt(e.target.value) || 1000 })}
                  />
                )}

                <Button
                  onPress={onPreviewOpen}
                  variant="bordered"
                  startContent={<Eye className="h-4 w-4" />}
                  isDisabled={batchTrades.length === 0}
                  className="w-full"
                >
                  {t('trading.previewBatch')} ({batchTrades.length} {t('dashboard.trades')})
                </Button>

                <Button
                  onPress={handleExecuteBatch}
                  isLoading={loading}
                  color="primary"
                  startContent={<Play className="h-4 w-4" />}
                  isDisabled={batchTrades.length === 0}
                  className="w-full"
                >
                  {t('trading.executeBatch')}
                </Button>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="text-lg font-semibold">{t('trading.batchOverview')}</h3>
              </CardHeader>
              <CardBody className="p-4 sm:p-6">
                {batchTrades.length > 0 ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">{t('trading.totalTrades')}:</span>
                        <div className="font-semibold">{batchTrades.length}</div>
                      </div>
                      <div>
                        <span className="text-gray-600">{t('trading.strategy')}:</span>
                        <div className="font-semibold capitalize">{batchConfig.strategy}</div>
                      </div>
                      <div>
                        <span className="text-gray-600">{t('trading.buyOrders')}:</span>
                        <div className="font-semibold text-green-600">{batchTrades.filter(t => t.type === 'buy').length}</div>
                      </div>
                      <div>
                        <span className="text-gray-600">{t('trading.sellOrders')}:</span>
                        <div className="font-semibold text-red-600">{batchTrades.filter(t => t.type === 'sell').length}</div>
                      </div>
                    </div>

                    <div className="border-t pt-3">
                      <h4 className="font-medium mb-2">{t('trading.recentTrades')}:</h4>
                      <div className="space-y-2 max-h-24 sm:max-h-32 overflow-y-auto">
                        {batchTrades.slice(-5).map((trade, index) => (
                          <div key={index} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm bg-gray-50 p-2 rounded">
                            <span className={`font-medium ${trade.type === 'buy' ? 'text-green-600' : 'text-red-600'}`}>
                              {trade.type.toUpperCase()}
                            </span>
                            <span>{trade.amount} {getTokenSymbol(trade.tokenIn)}</span>
                            <Button
                              size="sm"
                              variant="light"
                              onPress={() => setBatchTrades(batchTrades.filter((_, i) => i !== index))}
                            >
                              {t('trading.remove')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Play className="h-12 w-12 mx-auto mb-4" />
                    <p>{t('trading.addTradesToBatch')}</p>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {/* Advanced Batch Tab */}
      {activeTab === 'advanced' && (
        <BatchOperations />
      )}

      {/* Trade History Tab */}
      {activeTab === 'history' && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">{t('trading.tradeHistory')}</h3>
          </CardHeader>
          <CardBody className="p-4 sm:p-6">
            <div className="overflow-x-auto">
            <Table aria-label="Trade history">
              <TableHeader>
                <TableColumn>{t('trading.type')}</TableColumn>
                <TableColumn>{t('trading.token')}</TableColumn>
                <TableColumn>{t('trading.amount').toUpperCase()}</TableColumn>
                <TableColumn>{t('trading.price').replace(':', '').toUpperCase()}</TableColumn>
                <TableColumn>{t('trading.status')}</TableColumn>
                <TableColumn>{t('trading.pnl')}</TableColumn>
                <TableColumn>{t('trading.time')}</TableColumn>
                <TableColumn>{t('trading.actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {tradeHistory.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={trade.type === 'buy' ? 'success' : 'danger'}
                        variant="flat"
                      >
                        {trade.type.toUpperCase()}
                      </Chip>
                    </TableCell>
                    <TableCell>{trade.tokenSymbol}</TableCell>
                    <TableCell>{trade.amount}</TableCell>
                    <TableCell>${trade.price}</TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={getStatusColor(trade.status)}
                        variant="flat"
                      >
                        {trade.status}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      {trade.pnl && (
                        <span className={trade.pnl.startsWith('+') ? 'text-green-600' : 'text-red-600'}>
                          {trade.pnl}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {new Date(trade.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {trade.txHash && (
                        <Button
                          size="sm"
                          variant="light"
                          onPress={() => window.open(`https://bscscan.com/tx/${trade.txHash}`, '_blank')}
                        >
                          {t('trading.view')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Batch Preview Modal */}
      <Modal isOpen={isPreviewOpen} onClose={onPreviewClose} size="2xl">
        <ModalContent>
          <ModalHeader>{t('trading.batchTradePreview')}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <div className="bg-gray-50 p-3 sm:p-4 rounded-lg">
                <h4 className="font-medium mb-2">Configuration</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Strategy:</span>
                    <div className="font-semibold capitalize">{batchConfig.strategy}</div>
                  </div>
                  <div>
                    <span className="text-gray-600">Max Concurrent:</span>
                    <div className="font-semibold">{batchConfig.maxConcurrent}</div>
                  </div>
                  {batchConfig.strategy === 'staggered' && (
                    <div>
                      <span className="text-gray-600">Delay:</span>
                      <div className="font-semibold">{batchConfig.delay}ms</div>
                    </div>
                  )}
                </div>
              </div>

              <Table aria-label="Batch trades preview">
                <TableHeader>
                  <TableColumn>TYPE</TableColumn>
                  <TableColumn>FROM</TableColumn>
                  <TableColumn>TO</TableColumn>
                  <TableColumn>AMOUNT</TableColumn>
                  <TableColumn>SLIPPAGE</TableColumn>
                </TableHeader>
                <TableBody>
                  {batchTrades.map((trade, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Chip
                          size="sm"
                          color={trade.type === 'buy' ? 'success' : 'danger'}
                          variant="flat"
                        >
                          {trade.type.toUpperCase()}
                        </Chip>
                      </TableCell>
                      <TableCell>{getTokenSymbol(trade.tokenIn)}</TableCell>
                      <TableCell>{getTokenSymbol(trade.tokenOut)}</TableCell>
                      <TableCell>{trade.amount}</TableCell>
                      <TableCell>{trade.slippage}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onPreviewClose}>
              Close
            </Button>
            <Button color="primary" onPress={() => { onPreviewClose(); handleExecuteBatch(); }}>
              Execute Batch
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}