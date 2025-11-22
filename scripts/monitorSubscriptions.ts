import { SDK } from '@somnia-chain/streams';
import { createPublicClient, webSocket, http, Address, Hex } from 'viem';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const BOT_TOKEN = process.env.BOT_TOKEN;
const TELEGRAM_API = 'https://api.telegram.org/bot';

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN not found in .env file');
}

const WS_RPC_URL = RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://');

// Load deployments
const deploymentsPath = path.join(__dirname, '../deployments.json');
const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));
const WSOMI_ADDRESS = deployments.deployments.WSOMI;

// Event topics
const SWAP_EVENT_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

// ABIs
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

const somniaTestnet = {
  id: 1946,
  name: 'Somnia Testnet',
  network: 'somnia-testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'SOMI',
    symbol: 'SOMI',
  },
  rpcUrls: {
    default: {
      http: [RPC_URL],
      webSocket: [WS_RPC_URL],
    },
    public: {
      http: [RPC_URL],
      webSocket: [WS_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: 'Somnia Explorer',
      url: 'https://explorer.somnia.network',
    },
  },
} as const;

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
  chatId?: string;
  tokens: Record<string, SubscriptionToken>;
  subscribedPools: string[];
  createdAt: string;
  updatedAt: string;
}

async function getSomniaPrice(): Promise<number> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd`;
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
      console.error(`⚠️  Error loading subscription ${file}:`, error);
    }
  }

  return subscriptions;
}

function saveSubscription(subscription: UserSubscription): void {
  const subscriptionsDir = path.join(__dirname, '../subscriptions');
  const subscriptionFile = path.join(subscriptionsDir, `${subscription.walletAddress.toLowerCase()}.json`);
  subscription.updatedAt = new Date().toISOString();
  fs.writeFileSync(subscriptionFile, JSON.stringify(subscription, null, 2));
}

async function checkSubscriptions(poolAddress: string, provider: ethers.Provider): Promise<void> {
  const subscriptions = loadSubscriptions();
  if (subscriptions.size === 0) {
    return;
  }

  // Get WSOMI price once
  const wsomiUsdPrice = await getSomniaPrice();
  if (wsomiUsdPrice === 0) {
    console.log('   ⚠️  Could not fetch WSOMI price, skipping check');
    return;
  }

  // Find which tokens are in this pool
  const pair = new ethers.Contract(poolAddress, PAIR_ABI, provider);
  const [token0, token1] = await Promise.all([pair.token0(), pair.token1()]);

  // Check each subscription
  for (const [walletAddress, subscription] of subscriptions.entries()) {
    // Check if this pool is relevant for this subscription
    const relevantTokens = Object.entries(subscription.tokens).filter(
      ([, token]) => token.poolAddress.toLowerCase() === poolAddress.toLowerCase()
    );

    if (relevantTokens.length === 0) {
      continue;
    }

    for (const [tokenName, tokenData] of relevantTokens) {
      try {
        // Get current price
        const currentUsdPrice = await getTokenPriceFromPool(provider, tokenData.address, poolAddress);

        // Get current balance
        const tokenContract = new ethers.Contract(tokenData.address, ERC20_ABI, provider);
        const balance = await tokenContract.balanceOf(subscription.walletAddress);
        const decimals = await tokenContract.decimals();
        const balanceFormatted = ethers.formatUnits(balance, decimals);
        const currentUsdValue = Number(balanceFormatted) * currentUsdPrice;

        // Calculate change
        const priceChange = ((currentUsdPrice - tokenData.baselineUsdPrice) / tokenData.baselineUsdPrice) * 100;
        const valueChange = ((currentUsdValue - tokenData.baselineUsdValue) / tokenData.baselineUsdValue) * 100;

        // Check thresholds
        let shouldNotify = false;
        let direction = '';
        let changePercent = 0;

        if (valueChange >= tokenData.thresholdUp) {
          shouldNotify = true;
          direction = 'up';
          changePercent = valueChange;
        } else if (valueChange <= -tokenData.thresholdDown) {
          shouldNotify = true;
          direction = 'down';
          changePercent = Math.abs(valueChange);
        }

        if (shouldNotify) {
          const emoji = direction === 'up' ? '📈' : '📉';
          const sign = direction === 'up' ? '+' : '-';
          const message = `${emoji} <b>${tokenData.symbol} Alert</b>\n\n` +
            `Your ${tokenData.symbol} bags have gone ${direction} ${changePercent.toFixed(2)}%\n\n` +
            `Current Value: $${currentUsdValue.toFixed(2)}\n` +
            `Previous Value: $${tokenData.baselineUsdValue.toFixed(2)}\n` +
            `Change: ${sign}$${(currentUsdValue - tokenData.baselineUsdValue).toFixed(2)}\n\n` +
            `Price: $${currentUsdPrice.toFixed(6)} (was $${tokenData.baselineUsdPrice.toFixed(6)})`;

          console.log(`\n📢 Notification for ${subscription.walletAddress}:`);
          console.log(`   ${tokenData.symbol}: ${direction} ${changePercent.toFixed(2)}%`);

          if (subscription.chatId) {
            await sendTelegramMessage(subscription.chatId, message);
            console.log(`   ✅ Telegram notification sent`);
          } else {
            console.log(`   ⚠️  No chat_id set, skipping Telegram notification`);
          }

        }

        // Always update baseline after swap
        tokenData.baselineUsdPrice = currentUsdPrice;
        tokenData.baselineUsdValue = currentUsdValue;
        tokenData.balance = balanceFormatted;
      } catch (error: any) {
        console.error(`   ⚠️  Error checking ${tokenName} for ${walletAddress}: ${error.message}`);
      }
    }

    // Save updated subscription
    saveSubscription(subscription);
  }
}

async function monitorSubscriptions() {
  console.log('🚀 Starting Subscription Monitor\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const subscriptions = loadSubscriptions();
  if (subscriptions.size === 0) {
    console.log('⚠️  No subscriptions found. Run "npm run subscribe-user <wallet>" first.');
    process.exit(0);
  }

  console.log(`📊 Loaded ${subscriptions.size} subscription(s)\n`);

  // Get all unique pool addresses
  const poolAddresses = new Set<string>();
  for (const subscription of subscriptions.values()) {
    for (const poolAddress of subscription.subscribedPools) {
      poolAddresses.add(poolAddress);
    }
  }

  console.log(`📡 Monitoring ${poolAddresses.size} pool(s):`);
  for (const poolAddress of poolAddresses) {
    console.log(`   ${poolAddress}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  console.log(`🔌 Connecting to WebSocket: ${WS_RPC_URL}`);
  console.log(`   HTTP RPC: ${RPC_URL}\n`);
  
  // Try WebSocket first, fall back to HTTP polling if it fails
  let useWebSocket = true;
  let subscriptions_list: any[] = [];
  let publicClient: any = null;

  try {
    console.log('🧪 Attempting WebSocket connection...');
    
    publicClient = createPublicClient({
      chain: somniaTestnet,
      transport: webSocket(WS_RPC_URL, {
        reconnect: false, // Don't auto-reconnect
        retryCount: 0,
        onError: () => {
          // Silently handle WebSocket errors during connection test
        },
      }),
    });
    
    // Test connection with a simple call (with timeout)
    console.log('   Testing connection...');
    try {
      const blockNumber = await Promise.race([
        publicClient.getBlockNumber(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        )
      ]) as bigint;
      console.log(`   ✅ WebSocket connection successful (block: ${blockNumber})\n`);
    } catch (testError: any) {
      // Clean up the client
      if (publicClient) {
        try {
          // Close the transport if possible
          const transport = (publicClient as any).transport;
          if (transport && typeof transport.close === 'function') {
            transport.close();
          }
        } catch {}
      }
      throw new Error(`Connection test failed: ${testError.message}`);
    }

    const sdk = new SDK({
      public: publicClient,
      wallet: undefined,
    });

    console.log('✅ SDK initialized\n');

    // Wait a bit for WebSocket to fully establish
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Subscribe to each pool
    for (const poolAddress of poolAddresses) {
      console.log(`📡 Subscribing to pool: ${poolAddress}`);
      try {
        // Add timeout for subscription
        const subscriptionPromise = sdk.streams.subscribe({
          somniaStreamsEventId: undefined,
          eventContractSource: poolAddress as Address,
          topicOverrides: [SWAP_EVENT_TOPIC as Hex],
          ethCalls: [],
          onlyPushChanges: false,
          onData: async (data: any) => {
            console.log(`\n🔄 Swap detected on pool ${poolAddress}`);
            await checkSubscriptions(poolAddress, provider);
          },
          onError: (error: any) => {
            const errorMsg = error?.message || error?.toString() || JSON.stringify(error);
            console.error(`❌ Subscription error for ${poolAddress}:`, errorMsg);
          },
        });

        const sub = await Promise.race([
          subscriptionPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Subscription timeout after 10s')), 10000)
          )
        ]) as any;

        if (sub) {
          subscriptions_list.push(sub);
          console.log(`   ✅ Subscribed (ID: ${sub.subscriptionId || 'N/A'})`);
        } else {
          console.error(`   ⚠️  Subscription returned null/undefined`);
        }
      } catch (error: any) {
        const errorMsg = error?.message || error?.toString() || JSON.stringify(error);
        console.error(`   ❌ Failed to subscribe: ${errorMsg}`);
        useWebSocket = false;
      }
    }
  } catch (error: any) {
    const errorMsg = error?.message || error?.toString() || JSON.stringify(error);
    console.error(`\n⚠️  WebSocket connection failed: ${errorMsg}`);
    console.error(`   Falling back to HTTP polling...\n`);
    useWebSocket = false;
    
    // Clean up WebSocket client if it was created
    if (publicClient) {
      try {
        publicClient.transport?.close?.();
      } catch {}
      publicClient = null;
    }
  }
  
  // If WebSocket subscriptions failed, fall back to HTTP polling
  if (!useWebSocket || subscriptions_list.length === 0) {
    console.log('⚠️  WebSocket mode unavailable, using HTTP polling fallback...');
    console.log('   (Any WebSocket error messages can be ignored)\n');
    await startHttpPolling(Array.from(poolAddresses), provider);
    return;
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ All subscriptions active!');
  console.log('📡 Listening for swap events (WebSocket)...');
  console.log('⏹️  Press Ctrl+C to stop\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping monitor...');
    for (const sub of subscriptions_list) {
      sub.unsubscribe();
    }
    console.log('✅ Monitor stopped. Goodbye!');
    process.exit(0);
  });
}

async function startHttpPolling(poolAddresses: string[], provider: ethers.Provider): Promise<void> {
  console.log('🔄 Starting HTTP polling mode...');
  console.log(`   Polling interval: 3 seconds`);
  console.log(`   Pools to monitor: ${poolAddresses.length}\n`);

  // Track last checked block for each pool
  const lastCheckedBlocks = new Map<string, number>();
  
  // Initialize last checked blocks to current block
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
  console.log('✅ HTTP polling active!');
  console.log('📡 Checking for swap events every 3 seconds...');
  console.log('⏹️  Press Ctrl+C to stop');
  console.log('💡 Note: Any WebSocket error messages can be safely ignored\n');
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
          // Get Swap events
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
            // If range is too large, query in smaller chunks
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

    // Wait 3 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

monitorSubscriptions().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

