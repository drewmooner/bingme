import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

// Load deployment info
const factoryRouterDeployment = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../factory-router-deployment.json'), 'utf-8')
);

const ROUTER_ADDRESS = factoryRouterDeployment.router;
const WSOMI_ADDRESS = factoryRouterDeployment.wsomi;

// Fee configuration
const FEE_RECIPIENT = process.env.FEE_RECIPIENT || '0x042943aefD5BFE42936b9fB575f5E1eeddFF1666'; // Default to deployer
const FEE_BPS = 100; // 1%

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY not found in .env file');
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log('🚀 Deploying LimitOrderManager...');
  console.log(`   Deployer: ${wallet.address}`);
  console.log(`   Router: ${ROUTER_ADDRESS}`);
  console.log(`   WSOMI: ${WSOMI_ADDRESS}`);
  console.log(`   Fee Recipient: ${FEE_RECIPIENT}`);
  console.log(`   Fee: ${FEE_BPS} bps (${FEE_BPS / 100}%)`);

  // Read contract
  const contractPath = path.join(__dirname, '../artifacts/contracts/LimitOrderManager.sol/LimitOrderManager.json');
  if (!fs.existsSync(contractPath)) {
    throw new Error('Contract not compiled. Run: npx hardhat compile');
  }

  const contractArtifact = JSON.parse(fs.readFileSync(contractPath, 'utf-8'));
  const factory = new ethers.ContractFactory(contractArtifact.abi, contractArtifact.bytecode, wallet);

  // Deploy
  const contract = await factory.deploy(
    ROUTER_ADDRESS,
    WSOMI_ADDRESS,
    FEE_RECIPIENT,
    FEE_BPS
  );

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`\n✅ LimitOrderManager deployed!`);
  console.log(`   Address: ${address}`);

  // Save deployment info
  const deploymentInfo = {
    network: RPC_URL,
    deployer: wallet.address,
    timestamp: new Date().toISOString(),
    contractAddress: address,
    router: ROUTER_ADDRESS,
    wsomi: WSOMI_ADDRESS,
    feeRecipient: FEE_RECIPIENT,
    feeBps: FEE_BPS,
  };

  const deploymentPath = path.join(__dirname, '../limit-order-deployment.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n📝 Deployment info saved to: ${deploymentPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

