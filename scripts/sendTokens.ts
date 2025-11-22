import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Recipient address
const RECIPIENT_ADDRESS = '0x0a66fe87d80aa139b25d1b2f5f9961c09511a862';

// Amount to send (40,000 tokens of each)
const TOKEN_AMOUNT = 40000;

// Load addresses from deployment file
const deploymentsPath = path.join(__dirname, '../deployments.json');

if (!fs.existsSync(deploymentsPath)) {
  throw new Error('deployments.json not found. Please deploy tokens first.');
}

const deployments = JSON.parse(fs.readFileSync(deploymentsPath, 'utf-8'));

const DREW_ADDRESS = deployments.deployments.Drew;
const CEEJHAY_ADDRESS = deployments.deployments.Ceejhay;

// ERC20 ABI
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

async function transferToken(
  wallet: ethers.Wallet,
  tokenAddress: string,
  recipient: string,
  amount: bigint
): Promise<void> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const [symbol, decimals] = await Promise.all([
    token.symbol(),
    token.decimals(),
  ]);

  console.log(`\n📤 Transferring ${ethers.formatUnits(amount, Number(decimals))} ${symbol}...`);
  console.log(`   From: ${wallet.address}`);
  console.log(`   To: ${recipient}`);

  // Check balance
  const balance = await token.balanceOf(wallet.address);
  const balanceFormatted = ethers.formatUnits(balance, Number(decimals));
  console.log(`   Current balance: ${balanceFormatted} ${symbol}`);

  if (balance < amount) {
    throw new Error(
      `Insufficient ${symbol} balance. Need ${ethers.formatUnits(amount, Number(decimals))}, have ${balanceFormatted}`
    );
  }

  // Execute transfer
  const tx = await token.transfer(recipient, amount);
  console.log(`   Transaction hash: ${tx.hash}`);
  console.log(`   Waiting for confirmation...`);
  const receipt = await tx.wait();
  console.log(`   ✅ Transfer confirmed!`);

  // Check final balances
  const [senderBalance, recipientBalance] = await Promise.all([
    token.balanceOf(wallet.address),
    token.balanceOf(recipient),
  ]);

  console.log(`   Sender balance: ${ethers.formatUnits(senderBalance, Number(decimals))} ${symbol}`);
  console.log(`   Recipient balance: ${ethers.formatUnits(recipientBalance, Number(decimals))} ${symbol}`);
}

async function main() {
  try {
    // Check if .env file exists
    const envPath = path.join(__dirname, '../.env');
    const envExists = fs.existsSync(envPath);

    if (!PRIVATE_KEY) {
      if (!envExists) {
        throw new Error(
          'PRIVATE_KEY not found. Please create a .env file in the project root with PRIVATE_KEY=your_private_key'
        );
      } else {
        throw new Error(
          'PRIVATE_KEY not found in .env file. Please add PRIVATE_KEY=your_private_key to your .env file'
        );
      }
    }

    console.log('🚀 Sending Tokens\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Network: ${RPC_URL}`);
    console.log(`Recipient: ${RECIPIENT_ADDRESS}`);
    console.log(`Amount: ${TOKEN_AMOUNT} of each token (DREW and CEEJHAY)`);
    if (envExists) {
      console.log(`✅ Using private key from .env file`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Connect to network
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`Wallet: ${wallet.address}`);
    const nativeBalance = await provider.getBalance(wallet.address);
    console.log(`Native Balance: ${ethers.formatEther(nativeBalance)} SOMI\n`);

    // Get token info and calculate amounts
    const drewContract = new ethers.Contract(DREW_ADDRESS, ERC20_ABI, provider);
    const ceejhayContract = new ethers.Contract(CEEJHAY_ADDRESS, ERC20_ABI, provider);

    const [drewDecimals, ceejhayDecimals, drewSymbol, ceejhaySymbol] = await Promise.all([
      drewContract.decimals(),
      ceejhayContract.decimals(),
      drewContract.symbol(),
      ceejhayContract.symbol(),
    ]);

    console.log('📋 Token Info:');
    console.log(`   ${drewSymbol}: ${DREW_ADDRESS}`);
    console.log(`   ${ceejhaySymbol}: ${CEEJHAY_ADDRESS}\n`);

    // Calculate amounts in wei
    const drewAmount = ethers.parseUnits(TOKEN_AMOUNT.toString(), Number(drewDecimals));
    const ceejhayAmount = ethers.parseUnits(TOKEN_AMOUNT.toString(), Number(ceejhayDecimals));

    // Transfer DREW
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Transferring ${drewSymbol}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    await transferToken(wallet, DREW_ADDRESS, RECIPIENT_ADDRESS, drewAmount);

    // Transfer CEEJHAY
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 Transferring ${ceejhaySymbol}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    await transferToken(wallet, CEEJHAY_ADDRESS, RECIPIENT_ADDRESS, ceejhayAmount);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SUCCESS! Sent 40,000 of each token');
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

