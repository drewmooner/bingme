import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const FACTORY_ADDRESS = '0xBABE473c0986bf6A986307Bcf52EAe1C96f921B2';
const WSOMI_ADDRESS = '0xb8DabbA9EAa4957Dce08e31Ad729F89C1F7C88b4';

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
] as const;

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
] as const;

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
] as const;

interface UserSubscription {
  walletAddress: string;
  notificationPermission: 'granted' | 'denied' | 'default';
  tokens: Record<string, {
    address: string;
    symbol: string;
    alertEnabled: boolean;
    thresholdUp?: number;
    thresholdDown?: number;
    poolAddress: string | null;
    baselineUsdPrice?: number;
    baselineUsdValue?: number;
    balance?: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

async function getSomniaPrice(): Promise<number> {
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd';
    const response = await fetch(url);
    if (!response.ok) return 0;
    const data = await response.json();
    return parseFloat(data?.somnia?.usd || '0');
  } catch {
    return 0;
  }
}

async function getTokenPriceFromPool(
  provider: ethers.Provider,
  tokenAddress: string,
  poolAddress: string
): Promise<number> {
  const pair = new ethers.Contract(poolAddress, PAIR_ABI, provider);
  const [token0, token1, reserves] = await Promise.all([
    pair.token0(),
    pair.token1(),
    pair.getReserves(),
  ]);

  const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
  const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
  const [token0Decimals, token1Decimals] = await Promise.all([
    token0Contract.decimals(),
    token1Contract.decimals(),
  ]);

  const isTokenToken0 = tokenAddress.toLowerCase() === token0.toLowerCase();
  const tokenReserve = isTokenToken0 ? reserves[0] : reserves[1];
  const wsomiReserve = isTokenToken0 ? reserves[1] : reserves[0];

  const tokenReserveFormatted = Number(ethers.formatUnits(tokenReserve, isTokenToken0 ? token0Decimals : token1Decimals));
  const wsomiReserveFormatted = Number(ethers.formatUnits(wsomiReserve, isTokenToken0 ? token1Decimals : token0Decimals));

  const priceInWsomi = wsomiReserveFormatted / tokenReserveFormatted;
  const wsomiUsdPrice = await getSomniaPrice();
  if (wsomiUsdPrice === 0) {
    throw new Error('Could not fetch WSOMI USD price');
  }

  return priceInWsomi * wsomiUsdPrice;
}

async function getPoolAddressFromFactory(tokenAddress: string): Promise<string | null> {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    
    // Use Promise.race to add timeout
    let pairAddress = await Promise.race([
      factory.getPair(tokenAddress, WSOMI_ADDRESS),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 30000)
      )
    ]) as string;
    
    if (pairAddress === ethers.ZeroAddress) {
      // Try reverse order with timeout
      pairAddress = await Promise.race([
        factory.getPair(WSOMI_ADDRESS, tokenAddress),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 30000)
        )
      ]) as string;
    }
    
    if (pairAddress === ethers.ZeroAddress) {
      return null;
    }
    
    return pairAddress;
  } catch (error: any) {
    // Suppress timeout errors silently
    if (error?.message?.includes('Timeout') || error?.code === 'TIMEOUT') {
      return null;
    }
    // Only log non-timeout errors
    if (!error?.message?.includes('Timeout')) {
      console.error('Error getting pool address:', error);
    }
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const walletAddress = searchParams.get('address');

    if (!walletAddress) {
      return NextResponse.json(
        { error: 'Wallet address is required' },
        { status: 400 }
      );
    }

    const subscriptionFile = path.join(
      process.cwd(),
      'subscriptions',
      `${walletAddress.toLowerCase()}.json`
    );

    if (!fs.existsSync(subscriptionFile)) {
      return NextResponse.json({ subscription: null });
    }

    const subscription = JSON.parse(fs.readFileSync(subscriptionFile, 'utf-8'));
    return NextResponse.json({ subscription });
  } catch (error: any) {
    console.error('Get subscription error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get subscription' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { walletAddress, tokenAddress, alertEnabled, tokenData } = body;

    if (!walletAddress || !tokenAddress) {
      return NextResponse.json(
        { error: 'Wallet address and token address are required' },
        { status: 400 }
      );
    }

    const subscriptionsDir = path.join(process.cwd(), 'subscriptions');
    const subscriptionFile = path.join(
      subscriptionsDir,
      `${walletAddress.toLowerCase()}.json`
    );

    if (!fs.existsSync(subscriptionFile)) {
      return NextResponse.json(
        { error: 'Subscription not found. Please register first.' },
        { status: 404 }
      );
    }

    const subscription: UserSubscription = JSON.parse(
      fs.readFileSync(subscriptionFile, 'utf-8')
    );

    const normalizedTokenAddress = tokenAddress.toLowerCase();
    const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
    
    // Get or verify pool address
    let poolAddress = tokenData?.poolAddress || null;
    if (!poolAddress || poolAddress === 'null') {
      poolAddress = await getPoolAddressFromFactory(tokenAddress);
    }

    // Default thresholds
    const defaultThresholdUp = 2.0;
    const defaultThresholdDown = 2.0;

    if (subscription.tokens[normalizedTokenAddress]) {
      const token = subscription.tokens[normalizedTokenAddress];
      token.alertEnabled = alertEnabled;
      
      // If enabling alert and no baseline exists, set it now
      if (alertEnabled && (!token.baselineUsdPrice || token.baselineUsdPrice === 0)) {
        if (poolAddress) {
          try {
            const usdPrice = await getTokenPriceFromPool(provider, tokenAddress, poolAddress);
            token.baselineUsdPrice = usdPrice;
            
            // Get balance if we have wallet address
            const ERC20_FULL_ABI = [
              ...ERC20_ABI,
              'function balanceOf(address account) external view returns (uint256)',
            ] as const;
            const tokenContract = new ethers.Contract(tokenAddress, ERC20_FULL_ABI, provider);
            const balance = await tokenContract.balanceOf(walletAddress);
            const decimals = await tokenContract.decimals();
            const balanceFormatted = ethers.formatUnits(balance, decimals);
            token.balance = balanceFormatted;
            token.baselineUsdValue = Number(balanceFormatted) * usdPrice;
          } catch (error) {
            console.error('Error setting baseline:', error);
          }
        }
      }
      
      // Update pool address if not set
      if (poolAddress && !token.poolAddress) {
        token.poolAddress = poolAddress;
      }
      
      // Set default thresholds if not set
      if (!token.thresholdUp) token.thresholdUp = defaultThresholdUp;
      if (!token.thresholdDown) token.thresholdDown = defaultThresholdDown;
    } else if (tokenData) {
      // Add new token to subscription
      let baselineUsdPrice = 0;
      let baselineUsdValue = 0;
      let balance = '0';
      
      if (alertEnabled && poolAddress) {
        try {
          baselineUsdPrice = await getTokenPriceFromPool(provider, tokenAddress, poolAddress);
          
          // Get balance
          const ERC20_FULL_ABI = [
            ...ERC20_ABI,
            'function balanceOf(address account) external view returns (uint256)',
          ] as const;
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_FULL_ABI, provider);
          const tokenBalance = await tokenContract.balanceOf(walletAddress);
          const decimals = await tokenContract.decimals();
          balance = ethers.formatUnits(tokenBalance, decimals);
          baselineUsdValue = Number(balance) * baselineUsdPrice;
        } catch (error) {
          console.error('Error setting baseline for new token:', error);
        }
      }
      
      subscription.tokens[normalizedTokenAddress] = {
        address: tokenData.address,
        symbol: tokenData.symbol,
        alertEnabled: alertEnabled,
        poolAddress: poolAddress,
        thresholdUp: defaultThresholdUp,
        thresholdDown: defaultThresholdDown,
        baselineUsdPrice,
        baselineUsdValue,
        balance,
      };
    } else {
      return NextResponse.json(
        { error: 'Token not found in subscription and tokenData not provided' },
        { status: 404 }
      );
    }

    subscription.updatedAt = new Date().toISOString();
    
    // Atomic write: write to temp file first, then rename
    const tempFile = `${subscriptionFile}.tmp`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(subscription, null, 2), 'utf8');
      fs.renameSync(tempFile, subscriptionFile);
    } catch (error) {
      // Clean up temp file if rename fails
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }

    return NextResponse.json({ success: true, subscription });
  } catch (error: any) {
    console.error('Update subscription error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update subscription' },
      { status: 500 }
    );
  }
}

