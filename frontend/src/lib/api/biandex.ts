const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:10001';

export interface BianDEXStats {
  totalValueLocked: number;
  volume24h: number;
  fees24h: number;
  totalPairs: number;
  totalSwaps: number;
}

export interface BianDEXPool {
  id: string;
  tokenA: string;
  tokenB: string;
  reserveA: string;
  reserveB: string;
  totalSupply: string;
  tvl: number;
  volume24h: number;
  fees24h: number;
}

export async function getBianDEXStats(): Promise<BianDEXStats> {
  try {
    const response = await fetch(`${API_BASE_URL}/biandex/stats`, {
      headers: {
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_API_TOKEN || ''}`,
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch BianDEX stats');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching BianDEX stats:', error);
    return {
      totalValueLocked: 0,
      volume24h: 0,
      fees24h: 0,
      totalPairs: 0,
      totalSwaps: 0,
    };
  }
}

export async function getBianDEXPools(): Promise<BianDEXPool[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/biandex/pools`, {
      headers: {
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_API_TOKEN || ''}`,
      },
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch BianDEX pools');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching BianDEX pools:', error);
    return [];
  }
}

export async function getPoolById(poolId: string): Promise<BianDEXPool | null> {
  try {
    const pools = await getBianDEXPools();
    return pools.find(pool => pool.id === poolId) || null;
  } catch (error) {
    console.error('Error fetching pool:', error);
    return null;
  }
}
