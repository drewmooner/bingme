import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const FACTORY_ADDRESS = '0xBABE473c0986bf6A986307Bcf52EAe1C96f921B2';
const WSOMI_ADDRESS = '0xb8DabbA9EAa4957Dce08e31Ad729F89C1F7C88b4';
const API_URL = process.env.API_URL || 'http://localhost:3000';
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = 'https://api.telegram.org/bot';

const SWAP_EVENT_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

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
  chatId?: string;
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

async function sendTelegramMessage(chatId: string, message: string): Promise<void> {
  if (!BOT_TOKEN) return;
  
  try {
    const url = `${TELEGRAM_API}${BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error(`   ⚠️  Telegram error: ${error.description || 'Unknown error'}`);
    }
  } catch (error: any) {
    console.error(`   ⚠️  Failed to send Telegram message: ${error.message}`);
  }
}

function loadSubscriptions(): Map<string, UserSubscription> {
  const subscriptionsDir = path.join(__dirname, '../subscriptions');
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
  const subscriptionsDir = path.join(__dirname, '../subscriptions');
  const subscriptionFile = path.join(
    subscriptionsDir,
    `${subscription.walletAddress.toLowerCase()}.json`
  );
  subscription.updatedAt = new Date().toISOString();
  
  // Atomic write
  const tempFile = `${subscriptionFile}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(subscription, null, 2), 'utf8');
    fs.renameSync(tempFile, subscriptionFile);
  } catch (error) {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw error;
  }
}

async function addNotification(notification: {
  walletAddress: string;
  tokenSymbol: string;
  direction: 'up' | 'down';
  changePercent: number;
  currentPrice: number;
  currentValue: number;
  previousValue: number;
}): Promise<void> {
  try {
    const response = await fetch(`${API_URL}/api/notifications`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(notification),
    });

    if (!response.ok) {
      console.error(`Failed to add notification: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error adding notification:', error);
  }
}

async function checkSubscriptions(poolAddress: string, provider: ethers.Provider): Promise<void> {
  const subscriptions = loadSubscriptions();
  if (subscriptions.size === 0) {
    return;
  }

  const wsomiUsdPrice = await getSomniaPrice();
  if (wsomiUsdPrice === 0) {
    console.log('   ⚠️  Could not fetch WSOMI price, skipping check');
    return;
  }

  // Check each subscription
  for (const [walletAddress, subscription] of subscriptions.entries()) {
    // Find tokens in this pool with alerts enabled
    const relevantTokens = Object.entries(subscription.tokens).filter(
      ([, token]) =>
        token.alertEnabled &&
        token.poolAddress &&
        token.poolAddress.toLowerCase() === poolAddress.toLowerCase() &&
        token.baselineUsdPrice &&
        token.baselineUsdPrice > 0 &&
        subscription.notificationPermission === 'granted'
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
          const emoji = direction === 'up' ? '📈' : '📉';
          const sign = direction === 'up' ? '+' : '-';
          
          // Add notification to queue (for browser notifications)
          await addNotification({
            walletAddress: subscription.walletAddress,
            tokenSymbol: tokenData.symbol,
            direction,
            changePercent,
            currentPrice: currentUsdPrice,
            currentValue: currentUsdValue,
            previousValue: baselineValue,
          });

          // Send Telegram notification if chatId is set
          if (subscription.chatId && BOT_TOKEN) {
            const telegramMessage = `${emoji} <b>${tokenData.symbol} Alert</b>\n\n` +
              `Your ${tokenData.symbol} bags have gone ${direction} ${changePercent.toFixed(2)}%\n\n` +
              `Current Value: $${currentUsdValue.toFixed(2)}\n` +
              `Previous Value: $${baselineValue.toFixed(2)}\n` +
              `Change: ${sign}$${(currentUsdValue - baselineValue).toFixed(2)}\n\n` +
              `Price: $${currentUsdPrice.toFixed(6)} (was $${tokenData.baselineUsdPrice?.toFixed(6) || 'N/A'})`;
            
            await sendTelegramMessage(subscription.chatId, telegramMessage);
            console.log(`   ✅ Telegram notification sent to chat ${subscription.chatId}`);
          }

          console.log(`📢 Notification queued for ${subscription.walletAddress}: ${tokenData.symbol} ${direction} ${changePercent.toFixed(2)}%`);

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
        console.error(`   ⚠️  Error checking ${tokenData.symbol} for ${walletAddress}: ${error.message}`);
      }
    }

    // Save updated subscription
    saveSubscription(subscription);
  }
}

async function startHttpPolling(poolAddresses: string[], provider: ethers.Provider): Promise<void> {
  console.log('🔄 Starting HTTP polling mode...');
  console.log(`   Polling interval: 5 seconds`);
  console.log(`   Pools to monitor: ${poolAddresses.length}\n`);

  const lastCheckedBlocks = new Map<string, number>();
  
  try {
    const currentBlock = await provider.getBlockNumber();
    for (const poolAddress of poolAddresses) {
      lastCheckedBlocks.set(poolAddress, currentBlock);
    }
    console.log(`   Starting from block: ${currentBlock}\n`);
  } catch (error: any) {
    console.error(`   ❌ Failed to get current block: ${error.message}`);
    process.exit(1);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Server-side monitoring active!');
  console.log('📡 Checking for swap events every 5 seconds...');
  console.log('⏹️  Press Ctrl+C to stop');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let isRunning = true;

  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping monitor...');
    isRunning = false;
    console.log('✅ Monitor stopped. Goodbye!');
    process.exit(0);
  });

  // Polling loop
  while (isRunning) {
    try {
      for (const poolAddress of poolAddresses) {
        const fromBlock = lastCheckedBlocks.get(poolAddress) || 0;
        const toBlock = await provider.getBlockNumber();
        
        if (toBlock > fromBlock) {
          const swapFilter = {
            address: poolAddress,
            topics: [SWAP_EVENT_TOPIC],
            fromBlock: fromBlock + 1,
            toBlock: toBlock,
          };

          try {
            const logs = await provider.getLogs(swapFilter);
            
            if (logs.length > 0) {
              console.log(`\n🔄 Found ${logs.length} swap event(s) on pool ${poolAddress}`);
              await checkSubscriptions(poolAddress, provider);
            }
          } catch (error: any) {
            if (error.message?.includes('query returned more than')) {
              const chunkSize = 1000;
              for (let start = fromBlock + 1; start <= toBlock; start += chunkSize) {
                const end = Math.min(start + chunkSize - 1, toBlock);
                try {
                  const logs = await provider.getLogs({
                    address: poolAddress,
                    topics: [SWAP_EVENT_TOPIC],
                    fromBlock: start,
                    toBlock: end,
                  });
                  
                  if (logs.length > 0) {
                    console.log(`\n🔄 Found ${logs.length} swap event(s) on pool ${poolAddress} (blocks ${start}-${end})`);
                    await checkSubscriptions(poolAddress, provider);
                  }
                } catch (chunkError: any) {
                  console.error(`   ⚠️  Error querying blocks ${start}-${end}: ${chunkError.message}`);
                }
              }
            } else {
              console.error(`   ⚠️  Error getting logs for ${poolAddress}: ${error.message}`);
            }
          }
          
          lastCheckedBlocks.set(poolAddress, toBlock);
        }
      }
    } catch (error: any) {
      console.error(`   ⚠️  Polling error: ${error.message}`);
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

async function monitorBrowserNotifications() {
  console.log('🚀 Starting Browser Notification Monitor\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const subscriptions = loadSubscriptions();
  if (subscriptions.size === 0) {
    console.log('⚠️  No subscriptions found.');
    process.exit(0);
  }

  console.log(`📊 Loaded ${subscriptions.size} subscription(s)\n`);

  // Get all unique pool addresses from subscriptions
  const poolAddresses = new Set<string>();
  for (const subscription of subscriptions.values()) {
    for (const token of Object.values(subscription.tokens)) {
      if (token.alertEnabled && token.poolAddress) {
        poolAddresses.add(token.poolAddress);
      }
    }
  }

  if (poolAddresses.size === 0) {
    console.log('⚠️  No pools to monitor (no active alerts).');
    process.exit(0);
  }

  console.log(`📡 Monitoring ${poolAddresses.size} pool(s):`);
  for (const poolAddress of poolAddresses) {
    console.log(`   ${poolAddress}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  await startHttpPolling(Array.from(poolAddresses), provider);
}

monitorBrowserNotifications().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

