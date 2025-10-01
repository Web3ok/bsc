'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardBody, CardHeader, Button, Input, Divider, Modal, ModalContent, ModalHeader, ModalBody, useDisclosure, Chip, Spinner } from '@nextui-org/react';
import { ArrowDown as ArrowDownIcon, Settings as CogIcon, CheckCircle as CheckCircleIcon, AlertCircle as ExclamationCircleIcon } from 'lucide-react';
import { useAccount, useBalance, useContractRead, useContractWrite, usePrepareContractWrite, useWaitForTransaction, useNetwork } from 'wagmi';
import { parseEther, formatEther, Address } from 'viem';
import { CONTRACTS, ROUTER_ABI, ERC20_ABI, FACTORY_ABI } from '@/src/config/contracts';

interface Token {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  logoURI?: string;
}

const SUPPORTED_TOKENS: Token[] = [
  { symbol: 'BNB', name: 'BNB', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
  { symbol: 'WBNB', name: 'Wrapped BNB', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
  { symbol: 'USDT', name: 'Tether USD', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
  { symbol: 'BUSD', name: 'Binance USD', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
  { symbol: 'CAKE', name: 'PancakeSwap Token', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
];

export default function SwapInterface() {
  const { address, isConnected } = useAccount();
  const { chain } = useNetwork();
  const { isOpen: isSettingsOpen, onOpen: onOpenSettings, onClose: onCloseSettings } = useDisclosure();
  const { isOpen: isTokenSelectOpen, onOpen: onOpenTokenSelect, onClose: onCloseTokenSelect } = useDisclosure();
  
  const [tokenIn, setTokenIn] = useState<Token>(SUPPORTED_TOKENS[0]);
  const [tokenOut, setTokenOut] = useState<Token>(SUPPORTED_TOKENS[2]);
  const [amountIn, setAmountIn] = useState('');
  const [amountOut, setAmountOut] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [deadline, setDeadline] = useState('20');
  const [selectingTokenFor, setSelectingTokenFor] = useState<'in' | 'out'>('in');
  const [isApproving, setIsApproving] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  
  // Get network-specific contract addresses
  const networkName = useMemo(() => {
    if (chain?.id === 56) return 'bsc_mainnet';
    if (chain?.id === 97) return 'bsc_testnet';
    return 'localhost';
  }, [chain]);
  
  const routerAddress = CONTRACTS[networkName as keyof typeof CONTRACTS]?.router as Address;
  const wbnbAddress = CONTRACTS[networkName as keyof typeof CONTRACTS]?.wbnb as Address;
  
  // Update token addresses based on network
  useEffect(() => {
    const contracts = CONTRACTS[networkName as keyof typeof CONTRACTS];
    if (contracts) {
      SUPPORTED_TOKENS[1].address = contracts.wbnb as Address;
      SUPPORTED_TOKENS[2].address = contracts.usdt as Address;
      SUPPORTED_TOKENS[3].address = contracts.busd as Address;
    }
  }, [networkName]);
  
  // Get token balances
  const { data: tokenInBalance } = useBalance({
    address,
    token: tokenIn.symbol === 'BNB' ? undefined : tokenIn.address,
    watch: true,
  });
  
  const { data: tokenOutBalance } = useBalance({
    address,
    token: tokenOut.symbol === 'BNB' ? undefined : tokenOut.address,
    watch: true,
  });
  
  // Get swap path
  const swapPath = useMemo(() => {
    if (!tokenIn || !tokenOut) return [];
    
    const path: Address[] = [];
    
    // Handle BNB conversions
    const inAddress = tokenIn.symbol === 'BNB' ? wbnbAddress : tokenIn.address;
    const outAddress = tokenOut.symbol === 'BNB' ? wbnbAddress : tokenOut.address;
    
    path.push(inAddress);
    
    // If not a direct pair, route through WBNB
    if (tokenIn.symbol !== 'BNB' && tokenOut.symbol !== 'BNB' && 
        tokenIn.symbol !== 'WBNB' && tokenOut.symbol !== 'WBNB') {
      path.push(wbnbAddress);
    }
    
    if (outAddress !== inAddress) {
      path.push(outAddress);
    }
    
    return path;
  }, [tokenIn, tokenOut, wbnbAddress]);
  
  // Get output amount estimate
  const { data: amountsOut } = useContractRead({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: amountIn && swapPath.length >= 2 ? [parseEther(amountIn), swapPath] : undefined,
    watch: true,
    enabled: !!amountIn && Number(amountIn) > 0 && swapPath.length >= 2,
  });
  
  // Update output amount when estimate changes
  useEffect(() => {
    if (amountsOut && Array.isArray(amountsOut)) {
      const outputAmount = amountsOut[amountsOut.length - 1];
      setAmountOut(formatEther(outputAmount as bigint));
    }
  }, [amountsOut]);
  
  // Check token allowance
  const { data: tokenAllowance } = useContractRead({
    address: tokenIn.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && routerAddress ? [address, routerAddress] : undefined,
    watch: true,
    enabled: tokenIn.symbol !== 'BNB' && !!address,
  });
  
  const needsApproval = useMemo(() => {
    if (tokenIn.symbol === 'BNB') return false;
    if (!tokenAllowance || !amountIn) return false;
    return (tokenAllowance as bigint) < parseEther(amountIn);
  }, [tokenAllowance, amountIn, tokenIn]);
  
  // Prepare approve transaction
  const { config: approveConfig } = usePrepareContractWrite({
    address: tokenIn.address,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [routerAddress, parseEther(amountIn || '0')],
    enabled: needsApproval && !!amountIn,
  });
  
  const { write: approveWrite, data: approveData } = useContractWrite(approveConfig);
  
  const { isLoading: isApprovalPending } = useWaitForTransaction({
    hash: approveData?.hash,
    onSuccess: () => {
      setIsApproving(false);
    },
  });
  
  // Prepare swap transaction
  // PancakeSwap Router uses ETH naming even on BSC
  const swapFunction = useMemo(() => {
    if (tokenIn.symbol === 'BNB') return 'swapExactETHForTokens';
    if (tokenOut.symbol === 'BNB') return 'swapExactTokensForETH';
    return 'swapExactTokensForTokens';
  }, [tokenIn, tokenOut]);
  
  const { config: swapConfig } = usePrepareContractWrite({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: swapFunction,
    args: (() => {
      if (!amountIn || !amountOut || !address) return undefined;
      
      const minAmountOut = parseEther(amountOut) * BigInt(1000 - Number(slippage) * 10) / 1000n;
      const deadlineTime = BigInt(Math.floor(Date.now() / 1000) + Number(deadline) * 60);
      
      if (tokenIn.symbol === 'BNB') {
        return [minAmountOut, swapPath, address, deadlineTime];
      } else {
        return [parseEther(amountIn), minAmountOut, swapPath, address, deadlineTime];
      }
    })(),
    value: tokenIn.symbol === 'BNB' ? parseEther(amountIn || '0') : undefined,
    enabled: !needsApproval && !!amountIn && Number(amountIn) > 0 && !!amountOut,
  });
  
  const { write: swapWrite, data: swapData } = useContractWrite(swapConfig);
  
  const { isLoading: isSwapPending, isSuccess: isSwapSuccess } = useWaitForTransaction({
    hash: swapData?.hash,
    onSuccess: () => {
      setIsSwapping(false);
      setAmountIn('');
      setAmountOut('');
    },
  });
  
  const handleApprove = () => {
    if (approveWrite) {
      setIsApproving(true);
      approveWrite();
    }
  };
  
  const handleSwap = () => {
    if (swapWrite) {
      setIsSwapping(true);
      swapWrite();
    }
  };
  
  const handleTokenSwitch = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn('');
    setAmountOut('');
  };
  
  const handleTokenSelect = (token: Token) => {
    if (selectingTokenFor === 'in') {
      if (token.address === tokenOut.address) {
        handleTokenSwitch();
      } else {
        setTokenIn(token);
      }
    } else {
      if (token.address === tokenIn.address) {
        handleTokenSwitch();
      } else {
        setTokenOut(token);
      }
    }
    onCloseTokenSelect();
  };
  
  const priceImpact = useMemo(() => {
    if (!amountIn || !amountOut || Number(amountIn) === 0) return '0.00';
    // Simplified price impact calculation
    return '< 0.01';
  }, [amountIn, amountOut]);
  
  return (
    <>
      <Card className="max-w-md mx-auto">
        <CardHeader className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Swap</h3>
          <Button
            isIconOnly
            variant="light"
            size="sm"
            onPress={onOpenSettings}
          >
            <CogIcon className="h-5 w-5" />
          </Button>
        </CardHeader>
        <CardBody className="gap-4">
          {/* From Token */}
          <div className="bg-default-100 rounded-xl p-4">
            <div className="flex justify-between mb-2">
              <span className="text-sm text-default-500">From</span>
              <span className="text-sm text-default-500">
                Balance: {tokenInBalance ? Number(tokenInBalance.formatted).toFixed(4) : '0.0000'}
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="0.0"
                value={amountIn}
                onValueChange={setAmountIn}
                variant="bordered"
                classNames={{
                  input: "text-xl",
                  inputWrapper: "border-none bg-transparent",
                }}
              />
              <Button
                variant="flat"
                onPress={() => {
                  setSelectingTokenFor('in');
                  onOpenTokenSelect();
                }}
                className="min-w-[100px]"
              >
                {tokenIn.symbol}
              </Button>
            </div>
            <Button
              size="sm"
              variant="light"
              onPress={() => setAmountIn(tokenInBalance?.formatted || '')}
              className="mt-2"
            >
              MAX
            </Button>
          </div>
          
          {/* Swap Direction Button */}
          <div className="flex justify-center">
            <Button
              isIconOnly
              variant="light"
              onPress={handleTokenSwitch}
            >
              <ArrowDownIcon className="h-5 w-5" />
            </Button>
          </div>
          
          {/* To Token */}
          <div className="bg-default-100 rounded-xl p-4">
            <div className="flex justify-between mb-2">
              <span className="text-sm text-default-500">To</span>
              <span className="text-sm text-default-500">
                Balance: {tokenOutBalance ? Number(tokenOutBalance.formatted).toFixed(4) : '0.0000'}
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                type="number"
                placeholder="0.0"
                value={amountOut}
                isReadOnly
                variant="bordered"
                classNames={{
                  input: "text-xl",
                  inputWrapper: "border-none bg-transparent",
                }}
              />
              <Button
                variant="flat"
                onPress={() => {
                  setSelectingTokenFor('out');
                  onOpenTokenSelect();
                }}
                className="min-w-[100px]"
              >
                {tokenOut.symbol}
              </Button>
            </div>
          </div>
          
          {/* Price Info */}
          {amountIn && amountOut && Number(amountIn) > 0 && (
            <div className="bg-default-50 rounded-lg p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-default-500">Price</span>
                <span>1 {tokenIn.symbol} = {(Number(amountOut) / Number(amountIn)).toFixed(6)} {tokenOut.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-default-500">Price Impact</span>
                <span className="text-success">{priceImpact}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-default-500">Route</span>
                <span>{swapPath.length > 2 ? `${tokenIn.symbol} → WBNB → ${tokenOut.symbol}` : `${tokenIn.symbol} → ${tokenOut.symbol}`}</span>
              </div>
            </div>
          )}
          
          {/* Action Button */}
          {!isConnected ? (
            <Button color="primary" size="lg" isDisabled>
              Connect Wallet
            </Button>
          ) : needsApproval ? (
            <Button
              color="primary"
              size="lg"
              onPress={handleApprove}
              isLoading={isApproving || isApprovalPending}
            >
              Approve {tokenIn.symbol}
            </Button>
          ) : (
            <Button
              color="primary"
              size="lg"
              onPress={handleSwap}
              isDisabled={!swapWrite || !amountIn || Number(amountIn) === 0}
              isLoading={isSwapping || isSwapPending}
            >
              {!amountIn || Number(amountIn) === 0 
                ? 'Enter Amount' 
                : `Swap ${tokenIn.symbol} for ${tokenOut.symbol}`}
            </Button>
          )}
          
          {/* Transaction Status */}
          {isSwapSuccess && (
            <Chip
              startContent={<CheckCircleIcon className="h-4 w-4" />}
              color="success"
              variant="flat"
            >
              Swap Successful!
            </Chip>
          )}
        </CardBody>
      </Card>
      
      {/* Settings Modal */}
      <Modal isOpen={isSettingsOpen} onClose={onCloseSettings} size="sm">
        <ModalContent>
          <ModalHeader>Transaction Settings</ModalHeader>
          <ModalBody className="gap-4 pb-6">
            <div>
              <label className="text-sm text-default-500">
                Slippage Tolerance (%)
              </label>
              <div className="flex gap-2 mt-2">
                {['0.1', '0.5', '1.0'].map(value => (
                  <Button
                    key={value}
                    size="sm"
                    variant={slippage === value ? 'solid' : 'flat'}
                    onPress={() => setSlippage(value)}
                  >
                    {value}%
                  </Button>
                ))}
                <Input
                  type="number"
                  size="sm"
                  value={slippage}
                  onValueChange={setSlippage}
                  endContent={<span className="text-default-500">%</span>}
                  className="w-24"
                />
              </div>
            </div>
            <div>
              <label className="text-sm text-default-500">
                Transaction Deadline (minutes)
              </label>
              <Input
                type="number"
                size="sm"
                value={deadline}
                onValueChange={setDeadline}
                className="mt-2"
              />
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
      
      {/* Token Selection Modal */}
      <Modal isOpen={isTokenSelectOpen} onClose={onCloseTokenSelect} size="sm">
        <ModalContent>
          <ModalHeader>Select Token</ModalHeader>
          <ModalBody className="gap-2 pb-6">
            {SUPPORTED_TOKENS.map(token => (
              <Button
                key={token.symbol}
                variant="flat"
                onPress={() => handleTokenSelect(token)}
                className="justify-start"
                isDisabled={
                  (selectingTokenFor === 'in' && token.address === tokenOut.address) ||
                  (selectingTokenFor === 'out' && token.address === tokenIn.address)
                }
              >
                <div className="flex items-center gap-3 w-full">
                  <div className="w-8 h-8 rounded-full bg-default-200 flex items-center justify-center">
                    {token.symbol.charAt(0)}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-medium">{token.symbol}</div>
                    <div className="text-xs text-default-500">{token.name}</div>
                  </div>
                </div>
              </Button>
            ))}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
}