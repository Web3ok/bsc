'use client';

import { useState, useEffect } from 'react';
import { Card, CardBody, Input, Button, Select, SelectItem } from '@nextui-org/react';
import { ArrowDownUp, Settings, Info } from 'lucide-react';
import { useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { bsc, bscTestnet } from 'wagmi/chains';

// Network configurations
const NETWORK_CONFIG = {
  [bsc.id]: {
    // BSC Mainnet
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
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
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }, { name: '_spender', type: 'address' }],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: false,
    inputs: [{ name: '_spender', type: 'address' }, { name: '_value', type: 'uint256' }],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
] as const;

// PancakeSwap Router ABI (minimal)
const ROUTER_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactTokensForTokens',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactETHForTokens',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    name: 'swapExactTokensForETH',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
    ],
    name: 'getAmountsOut',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export function SwapInterface() {
  const { address, isConnected, chain } = useAccount();
  const chainId = useChainId();

  // Get network config based on current chain
  const config = NETWORK_CONFIG[chainId as keyof typeof NETWORK_CONFIG] || NETWORK_CONFIG[bsc.id];
  const ROUTER_ADDRESS = config.router;
  const WBNB_ADDRESS = config.wbnb;
  const COMMON_TOKENS = config.tokens;

  const [fromToken, setFromToken] = useState(COMMON_TOKENS[0]);
  const [toToken, setToToken] = useState(COMMON_TOKENS[2]);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [isApproving, setIsApproving] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);

  // Reset tokens when chain changes
  useEffect(() => {
    setFromToken(COMMON_TOKENS[0]);
    setToToken(COMMON_TOKENS[2]);
    setFromAmount('');
    setToAmount('');
  }, [chainId]);

  // Get balance
  const { data: nativeBalance } = useBalance({ address });
  const { data: tokenBalance } = useBalance({
    address,
    token: fromToken.address !== 'NATIVE' ? fromToken.address as `0x${string}` : undefined,
  });

  // Check allowance
  const { data: allowance } = useReadContract({
    address: fromToken.address !== 'NATIVE' ? fromToken.address as `0x${string}` : undefined,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && fromToken.address !== 'NATIVE' ? [address, ROUTER_ADDRESS] : undefined,
  });

  // Get quote
  const { data: amountsOut } = useReadContract({
    address: ROUTER_ADDRESS as `0x${string}`,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: fromAmount && parseFloat(fromAmount) > 0 ? [
      parseUnits(fromAmount, fromToken.decimals),
      (fromToken.address === 'NATIVE'
        ? [WBNB_ADDRESS as `0x${string}`, toToken.address as `0x${string}`]
        : toToken.address === 'NATIVE'
        ? [fromToken.address as `0x${string}`, WBNB_ADDRESS as `0x${string}`]
        : [fromToken.address as `0x${string}`, WBNB_ADDRESS as `0x${string}`, toToken.address as `0x${string}`]) as readonly `0x${string}`[]
    ] : undefined,
  });

  // Write contracts
  const { writeContract: approve, data: approveHash } = useWriteContract();
  const { writeContract: swap, data: swapHash } = useWriteContract();

  // Wait for transactions
  const { isLoading: isApproveLoading } = useWaitForTransactionReceipt({ hash: approveHash });
  const { isLoading: isSwapLoading } = useWaitForTransactionReceipt({ hash: swapHash });

  // Update output amount when quote changes
  useEffect(() => {
    if (amountsOut && Array.isArray(amountsOut) && amountsOut.length > 0) {
      const outputAmount = amountsOut[amountsOut.length - 1];
      setToAmount(formatUnits(outputAmount, toToken.decimals));
    }
  }, [amountsOut, toToken.decimals]);

  // Flip tokens
  const handleFlip = () => {
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
    setFromAmount(toAmount);
    setToAmount('');
  };

  // Approve token
  const handleApprove = async () => {
    if (!address || fromToken.address === 'NATIVE') return;

    setIsApproving(true);
    try {
      await approve({
        address: fromToken.address as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [ROUTER_ADDRESS as `0x${string}`, parseUnits('1000000', fromToken.decimals)],
      } as any);
    } catch (error) {
      console.error('Approve error:', error);
    } finally {
      setIsApproving(false);
    }
  };

  // Execute swap
  const handleSwap = async () => {
    if (!address || !fromAmount || !toAmount) return;

    setIsSwapping(true);
    try {
      const amountIn = parseUnits(fromAmount, fromToken.decimals);
      const amountOutMin = parseUnits(
        (parseFloat(toAmount) * (1 - parseFloat(slippage) / 100)).toFixed(toToken.decimals),
        toToken.decimals
      );
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

      if (fromToken.address === 'NATIVE') {
        // BNB -> Token
        await swap({
          address: ROUTER_ADDRESS,
          abi: ROUTER_ABI,
          functionName: 'swapExactETHForTokens',
          args: [amountOutMin, [WBNB_ADDRESS as `0x${string}`, toToken.address as `0x${string}`] as readonly `0x${string}`[], address, BigInt(deadline)],
          value: amountIn,
        } as any);
      } else if (toToken.address === 'NATIVE') {
        // Token -> BNB
        await swap({
          address: ROUTER_ADDRESS,
          abi: ROUTER_ABI,
          functionName: 'swapExactTokensForETH',
          args: [amountIn, amountOutMin, [fromToken.address as `0x${string}`, WBNB_ADDRESS as `0x${string}`] as readonly `0x${string}`[], address, BigInt(deadline)],
        } as any);
      } else {
        // Token -> Token
        const path = [fromToken.address as `0x${string}`, WBNB_ADDRESS as `0x${string}`, toToken.address as `0x${string}`] as readonly `0x${string}`[];
        await swap({
          address: ROUTER_ADDRESS,
          abi: ROUTER_ABI,
          functionName: 'swapExactTokensForTokens',
          args: [amountIn, amountOutMin, path, address, BigInt(deadline)],
        } as any);
      }
    } catch (error) {
      console.error('Swap error:', error);
    } finally {
      setIsSwapping(false);
    }
  };

  // Check if needs approval
  const needsApproval = fromToken.address !== 'NATIVE' &&
    allowance !== undefined &&
    fromAmount &&
    parseFloat(fromAmount) > 0 &&
    (allowance as bigint) < parseUnits(fromAmount, fromToken.decimals);

  const currentBalance = fromToken.address === 'NATIVE' ? nativeBalance : tokenBalance;
  const isInsufficientBalance = currentBalance && fromAmount &&
    parseFloat(fromAmount) > parseFloat(formatUnits(currentBalance.value, fromToken.decimals));

  return (
    <Card className="max-w-md mx-auto">
      <CardBody className="gap-4">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h3 className="text-xl font-bold">Swap Tokens</h3>
          <Button isIconOnly variant="light" size="sm">
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        {/* From Token */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-default-500">From</span>
            <span className="text-default-500">
              Balance: {currentBalance ? parseFloat(formatUnits(currentBalance.value, fromToken.decimals)).toFixed(4) : '0.0000'}
            </span>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="0.0"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
              classNames={{ input: 'text-2xl' }}
            />
            <Select
              selectedKeys={[fromToken.symbol]}
              onChange={(e) => {
                const token = COMMON_TOKENS.find(t => t.symbol === e.target.value);
                if (token) setFromToken(token);
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

        {/* Flip Button */}
        <div className="flex justify-center">
          <Button isIconOnly variant="bordered" size="sm" onClick={handleFlip}>
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>

        {/* To Token */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-default-500">To</span>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="0.0"
              value={toAmount}
              isReadOnly
              classNames={{ input: 'text-2xl' }}
            />
            <Select
              selectedKeys={[toToken.symbol]}
              onChange={(e) => {
                const token = COMMON_TOKENS.find(t => t.symbol === e.target.value);
                if (token) setToToken(token);
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
        ) : isInsufficientBalance ? (
          <Button color="danger" size="lg" fullWidth disabled>
            Insufficient {fromToken.symbol} Balance
          </Button>
        ) : needsApproval ? (
          <Button
            color="primary"
            size="lg"
            fullWidth
            onClick={handleApprove}
            isLoading={isApproving || isApproveLoading}
          >
            Approve {fromToken.symbol}
          </Button>
        ) : (
          <Button
            color="success"
            size="lg"
            fullWidth
            onClick={handleSwap}
            isLoading={isSwapping || isSwapLoading}
            isDisabled={!fromAmount || !toAmount || parseFloat(fromAmount) <= 0}
          >
            Swap
          </Button>
        )}

        {/* Price Info */}
        {toAmount && fromAmount && parseFloat(fromAmount) > 0 && (
          <div className="text-sm text-default-500 text-center">
            1 {fromToken.symbol} ≈ {(parseFloat(toAmount) / parseFloat(fromAmount)).toFixed(6)} {toToken.symbol}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
