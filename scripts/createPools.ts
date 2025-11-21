import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Factory and Router addresses - will be loaded from deployment file
let FACTORY_ADDRESS: string;
let ROUTER_ADDRESS: string;

// Router ABI
const ROUTER_ABI = [
  'function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)',
  'function factory() external view returns (address)',
  'function WETH() external view returns (address)',
];

// ERC20 ABI
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// Factory ABI
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

// Pair ABI
const PAIR_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

async function getTokenInfo(provider: ethers.Provider, address: string): Promise<TokenInfo> {
  const token = new ethers.Contract(address, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([
    token.symbol(),
    token.decimals(),
  ]);
  return { address, symbol, decimals: Number(decimals) };
}

async function approveToken(
  wallet: ethers.Wallet,
  tokenAddress: string,
  spender: string,
  amount: bigint
): Promise<void> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const symbol = await token.symbol();
  
  console.log(`   Approving ${ethers.formatEther(amount)} ${symbol}...`);
  
  const tx = await token.approve(spender, amount);
  console.log(`   Approval tx: ${tx.hash}`);
  await tx.wait();
  console.log(`   ✅ Approved`);
}

async function addLiquidity(
  router: ethers.Contract,
  wallet: ethers.Wallet,
  tokenA: TokenInfo,
  tokenB: TokenInfo,
  amountA: bigint,
  amountB: bigint
): Promise<{ pairAddress: string; liquidity: bigint }> {
  console.log(`\n💧 Adding liquidity: ${tokenA.symbol}/${tokenB.symbol}`);
  console.log(`   ${tokenA.symbol}: ${ethers.formatEther(amountA)}`);
  console.log(`   ${tokenB.symbol}: ${ethers.formatEther(amountB)}`);

  // Set deadline (1 hour from now)
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  // Approve tokens
  await approveToken(wallet, tokenA.address, ROUTER_ADDRESS, amountA);
  await approveToken(wallet, tokenB.address, ROUTER_ADDRESS, amountB);

  // Add liquidity (allow 1% slippage)
  const amountAMin = (amountA * 99n) / 100n;
  const amountBMin = (amountB * 99n) / 100n;

  console.log(`   Calling addLiquidity...`);
  const tx = await router.addLiquidity(
    tokenA.address,
    tokenB.address,
    amountA,
    amountB,
    amountAMin,
    amountBMin,
    wallet.address,
    deadline
  );

  console.log(`   Transaction hash: ${tx.hash}`);
  console.log(`   Waiting for confirmation...`);
  const receipt = await tx.wait();
  console.log(`   ✅ Liquidity added!`);

  // Wait a bit for the pair to be created
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Get pair address from factory
  const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet.provider);
  let pairAddress = await factory.getPair(tokenA.address, tokenB.address);
  if (pairAddress === ethers.ZeroAddress) {
    pairAddress = await factory.getPair(tokenB.address, tokenA.address);
  }

  // If still zero, try to parse from receipt logs
  if (pairAddress === ethers.ZeroAddress && receipt.logs) {
    const factoryInterface = new ethers.Interface([
      'event PairCreated(address indexed token0, address indexed token1, address pair, uint)'
    ]);
    
    for (const log of receipt.logs) {
      try {
        const parsed = factoryInterface.parseLog(log);
        if (parsed && parsed.name === 'PairCreated') {
          pairAddress = parsed.args.pair;
          break;
        }
      } catch {
        // Not this log, continue
      }
    }
  }

  return {
    pairAddress: pairAddress || '0x0000000000000000000000000000000000000000',
    liquidity: amountA + amountB, // Approximate
  };
}

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY not found in .env');
  }

  // Load Factory and Router addresses from deployment file
  const factoryRouterPath = path.join(__dirname, '../factory-router-deployment.json');
  if (!fs.existsSync(factoryRouterPath)) {
    throw new Error('factory-router-deployment.json not found. Please deploy Factory and Router first using: npm run deploy-hardhat');
  }

  const factoryRouterDeployment = JSON.parse(fs.readFileSync(factoryRouterPath, 'utf-8'));
  FACTORY_ADDRESS = factoryRouterDeployment.factory;
  ROUTER_ADDRESS = factoryRouterDeployment.router;

  if (!FACTORY_ADDRESS || !ROUTER_ADDRESS) {
    throw new Error('Factory or Router address not found in factory-router-deployment.json');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);

  console.log('🚀 Creating Liquidity Pools\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Network: ${RPC_URL}`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Router: ${ROUTER_ADDRESS}`);
  console.log(`Factory: ${FACTORY_ADDRESS}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Load deployed token addresses
  const deploymentsPath = path.join(__dirname, '../deployments.json');
  if (!fs.existsSync(deploymentsPath)) {
    throw new Error('deployments.json not found. Please deploy tokens first.');
  }

  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));
  const wsomiAddress = deployments.deployments.WSOMI;
  const drewAddress = deployments.deployments.Drew;
  const ceejhayAddress = deployments.deployments.Ceejhay;

  if (!wsomiAddress || !drewAddress || !ceejhayAddress) {
    throw new Error('Token addresses not found in deployments.json');
  }

  console.log('📋 Token Addresses:');
  console.log(`   WSOMI: ${wsomiAddress}`);
  console.log(`   DREW: ${drewAddress}`);
  console.log(`   CEEJHAY: ${ceejhayAddress}\n`);

  // Get token info
  const wsomi = await getTokenInfo(provider, wsomiAddress);
  const drew = await getTokenInfo(provider, drewAddress);
  const ceejhay = await getTokenInfo(provider, ceejhayAddress);

  // Check balances
  const wsomiContract = new ethers.Contract(wsomiAddress, ERC20_ABI, provider);
  const drewContract = new ethers.Contract(drewAddress, ERC20_ABI, provider);
  const ceejhayContract = new ethers.Contract(ceejhayAddress, ERC20_ABI, provider);

  const [wsomiBalance, drewBalance, ceejhayBalance] = await Promise.all([
    wsomiContract.balanceOf(wallet.address),
    drewContract.balanceOf(wallet.address),
    ceejhayContract.balanceOf(wallet.address),
  ]);

  console.log('💰 Current Balances:');
  console.log(`   WSOMI: ${ethers.formatEther(wsomiBalance)}`);
  console.log(`   DREW: ${ethers.formatEther(drewBalance)}`);
  console.log(`   CEEJHAY: ${ethers.formatEther(ceejhayBalance)}\n`);

  // Amounts: 50k WSOMI and equivalent of other tokens (1:1 ratio)
  const wsomiAmount = ethers.parseEther('50000'); // 50k WSOMI
  const otherTokenAmount = ethers.parseEther('50000'); // 50k of other token (1:1 ratio)

  // Check if we have enough balance
  if (wsomiBalance < wsomiAmount * 2n) {
    throw new Error(`Insufficient WSOMI balance. Need ${ethers.formatEther(wsomiAmount * 2n)}, have ${ethers.formatEther(wsomiBalance)}`);
  }
  if (drewBalance < otherTokenAmount) {
    throw new Error(`Insufficient DREW balance. Need ${ethers.formatEther(otherTokenAmount)}, have ${ethers.formatEther(drewBalance)}`);
  }
  if (ceejhayBalance < otherTokenAmount) {
    throw new Error(`Insufficient CEEJHAY balance. Need ${ethers.formatEther(otherTokenAmount)}, have ${ethers.formatEther(ceejhayBalance)}`);
  }

  const pools: Array<{ pair: string; address: string }> = [];

  // Create WSOMI/DREW pool
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Creating WSOMI/DREW Pool');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const pool1 = await addLiquidity(router, wallet, wsomi, drew, wsomiAmount, otherTokenAmount);
  pools.push({ pair: 'WSOMI/DREW', address: pool1.pairAddress });
  console.log(`   Pair Address: ${pool1.pairAddress}`);

  // Create WSOMI/CEEJHAY pool
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Creating WSOMI/CEEJHAY Pool');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const pool2 = await addLiquidity(router, wallet, wsomi, ceejhay, wsomiAmount, otherTokenAmount);
  pools.push({ pair: 'WSOMI/CEEJHAY', address: pool2.pairAddress });
  console.log(`   Pair Address: ${pool2.pairAddress}`);

  // Save pool info
  const poolsInfo = {
    network: RPC_URL,
    timestamp: new Date().toISOString(),
    pools: pools,
  };

  const poolsPath = path.join(__dirname, '../pools.json');
  fs.writeFileSync(poolsPath, JSON.stringify(poolsInfo, null, 2));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ POOLS CREATED SUCCESSFULLY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  pools.forEach((pool) => {
    console.log(`${pool.pair}: ${pool.address}`);
  });
  console.log(`\n📄 Pool info saved to: ${poolsPath}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(console.error);

