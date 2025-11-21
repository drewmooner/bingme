import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

// Load addresses from deployment files
const factoryRouterPath = path.join(__dirname, '../factory-router-deployment.json');
const poolsPath = path.join(__dirname, '../pools.json');

if (!fs.existsSync(factoryRouterPath)) {
  throw new Error('factory-router-deployment.json not found. Please deploy Factory and Router first.');
}

const factoryRouterDeployment = JSON.parse(fs.readFileSync(factoryRouterPath, 'utf-8'));
const FACTORY_ADDRESS = factoryRouterDeployment.factory;

// Get pool address from command line argument or pools.json
let POOL_ADDRESS = process.argv[2];
if (!POOL_ADDRESS && fs.existsSync(poolsPath)) {
  const pools = JSON.parse(fs.readFileSync(poolsPath, 'utf-8'));
  if (pools.pools && pools.pools.length > 0) {
    POOL_ADDRESS = pools.pools[0].address; // Use first pool by default
  }
}

if (!POOL_ADDRESS) {
  throw new Error('Pool address not provided. Usage: npm run check-pool <pool-address>');
}

// RPC URL
const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';

// Factory ABI
const FACTORY_ABI = [
  'function allPairs(uint) external view returns (address pair)',
  'function allPairsLength() external view returns (uint)'
];

// Pair ABI - standard Uniswap V2 pair functions
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function factory() external view returns (address)',
  'function totalSupply() external view returns (uint)'
];

// ERC20 ABI
const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)'
];

async function checkPool() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    console.log('Connected to Somnia network\n');
    console.log(`Checking address: ${POOL_ADDRESS}\n`);

    // Step 1: Check if it's a contract
    console.log('1️⃣ Checking if address is a contract...');
    const code = await provider.getCode(POOL_ADDRESS);
    
    if (code === '0x') {
      console.log('❌ This is NOT a contract address (EOA)\n');
      return;
    }
    console.log('✅ This is a contract address\n');

    // Step 2: Try to call pair functions
    console.log('2️⃣ Checking if it has pair contract functions...');
    const pool = new ethers.Contract(POOL_ADDRESS, PAIR_ABI, provider);
    
    let isPair = false;
    let pairInfo: any = {};

    try {
      // Try to get factory address
      const factory = await pool.factory();
      console.log(`   Factory: ${factory}`);
      pairInfo.factory = factory;
      
      // Check if factory matches
      if (factory.toLowerCase() === FACTORY_ADDRESS.toLowerCase()) {
        console.log('   ✅ Factory matches!\n');
      } else {
        console.log('   ⚠️  Factory does not match expected factory\n');
      }

      // Try to get token0 and token1
      const token0 = await pool.token0();
      const token1 = await pool.token1();
      console.log(`   Token0: ${token0}`);
      console.log(`   Token1: ${token1}`);
      pairInfo.token0 = token0;
      pairInfo.token1 = token1;

      // Get reserves
      const reserves = await pool.getReserves();
      const reserve0 = reserves[0];
      const reserve1 = reserves[1];
      console.log(`   Reserve0: ${ethers.formatEther(reserve0)}`);
      console.log(`   Reserve1: ${ethers.formatEther(reserve1)}`);
      pairInfo.reserve0 = reserve0;
      pairInfo.reserve1 = reserve1;

      // Get total supply (LP tokens)
      const totalSupply = await pool.totalSupply();
      console.log(`   Total Supply (LP tokens): ${ethers.formatEther(totalSupply)}`);
      pairInfo.totalSupply = totalSupply;

      isPair = true;
      console.log('   ✅ Has all pair contract functions!\n');

    } catch (error: any) {
      console.log('   ❌ Failed to call pair functions');
      console.log(`   Error: ${error.message}\n`);
    }

    // Step 3: Get token information
    if (isPair && pairInfo.token0 && pairInfo.token1) {
      console.log('3️⃣ Fetching token information...');
      
      try {
        const token0Contract = new ethers.Contract(pairInfo.token0, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(pairInfo.token1, ERC20_ABI, provider);

        const token0Symbol = await token0Contract.symbol();
        const token1Symbol = await token1Contract.symbol();
        const token0Decimals = await token0Contract.decimals();
        const token1Decimals = await token1Contract.decimals();

        console.log(`   Token0: ${token0Symbol} (${token0Decimals} decimals)`);
        console.log(`   Token1: ${token1Symbol} (${token1Decimals} decimals)\n`);

        pairInfo.token0Symbol = token0Symbol;
        pairInfo.token1Symbol = token1Symbol;
        pairInfo.token0Decimals = token0Decimals;
        pairInfo.token1Decimals = token1Decimals;

        // Format reserves with correct decimals
        const reserve0Formatted = ethers.formatUnits(pairInfo.reserve0, token0Decimals);
        const reserve1Formatted = ethers.formatUnits(pairInfo.reserve1, token1Decimals);

        console.log('📊 Pool Reserves:');
        console.log(`   ${token0Symbol}: ${reserve0Formatted}`);
        console.log(`   ${token1Symbol}: ${reserve1Formatted}\n`);

        // Calculate price
        const price = Number(reserve1Formatted) / Number(reserve0Formatted);
        const priceInverse = Number(reserve0Formatted) / Number(reserve1Formatted);

        console.log('💰 Price:');
        console.log(`   1 ${token0Symbol} = ${price.toFixed(8)} ${token1Symbol}`);
        console.log(`   1 ${token1Symbol} = ${priceInverse.toFixed(8)} ${token0Symbol}\n`);

      } catch (error: any) {
        console.log(`   ⚠️  Could not fetch token info: ${error.message}\n`);
      }
    }

    // Step 4: Try to verify in factory (optional - some factories don't have this)
    console.log('4️⃣ Verifying with factory...');
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
      const allPairsLength = await factory.allPairsLength();
      console.log(`   Total pairs in factory: ${allPairsLength.toString()}`);
      
      // Try to find this pair in the factory (this might be slow if there are many pairs)
      // We'll just check if we can call the factory functions
      console.log('   ✅ Factory is accessible\n');
    } catch (error: any) {
      console.log(`   ⚠️  Could not verify with factory: ${error.message}\n`);
    }

    // Final verdict
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    if (isPair) {
      console.log('✅ VERDICT: This IS a valid pool/pair contract!');
    } else {
      console.log('❌ VERDICT: This does NOT appear to be a pool/pair contract');
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      isPool: isPair,
      address: POOL_ADDRESS,
      ...pairInfo
    };

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Run the script
checkPool()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

