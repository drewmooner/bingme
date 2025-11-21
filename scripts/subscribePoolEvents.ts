import { SDK } from '@somnia-chain/streams';
import { createPublicClient, http, webSocket, Address, Hex } from 'viem';
import { ethers } from 'ethers';

import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

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

const factoryRouterDeployment = JSON.parse(fs.readFileSync(factoryRouterPath, 'utf-8'));
const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));

const FACTORY_ADDRESS = factoryRouterDeployment.factory;
const ROUTER_ADDRESS = factoryRouterDeployment.router;
const WSOMI_ADDRESS = deployments.deployments.WSOMI;

// Get token address from command line argument or use DREW as default
const TOKEN_ADDRESS = process.argv[2] || deployments.deployments.Drew;

// RPC URLs
const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const WS_RPC_URL = RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://');

// Event topics (Uniswap V2 style)
const SWAP_EVENT_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'; // Swap event
const SYNC_EVENT_TOPIC = '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1'; // Sync event

// Factory ABI
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
] as const;

// Pair ABI
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
] as const;

// ERC20 ABI
const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
] as const;

// Router ABI
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
] as const;

// Define Somnia chain (testnet)
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

async function getPoolInfo() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  // Get pair address
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
  let pairAddress = await factory.getPair(TOKEN_ADDRESS, WSOMI_ADDRESS);
  
  if (pairAddress === ethers.ZeroAddress) {
    pairAddress = await factory.getPair(WSOMI_ADDRESS, TOKEN_ADDRESS);
  }
  
  if (pairAddress === ethers.ZeroAddress) {
    throw new Error('Pair does not exist!');
  }
  
  // Get reserves and token info
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const [token0, token1, reserves] = await Promise.all([
    pair.token0(),
    pair.token1(),
    pair.getReserves()
  ]);
  
  const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
  const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
  
  const [token0Symbol, token0Decimals, token1Symbol, token1Decimals] = await Promise.all([
    token0Contract.symbol(),
    token0Contract.decimals(),
    token1Contract.symbol(),
    token1Contract.decimals()
  ]);
  
  const reserve0 = ethers.formatUnits(reserves[0], token0Decimals);
  const reserve1 = ethers.formatUnits(reserves[1], token1Decimals);
  
  // Get quote
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
  const oneToken = ethers.parseUnits('1', token1Decimals);
  const path = token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase() 
    ? [TOKEN_ADDRESS, WSOMI_ADDRESS]
    : [WSOMI_ADDRESS, TOKEN_ADDRESS];
  
  const amountsOut = await router.getAmountsOut(oneToken, path);
  const quote = ethers.formatUnits(amountsOut[1], token0Decimals);
  
  return {
    pairAddress: pairAddress as Address,
    token0: { address: token0, symbol: token0Symbol, decimals: token0Decimals },
    token1: { address: token1, symbol: token1Symbol, decimals: token1Decimals },
    reserves: { reserve0, reserve1 },
    quote: `1 ${token1Symbol} = ${quote} ${token0Symbol}`
  };
}

async function subscribeToPoolEvents() {
  try {
    console.log('🚀 Starting Pool Event Subscription\n');
    
    // Get pool info first
    console.log('📊 Fetching pool information...');
    const poolInfo = await getPoolInfo();
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 POOL INFORMATION:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Pool Address: ${poolInfo.pairAddress}`);
    console.log(`Token0: ${poolInfo.token0.symbol} (${poolInfo.token0.address})`);
    console.log(`Token1: ${poolInfo.token1.symbol} (${poolInfo.token1.address})`);
    console.log(`Reserves:`);
    console.log(`  ${poolInfo.token0.symbol}: ${poolInfo.reserves.reserve0}`);
    console.log(`  ${poolInfo.token1.symbol}: ${poolInfo.reserves.reserve1}`);
    console.log(`Quote: ${poolInfo.quote}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Setup SDK with WebSocket transport for subscriptions
    console.log('🔌 Setting up Somnia Data Streams SDK...');
    console.log(`WebSocket URL: ${WS_RPC_URL}\n`);
    
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
      wallet: undefined // Not needed for subscriptions
    });
    
    console.log('✅ SDK initialized\n');
    
    // Subscribe to Swap events
    console.log('📡 Subscribing to Swap events...');
    const swapSubscription = await sdk.streams.subscribe({
      somniaStreamsEventId: undefined, // Using custom event source
      eventContractSource: poolInfo.pairAddress,
      topicOverrides: [SWAP_EVENT_TOPIC as Hex],
      ethCalls: [], // No additional calls needed for now
      onlyPushChanges: false,
      onData: (data: any) => {
        console.log('\n🔄 SWAP EVENT DETECTED!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Event Data:', JSON.stringify(data, null, 2));
        console.log('Timestamp:', new Date().toISOString());
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      },
      onError: (error: Error) => {
        console.error('❌ Swap subscription error:', error.message || error);
        console.error('Error details:', error);
      }
    });
    
    if (swapSubscription) {
      console.log(`✅ Swap subscription active (ID: ${swapSubscription.subscriptionId})\n`);
    }
    
    // Subscribe to Sync events
    console.log('📡 Subscribing to Sync events...');
    const syncSubscription = await sdk.streams.subscribe({
      somniaStreamsEventId: undefined, // Using custom event source
      eventContractSource: poolInfo.pairAddress,
      topicOverrides: [SYNC_EVENT_TOPIC as Hex],
      ethCalls: [], // No additional calls needed for now
      onlyPushChanges: false,
      onData: (data: any) => {
        console.log('\n🔄 SYNC EVENT DETECTED!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Event Data:', JSON.stringify(data, null, 2));
        console.log('Timestamp:', new Date().toISOString());
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      },
      onError: (error: Error) => {
        console.error('❌ Sync subscription error:', error.message || error);
        console.error('Error details:', error);
      }
    });
    
    if (syncSubscription) {
      console.log(`✅ Sync subscription active (ID: ${syncSubscription.subscriptionId})\n`);
    }
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All subscriptions active!');
    console.log('📡 Listening for events from pool:', poolInfo.pairAddress);
    console.log('⏹️  Press Ctrl+C to stop\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Keep the process alive
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping subscriptions...');
      if (swapSubscription) swapSubscription.unsubscribe();
      if (syncSubscription) syncSubscription.unsubscribe();
      console.log('✅ Subscriptions stopped. Goodbye!');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
subscribeToPoolEvents();

