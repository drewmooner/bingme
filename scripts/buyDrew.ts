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
const DREW_ADDRESS = deployments.deployments.Drew;

// Amount of DREW to buy (3500 tokens)
const DREW_AMOUNT = 7000;

// Router ABI - for swapping
const ROUTER_ABI = [
  'function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapETHForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts)',
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

    console.log('🛒 Buying DREW Tokens\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Network: ${RPC_URL}`);
    console.log(`Target: ${DREW_AMOUNT} DREW tokens`);
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
    const drewContract = new ethers.Contract(DREW_ADDRESS, ERC20_ABI, provider);
    const wsomiContract = new ethers.Contract(WSOMI_ADDRESS, ERC20_ABI, provider);

    const [drewDecimals, wsomiDecimals, drewSymbol, wsomiSymbol] = await Promise.all([
      drewContract.decimals(),
      wsomiContract.decimals(),
      drewContract.symbol(),
      wsomiContract.symbol(),
    ]);

    console.log(`Token Info:`);
    console.log(`   ${drewSymbol}: ${DREW_ADDRESS}`);
    console.log(`   ${wsomiSymbol}: ${WSOMI_ADDRESS}\n`);

    // Calculate exact amount of DREW in wei
    const drewAmountWei = ethers.parseUnits(DREW_AMOUNT.toString(), Number(drewDecimals));
    console.log(`Target Amount: ${DREW_AMOUNT} ${drewSymbol} (${drewAmountWei.toString()} wei)\n`);

    // Get quote for how much WSOMI is needed
    console.log('📊 Getting quote...');
    const swapPath = [WSOMI_ADDRESS, DREW_ADDRESS];
    const amountsIn = await router.getAmountsIn(drewAmountWei, swapPath);
    const wsomiAmountNeeded = amountsIn[0];
    const wsomiAmountNeededFormatted = ethers.formatUnits(wsomiAmountNeeded, Number(wsomiDecimals));

    console.log(`   To get ${DREW_AMOUNT} ${drewSymbol}, you need:`);
    console.log(`   ${wsomiAmountNeededFormatted} ${wsomiSymbol}\n`);

    // Check WSOMI balance
    const wsomiBalance = await wsomiContract.balanceOf(wallet.address);
    const wsomiBalanceFormatted = ethers.formatUnits(wsomiBalance, Number(wsomiDecimals));
    console.log(`💰 Current ${wsomiSymbol} Balance: ${wsomiBalanceFormatted}`);

    if (wsomiBalance < wsomiAmountNeeded) {
      throw new Error(
        `Insufficient ${wsomiSymbol} balance. Need ${wsomiAmountNeededFormatted}, have ${wsomiBalanceFormatted}`
      );
    }

    // Add 5% slippage tolerance for amountInMax
    const amountInMax = (wsomiAmountNeeded * 105n) / 100n;
    const amountInMaxFormatted = ethers.formatUnits(amountInMax, Number(wsomiDecimals));
    console.log(`   Max ${wsomiSymbol} to spend (5% slippage): ${amountInMaxFormatted}\n`);

    // Check and approve WSOMI if needed
    console.log('🔐 Checking approval...');
    const currentAllowance = await wsomiContract.allowance(wallet.address, ROUTER_ADDRESS);
    console.log(`   Current allowance: ${ethers.formatUnits(currentAllowance, Number(wsomiDecimals))} ${wsomiSymbol}`);

    if (currentAllowance < amountInMax) {
      console.log(`   Approving ${wsomiSymbol}...`);
      // Create contract instance connected to wallet for write operations
      const wsomiContractWithSigner = new ethers.Contract(WSOMI_ADDRESS, ERC20_ABI, wallet);
      const approveTx = await wsomiContractWithSigner.approve(ROUTER_ADDRESS, amountInMax);
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
    console.log(`   Path: ${wsomiSymbol} → ${drewSymbol}`);
    console.log(`   Amount Out: ${DREW_AMOUNT} ${drewSymbol}`);
    console.log(`   Amount In Max: ${amountInMaxFormatted} ${wsomiSymbol}`);
    console.log(`   Deadline: ${new Date(deadline * 1000).toISOString()}\n`);

    const swapTx = await router.swapTokensForExactTokens(
      drewAmountWei, // amountOut - exact amount of DREW we want
      amountInMax, // amountInMax - maximum WSOMI we're willing to spend
      swapPath, // [WSOMI, DREW]
      wallet.address, // to - recipient address
      deadline // deadline
    );

    console.log(`   Transaction hash: ${swapTx.hash}`);
    console.log(`   Waiting for confirmation...`);
    const receipt = await swapTx.wait();
    console.log(`   ✅ Transaction confirmed!\n`);

    // Check final balances
    console.log('📊 Final Balances:');
    const [finalWsomiBalance, finalDrewBalance] = await Promise.all([
      wsomiContract.balanceOf(wallet.address),
      drewContract.balanceOf(wallet.address),
    ]);

    console.log(`   ${wsomiSymbol}: ${ethers.formatUnits(finalWsomiBalance, Number(wsomiDecimals))}`);
    console.log(`   ${drewSymbol}: ${ethers.formatUnits(finalDrewBalance, Number(drewDecimals))}\n`);

    // Calculate actual amounts from receipt
    if (receipt.logs) {
      const routerInterface = new ethers.Interface([
        'event Transfer(address indexed from, address indexed to, uint256 value)',
      ]);

      let wsomiSpent = 0n;
      let drewReceived = 0n;

      for (const log of receipt.logs) {
        try {
          const parsed = routerInterface.parseLog(log);
          if (parsed && parsed.name === 'Transfer') {
            const from = parsed.args.from;
            const to = parsed.args.to;
            const value = parsed.args.value;

            // WSOMI spent (from wallet to router/pair)
            if (from.toLowerCase() === wallet.address.toLowerCase() && 
                log.address.toLowerCase() === WSOMI_ADDRESS.toLowerCase()) {
              wsomiSpent += value;
            }

            // DREW received (from router/pair to wallet)
            if (to.toLowerCase() === wallet.address.toLowerCase() && 
                log.address.toLowerCase() === DREW_ADDRESS.toLowerCase()) {
              drewReceived += value;
            }
          }
        } catch {
          // Not a Transfer event, continue
        }
      }

      if (wsomiSpent > 0n || drewReceived > 0n) {
        console.log('📈 Swap Summary:');
        if (wsomiSpent > 0n) {
          console.log(`   ${wsomiSymbol} Spent: ${ethers.formatUnits(wsomiSpent, Number(wsomiDecimals))}`);
        }
        if (drewReceived > 0n) {
          console.log(`   ${drewSymbol} Received: ${ethers.formatUnits(drewReceived, Number(drewDecimals))}`);
        }
        console.log();
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SUCCESS! Bought 3500 DREW tokens');
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

