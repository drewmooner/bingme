import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

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

const ROUTER_ADDRESS = factoryRouterDeployment.router;
const WSOMI_ADDRESS = deployments.deployments.WSOMI;
const CEEJHAY_ADDRESS = deployments.deployments.Ceejhay;

// Amount of CEEJHAY to sell (20000 tokens)
const CEEJHAY_AMOUNT = 20000;

// Router ABI - for swapping
const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
];

// ERC20 ABI
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

async function main() {
  try {
    // Check if .env file exists
    const envPath = path.join(__dirname, '../.env');
    const envExists = fs.existsSync(envPath);
    
    if (!PRIVATE_KEY) {
      if (!envExists) {
        throw new Error('PRIVATE_KEY not found. Please create a .env file in the project root with PRIVATE_KEY=your_private_key');
      } else {
        throw new Error('PRIVATE_KEY not found in .env file. Please add PRIVATE_KEY=your_private_key to your .env file');
      }
    }

    console.log('💰 Selling CEEJHAY Tokens\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Network: ${RPC_URL}`);
    console.log(`Target: ${CEEJHAY_AMOUNT} CEEJHAY tokens`);
    if (envExists) {
      console.log(`✅ Using private key from .env file`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Connect to network
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, wallet);

    console.log(`Wallet: ${wallet.address}`);
    const balance = await provider.getBalance(wallet.address);
    console.log(`Native Balance: ${ethers.formatEther(balance)} SOMI\n`);

    // Get token info
    const ceejhayContract = new ethers.Contract(CEEJHAY_ADDRESS, ERC20_ABI, provider);
    const wsomiContract = new ethers.Contract(WSOMI_ADDRESS, ERC20_ABI, provider);

    const [ceejhayDecimals, wsomiDecimals, ceejhaySymbol, wsomiSymbol] = await Promise.all([
      ceejhayContract.decimals(),
      wsomiContract.decimals(),
      ceejhayContract.symbol(),
      wsomiContract.symbol(),
    ]);

    console.log(`Token Info:`);
    console.log(`   ${ceejhaySymbol}: ${CEEJHAY_ADDRESS}`);
    console.log(`   ${wsomiSymbol}: ${WSOMI_ADDRESS}\n`);

    // Calculate exact amount of CEEJHAY in wei
    const ceejhayAmountWei = ethers.parseUnits(CEEJHAY_AMOUNT.toString(), Number(ceejhayDecimals));
    console.log(`Selling Amount: ${CEEJHAY_AMOUNT} ${ceejhaySymbol} (${ceejhayAmountWei.toString()} wei)\n`);

    // Get quote for how much WSOMI we'll receive
    console.log('📊 Getting quote...');
    const swapPath = [CEEJHAY_ADDRESS, WSOMI_ADDRESS];
    const amountsOut = await router.getAmountsOut(ceejhayAmountWei, swapPath);
    const wsomiAmountOut = amountsOut[1];
    const wsomiAmountOutFormatted = ethers.formatUnits(wsomiAmountOut, Number(wsomiDecimals));

    console.log(`   Selling ${CEEJHAY_AMOUNT} ${ceejhaySymbol} will give you:`);
    console.log(`   ${wsomiAmountOutFormatted} ${wsomiSymbol}\n`);

    // Check CEEJHAY balance
    const ceejhayBalance = await ceejhayContract.balanceOf(wallet.address);
    const ceejhayBalanceFormatted = ethers.formatUnits(ceejhayBalance, Number(ceejhayDecimals));
    console.log(`💰 Current ${ceejhaySymbol} Balance: ${ceejhayBalanceFormatted}`);

    if (ceejhayBalance < ceejhayAmountWei) {
      throw new Error(
        `Insufficient ${ceejhaySymbol} balance. Need ${CEEJHAY_AMOUNT}, have ${ceejhayBalanceFormatted}`
      );
    }

    // Calculate minimum WSOMI to receive (5% slippage tolerance)
    const amountOutMin = (wsomiAmountOut * 95n) / 100n;
    const amountOutMinFormatted = ethers.formatUnits(amountOutMin, Number(wsomiDecimals));
    console.log(`   Min ${wsomiSymbol} to receive (5% slippage): ${amountOutMinFormatted}\n`);

    // Check and approve CEEJHAY if needed
    console.log('🔐 Checking approval...');
    const currentAllowance = await ceejhayContract.allowance(wallet.address, ROUTER_ADDRESS);
    console.log(`   Current allowance: ${ethers.formatUnits(currentAllowance, Number(ceejhayDecimals))} ${ceejhaySymbol}`);

    if (currentAllowance < ceejhayAmountWei) {
      console.log(`   Approving ${ceejhaySymbol}...`);
      // Create contract instance connected to wallet for write operations
      const ceejhayContractWithSigner = new ethers.Contract(CEEJHAY_ADDRESS, ERC20_ABI, wallet);
      const approveTx = await ceejhayContractWithSigner.approve(ROUTER_ADDRESS, ceejhayAmountWei);
      console.log(`   Approval tx: ${approveTx.hash}`);
      await approveTx.wait();
      console.log(`   ✅ Approved\n`);
    } else {
      console.log(`   ✅ Already approved\n`);
    }

    // Set deadline (30 minutes from now)
    const deadline = Math.floor(Date.now() / 1000) + 1800;

    // Perform swap
    console.log('🔄 Executing swap...');
    console.log(`   Path: ${ceejhaySymbol} → ${wsomiSymbol}`);
    console.log(`   Amount In: ${CEEJHAY_AMOUNT} ${ceejhaySymbol}`);
    console.log(`   Amount Out Min: ${amountOutMinFormatted} ${wsomiSymbol}`);
    console.log(`   Expected Out: ${wsomiAmountOutFormatted} ${wsomiSymbol}`);
    console.log(`   Deadline: ${new Date(deadline * 1000).toISOString()}\n`);

    const swapTx = await router.swapExactTokensForTokens(
      ceejhayAmountWei, // amountIn - exact amount of CEEJHAY to sell
      amountOutMin, // amountOutMin - minimum WSOMI to receive
      swapPath, // [CEEJHAY, WSOMI]
      wallet.address, // to - recipient address
      deadline // deadline
    );

    console.log(`   Transaction hash: ${swapTx.hash}`);
    console.log(`   Waiting for confirmation...`);
    const receipt = await swapTx.wait();
    console.log(`   ✅ Transaction confirmed!\n`);

    // Check final balances
    console.log('📊 Final Balances:');
    const [finalCeejhayBalance, finalWsomiBalance] = await Promise.all([
      ceejhayContract.balanceOf(wallet.address),
      wsomiContract.balanceOf(wallet.address),
    ]);

    console.log(`   ${ceejhaySymbol}: ${ethers.formatUnits(finalCeejhayBalance, Number(ceejhayDecimals))}`);
    console.log(`   ${wsomiSymbol}: ${ethers.formatUnits(finalWsomiBalance, Number(wsomiDecimals))}\n`);

    // Calculate actual amounts from receipt
    if (receipt.logs) {
      const routerInterface = new ethers.Interface([
        'event Transfer(address indexed from, address indexed to, uint256 value)',
      ]);

      let ceejhaySpent = 0n;
      let wsomiReceived = 0n;

      for (const log of receipt.logs) {
        try {
          const parsed = routerInterface.parseLog(log);
          if (parsed && parsed.name === 'Transfer') {
            const from = parsed.args.from;
            const to = parsed.args.to;
            const value = parsed.args.value;

            // CEEJHAY spent (from wallet to router/pair)
            if (from.toLowerCase() === wallet.address.toLowerCase() && 
                log.address.toLowerCase() === CEEJHAY_ADDRESS.toLowerCase()) {
              ceejhaySpent += value;
            }

            // WSOMI received (from router/pair to wallet)
            if (to.toLowerCase() === wallet.address.toLowerCase() && 
                log.address.toLowerCase() === WSOMI_ADDRESS.toLowerCase()) {
              wsomiReceived += value;
            }
          }
        } catch {
          // Not a Transfer event, continue
        }
      }

      if (ceejhaySpent > 0n || wsomiReceived > 0n) {
        console.log('📈 Swap Summary:');
        if (ceejhaySpent > 0n) {
          console.log(`   ${ceejhaySymbol} Sold: ${ethers.formatUnits(ceejhaySpent, Number(ceejhayDecimals))}`);
        }
        if (wsomiReceived > 0n) {
          console.log(`   ${wsomiSymbol} Received: ${ethers.formatUnits(wsomiReceived, Number(wsomiDecimals))}`);
        }
        console.log();
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SUCCESS! Sold 20000 CEEJHAY tokens');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.transaction) {
      console.error('   Transaction hash:', error.transaction.hash);
    }
    throw error;
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

