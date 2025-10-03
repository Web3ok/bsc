'use client';

import { useState, useEffect } from 'react';
import { Card, CardBody, Input, Button, Select, SelectItem, Tabs, Tab } from '@nextui-org/react';
import { Plus, Minus, Info } from 'lucide-react';
import { useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { parseUnits, formatUnits, Address } from 'viem';
import { bsc, bscTestnet } from 'wagmi/chains';

// Network configurations
const NETWORK_CONFIG = {
  [bsc.id]: {
    // BSC Mainnet
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    factory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    wbnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    tokens: [
      { symbol: 'BNB', address: 'NATIVE', decimals: 18 },
      { symbol: 'WBNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
      { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
      { symbol: 'BUSD', address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', decimals: 18 },
      { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    ]
  },
  [bscTestnet.id]: {
    // BSC Testnet
    router: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
    factory: '0x6725F303b657a9451d8BA641348b6761A6CC7a17',
    wbnb: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
    tokens: [
      { symbol: 'BNB', address: 'NATIVE', decimals: 18 },
      { symbol: 'WBNB', address: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', decimals: 18 },
      { symbol: 'USDT', address: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd', decimals: 18 },
      { symbol: 'BUSD', address: '0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee', decimals: 18 },
      { symbol: 'USDC', address: '0x64544969ed7EBf5f083679233325356EbE738930', decimals: 18 },
    ]
  }
};

// ERC20 ABI (minimal)
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: false,
    inputs: [{ name: '_spender', type: 'address' }, { name: '_value', type: 'uint256' }],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }, { name: '_spender', type: 'address' }],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
  },
] as const;

// PancakeSwap Router ABI (minimal for liquidity)
const ROUTER_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'uint256', name: 'amountADesired', type: 'uint256' },
      { internalType: 'uint256', name: 'amountBDesired', type: 'uint256' },
      { internalType: 'uint256', name: 'amountAMin', type: 'uint256' },
      { internalType: 'uint256', name: 'amountBMin', type: 'uint256' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'addLiquidity',
    outputs: [
      { internalType: 'uint256', name: 'amountA', type: 'uint256' },
      { internalType: 'uint256', name: 'amountB', type: 'uint256' },
      { internalType: 'uint256', name: 'liquidity', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amountTokenDesired', type: 'uint256' },
      { internalType: 'uint256', name: 'amountTokenMin', type: 'uint256' },
      { internalType: 'uint256', name: 'amountETHMin', type: 'uint256' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'addLiquidityETH',
    outputs: [
      { internalType: 'uint256', name: 'amountToken', type: 'uint256' },
      { internalType: 'uint256', name: 'amountETH', type: 'uint256' },
      { internalType: 'uint256', name: 'liquidity', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
      { internalType: 'uint256', name: 'liquidity', type: 'uint256' },
      { internalType: 'uint256', name: 'amountAMin', type: 'uint256' },
      { internalType: 'uint256', name: 'amountBMin', type: 'uint256' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'removeLiquidity',
    outputs: [
      { internalType: 'uint256', name: 'amountA', type: 'uint256' },
      { internalType: 'uint256', name: 'amountB', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// Factory ABI (to get pair address)
const FACTORY_ABI = [
  {
    constant: true,
    inputs: [
      { internalType: 'address', name: 'tokenA', type: 'address' },
      { internalType: 'address', name: 'tokenB', type: 'address' },
    ],
    name: 'getPair',
    outputs: [{ internalType: 'address', name: 'pair', type: 'address' }],
    type: 'function',
  },
] as const;

// Pair ABI (to get reserves and LP balance)
const PAIR_ABI = [
  {
    constant: true,
    inputs: [],
    name: 'getReserves',
    outputs: [
      { internalType: 'uint112', name: 'reserve0', type: 'uint112' },
      { internalType: 'uint112', name: 'reserve1', type: 'uint112' },
      { internalType: 'uint32', name: 'blockTimestampLast', type: 'uint32' },
    ],
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    type: 'function',
  },
] as const;

export function LiquidityInterface() {
  const { address, isConnected, chain } = useAccount();
  const chainId = useChainId();

  // Get network config based on current chain
  const config = NETWORK_CONFIG[chainId as keyof typeof NETWORK_CONFIG] || NETWORK_CONFIG[bsc.id];
  const ROUTER_ADDRESS = config.router;
  const FACTORY_ADDRESS = config.factory;
  const WBNB_ADDRESS = config.wbnb;
  const COMMON_TOKENS = config.tokens;

  const [activeTab, setActiveTab] = useState<'add' | 'remove'>('add');
  const [tokenA, setTokenA] = useState(COMMON_TOKENS[0]);
  const [tokenB, setTokenB] = useState(COMMON_TOKENS[2]);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [slippage, setSlippage] = useState('0.5');

  // Reset tokens when chain changes
  useEffect(() => {
    setTokenA(COMMON_TOKENS[0]);
    setTokenB(COMMON_TOKENS[2]);
    setAmountA('');
    setAmountB('');
  }, [chainId]);

  // Get balances
  const { data: balanceA } = useBalance({
    address,
    token: tokenA.address !== 'NATIVE' ? tokenA.address as Address : undefined,
  });
  const { data: balanceB } = useBalance({
    address,
    token: tokenB.address !== 'NATIVE' ? tokenB.address as Address : undefined,
  });

  // Get pair address
  const { data: pairAddress } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [
      tokenA.address === 'NATIVE' ? WBNB_ADDRESS : tokenA.address,
      tokenB.address === 'NATIVE' ? WBNB_ADDRESS : tokenB.address,
    ] as [Address, Address],
  });

  // Get LP token balance
  const { data: lpBalance } = useReadContract({
    address: pairAddress as Address,
    abi: PAIR_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  });

  // Write contracts
  const { writeContract: approve, data: approveHash } = useWriteContract();
  const { writeContract: addLiquidity, data: addLiquidityHash } = useWriteContract();
  const { writeContract: removeLiquidity, data: removeLiquidityHash } = useWriteContract();

  // Wait for transactions
  const { isLoading: isApproving } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: isAdding } = useWaitForTransactionReceipt({ hash: addLiquidityHash });
  const { isLoading: isRemoving } = useWaitForTransactionReceipt({ hash: removeLiquidityHash });

  // Check allowances
  const { data: allowanceA } = useReadContract({
    address: tokenA.address !== 'NATIVE' ? tokenA.address as Address : undefined,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && tokenA.address !== 'NATIVE' ? [address, ROUTER_ADDRESS] : undefined,
  });

  const { data: allowanceB } = useReadContract({
    address: tokenB.address !== 'NATIVE' ? tokenB.address as Address : undefined,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && tokenB.address !== 'NATIVE' ? [address, ROUTER_ADDRESS] : undefined,
  });

  // Approve token
  const handleApprove = async (token: typeof tokenA) => {
    if (!address || token.address === 'NATIVE') return;

    await approve({
      address: token.address as Address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ROUTER_ADDRESS, parseUnits('1000000', token.decimals)],
    } as any);
  };

  // Add liquidity
  const handleAddLiquidity = async () => {
    if (!address || !amountA || !amountB) return;

    const amountADesired = parseUnits(amountA, tokenA.decimals);
    const amountBDesired = parseUnits(amountB, tokenB.decimals);
    const amountAMin = parseUnits((parseFloat(amountA) * (1 - parseFloat(slippage) / 100)).toFixed(tokenA.decimals), tokenA.decimals);
    const amountBMin = parseUnits((parseFloat(amountB) * (1 - parseFloat(slippage) / 100)).toFixed(tokenB.decimals), tokenB.decimals);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

    if (tokenA.address === 'NATIVE') {
      await addLiquidity({
        address: ROUTER_ADDRESS,
        abi: ROUTER_ABI,
        functionName: 'addLiquidityETH',
        args: [tokenB.address as Address, amountBDesired, amountBMin, amountAMin, address, deadline],
        value: amountADesired,
      } as any);
    } else if (tokenB.address === 'NATIVE') {
      await addLiquidity({
        address: ROUTER_ADDRESS,
        abi: ROUTER_ABI,
        functionName: 'addLiquidityETH',
        args: [tokenA.address as Address, amountADesired, amountAMin, amountBMin, address, deadline],
        value: amountBDesired,
      } as any);
    } else {
      await addLiquidity({
        address: ROUTER_ADDRESS,
        abi: ROUTER_ABI,
        functionName: 'addLiquidity',
        args: [
          tokenA.address as Address,
          tokenB.address as Address,
          amountADesired,
          amountBDesired,
          amountAMin,
          amountBMin,
          address,
          deadline,
        ],
      } as any);
    }
  };

  // Remove liquidity
  const handleRemoveLiquidity = async () => {
    if (!address || !amountA || !pairAddress) return;

    const liquidity = parseUnits(amountA, 18); // LP tokens are always 18 decimals
    const amountAMin = BigInt(0);
    const amountBMin = BigInt(0);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

    await removeLiquidity({
      address: ROUTER_ADDRESS,
      abi: ROUTER_ABI,
      functionName: 'removeLiquidity',
      args: [
        tokenA.address === 'NATIVE' ? WBNB_ADDRESS : (tokenA.address as Address),
        tokenB.address === 'NATIVE' ? WBNB_ADDRESS : (tokenB.address as Address),
        liquidity,
        amountAMin,
        amountBMin,
        address,
        deadline,
      ],
    } as any);
  };

  // Check if needs approval for adding liquidity
  const needsApprovalA = tokenA.address !== 'NATIVE' && allowanceA !== undefined && amountA && parseFloat(amountA) > 0 && (allowanceA as bigint) < parseUnits(amountA, tokenA.decimals);
  const needsApprovalB = tokenB.address !== 'NATIVE' && allowanceB !== undefined && amountB && parseFloat(amountB) > 0 && (allowanceB as bigint) < parseUnits(amountB, tokenB.decimals);

  return (
    <Card className="max-w-md mx-auto">
      <CardBody className="gap-4">
        {/* Header with Tabs */}
        <Tabs selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(key as 'add' | 'remove')}>
          <Tab key="add" title={<div className="flex items-center gap-2"><Plus className="h-4 w-4" />Add Liquidity</div>} />
          <Tab key="remove" title={<div className="flex items-center gap-2"><Minus className="h-4 w-4" />Remove Liquidity</div>} />
        </Tabs>

        {activeTab === 'add' ? (
          <>
            {/* Token A Input */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-default-500">Token A</span>
                <span className="text-default-500">
                  Balance: {balanceA ? parseFloat(formatUnits(balanceA.value, tokenA.decimals)).toFixed(4) : '0.0000'}
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="0.0"
                  value={amountA}
                  onChange={(e) => setAmountA(e.target.value)}
                />
                <Select
                  selectedKeys={[tokenA.symbol]}
                  onChange={(e) => {
                    const token = COMMON_TOKENS.find(t => t.symbol === e.target.value);
                    if (token) setTokenA(token);
                  }}
                  className="w-32"
                >
                  {COMMON_TOKENS.map((token) => (
                    <SelectItem key={token.symbol} value={token.symbol}>
                      {token.symbol}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex justify-center">
              <Plus className="h-4 w-4 text-default-400" />
            </div>

            {/* Token B Input */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-default-500">Token B</span>
                <span className="text-default-500">
                  Balance: {balanceB ? parseFloat(formatUnits(balanceB.value, tokenB.decimals)).toFixed(4) : '0.0000'}
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="0.0"
                  value={amountB}
                  onChange={(e) => setAmountB(e.target.value)}
                />
                <Select
                  selectedKeys={[tokenB.symbol]}
                  onChange={(e) => {
                    const token = COMMON_TOKENS.find(t => t.symbol === e.target.value);
                    if (token) setTokenB(token);
                  }}
                  className="w-32"
                >
                  {COMMON_TOKENS.map((token) => (
                    <SelectItem key={token.symbol} value={token.symbol}>
                      {token.symbol}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>

            {/* Slippage */}
            <div className="flex items-center gap-2 text-sm text-default-500">
              <Info className="h-4 w-4" />
              <span>Slippage Tolerance:</span>
              <Input
                type="number"
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
                size="sm"
                className="w-20"
                endContent="%"
              />
            </div>

            {/* Action Buttons */}
            {!isConnected ? (
              <Button color="primary" size="lg" fullWidth disabled>
                Connect Wallet First
              </Button>
            ) : chain?.id !== bsc.id ? (
              <Button color="warning" size="lg" fullWidth disabled>
                Switch to BSC Mainnet
              </Button>
            ) : needsApprovalA ? (
              <Button color="primary" size="lg" fullWidth onClick={() => handleApprove(tokenA)} isLoading={isApproving}>
                Approve {tokenA.symbol}
              </Button>
            ) : needsApprovalB ? (
              <Button color="primary" size="lg" fullWidth onClick={() => handleApprove(tokenB)} isLoading={isApproving}>
                Approve {tokenB.symbol}
              </Button>
            ) : (
              <Button
                color="success"
                size="lg"
                fullWidth
                onClick={handleAddLiquidity}
                isLoading={isAdding}
                isDisabled={!amountA || !amountB || parseFloat(amountA) <= 0 || parseFloat(amountB) <= 0}
              >
                Add Liquidity
              </Button>
            )}
          </>
        ) : (
          <>
            {/* Remove Liquidity */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-default-500">LP Tokens</span>
                <span className="text-default-500">
                  Balance: {lpBalance ? parseFloat(formatUnits(lpBalance as bigint, 18)).toFixed(6) : '0.000000'}
                </span>
              </div>
              <Input
                type="number"
                placeholder="0.0"
                value={amountA}
                onChange={(e) => setAmountA(e.target.value)}
                description={`${tokenA.symbol}-${tokenB.symbol} LP`}
              />
            </div>

            <div className="text-sm text-default-500">
              <Info className="h-4 w-4 inline mr-1" />
              You will receive both {tokenA.symbol} and {tokenB.symbol}
            </div>

            {/* Action Button */}
            {!isConnected ? (
              <Button color="primary" size="lg" fullWidth disabled>
                Connect Wallet First
              </Button>
            ) : !pairAddress || pairAddress === '0x0000000000000000000000000000000000000000' ? (
              <Button color="warning" size="lg" fullWidth disabled>
                Pair Does Not Exist
              </Button>
            ) : (
              <Button
                color="danger"
                size="lg"
                fullWidth
                onClick={handleRemoveLiquidity}
                isLoading={isRemoving}
                isDisabled={!amountA || parseFloat(amountA) <= 0}
              >
                Remove Liquidity
              </Button>
            )}
          </>
        )}

        {/* LP Info */}
        {pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' && (
          <div className="text-sm text-default-500 text-center">
            Your LP Tokens: {lpBalance ? parseFloat(formatUnits(lpBalance as bigint, 18)).toFixed(6) : '0.000000'}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
