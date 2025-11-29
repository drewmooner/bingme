import { SDK } from '@somnia-chain/streams';
import { createPublicClient, http, webSocket, Address, Hex } from 'viem';
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

// Load addresses
const factoryRouterPath = path.join(__dirname, '../factory-router-deployment.json');
const deploymentsPath = path.join(__dirname, '../deployments.json');
const poolsPath = path.join(__dirname, '../pools.json');
const ordersPath = path.join(__dirname, '../limit-orders.json');

if (!fs.existsSync(factoryRouterPath)) {
  throw new Error('factory-router-deployment.json not found');
}
if (!fs.existsSync(deploymentsPath)) {
  throw new Error('deployments.json not found');
}

const factoryRouterDeployment = JSON.parse(fs.readFileSync(factoryRouterPath, 'utf-8'));
const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));

const FACTORY_ADDRESS = factoryRouterDeployment.factory;
const ROUTER_ADDRESS = factoryRouterDeployment.router;
const WSOMI_ADDRESS = factoryRouterDeployment.wsomi || deployments.deployments.WSOMI;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY not found in .env file');
}

// Load limit order manager address (will be set after deployment)
let LIMIT_ORDER_MANAGER_ADDRESS = '0x0000000000000000000000000000000000000000';
const limitOrderDeploymentPath = path.join(__dirname, '../limit-order-deployment.json');
if (fs.existsSync(limitOrderDeploymentPath)) {
  const deployment = JSON.parse(fs.readFileSync(limitOrderDeploymentPath, 'utf-8'));
  LIMIT_ORDER_MANAGER_ADDRESS = deployment.contractAddress;
}

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const WS_RPC_URL = RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://');

// Event topics
const SWAP_EVENT_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

// ABIs
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
] as const;

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
] as const;

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function balanceOf(address) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)'
] as const;

const LIMIT_ORDER_ABI = [
  'function execute((address trader, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, uint256 limitPriceE18, uint256 slippageBps, uint256 deadline, uint256 nonce), bytes calldata sig) external returns (uint256 amountOut)',
  'function nonceUsed(address, uint256) external view returns (bool)'
] as const;

const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
] as const;

// Somnia chain config
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
  },
  blockExplorers: {
    default: {
      name: 'Somnia Explorer',
      url: 'https://explorer.somnia.network',
    },
  },
} as const;

interface LimitOrder {
  id: string;
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin: string;
  limitPriceE18: string;
  slippageBps: number;
  deadline: number;
  nonce: number;
  signature: string;
  createdAt: string;
  status: 'pending' | 'executed' | 'canceled' | 'expired';
  orderType: 'buy' | 'sell';
  limitPriceWSOMI: string;
  limitPriceUSD: string;
}

interface OrdersData {
  orders: LimitOrder[];
  lastUpdated: string;
}

// Atomic write function
function atomicWrite(filePath: string, data: any) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

// Load orders
function loadOrders(): OrdersData {
  if (!fs.existsSync(ordersPath)) {
    return { orders: [], lastUpdated: new Date().toISOString() };
  }
  try {
    const content = fs.readFileSync(ordersPath, 'utf-8').trim();
    if (!content || content === '') {
      return { orders: [], lastUpdated: new Date().toISOString() };
    }
    const parsed = JSON.parse(content);
    return parsed.orders ? parsed : { orders: parsed.orders || [], lastUpdated: parsed.lastUpdated || new Date().toISOString() };
  } catch (error) {
    console.error('Error loading orders:', error);
    // If file is corrupted, reset it
    try {
      fs.writeFileSync(ordersPath, JSON.stringify({ orders: [], lastUpdated: new Date().toISOString() }, null, 2));
    } catch {}
    return { orders: [], lastUpdated: new Date().toISOString() };
  }
}

// Save orders
function saveOrders(data: OrdersData) {
  data.lastUpdated = new Date().toISOString();
  atomicWrite(ordersPath, data);
}

// Get pool address for token pair
async function getPoolAddress(tokenA: string, tokenB: string, provider: ethers.Provider): Promise<string> {
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  let pairAddress = await factory.getPair(tokenA, tokenB);
  
  if (pairAddress === ethers.ZeroAddress) {
    pairAddress = await factory.getPair(tokenB, tokenA);
  }
  
  return pairAddress;
}

// Get current price from pool
async function getCurrentPrice(
  tokenIn: string,
  tokenOut: string,
  provider: ethers.Provider
): Promise<{ priceE18: bigint; reserveIn: bigint; reserveOut: bigint }> {
  const poolAddress = await getPoolAddress(tokenIn, tokenOut, provider);
  if (poolAddress === ethers.ZeroAddress) {
    throw new Error('Pool does not exist');
  }

  const pair = new ethers.Contract(poolAddress, PAIR_ABI, provider);
  const [token0, reserves] = await Promise.all([
    pair.token0(),
    pair.getReserves()
  ]);

  const reserve0 = reserves[0];
  const reserve1 = reserves[1];

  // Determine which reserve is which token
  const token0Lower = token0.toLowerCase();
  const tokenInLower = tokenIn.toLowerCase();
  
  let reserveIn: bigint;
  let reserveOut: bigint;

  if (token0Lower === tokenInLower) {
    reserveIn = reserve0;
    reserveOut = reserve1;
  } else {
    reserveIn = reserve1;
    reserveOut = reserve0;
  }

  // Calculate price: (reserveOut / reserveIn) * 1e18
  const priceE18 = (reserveOut * ethers.parseEther('1')) / reserveIn;

  return { priceE18, reserveIn, reserveOut };
}

// Check if order should execute
async function shouldExecuteOrder(
  order: LimitOrder,
  provider: ethers.Provider
): Promise<boolean> {
  try {
    // Check deadline
    if (Date.now() / 1000 > order.deadline) {
      return false;
    }

    // Check if already executed
    if (order.status !== 'pending') {
      return false;
    }

    // Get current price
    const { priceE18 } = await getCurrentPrice(order.tokenIn, order.tokenOut, provider);
    const limitPrice = BigInt(order.limitPriceE18);

    // For buy orders: execute if current price <= limit price
    // For sell orders: execute if current price >= limit price
    if (order.orderType === 'buy') {
      return priceE18 <= limitPrice;
    } else {
      return priceE18 >= limitPrice;
    }
  } catch (error) {
    console.error(`Error checking order ${order.id}:`, error);
    return false;
  }
}

// Execute order
async function executeOrder(order: LimitOrder, provider: ethers.Provider, wallet: ethers.Wallet) {
  try {
    console.log(`\n🔄 Executing order ${order.id}...`);
    console.log(`   Trader: ${order.trader}`);
    console.log(`   Type: ${order.orderType}`);
    console.log(`   ${order.tokenIn} → ${order.tokenOut}`);
    console.log(`   Amount: ${ethers.formatEther(order.amountIn)}`);

    // Check if order is still valid
    const limitOrderContract = new ethers.Contract(
      LIMIT_ORDER_MANAGER_ADDRESS,
      LIMIT_ORDER_ABI,
      wallet
    );

    // Check if nonce is already used
    const isUsed = await limitOrderContract.nonceUsed(order.trader, order.nonce);
    if (isUsed) {
      console.log(`   ⚠️  Order already executed (nonce used)`);
      updateOrderStatus(order.id, 'executed');
      return;
    }

    // Check allowance
    const tokenInContract = new ethers.Contract(order.tokenIn, ERC20_ABI, provider);
    const allowance = await tokenInContract.allowance(order.trader, LIMIT_ORDER_MANAGER_ADDRESS);
    const amountIn = BigInt(order.amountIn);

    if (allowance < amountIn) {
      console.log(`   ⚠️  Insufficient allowance. User needs to approve the contract.`);
      return;
    }

    // Prepare order struct
    const orderStruct = {
      trader: order.trader,
      tokenIn: order.tokenIn,
      tokenOut: order.tokenOut,
      amountIn: amountIn,
      amountOutMin: BigInt(order.amountOutMin),
      limitPriceE18: BigInt(order.limitPriceE18),
      slippageBps: order.slippageBps,
      deadline: order.deadline,
      nonce: order.nonce,
    };

    // Execute
    const tx = await limitOrderContract.execute(orderStruct, order.signature);
    console.log(`   📝 Transaction: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`   ✅ Order executed! Block: ${receipt.blockNumber}`);

    // Update order status
    updateOrderStatus(order.id, 'executed');

    // Send notification
    await sendNotification(order);

  } catch (error: any) {
    console.error(`   ❌ Error executing order:`, error.message);
    if (error.message.includes('expired')) {
      updateOrderStatus(order.id, 'expired');
    } else if (error.message.includes('nonce used')) {
      updateOrderStatus(order.id, 'executed');
    }
  }
}

// Update order status
function updateOrderStatus(orderId: string, status: 'executed' | 'canceled' | 'expired') {
  const data = loadOrders();
  const order = data.orders.find(o => o.id === orderId);
  if (order) {
    order.status = status;
    saveOrders(data);
  }
}

// Send notification when order executes
async function sendNotification(order: LimitOrder) {
  try {
    // Check if user has subscription
    const subscriptionsPath = path.join(__dirname, '../subscriptions');
    if (!fs.existsSync(subscriptionsPath)) {
      return;
    }

    const subscriptionFile = path.join(subscriptionsPath, `${order.trader.toLowerCase()}.json`);
    if (!fs.existsSync(subscriptionFile)) {
      return;
    }

    const subscription = JSON.parse(fs.readFileSync(subscriptionFile, 'utf-8'));
    
    // Create notification
    const notificationsPath = path.join(__dirname, '../notifications');
    if (!fs.existsSync(notificationsPath)) {
      fs.mkdirSync(notificationsPath, { recursive: true });
    }

    const notificationFile = path.join(notificationsPath, `${order.trader.toLowerCase()}.json`);
    let notifications: any[] = [];

    if (fs.existsSync(notificationFile)) {
      notifications = JSON.parse(fs.readFileSync(notificationFile, 'utf-8'));
    }

    const notification = {
      id: `limit-order-${order.id}-${Date.now()}`,
      type: 'limit_order_executed',
      title: 'Limit Order Executed',
      message: `Your ${order.orderType} order for ${ethers.formatEther(order.amountIn)} tokens has been executed successfully!`,
      timestamp: new Date().toISOString(),
      read: false,
      orderId: order.id,
    };

    notifications.unshift(notification);
    // Keep only last 100 notifications
    if (notifications.length > 100) {
      notifications = notifications.slice(0, 100);
    }

    // Atomic write
    const tmpPath = `${notificationFile}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(notifications, null, 2), 'utf-8');
    fs.renameSync(tmpPath, notificationFile);

    console.log(`   📧 Notification saved for ${order.trader}`);
  } catch (error) {
    console.error(`   ⚠️  Error sending notification:`, error);
  }
}

// Monitor swaps and check orders
async function monitorLimitOrders() {
  console.log('🚀 Starting Limit Order Monitor\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Router: ${ROUTER_ADDRESS}`);
  console.log(`WSOMI: ${WSOMI_ADDRESS}`);
  console.log(`Limit Order Manager: ${LIMIT_ORDER_MANAGER_ADDRESS}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (LIMIT_ORDER_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
    console.error('❌ Limit Order Manager not deployed. Please deploy first.');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`✅ Wallet loaded: ${wallet.address}\n`);

  // Load all pools to monitor
  let poolsToMonitor: string[] = [];
  if (fs.existsSync(poolsPath)) {
    const poolsData = JSON.parse(fs.readFileSync(poolsPath, 'utf-8'));
    // Handle both formats: { pools: [...] } or direct array
    const pools = poolsData.pools || poolsData;
    if (Array.isArray(pools)) {
      poolsToMonitor = pools
        .map((p: any) => p.address || p.poolAddress)
        .filter((addr: string) => addr && addr !== 'undefined' && addr !== ethers.ZeroAddress && addr !== null);
    } else {
      poolsToMonitor = Object.values(pools)
        .map((p: any) => p.address || p.poolAddress)
        .filter((addr: string) => addr && addr !== 'undefined' && addr !== ethers.ZeroAddress && addr !== null);
    }
    console.log(`📋 Loaded ${poolsToMonitor.length} pool(s) from pools.json:`, poolsToMonitor);
  }

  // Also get pools from active orders
  const ordersData = loadOrders();
  const activeOrders = ordersData.orders.filter(o => o.status === 'pending');
  
  console.log(`📊 Found ${activeOrders.length} active orders\n`);

  // Get unique pools from orders
  const orderPools = new Set<string>();
  for (const order of activeOrders) {
    try {
      const poolAddress = await getPoolAddress(order.tokenIn, order.tokenOut, provider);
      if (poolAddress !== ethers.ZeroAddress) {
        orderPools.add(poolAddress);
      }
    } catch (error) {
      console.error(`Error getting pool for order ${order.id}:`, error);
    }
  }

  poolsToMonitor = Array.from(new Set([...poolsToMonitor, ...Array.from(orderPools)]));
  
  // Final filter to remove any undefined/null values
  poolsToMonitor = poolsToMonitor.filter(addr => addr && addr !== 'undefined' && addr !== ethers.ZeroAddress && addr !== null);

  if (poolsToMonitor.length === 0) {
    console.log('⚠️  No pools to monitor. Waiting for orders...\n');
  } else {
    console.log(`📡 Monitoring ${poolsToMonitor.length} pool(s):`, poolsToMonitor);
    console.log('');
  }

  // Setup SDK
  const publicClient = createPublicClient({
    chain: somniaTestnet,
    transport: webSocket(WS_RPC_URL, {
      reconnect: true,
      retryCount: 5,
      retryDelay: 1000
    })
  });

  const sdk = new SDK({
    public: publicClient,
    wallet: undefined
  });

  // Subscribe to each pool
  const subscriptions: any[] = [];

  for (const poolAddress of poolsToMonitor) {
    if (!poolAddress || poolAddress === 'undefined' || poolAddress === ethers.ZeroAddress) {
      console.log(`⚠️  Skipping invalid pool address: ${poolAddress}`);
      continue;
    }
    console.log(`📡 Subscribing to pool: ${poolAddress}`);
    
    const subscription = await sdk.streams.subscribe({
      somniaStreamsEventId: undefined,
      eventContractSource: poolAddress as Address,
      topicOverrides: [SWAP_EVENT_TOPIC as Hex],
      ethCalls: [],
      onlyPushChanges: false,
      onData: async (data: any) => {
        console.log(`\n🔄 Swap detected in pool ${poolAddress}`);
        
        // Check all pending orders
        const ordersData = loadOrders();
        const pendingOrders = ordersData.orders.filter(o => o.status === 'pending');

        for (const order of pendingOrders) {
          try {
            // Check if this swap affects this order's pool
            const orderPool = await getPoolAddress(order.tokenIn, order.tokenOut, provider);
            if (orderPool.toLowerCase() === poolAddress.toLowerCase()) {
              // Check if order should execute
              const shouldExecute = await shouldExecuteOrder(order, provider);
              if (shouldExecute) {
                await executeOrder(order, provider, wallet);
              }
            }
          } catch (error) {
            console.error(`Error processing order ${order.id}:`, error);
          }
        }
      },
      onError: (error: Error) => {
        console.error(`❌ Subscription error for ${poolAddress}:`, error.message);
      }
    });

    if (subscription) {
      subscriptions.push(subscription);
      console.log(`   ✅ Subscribed (ID: ${subscription.subscriptionId})`);
    }
  }

  // Periodic check (every 30 seconds) for orders that might have been missed
  setInterval(async () => {
    const ordersData = loadOrders();
    const pendingOrders = ordersData.orders.filter(o => o.status === 'pending');

    for (const order of pendingOrders) {
      try {
        const shouldExecute = await shouldExecuteOrder(order, provider);
        if (shouldExecute) {
          await executeOrder(order, provider, wallet);
        }
      } catch (error) {
        // Silent fail, will retry
      }
    }
  }, 30000);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Limit Order Monitor Active!');
  console.log('📡 Listening for swaps and checking orders...');
  console.log('⏹️  Press Ctrl+C to stop\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping monitor...');
    subscriptions.forEach(sub => sub.unsubscribe());
    console.log('✅ Monitor stopped. Goodbye!');
    process.exit(0);
  });
}

// Run
monitorLimitOrders().catch(console.error);

