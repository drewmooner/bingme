import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';

// Load addresses from deployment files
const factoryRouterPath = path.join(__dirname, '../factory-router-deployment.json');
const deploymentsPath = path.join(__dirname, '../deployments.json');
const poolsPath = path.join(__dirname, '../pools.json');

if (!fs.existsSync(factoryRouterPath)) {
  throw new Error('factory-router-deployment.json not found. Please deploy Factory and Router first.');
}
if (!fs.existsSync(deploymentsPath)) {
  throw new Error('deployments.json not found. Please deploy tokens first.');
}
if (!fs.existsSync(poolsPath)) {
  throw new Error('pools.json not found. Please create pools first.');
}

const factoryRouterDeployment = JSON.parse(fs.readFileSync(factoryRouterPath, 'utf-8'));
const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));
const pools = JSON.parse(fs.readFileSync(poolsPath, 'utf-8'));

const FACTORY_ADDRESS = factoryRouterDeployment.factory;
const WSOMI_ADDRESS = deployments.deployments.WSOMI;

// CoinGecko API
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const SOMNIA_COIN_ID = 'somnia';

// ERC20 ABI
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
] as const;

// Pair ABI
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
] as const;

// Factory ABI
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
] as const;

interface TokenConfig {
  thresholdUp?: number; // % threshold for price increase (default: 2%)
  thresholdDown?: number; // % threshold for price decrease (default: 2%)
}

interface SubscriptionToken {
  address: string;
  symbol: string;
  balance: string;
  baselineUsdPrice: number;
  baselineUsdValue: number;
  thresholdUp: number;
  thresholdDown: number;
  poolAddress: string;
}

interface UserSubscription {
  walletAddress: string;
  chatId?: string; // Telegram chat ID for notifications
  tokens: Record<string, SubscriptionToken>;
  subscribedPools: string[];
  createdAt: string;
  updatedAt: string;
}

async function getSomniaPrice(): Promise<number> {
  try {
    const url = `${COINGECKO_API}/simple/price?ids=${SOMNIA_COIN_ID}&vs_currencies=usd`;
    const response = await fetch(url);
    if (!response.ok) return 0;
    const data = await response.json();
    return parseFloat(data?.[SOMNIA_COIN_ID]?.usd || '0');
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

  // Price = WSOMI reserve / Token reserve
  const priceInWsomi = wsomiReserveFormatted / tokenReserveFormatted;

  // Get WSOMI USD price
  const wsomiUsdPrice = await getSomniaPrice();
  if (wsomiUsdPrice === 0) {
    throw new Error('Could not fetch WSOMI USD price from CoinGecko');
  }

  return priceInWsomi * wsomiUsdPrice;
}

async function main() {
  const walletAddress = process.argv[2];
  if (!walletAddress || !ethers.isAddress(walletAddress)) {
    throw new Error('Please provide a valid wallet address: npm run subscribe-user <wallet_address> [chat_id] [threshold_up] [threshold_down]');
  }

  const chatId = process.argv[3] || undefined;
  const thresholdUp = process.argv[4] ? parseFloat(process.argv[4]) : 2.0;
  const thresholdDown = process.argv[5] ? parseFloat(process.argv[5]) : 2.0;

  if (thresholdUp < 2.0 || thresholdDown < 2.0) {
    throw new Error('Thresholds must be at least 2%');
  }

  console.log('📝 Creating User Subscription\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Wallet: ${walletAddress}`);
  console.log(`Default Threshold Up: ${thresholdUp}%`);
  console.log(`Default Threshold Down: ${thresholdDown}%`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);

  // Get WSOMI USD price
  console.log('💵 Fetching WSOMI USD price...');
  const wsomiUsdPrice = await getSomniaPrice();
  if (wsomiUsdPrice === 0) {
    throw new Error('Could not fetch WSOMI USD price from CoinGecko');
  }
  console.log(`   WSOMI/USD: $${wsomiUsdPrice.toFixed(6)}\n`);

  const subscription: UserSubscription = {
    walletAddress,
    chatId,
    tokens: {},
    subscribedPools: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Check each token
  const tokenAddresses = {
    DREW: deployments.deployments.Drew,
    CEEJHAY: deployments.deployments.Ceejhay,
  };

  for (const [tokenName, tokenAddress] of Object.entries(tokenAddresses)) {
    console.log(`📊 Checking ${tokenName}...`);

    // Get token balance
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const [balance, decimals, symbol] = await Promise.all([
      tokenContract.balanceOf(walletAddress),
      tokenContract.decimals(),
      tokenContract.symbol(),
    ]);

    const balanceFormatted = ethers.formatUnits(balance, decimals);
    console.log(`   Balance: ${balanceFormatted} ${symbol}`);

    if (balance === 0n) {
      console.log(`   ⏭️  Skipping (zero balance)\n`);
      continue;
    }

    // Find pool for this token
    let poolAddress: string | null = null;
    for (const pool of pools.pools) {
      if (pool.pair.includes(tokenName)) {
        poolAddress = pool.address;
        break;
      }
    }

    if (!poolAddress) {
      console.log(`   ⚠️  No pool found for ${tokenName}, skipping\n`);
      continue;
    }

    console.log(`   Pool: ${poolAddress}`);

    // Get current price
    const usdPrice = await getTokenPriceFromPool(provider, tokenAddress, poolAddress);
    const usdValue = Number(balanceFormatted) * usdPrice;

    console.log(`   USD Price: $${usdPrice.toFixed(6)}`);
    console.log(`   USD Value: $${usdValue.toFixed(2)}\n`);

    subscription.tokens[tokenName] = {
      address: tokenAddress,
      symbol,
      balance: balanceFormatted,
      baselineUsdPrice: usdPrice,
      baselineUsdValue: usdValue,
      thresholdUp: thresholdUp,
      thresholdDown: thresholdDown,
      poolAddress,
    };

    if (!subscription.subscribedPools.includes(poolAddress)) {
      subscription.subscribedPools.push(poolAddress);
    }
  }

  // Save subscription
  const subscriptionsDir = path.join(__dirname, '../subscriptions');
  if (!fs.existsSync(subscriptionsDir)) {
    fs.mkdirSync(subscriptionsDir, { recursive: true });
  }

  const subscriptionFile = path.join(subscriptionsDir, `${walletAddress.toLowerCase()}.json`);
  fs.writeFileSync(subscriptionFile, JSON.stringify(subscription, null, 2));

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Subscription Created!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📄 Saved to: ${subscriptionFile}`);
  console.log(`📊 Tracking ${Object.keys(subscription.tokens).length} token(s)`);
  console.log(`📡 Monitoring ${subscription.subscribedPools.length} pool(s)`);
  if (chatId) {
    console.log(`💬 Telegram Chat ID: ${chatId}`);
  } else {
    console.log(`⚠️  No Telegram Chat ID set. Add it to subscription file to receive notifications.`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});

