'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardBody, CardHeader, Button, Input, Divider, Modal, ModalContent, ModalHeader, ModalBody, useDisclosure, Chip, Progress, Tabs, Tab } from '@nextui-org/react';
import { Plus as PlusIcon, Minus as MinusIcon, Settings as CogIcon } from 'lucide-react';
import { useAccount, useBalance, useContractRead, useContractWrite, usePrepareContractWrite, useWaitForTransaction, useNetwork } from 'wagmi';
import { parseEther, formatEther, Address } from 'viem';
import { CONTRACTS, ROUTER_ABI, ERC20_ABI, FACTORY_ABI, PAIR_ABI } from '@/src/config/contracts';

interface Token {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  logoURI?: string;
}

interface LiquidityPair {
  token0: Token;
  token1: Token;
  pairAddress: Address;
  balance: string;
  reserve0: string;
  reserve1: string;
  totalSupply: string;
  sharePercent: string;
}

const SUPPORTED_TOKENS: Token[] = [
  { symbol: 'BNB', name: 'BNB', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
  { symbol: 'WBNB', name: 'Wrapped BNB', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
  { symbol: 'USDT', name: 'Tether USD', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
  { symbol: 'BUSD', name: 'Binance USD', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
  { symbol: 'CAKE', name: 'PancakeSwap Token', address: '0x0000000000000000000000000000000000000000' as Address, decimals: 18 },
];

export default function LiquidityInterface() {
  const { address, isConnected } = useAccount();
  const { chain } = useNetwork();
  const { isOpen: isTokenSelectOpen, onOpen: onOpenTokenSelect, onClose: onCloseTokenSelect } = useDisclosure();
  
  const [activeTab, setActiveTab] = useState('add');
  const [tokenA, setTokenA] = useState<Token>(SUPPORTED_TOKENS[0]);
  const [tokenB, setTokenB] = useState<Token>(SUPPORTED_TOKENS[2]);
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [liquidityAmount, setLiquidityAmount] = useState('');
  const [removePercent, setRemovePercent] = useState('50');
  const [selectingTokenFor, setSelectingTokenFor] = useState<'A' | 'B'>('A');
  const [userPairs, setUserPairs] = useState<LiquidityPair[]>([]);
  const [selectedPair, setSelectedPair] = useState<LiquidityPair | null>(null);
  const [deadline, setDeadline] = useState('20');
  const [isApproving, setIsApproving] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  
  // Get network-specific contract addresses
  const networkName = useMemo(() => {
    if (chain?.id === 56) return 'bsc_mainnet';
    if (chain?.id === 97) return 'bsc_testnet';
    return 'localhost';
  }, [chain]);
  
  const routerAddress = CONTRACTS[networkName as keyof typeof CONTRACTS]?.router as Address;
  const factoryAddress = CONTRACTS[networkName as keyof typeof CONTRACTS]?.factory as Address;
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
  const { data: tokenABalance } = useBalance({
    address,
    token: tokenA.symbol === 'BNB' ? undefined : tokenA.address,
    watch: true,
  });
  
  const { data: tokenBBalance } = useBalance({
    address,
    token: tokenB.symbol === 'BNB' ? undefined : tokenB.address,
    watch: true,
  });
  
  // Get pair address
  const { data: pairAddress } = useContractRead({
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: 'getPair',
    args: [
      tokenA.symbol === 'BNB' ? wbnbAddress : tokenA.address,
      tokenB.symbol === 'BNB' ? wbnbAddress : tokenB.address,
    ],
    watch: true,
  });
  
  // Get pair reserves
  const { data: reserves } = useContractRead({
    address: pairAddress as Address,
    abi: PAIR_ABI,
    functionName: 'getReserves',
    enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000',
    watch: true,
  });
  
  // Get pair total supply
  const { data: totalSupply } = useContractRead({
    address: pairAddress as Address,
    abi: PAIR_ABI,
    functionName: 'totalSupply',
    enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000',
    watch: true,
  });
  
  // Get user LP balance
  const { data: lpBalance } = useBalance({
    address,
    token: pairAddress as Address,
    enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000',
    watch: true,
  });
  
  // Calculate optimal amounts for adding liquidity
  useEffect(() => {
    if (reserves && amountA) {
      const [reserve0, reserve1] = reserves as [bigint, bigint];
      if (reserve0 > 0n && reserve1 > 0n) {
        const optimalB = (parseEther(amountA) * reserve1) / reserve0;
        setAmountB(formatEther(optimalB));
      }
    }
  }, [amountA, reserves]);
  
  // Check token approvals
  const { data: tokenAAllowance } = useContractRead({
    address: tokenA.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && routerAddress ? [address, routerAddress] : undefined,
    watch: true,
    enabled: tokenA.symbol !== 'BNB' && !!address,
  });
  
  const { data: tokenBAllowance } = useContractRead({
    address: tokenB.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && routerAddress ? [address, routerAddress] : undefined,
    watch: true,
    enabled: tokenB.symbol !== 'BNB' && !!address,
  });
  
  const { data: lpAllowance } = useContractRead({
    address: pairAddress as Address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && routerAddress ? [address, routerAddress] : undefined,
    watch: true,
    enabled: !!pairAddress && !!address && activeTab === 'remove',
  });
  
  const needsApprovalA = useMemo(() => {
    if (tokenA.symbol === 'BNB') return false;
    if (!tokenAAllowance || !amountA) return false;
    return (tokenAAllowance as bigint) < parseEther(amountA);
  }, [tokenAAllowance, amountA, tokenA]);
  
  const needsApprovalB = useMemo(() => {
    if (tokenB.symbol === 'BNB') return false;
    if (!tokenBAllowance || !amountB) return false;
    return (tokenBAllowance as bigint) < parseEther(amountB);
  }, [tokenBAllowance, amountB, tokenB]);
  
  const needsLPApproval = useMemo(() => {
    if (!lpAllowance || !liquidityAmount) return false;
    return (lpAllowance as bigint) < parseEther(liquidityAmount);
  }, [lpAllowance, liquidityAmount]);
  
  // Prepare approve transactions
  const { config: approveAConfig } = usePrepareContractWrite({
    address: tokenA.address,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [routerAddress, parseEther(amountA || '0')],
    enabled: needsApprovalA && !!amountA,
  });
  
  const { config: approveBConfig } = usePrepareContractWrite({
    address: tokenB.address,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [routerAddress, parseEther(amountB || '0')],
    enabled: needsApprovalB && !!amountB,
  });
  
  const { config: approveLPConfig } = usePrepareContractWrite({
    address: pairAddress as Address,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [routerAddress, parseEther(liquidityAmount || '0')],
    enabled: needsLPApproval && !!liquidityAmount,
  });
  
  const { write: approveAWrite, data: approveAData } = useContractWrite(approveAConfig);
  const { write: approveBWrite, data: approveBData } = useContractWrite(approveBConfig);
  const { write: approveLPWrite, data: approveLPData } = useContractWrite(approveLPConfig);
  
  const { isLoading: isApproveAPending } = useWaitForTransaction({
    hash: approveAData?.hash,
    onSuccess: () => setIsApproving(false),
  });
  
  const { isLoading: isApproveBPending } = useWaitForTransaction({
    hash: approveBData?.hash,
    onSuccess: () => setIsApproving(false),
  });
  
  const { isLoading: isApproveLPPending } = useWaitForTransaction({
    hash: approveLPData?.hash,
    onSuccess: () => setIsApproving(false),
  });
  
  // Prepare add liquidity transaction
  const addFunction = useMemo(() => {
    if (tokenA.symbol === 'BNB' || tokenB.symbol === 'BNB') return 'addLiquidityBNB';
    return 'addLiquidity';
  }, [tokenA, tokenB]);
  
  const { config: addConfig } = usePrepareContractWrite({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: addFunction,
    args: (() => {
      if (!amountA || !amountB || !address) return undefined;
      
      const deadlineTime = BigInt(Math.floor(Date.now() / 1000) + Number(deadline) * 60);
      
      if (tokenA.symbol === 'BNB') {
        return [
          tokenB.address,
          parseEther(amountB),
          parseEther(amountB) * 95n / 100n, // 5% slippage
          parseEther(amountA) * 95n / 100n,
          address,
          deadlineTime,
        ];
      } else if (tokenB.symbol === 'BNB') {
        return [
          tokenA.address,
          parseEther(amountA),
          parseEther(amountA) * 95n / 100n,
          parseEther(amountB) * 95n / 100n,
          address,
          deadlineTime,
        ];
      } else {
        return [
          tokenA.address,
          tokenB.address,
          parseEther(amountA),
          parseEther(amountB),
          parseEther(amountA) * 95n / 100n,
          parseEther(amountB) * 95n / 100n,
          address,
          deadlineTime,
        ];
      }
    })(),
    value: tokenA.symbol === 'BNB' ? parseEther(amountA || '0') : 
           tokenB.symbol === 'BNB' ? parseEther(amountB || '0') : undefined,
    enabled: !needsApprovalA && !needsApprovalB && !!amountA && !!amountB,
  });
  
  const { write: addWrite, data: addData } = useContractWrite(addConfig);
  
  const { isLoading: isAddPending, isSuccess: isAddSuccess } = useWaitForTransaction({
    hash: addData?.hash,
    onSuccess: () => {
      setIsAdding(false);
      setAmountA('');
      setAmountB('');
    },
  });
  
  // Prepare remove liquidity transaction
  const removeFunction = useMemo(() => {
    if (selectedPair?.token0.symbol === 'BNB' || selectedPair?.token1.symbol === 'BNB') {
      return 'removeLiquidityBNB';
    }
    return 'removeLiquidity';
  }, [selectedPair]);
  
  const { config: removeConfig } = usePrepareContractWrite({
    address: routerAddress,
    abi: ROUTER_ABI,
    functionName: removeFunction,
    args: (() => {
      if (!liquidityAmount || !address || !selectedPair) return undefined;
      
      const deadlineTime = BigInt(Math.floor(Date.now() / 1000) + Number(deadline) * 60);
      const liquidity = parseEther(liquidityAmount);
      
      if (selectedPair.token0.symbol === 'BNB' || selectedPair.token1.symbol === 'BNB') {
        const token = selectedPair.token0.symbol === 'BNB' ? selectedPair.token1 : selectedPair.token0;
        return [
          token.address,
          liquidity,
          0n, // Accept any amount of tokens
          0n, // Accept any amount of BNB
          address,
          deadlineTime,
        ];
      } else {
        return [
          selectedPair.token0.address,
          selectedPair.token1.address,
          liquidity,
          0n, // Accept any amount of tokenA
          0n, // Accept any amount of tokenB
          address,
          deadlineTime,
        ];
      }
    })(),
    enabled: !needsLPApproval && !!liquidityAmount && !!selectedPair,
  });
  
  const { write: removeWrite, data: removeData } = useContractWrite(removeConfig);
  
  const { isLoading: isRemovePending, isSuccess: isRemoveSuccess } = useWaitForTransaction({
    hash: removeData?.hash,
    onSuccess: () => {
      setIsRemoving(false);
      setLiquidityAmount('');
      setRemovePercent('50');
    },
  });
  
  const handleTokenSwitch = () => {
    setTokenA(tokenB);
    setTokenB(tokenA);
    setAmountA('');
    setAmountB('');
  };
  
  const handleTokenSelect = (token: Token) => {
    if (selectingTokenFor === 'A') {
      if (token.address === tokenB.address) {
        handleTokenSwitch();
      } else {
        setTokenA(token);
      }
    } else {
      if (token.address === tokenA.address) {
        handleTokenSwitch();
      } else {
        setTokenB(token);
      }
    }
    onCloseTokenSelect();
  };
  
  const handleApprove = (token: 'A' | 'B' | 'LP') => {
    setIsApproving(true);
    if (token === 'A' && approveAWrite) approveAWrite();
    if (token === 'B' && approveBWrite) approveBWrite();
    if (token === 'LP' && approveLPWrite) approveLPWrite();
  };
  
  const handleAdd = () => {
    if (addWrite) {
      setIsAdding(true);
      addWrite();
    }
  };
  
  const handleRemove = () => {
    if (removeWrite) {
      setIsRemoving(true);
      removeWrite();
    }
  };
  
  const shareOfPool = useMemo(() => {
    if (!lpBalance || !totalSupply || !totalSupply) return '0';
    const share = (Number(lpBalance.formatted) / Number(formatEther(totalSupply as bigint))) * 100;
    return share.toFixed(2);
  }, [lpBalance, totalSupply]);
  
  return (
    <>
      <Card className="max-w-md mx-auto">
        <CardHeader>
          <h3 className="text-lg font-semibold">Liquidity</h3>
        </CardHeader>
        <CardBody className="gap-4">
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={(key) => setActiveTab(key as string)}
            className="w-full"
          >
            <Tab key="add" title="Add Liquidity">
              <div className="space-y-4 mt-4">
                {/* Token A */}
                <div className="bg-default-100 rounded-xl p-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-default-500">Token A</span>
                    <span className="text-sm text-default-500">
                      Balance: {tokenABalance ? Number(tokenABalance.formatted).toFixed(4) : '0.0000'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="0.0"
                      value={amountA}
                      onValueChange={setAmountA}
                      variant="bordered"
                      classNames={{
                        input: "text-xl",
                        inputWrapper: "border-none bg-transparent",
                      }}
                    />
                    <Button
                      variant="flat"
                      onPress={() => {
                        setSelectingTokenFor('A');
                        onOpenTokenSelect();
                      }}
                      className="min-w-[100px]"
                    >
                      {tokenA.symbol}
                    </Button>
                  </div>
                </div>
                
                {/* Plus Icon */}
                <div className="flex justify-center">
                  <div className="p-2 rounded-full bg-default-100">
                    <PlusIcon className="h-5 w-5" />
                  </div>
                </div>
                
                {/* Token B */}
                <div className="bg-default-100 rounded-xl p-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-default-500">Token B</span>
                    <span className="text-sm text-default-500">
                      Balance: {tokenBBalance ? Number(tokenBBalance.formatted).toFixed(4) : '0.0000'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="0.0"
                      value={amountB}
                      onValueChange={setAmountB}
                      variant="bordered"
                      classNames={{
                        input: "text-xl",
                        inputWrapper: "border-none bg-transparent",
                      }}
                    />
                    <Button
                      variant="flat"
                      onPress={() => {
                        setSelectingTokenFor('B');
                        onOpenTokenSelect();
                      }}
                      className="min-w-[100px]"
                    >
                      {tokenB.symbol}
                    </Button>
                  </div>
                </div>
                
                {/* Pool Info */}
                {reserves && (
                  <div className="bg-default-50 rounded-lg p-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-default-500">Pool Reserve</span>
                      <span>
                        {Number(formatEther(reserves[0] as bigint)).toFixed(2)} / {Number(formatEther(reserves[1] as bigint)).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-default-500">Your Share</span>
                      <span>{shareOfPool}%</span>
                    </div>
                  </div>
                )}
                
                {/* Action Button */}
                {!isConnected ? (
                  <Button color="primary" size="lg" isDisabled>
                    Connect Wallet
                  </Button>
                ) : needsApprovalA ? (
                  <Button
                    color="primary"
                    size="lg"
                    onPress={() => handleApprove('A')}
                    isLoading={isApproving || isApproveAPending}
                  >
                    Approve {tokenA.symbol}
                  </Button>
                ) : needsApprovalB ? (
                  <Button
                    color="primary"
                    size="lg"
                    onPress={() => handleApprove('B')}
                    isLoading={isApproving || isApproveBPending}
                  >
                    Approve {tokenB.symbol}
                  </Button>
                ) : (
                  <Button
                    color="primary"
                    size="lg"
                    onPress={handleAdd}
                    isDisabled={!addWrite || !amountA || !amountB}
                    isLoading={isAdding || isAddPending}
                  >
                    {!amountA || !amountB ? 'Enter Amounts' : 'Add Liquidity'}
                  </Button>
                )}
                
                {isAddSuccess && (
                  <Chip color="success" variant="flat">
                    Liquidity Added Successfully!
                  </Chip>
                )}
              </div>
            </Tab>
            
            <Tab key="remove" title="Remove Liquidity">
              <div className="space-y-4 mt-4">
                {/* LP Token Balance */}
                {lpBalance && Number(lpBalance.formatted) > 0 ? (
                  <>
                    <div className="bg-default-100 rounded-xl p-4">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm text-default-500">Your LP Tokens</span>
                        <span className="text-sm">{Number(lpBalance.formatted).toFixed(6)}</span>
                      </div>
                      
                      <div className="mb-4">
                        <div className="flex justify-between mb-2">
                          <span className="text-sm text-default-500">Remove Amount</span>
                          <span className="text-sm">{removePercent}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={removePercent}
                          onChange={(e) => {
                            setRemovePercent(e.target.value);
                            setLiquidityAmount((Number(lpBalance.formatted) * Number(e.target.value) / 100).toString());
                          }}
                          className="w-full"
                        />
                        <div className="flex justify-between mt-2">
                          {['25', '50', '75', '100'].map(percent => (
                            <Button
                              key={percent}
                              size="sm"
                              variant={removePercent === percent ? 'solid' : 'flat'}
                              onPress={() => {
                                setRemovePercent(percent);
                                setLiquidityAmount((Number(lpBalance.formatted) * Number(percent) / 100).toString());
                              }}
                            >
                              {percent}%
                            </Button>
                          ))}
                        </div>
                      </div>
                      
                      <Input
                        type="number"
                        label="LP Tokens to Remove"
                        placeholder="0.0"
                        value={liquidityAmount}
                        onValueChange={setLiquidityAmount}
                        variant="bordered"
                      />
                    </div>
                    
                    {/* Expected Output */}
                    {liquidityAmount && reserves && totalSupply && (
                      <div className="bg-default-50 rounded-lg p-3 space-y-1 text-sm">
                        <div className="font-medium mb-2">You will receive:</div>
                        <div className="flex justify-between">
                          <span className="text-default-500">{tokenA.symbol}</span>
                          <span>
                            ~{((Number(liquidityAmount) / Number(formatEther(totalSupply as bigint))) * Number(formatEther(reserves[0] as bigint))).toFixed(4)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-default-500">{tokenB.symbol}</span>
                          <span>
                            ~{((Number(liquidityAmount) / Number(formatEther(totalSupply as bigint))) * Number(formatEther(reserves[1] as bigint))).toFixed(4)}
                          </span>
                        </div>
                      </div>
                    )}
                    
                    {/* Remove Button */}
                    {needsLPApproval ? (
                      <Button
                        color="primary"
                        size="lg"
                        onPress={() => handleApprove('LP')}
                        isLoading={isApproving || isApproveLPPending}
                      >
                        Approve LP Tokens
                      </Button>
                    ) : (
                      <Button
                        color="primary"
                        size="lg"
                        onPress={handleRemove}
                        isDisabled={!removeWrite || !liquidityAmount || Number(liquidityAmount) === 0}
                        isLoading={isRemoving || isRemovePending}
                      >
                        {!liquidityAmount || Number(liquidityAmount) === 0 
                          ? 'Enter Amount' 
                          : 'Remove Liquidity'}
                      </Button>
                    )}
                    
                    {isRemoveSuccess && (
                      <Chip color="success" variant="flat">
                        Liquidity Removed Successfully!
                      </Chip>
                    )}
                  </>
                ) : (
                  <div className="text-center py-8 text-default-500">
                    No liquidity positions found
                  </div>
                )}
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>
      
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
                  (selectingTokenFor === 'A' && token.address === tokenB.address) ||
                  (selectingTokenFor === 'B' && token.address === tokenA.address)
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