import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const FACTORY_ADDRESS = '0xBABE473c0986bf6A986307Bcf52EAe1C96f921B2';
const WSOMI_ADDRESS = '0xb8DabbA9EAa4957Dce08e31Ad729F89C1F7C88b4';

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
] as const;

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
] as const;

interface SubscriptionToken {
  address: string;
  symbol: string;
  alertEnabled: boolean;
  thresholdUp?: number;
  thresholdDown?: number;
  poolAddress: string | null;
  baselineUsdPrice?: number;
  baselineUsdValue?: number;
  balance?: string;
}

interface UserSubscription {
  walletAddress: string;
  notificationPermission: 'granted' | 'denied' | 'default';
  tokens: Record<string, SubscriptionToken>;
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

function loadSubscriptions(): Map<string, UserSubscription> {
  const subscriptionsDir = path.join(process.cwd(), 'subscriptions');
  if (!fs.existsSync(subscriptionsDir)) {
    return new Map();
  }

  const subscriptions = new Map<string, UserSubscription>();
  const files = fs.readdirSync(subscriptionsDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const filePath = path.join(subscriptionsDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      subscriptions.set(data.walletAddress.toLowerCase(), data);
    } catch (error) {
      console.error(`Error loading subscription ${file}:`, error);
    }
  }

  return subscriptions;
}

function saveSubscription(subscription: UserSubscription): void {
  const subscriptionsDir = path.join(process.cwd(), 'subscriptions');
  const subscriptionFile = path.join(
    subscriptionsDir,
    `${subscription.walletAddress.toLowerCase()}.json`
  );
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
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { poolAddress } = body;

    if (!poolAddress) {
      return NextResponse.json(
        { error: 'Pool address is required' },
        { status: 400 }
      );
    }

    const subscriptions = loadSubscriptions();
    if (subscriptions.size === 0) {
      return NextResponse.json({ notifications: [] });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
      staticNetwork: true,
      batchMaxCount: 1,
    });
    const wsomiUsdPrice = await getSomniaPrice();
    
    if (wsomiUsdPrice === 0) {
      return NextResponse.json(
        { error: 'Could not fetch WSOMI price' },
        { status: 500 }
      );
    }

    const notifications: Array<{
      walletAddress: string;
      tokenSymbol: string;
      direction: 'up' | 'down';
      changePercent: number;
      currentPrice: number;
      currentValue: number;
      previousValue: number;
    }> = [];

    // Check each subscription
    for (const [walletAddress, subscription] of subscriptions.entries()) {
      // Find tokens in this pool
      const relevantTokens = Object.entries(subscription.tokens).filter(
        ([, token]) =>
          token.alertEnabled &&
          token.poolAddress &&
          token.poolAddress.toLowerCase() === poolAddress.toLowerCase() &&
          token.baselineUsdPrice &&
          token.baselineUsdPrice > 0
      );

      if (relevantTokens.length === 0) {
        continue;
      }

      for (const [tokenAddress, tokenData] of relevantTokens) {
        try {
          // Get current price
          const currentUsdPrice = await getTokenPriceFromPool(
            provider,
            tokenData.address,
            poolAddress
          );

          // Get current balance
          const tokenContract = new ethers.Contract(tokenData.address, ERC20_ABI, provider);
          const balance = await tokenContract.balanceOf(subscription.walletAddress);
          const decimals = await tokenContract.decimals();
          const balanceFormatted = ethers.formatUnits(balance, decimals);
          const currentUsdValue = Number(balanceFormatted) * currentUsdPrice;

          // Calculate change
          const baselineValue = tokenData.baselineUsdValue || 0;
          const valueChange = baselineValue > 0
            ? ((currentUsdValue - baselineValue) / baselineValue) * 100
            : 0;

          // Check thresholds
          const thresholdUp = tokenData.thresholdUp || 2.0;
          const thresholdDown = tokenData.thresholdDown || 2.0;

          let shouldNotify = false;
          let direction: 'up' | 'down' | null = null;
          let changePercent = 0;

          if (valueChange >= thresholdUp) {
            shouldNotify = true;
            direction = 'up';
            changePercent = valueChange;
          } else if (valueChange <= -thresholdDown) {
            shouldNotify = true;
            direction = 'down';
            changePercent = Math.abs(valueChange);
          }

          if (shouldNotify && direction) {
            notifications.push({
              walletAddress: subscription.walletAddress,
              tokenSymbol: tokenData.symbol,
              direction,
              changePercent,
              currentPrice: currentUsdPrice,
              currentValue: currentUsdValue,
              previousValue: baselineValue,
            });

            // Update baseline after notification
            tokenData.baselineUsdPrice = currentUsdPrice;
            tokenData.baselineUsdValue = currentUsdValue;
            tokenData.balance = balanceFormatted;
          } else {
            // Update baseline even if no notification (for continuous tracking)
            tokenData.baselineUsdPrice = currentUsdPrice;
            tokenData.baselineUsdValue = currentUsdValue;
            tokenData.balance = balanceFormatted;
          }
        } catch (error: any) {
          console.error(`Error checking ${tokenData.symbol} for ${walletAddress}:`, error.message);
        }
      }

      // Save updated subscription
      saveSubscription(subscription);
    }

    return NextResponse.json({ notifications });
  } catch (error: any) {
    console.error('Monitor error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to monitor pools' },
      { status: 500 }
    );
  }
}

