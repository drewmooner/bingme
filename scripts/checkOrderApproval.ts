import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const ORDERS_FILE = path.join(__dirname, '../limit-orders.json');

const ERC20_ABI = [
  'function allowance(address owner, address spender) external view returns (uint256)',
] as const;

interface LimitOrder {
  id: string;
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  status: 'pending' | 'executed' | 'canceled' | 'expired';
}

interface OrdersData {
  orders: LimitOrder[];
}

// Load limit order manager address
let LIMIT_ORDER_MANAGER_ADDRESS = '0x0000000000000000000000000000000000000000';
const limitOrderDeploymentPath = path.join(__dirname, '../limit-order-deployment.json');
if (fs.existsSync(limitOrderDeploymentPath)) {
  const deployment = JSON.parse(fs.readFileSync(limitOrderDeploymentPath, 'utf-8'));
  LIMIT_ORDER_MANAGER_ADDRESS = deployment.contractAddress;
}

async function checkApprovals() {
  console.log('🔍 Checking Limit Order Approvals\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Limit Order Manager: ${LIMIT_ORDER_MANAGER_ADDRESS}\n`);

  if (LIMIT_ORDER_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
    console.error('❌ Limit Order Manager not deployed. Please deploy first.');
    process.exit(1);
  }

  if (!fs.existsSync(ORDERS_FILE)) {
    console.log('📭 No orders found.');
    return;
  }

  const data: OrdersData = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
  const pendingOrders = data.orders.filter(o => o.status === 'pending');

  if (pendingOrders.length === 0) {
    console.log('📭 No pending orders found.');
    return;
  }

  console.log(`📊 Found ${pendingOrders.length} pending order(s)\n`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  for (const order of pendingOrders) {
    try {
      const tokenContract = new ethers.Contract(order.tokenIn, ERC20_ABI, provider);
      const allowance = await tokenContract.allowance(order.trader, LIMIT_ORDER_MANAGER_ADDRESS);
      const amountIn = BigInt(order.amountIn);
      const hasApproval = allowance >= amountIn;

      console.log(`Order ID: ${order.id}`);
      console.log(`  Trader: ${order.trader}`);
      console.log(`  Token In: ${order.tokenIn}`);
      console.log(`  Amount: ${ethers.formatEther(amountIn)}`);
      console.log(`  Allowance: ${ethers.formatEther(allowance)}`);
      console.log(`  Status: ${hasApproval ? '✅ Approved' : '❌ Not Approved'}`);
      console.log('');
    } catch (error: any) {
      console.error(`Error checking order ${order.id}:`, error.message);
      console.log('');
    }
  }
}

checkApprovals().catch(console.error);

