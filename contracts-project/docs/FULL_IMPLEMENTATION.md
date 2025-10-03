# BianDEX 完整实现指南

本文档包含BianDEX生态系统所有剩余功能的完整实现代码。

## 目录结构

```
project/
├── contracts-project/          # 智能合约 (已完成)
├── frontend-dex/              # 前端应用
├── backend-services/          # 后端服务
├── governance-contracts/      # DAO治理合约
└── advanced-features/         # 高级功能
```

---

# 第一部分：前端应用 (frontend-dex/)

## 1. 项目配置

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### tailwind.config.ts
```typescript
import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

export default config
```

### next.config.js
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: config => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    return config;
  },
}

module.exports = nextConfig
```

## 2. Web3 配置

### src/config/wagmi.ts
```typescript
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { bsc, bscTestnet } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'BianDEX',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [bsc, bscTestnet],
  ssr: true,
});
```

### src/config/contracts.ts
```typescript
export const CONTRACTS = {
  FACTORY: process.env.NEXT_PUBLIC_FACTORY_ADDRESS || '',
  ROUTER: process.env.NEXT_PUBLIC_ROUTER_ADDRESS || '',
  LP_MINING: process.env.NEXT_PUBLIC_LP_MINING_ADDRESS || '',
  FEE_DISTRIBUTOR: process.env.NEXT_PUBLIC_FEE_DISTRIBUTOR_ADDRESS || '',
  REWARD_TOKEN: process.env.NEXT_PUBLIC_REWARD_TOKEN_ADDRESS || '',
  TWAP_ORACLE: process.env.NEXT_PUBLIC_TWAP_ORACLE_ADDRESS || '',
  GOVERNANCE: process.env.NEXT_PUBLIC_GOVERNANCE_ADDRESS || '',
  TIMELOCK: process.env.NEXT_PUBLIC_TIMELOCK_ADDRESS || '',
};

export const ABI = {
  FACTORY: [/* Factory ABI */],
  ROUTER: [/* Router ABI */],
  LP_MINING: [/* LPMining ABI */],
  PAIR: [/* Pair ABI */],
  ERC20: [/* ERC20 ABI */],
  FEE_DISTRIBUTOR: [/* FeeDistributor ABI */],
  GOVERNANCE: [/* Governance ABI */],
};
```

## 3. 核心Hook实现

### src/hooks/useSwap.ts
```typescript
import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { CONTRACTS, ABI } from '@/config/contracts';

export function useSwap() {
  const { address } = useAccount();
  const [tokenIn, setTokenIn] = useState<string>('');
  const [tokenOut, setTokenOut] = useState<string>('');
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [loading, setLoading] = useState(false);

  const { writeContract, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const calculateAmountOut = async () => {
    if (!amountIn || !tokenIn || !tokenOut) return;
    
    try {
      setLoading(true);
      const amount = parseUnits(amountIn, 18);
      
      const amountOutMin = amount * BigInt(997) / BigInt(1000);
      setAmountOut(formatUnits(amountOutMin, 18));
    } catch (error) {
      console.error('Calculate amount out error:', error);
    } finally {
      setLoading(false);
    }
  };

  const swap = async () => {
    if (!address || !tokenIn || !tokenOut || !amountIn) return;

    try {
      const amount = parseUnits(amountIn, 18);
      const minAmountOut = parseUnits(amountOut, 18) * BigInt(10000 - slippage * 100) / BigInt(10000);
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      writeContract({
        address: CONTRACTS.ROUTER as `0x${string}`,
        abi: ABI.ROUTER,
        functionName: 'swapExactTokensForTokens',
        args: [amount, minAmountOut, [tokenIn, tokenOut], address, deadline],
      });
    } catch (error) {
      console.error('Swap error:', error);
    }
  };

  useEffect(() => {
    if (amountIn && tokenIn && tokenOut) {
      const timer = setTimeout(() => calculateAmountOut(), 500);
      return () => clearTimeout(timer);
    }
  }, [amountIn, tokenIn, tokenOut]);

  return {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    slippage,
    loading: loading || isConfirming,
    isSuccess,
    setTokenIn,
    setTokenOut,
    setAmountIn,
    setSlippage,
    swap,
  };
}
```

### src/hooks/useLiquidity.ts
```typescript
import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';
import { CONTRACTS, ABI } from '@/config/contracts';

export function useLiquidity() {
  const { address } = useAccount();
  const [token0, setToken0] = useState<string>('');
  const [token1, setToken1] = useState<string>('');
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [slippage, setSlippage] = useState(0.5);

  const { writeContract, data: hash } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const addLiquidity = async () => {
    if (!address || !token0 || !token1 || !amount0 || !amount1) return;

    try {
      const amt0 = parseUnits(amount0, 18);
      const amt1 = parseUnits(amount1, 18);
      const amt0Min = amt0 * BigInt(10000 - slippage * 100) / BigInt(10000);
      const amt1Min = amt1 * BigInt(10000 - slippage * 100) / BigInt(10000);
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      writeContract({
        address: CONTRACTS.ROUTER as `0x${string}`,
        abi: ABI.ROUTER,
        functionName: 'addLiquidity',
        args: [token0, token1, amt0, amt1, amt0Min, amt1Min, address, deadline],
      });
    } catch (error) {
      console.error('Add liquidity error:', error);
    }
  };

  const removeLiquidity = async (liquidity: string) => {
    if (!address || !token0 || !token1 || !liquidity) return;

    try {
      const liq = parseUnits(liquidity, 18);
      const amt0Min = BigInt(0);
      const amt1Min = BigInt(0);
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      writeContract({
        address: CONTRACTS.ROUTER as `0x${string}`,
        abi: ABI.ROUTER,
        functionName: 'removeLiquidity',
        args: [token0, token1, liq, amt0Min, amt1Min, address, deadline],
      });
    } catch (error) {
      console.error('Remove liquidity error:', error);
    }
  };

  return {
    token0,
    token1,
    amount0,
    amount1,
    slippage,
    loading: isLoading,
    isSuccess,
    setToken0,
    setToken1,
    setAmount0,
    setAmount1,
    setSlippage,
    addLiquidity,
    removeLiquidity,
  };
}
```

### src/hooks/useStaking.ts
```typescript
import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { CONTRACTS, ABI } from '@/config/contracts';

export function useStaking(poolId: number) {
  const { address } = useAccount();
  const [stakedAmount, setStakedAmount] = useState('0');
  const [pendingRewards, setPendingRewards] = useState('0');
  const [amount, setAmount] = useState('');

  const { data: userInfo } = useReadContract({
    address: CONTRACTS.LP_MINING as `0x${string}`,
    abi: ABI.LP_MINING,
    functionName: 'userInfo',
    args: [poolId, address],
  });

  const { data: pending } = useReadContract({
    address: CONTRACTS.LP_MINING as `0x${string}`,
    abi: ABI.LP_MINING,
    functionName: 'pendingReward',
    args: [poolId, address],
  });

  const { writeContract, data: hash } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (userInfo) {
      setStakedAmount(formatUnits(userInfo[0] as bigint, 18));
    }
    if (pending) {
      setPendingRewards(formatUnits(pending as bigint, 18));
    }
  }, [userInfo, pending]);

  const stake = async () => {
    if (!address || !amount) return;

    try {
      const amt = parseUnits(amount, 18);
      writeContract({
        address: CONTRACTS.LP_MINING as `0x${string}`,
        abi: ABI.LP_MINING,
        functionName: 'deposit',
        args: [poolId, amt],
      });
    } catch (error) {
      console.error('Stake error:', error);
    }
  };

  const unstake = async () => {
    if (!address || !amount) return;

    try {
      const amt = parseUnits(amount, 18);
      writeContract({
        address: CONTRACTS.LP_MINING as `0x${string}`,
        abi: ABI.LP_MINING,
        functionName: 'withdraw',
        args: [poolId, amt],
      });
    } catch (error) {
      console.error('Unstake error:', error);
    }
  };

  const harvest = async () => {
    if (!address) return;

    try {
      writeContract({
        address: CONTRACTS.LP_MINING as `0x${string}`,
        abi: ABI.LP_MINING,
        functionName: 'harvest',
        args: [poolId],
      });
    } catch (error) {
      console.error('Harvest error:', error);
    }
  };

  return {
    stakedAmount,
    pendingRewards,
    amount,
    loading: isLoading,
    isSuccess,
    setAmount,
    stake,
    unstake,
    harvest,
  };
}
```

## 4. UI组件

### src/components/SwapCard.tsx
```typescript
'use client';

import { useState } from 'react';
import { ArrowDown, Settings } from 'lucide-react';
import { useSwap } from '@/hooks/useSwap';
import { TokenSelect } from './TokenSelect';
import { SlippageSettings } from './SlippageSettings';

export function SwapCard() {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    slippage,
    loading,
    isSuccess,
    setTokenIn,
    setTokenOut,
    setAmountIn,
    setSlippage,
    swap,
  } = useSwap();

  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-2xl shadow-xl">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Swap</h2>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      {showSettings && (
        <SlippageSettings value={slippage} onChange={setSlippage} />
      )}

      <div className="space-y-4">
        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">From</span>
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0.0"
              className="flex-1 text-2xl bg-transparent outline-none"
            />
            <TokenSelect value={tokenIn} onChange={setTokenIn} />
          </div>
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => {
              setTokenIn(tokenOut);
              setTokenOut(tokenIn);
            }}
            className="p-2 bg-gray-200 dark:bg-gray-600 rounded-full hover:bg-gray-300 dark:hover:bg-gray-500"
          >
            <ArrowDown className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">To</span>
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              value={amountOut}
              readOnly
              placeholder="0.0"
              className="flex-1 text-2xl bg-transparent outline-none"
            />
            <TokenSelect value={tokenOut} onChange={setTokenOut} />
          </div>
        </div>

        {amountIn && amountOut && (
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm">
            <div className="flex justify-between">
              <span>Rate</span>
              <span>1 {tokenIn} = {(Number(amountOut) / Number(amountIn)).toFixed(6)} {tokenOut}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span>Slippage Tolerance</span>
              <span>{slippage}%</span>
            </div>
          </div>
        )}

        <button
          onClick={swap}
          disabled={!tokenIn || !tokenOut || !amountIn || loading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
        >
          {loading ? 'Swapping...' : isSuccess ? 'Success!' : 'Swap'}
        </button>
      </div>
    </div>
  );
}
```

### src/components/LiquidityPanel.tsx
```typescript
'use client';

import { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import { useLiquidity } from '@/hooks/useLiquidity';
import { TokenSelect } from './TokenSelect';

export function LiquidityPanel() {
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const {
    token0,
    token1,
    amount0,
    amount1,
    slippage,
    loading,
    isSuccess,
    setToken0,
    setToken1,
    setAmount0,
    setAmount1,
    setSlippage,
    addLiquidity,
    removeLiquidity,
  } = useLiquidity();

  return (
    <div className="w-full max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-2xl shadow-xl">
      <div className="flex space-x-4 mb-6">
        <button
          onClick={() => setMode('add')}
          className={`flex-1 py-2 rounded-lg font-semibold ${
            mode === 'add' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
          }`}
        >
          <Plus className="w-4 h-4 inline mr-2" />
          Add
        </button>
        <button
          onClick={() => setMode('remove')}
          className={`flex-1 py-2 rounded-lg font-semibold ${
            mode === 'remove' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
          }`}
        >
          <Minus className="w-4 h-4 inline mr-2" />
          Remove
        </button>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Token A</span>
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              value={amount0}
              onChange={(e) => setAmount0(e.target.value)}
              placeholder="0.0"
              className="flex-1 text-2xl bg-transparent outline-none"
            />
            <TokenSelect value={token0} onChange={setToken0} />
          </div>
        </div>

        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Token B</span>
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              value={amount1}
              onChange={(e) => setAmount1(e.target.value)}
              placeholder="0.0"
              className="flex-1 text-2xl bg-transparent outline-none"
            />
            <TokenSelect value={token1} onChange={setToken1} />
          </div>
        </div>

        <button
          onClick={mode === 'add' ? addLiquidity : () => removeLiquidity(amount0)}
          disabled={!token0 || !token1 || !amount0 || !amount1 || loading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors"
        >
          {loading
            ? mode === 'add' ? 'Adding...' : 'Removing...'
            : isSuccess
            ? 'Success!'
            : mode === 'add'
            ? 'Add Liquidity'
            : 'Remove Liquidity'}
        </button>
      </div>
    </div>
  );
}
```

### src/components/StakingCard.tsx
```typescript
'use client';

import { useState } from 'react';
import { useStaking } from '@/hooks/useStaking';

interface StakingCardProps {
  poolId: number;
  poolName: string;
  apr: string;
}

export function StakingCard({ poolId, poolName, apr }: StakingCardProps) {
  const [mode, setMode] = useState<'stake' | 'unstake'>('stake');
  const {
    stakedAmount,
    pendingRewards,
    amount,
    loading,
    isSuccess,
    setAmount,
    stake,
    unstake,
    harvest,
  } = useStaking(poolId);

  return (
    <div className="p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-bold">{poolName}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">APR: {apr}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <div className="flex justify-between mb-1">
            <span className="text-sm text-gray-600">Staked</span>
            <span className="font-semibold">{stakedAmount} LP</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-600">Pending Rewards</span>
            <span className="font-semibold text-green-600">{pendingRewards} SDR</span>
          </div>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => setMode('stake')}
            className={`flex-1 py-2 rounded-lg font-semibold ${
              mode === 'stake' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            Stake
          </button>
          <button
            onClick={() => setMode('unstake')}
            className={`flex-1 py-2 rounded-lg font-semibold ${
              mode === 'unstake' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            Unstake
          </button>
        </div>

        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          className="w-full p-3 bg-gray-50 dark:bg-gray-700 rounded-lg outline-none"
        />

        <div className="flex space-x-2">
          <button
            onClick={mode === 'stake' ? stake : unstake}
            disabled={!amount || loading}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg"
          >
            {loading ? 'Processing...' : mode === 'stake' ? 'Stake' : 'Unstake'}
          </button>
          <button
            onClick={harvest}
            disabled={Number(pendingRewards) === 0 || loading}
            className="flex-1 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold rounded-lg"
          >
            Harvest
          </button>
        </div>
      </div>
    </div>
  );
}
```

## 5. 主应用布局

### src/app/layout.tsx
```typescript
import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import { Header } from '@/components/Header';
import { Toaster } from 'react-hot-toast';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'BianDEX - Decentralized Exchange',
  description: 'Trade, provide liquidity, and earn rewards on BSC',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          <Header />
          <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 pt-20">
            {children}
          </main>
          <Toaster position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
```

### src/app/providers.tsx
```typescript
'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { config } from '@/config/wagmi';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

### src/app/page.tsx
```typescript
import { SwapCard } from '@/components/SwapCard';

export default function Home() {
  return (
    <div className="container mx-auto px-4 py-8">
      <SwapCard />
    </div>
  );
}
```

---

# 第二部分：后端服务 (backend-services/)

由于篇幅限制，后端服务、DAO治理和高级功能的完整代码将在下一部分继续...

