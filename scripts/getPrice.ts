import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

// Load addresses from deployment files
const factoryRouterPath = path.join(__dirname, '../factory-router-deployment.json');
const deploymentsPath = path.join(__dirname, '../deployments.json');

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

// Optional: WSOMI Ethereum address for price lookup (if different from Somnia address)
// Can be provided as 3rd argument: npm run price <token_address> <wsomi_eth_address>
const WSOMI_ETH_ADDRESS = process.argv[3] || null;

// RPC URL
const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';

// Factory ABI - getPair function
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)'
];

// Router ABI - for getting quotes
const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
  'function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)',
  'function getReserves(address factory, address tokenA, address tokenB) external view returns (uint reserveA, uint reserveB)'
];

// Pair ABI - getReserves function
const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)'
];

// ERC20 ABI - for token decimals and symbol
const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

// CoinGecko API base URL
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Somnia coin ID on CoinGecko
const SOMNIA_COIN_ID = 'somnia';

// Function to fetch Somnia/USD price from CoinGecko
async function getSomniaPriceFromCoinGecko(): Promise<number | null> {
  try {
    const url = `${COINGECKO_API}/simple/price?ids=${SOMNIA_COIN_ID}&vs_currencies=usd`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`   ⚠️  CoinGecko API response not OK: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    
    // CoinGecko returns: { "somnia": { "usd": 0.123 } }
    const price = data?.[SOMNIA_COIN_ID]?.usd;
    
    if (price !== undefined && price !== null) {
      return parseFloat(price.toString());
    }
    
    return null;
  } catch (error: any) {
    console.log(`   ⚠️  Error fetching price from CoinGecko: ${error.message}`);
    return null;
  }
}

async function getPairAndPrice() {
  try {
    // Connect to provider
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    console.log('Connected to Somnia network');

    // Create factory contract instance
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);

    // Verify token addresses are valid contracts
    console.log('\nVerifying token addresses...');
    const tokenCode = await provider.getCode(TOKEN_ADDRESS);
    const wsomiCode = await provider.getCode(WSOMI_ADDRESS);
    
    if (tokenCode === '0x') {
      console.error(`❌ TOKEN address ${TOKEN_ADDRESS} is not a contract!`);
      return;
    }
    if (wsomiCode === '0x') {
      console.error(`❌ WSOMI address ${WSOMI_ADDRESS} is not a contract!`);
      return;
    }
    console.log('✅ Both token addresses are valid contracts');

    // Get pair address (try both orders - factory should handle it, but just in case)
    console.log('\nFetching pair address...');
    let pairAddress = await factory.getPair(TOKEN_ADDRESS, WSOMI_ADDRESS);
    
    // If pair doesn't exist, try reverse order
    if (pairAddress === ethers.ZeroAddress) {
      console.log('Trying reverse order...');
      pairAddress = await factory.getPair(WSOMI_ADDRESS, TOKEN_ADDRESS);
    }
    
    if (pairAddress === ethers.ZeroAddress) {
      console.error('❌ Pair does not exist!');
      console.error(`   Token: ${TOKEN_ADDRESS}`);
      console.error(`   WSOMI: ${WSOMI_ADDRESS}`);
      console.error('\n💡 The pair may need to be created first via a swap or liquidity provision.');
      return;
    }

    console.log(`✅ Pair address: ${pairAddress}`);

    // Create pair contract instance
    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);

    // Get token addresses in the pair
    const token0 = await pair.token0();
    const token1 = await pair.token1();
    
    console.log(`Token0: ${token0}`);
    console.log(`Token1: ${token1}`);

    // Get reserves
    console.log('\nFetching reserves...');
    const reserves = await pair.getReserves();
    const reserve0 = reserves[0];
    const reserve1 = reserves[1];

    console.log(`Reserve0: ${ethers.formatEther(reserve0)}`);
    console.log(`Reserve1: ${ethers.formatEther(reserve1)}`);

    // Determine which reserve is TOKEN and which is WSOMI
    let tokenReserve, wsomiReserve;
    let tokenDecimals, wsomiDecimals;

    // Get token decimals
    const tokenContract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, provider);
    const wsomiContract = new ethers.Contract(WSOMI_ADDRESS, ERC20_ABI, provider);

    tokenDecimals = await tokenContract.decimals();
    wsomiDecimals = await wsomiContract.decimals();

    // Get token symbols
    const tokenSymbol = await tokenContract.symbol();
    const wsomiSymbol = await wsomiContract.symbol();

    console.log(`\n${tokenSymbol} decimals: ${tokenDecimals}`);
    console.log(`${wsomiSymbol} decimals: ${wsomiDecimals}`);

    // Calculate which is which based on token0/token1
    if (token0.toLowerCase() === TOKEN_ADDRESS.toLowerCase()) {
      tokenReserve = reserve0;
      wsomiReserve = reserve1;
    } else {
      tokenReserve = reserve1;
      wsomiReserve = reserve0;
    }

    // Format reserves with correct decimals
    const tokenReserveFormatted = ethers.formatUnits(tokenReserve, tokenDecimals);
    const wsomiReserveFormatted = ethers.formatUnits(wsomiReserve, wsomiDecimals);

    console.log(`\n📊 Reserves (from pair contract):`);
    console.log(`${tokenSymbol}: ${tokenReserveFormatted}`);
    console.log(`${wsomiSymbol}: ${wsomiReserveFormatted}`);

    // Also get reserves using router quote (if router supports it)
    console.log(`\n📊 Getting reserves from router quote...`);
    try {
      const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
      
      // Get quote for 1 token to see the path and reserves
      const oneToken = ethers.parseUnits('1', tokenDecimals);
      const path = [TOKEN_ADDRESS, WSOMI_ADDRESS];
      
      const amountsOut = await router.getAmountsOut(oneToken, path);
      const amountOut = amountsOut[1];
      const quotePrice = ethers.formatUnits(amountOut, wsomiDecimals);
      
      console.log(`   Quote: 1 ${tokenSymbol} = ${quotePrice} ${wsomiSymbol}`);
      console.log(`   ✅ Router quote successful`);
      
      // Calculate implied reserves from quote
      // If 1 token = X wsomi, and we know the actual reserves, we can verify
      const impliedWsomiReserve = Number(tokenReserveFormatted) * Number(quotePrice);
      console.log(`   Implied ${wsomiSymbol} reserve from quote: ${impliedWsomiReserve.toFixed(6)}`);
      console.log(`   Actual ${wsomiSymbol} reserve: ${wsomiReserveFormatted}`);
      
    } catch (error: any) {
      console.log(`   ⚠️  Could not get router quote: ${error.message}`);
    }

    // Calculate price: WSOMI per TOKEN
    // Price = WSOMI Reserve / TOKEN Reserve
    const price = Number(wsomiReserveFormatted) / Number(tokenReserveFormatted);
    
    // Also calculate TOKEN per WSOMI
    const priceInverse = Number(tokenReserveFormatted) / Number(wsomiReserveFormatted);

    console.log(`\n💰 Price:`);
    console.log(`1 ${tokenSymbol} = ${price.toFixed(8)} ${wsomiSymbol}`);
    console.log(`1 ${wsomiSymbol} = ${priceInverse.toFixed(8)} ${tokenSymbol}`);

    // Fetch USD prices from CoinGecko
    console.log(`\n💵 Fetching USD prices from CoinGecko...`);
    console.log(`   Source: https://www.coingecko.com/en/coins/${SOMNIA_COIN_ID}`);
    
    let wsomiUsdPrice: number | null = null;
    
    // Get Somnia price from CoinGecko (WSOMI should have the same price as native SOMI)
    wsomiUsdPrice = await getSomniaPriceFromCoinGecko();
    
    if (wsomiUsdPrice) {
      console.log(`   ✅ Found Somnia/USD price: $${wsomiUsdPrice.toFixed(6)}`);
      console.log(`   💡 Using this as ${wsomiSymbol} price (WSOMI = Wrapped Somnia)`);
    } else {
      console.log(`   ⚠️  Could not fetch Somnia price from CoinGecko`);
      console.log(`   💡 Note: CoinGecko API may be rate-limited or unavailable`);
    }
    
    if (wsomiUsdPrice) {
      console.log(`   ✅ ${wsomiSymbol} USD Price: $${wsomiUsdPrice.toFixed(6)}`);
      
      // Calculate token USD price based on WSOMI price and exchange rate
      const tokenUsdPrice = wsomiUsdPrice * price;
      
      console.log(`\n💵 USD Prices:`);
      console.log(`   1 ${wsomiSymbol} = $${wsomiUsdPrice.toFixed(6)}`);
      console.log(`   1 ${tokenSymbol} = $${tokenUsdPrice.toFixed(6)}`);
      
      // Calculate additional metrics
      const wsomiReserveUsd = Number(wsomiReserveFormatted) * wsomiUsdPrice;
      const tokenReserveUsd = Number(tokenReserveFormatted) * tokenUsdPrice;
      const totalLiquidityUsd = wsomiReserveUsd + tokenReserveUsd;
      
      console.log(`\n📊 Liquidity (USD):`);
      console.log(`   ${wsomiSymbol} Reserve: $${wsomiReserveUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      console.log(`   ${tokenSymbol} Reserve: $${tokenReserveUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      console.log(`   Total Liquidity: $${totalLiquidityUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      console.log(`   💡 Note: Both reserves have equal USD value because price = reserve ratio`);
      console.log(`   💡 Price DOES fluctuate - it changes with every swap as reserves change`);
      
      console.log(`\n📊 Price Summary:`);
      console.log(`   ${wsomiSymbol}/USD: $${wsomiUsdPrice.toFixed(6)}`);
      console.log(`   ${tokenSymbol}/USD: $${tokenUsdPrice.toFixed(6)}`);
      console.log(`   ${tokenSymbol}/${wsomiSymbol}: ${price.toFixed(8)}`);
    } else {
      console.log(`   ⚠️  Could not fetch ${wsomiSymbol} USD price from GeckoTerminal`);
      console.log(`   💡 Note: WSOMI may not be listed on GeckoTerminal, or the network/address may differ`);
      console.log(`   💡 You can manually provide the WSOMI USD price to calculate token USD price`);
    }

    // Calculate swap output for 5 WSOMI
    console.log(`\n🔄 Swap Calculation:`);
    const inputAmount = 5; // 5 WSOMI
    const inputAmountWei = ethers.parseUnits(inputAmount.toString(), wsomiDecimals);
    
    // Uniswap V2 formula: outputAmount = (y * inputAmount * 997) / (x * 1000 + inputAmount * 997)
    // Where x is input reserve, y is output reserve
    // 0.3% fee = 997/1000
    const fee = 997n; // 0.3% fee
    const feeDenominator = 1000n;
    
    // Calculate output for WSOMI -> NIA swap
    const wsomiReserveBigInt = wsomiReserve;
    const tokenReserveBigInt = tokenReserve;
    
    // Formula: output = (tokenReserve * inputAmount * 997) / (wsomiReserve * 1000 + inputAmount * 997)
    const numerator = tokenReserveBigInt * inputAmountWei * fee;
    const denominator = wsomiReserveBigInt * feeDenominator + inputAmountWei * fee;
    const outputAmountWei = numerator / denominator;
    
    const outputAmount = ethers.formatUnits(outputAmountWei, tokenDecimals);
    
    console.log(`Input: ${inputAmount} ${wsomiSymbol}`);
    console.log(`Output: ~${Number(outputAmount).toFixed(6)} ${tokenSymbol}`);
    console.log(`Price Impact: ${((inputAmount * priceInverse - Number(outputAmount)) / (inputAmount * priceInverse) * 100).toFixed(4)}%`);

    // Get reserves from router quote (alternative method)
    console.log(`\n📊 Getting reserves from router quote method...`);
    let routerReserves = null;
    try {
      const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
      
      // Try to get reserves directly from router if it has getReserves function
      try {
        const routerReservesResult = await router.getReserves(FACTORY_ADDRESS, TOKEN_ADDRESS, WSOMI_ADDRESS);
        const routerReserveA = routerReservesResult[0];
        const routerReserveB = routerReservesResult[1];
        
        // Determine which is which
        if (routerReserveA > 0n && routerReserveB > 0n) {
          const routerReserveAFormatted = ethers.formatUnits(routerReserveA, tokenDecimals);
          const routerReserveBFormatted = ethers.formatUnits(routerReserveB, wsomiDecimals);
          
          console.log(`   ✅ Reserves from router.getReserves():`);
          console.log(`   Reserve A: ${routerReserveAFormatted}`);
          console.log(`   Reserve B: ${routerReserveBFormatted}`);
          
          routerReserves = {
            reserveA: routerReserveAFormatted,
            reserveB: routerReserveBFormatted
          };
        }
      } catch (getReservesError: any) {
        // Router might not have getReserves, that's okay
        console.log(`   Router doesn't have getReserves function, using quote method instead`);
      }
      
      // Alternative: Calculate reserves from multiple quotes
      // Get quotes for different amounts to infer reserves
      const testAmounts = [
        ethers.parseUnits('1', tokenDecimals),
        ethers.parseUnits('10', tokenDecimals),
        ethers.parseUnits('100', tokenDecimals)
      ];
      
      const path = [TOKEN_ADDRESS, WSOMI_ADDRESS];
      console.log(`   Getting quotes for different amounts to verify reserves...`);
      
      for (const amount of testAmounts) {
        try {
          const amountsOut = await router.getAmountsOut(amount, path);
          const output = ethers.formatUnits(amountsOut[1], wsomiDecimals);
          const input = ethers.formatUnits(amount, tokenDecimals);
          console.log(`   ${input} ${tokenSymbol} → ${output} ${wsomiSymbol}`);
        } catch (quoteError) {
          // Skip if quote fails
        }
      }
      
    } catch (error: any) {
      console.log(`   ⚠️  Router quote method error: ${error.message}`);
    }

    return {
      pairAddress,
      tokenReserve: tokenReserveFormatted,
      wsomiReserve: wsomiReserveFormatted,
      price,
      priceInverse,
      tokenSymbol,
      wsomiSymbol,
      routerReserves,
      swapOutput: {
        inputAmount,
        inputToken: wsomiSymbol,
        outputAmount: Number(outputAmount),
        outputToken: tokenSymbol
      }
    };

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Run the script
getPairAndPrice()
  .then((result) => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

