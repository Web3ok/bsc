import { useContractRead, useContractWrite, usePrepareContractWrite } from 'wagmi';
import { parseEther, formatEther } from 'viem';
import { BIANDEX_CONTRACTS, CHAIN_ID_TO_NETWORK } from '@/src/contracts/biandex/config';
import BianDEXRouterABI from '@/src/contracts/biandex/BianDEXRouter.json';
import BianDEXFactoryABI from '@/src/contracts/biandex/BianDEXFactory.json';

export function useBianDEXRouter(chainId?: number) {
  const network = chainId ? CHAIN_ID_TO_NETWORK[chainId as keyof typeof CHAIN_ID_TO_NETWORK] : 'hardhat';
  const routerAddress = BIANDEX_CONTRACTS[network]?.router;

  return {
    address: routerAddress,
    abi: BianDEXRouterABI,
  };
}

export function useBianDEXFactory(chainId?: number) {
  const network = chainId ? CHAIN_ID_TO_NETWORK[chainId as keyof typeof CHAIN_ID_TO_NETWORK] : 'hardhat';
  const factoryAddress = BIANDEX_CONTRACTS[network]?.factory;

  return {
    address: factoryAddress,
    abi: BianDEXFactoryABI,
  };
}

export function useSwap(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: string,
  minAmountOut: string,
  deadline: number,
  chainId?: number
) {
  const router = useBianDEXRouter(chainId);

  const { config } = usePrepareContractWrite({
    address: router.address as `0x${string}`,
    abi: router.abi as any,
    functionName: 'swapExactTokensForTokens',
    args: [
      parseEther(amountIn),
      parseEther(minAmountOut),
      [tokenIn, tokenOut],
      deadline,
    ],
    enabled: !!tokenIn && !!tokenOut && !!amountIn && !!minAmountOut,
  });

  const { write, data, isLoading, isSuccess, error } = useContractWrite(config);

  return {
    swap: write,
    data,
    isLoading,
    isSuccess,
    error,
  };
}

export function useAddLiquidity(
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  amountA: string,
  amountB: string,
  minAmountA: string,
  minAmountB: string,
  deadline: number,
  chainId?: number
) {
  const router = useBianDEXRouter(chainId);

  const { config } = usePrepareContractWrite({
    address: router.address as `0x${string}`,
    abi: router.abi as any,
    functionName: 'addLiquidity',
    args: [
      tokenA,
      tokenB,
      parseEther(amountA),
      parseEther(amountB),
      parseEther(minAmountA),
      parseEther(minAmountB),
      deadline,
    ],
    enabled: !!tokenA && !!tokenB && !!amountA && !!amountB,
  });

  const { write, data, isLoading, isSuccess, error } = useContractWrite(config);

  return {
    addLiquidity: write,
    data,
    isLoading,
    isSuccess,
    error,
  };
}

export function useRemoveLiquidity(
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  liquidity: string,
  minAmountA: string,
  minAmountB: string,
  deadline: number,
  chainId?: number
) {
  const router = useBianDEXRouter(chainId);

  const { config } = usePrepareContractWrite({
    address: router.address as `0x${string}`,
    abi: router.abi as any,
    functionName: 'removeLiquidity',
    args: [
      tokenA,
      tokenB,
      parseEther(liquidity),
      parseEther(minAmountA),
      parseEther(minAmountB),
      deadline,
    ],
    enabled: !!tokenA && !!tokenB && !!liquidity,
  });

  const { write, data, isLoading, isSuccess, error } = useContractWrite(config);

  return {
    removeLiquidity: write,
    data,
    isLoading,
    isSuccess,
    error,
  };
}

export function useGetPair(
  tokenA: `0x${string}`,
  tokenB: `0x${string}`,
  chainId?: number
) {
  const factory = useBianDEXFactory(chainId);

  const { data, isError, isLoading } = useContractRead({
    address: factory.address as `0x${string}`,
    abi: factory.abi as any,
    functionName: 'getPair',
    args: [tokenA, tokenB],
    enabled: !!tokenA && !!tokenB,
  });

  return {
    pairAddress: (data as unknown) as `0x${string}` | undefined,
    isError,
    isLoading,
  };
}
