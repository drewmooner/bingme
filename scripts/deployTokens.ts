import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

// RPC URL - use testnet or mainnet
const RPC_URL = process.env.RPC_URL || 'https://dream-rpc.somnia.network';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

interface DeploymentResult {
  contractName: string;
  address: string;
  txHash: string;
  blockNumber: number;
}

// ERC20 ABI (standard functions)
const ERC20_ABI = [
  'function name() public view returns (string)',
  'function symbol() public view returns (string)',
  'function decimals() public view returns (uint8)',
  'function totalSupply() public view returns (uint256)',
  'function balanceOf(address) public view returns (uint256)',
  'function transfer(address to, uint256 amount) public returns (bool)',
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function allowance(address owner, address spender) public view returns (uint256)',
  'function transferFrom(address from, address to, uint256 amount) public returns (bool)',
  'function deposit() public payable',
  'function withdraw(uint256 amount) public',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)'
];

async function deployContract(
  provider: ethers.Provider,
  wallet: ethers.Wallet,
  contractName: string,
  bytecode: string
): Promise<DeploymentResult> {
  console.log(`\n📦 Deploying ${contractName}...`);
  
  // Create contract factory
  const factory = new ethers.ContractFactory(
    ERC20_ABI,
    bytecode,
    wallet
  );

  // Deploy contract
  const contract = await factory.deploy();
  const txHash = contract.deploymentTransaction()?.hash || '';
  console.log(`   Transaction hash: ${txHash}`);
  console.log(`   Waiting for confirmation...`);

  // Wait for deployment
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const receipt = await contract.deploymentTransaction()?.wait();

  console.log(`   ✅ ${contractName} deployed at: ${address}`);
  console.log(`   Block number: ${receipt?.blockNumber}`);

  return {
    contractName,
    address,
    txHash,
    blockNumber: receipt?.blockNumber || 0
  };
}

// Get bytecode from compiled artifacts (if using Hardhat/Foundry)
// Or use solc to compile on the fly
function getBytecode(contractName: string): string {
  // Option 1: Try to load from compiled artifacts
  const artifactPath = path.join(__dirname, `../artifacts/contracts/${contractName}.sol/${contractName}.json`);
  
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    return artifact.bytecode;
  }

  // Option 2: If no artifacts, throw error with instructions
  throw new Error(
    `\n❌ Compiled bytecode not found for ${contractName}.\n` +
    `Please compile contracts first using:\n` +
    `  - Hardhat: npx hardhat compile\n` +
    `  - Foundry: forge build\n` +
    `  - Or use solc directly\n` +
    `\nExpected path: ${artifactPath}`
  );
}

async function main() {
  try {
    console.log('🚀 Starting Token Deployment\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Network: ${RPC_URL}`);
    
    // Check private key
    if (!PRIVATE_KEY) {
      throw new Error('PRIVATE_KEY not found in environment variables');
    }

    // Connect to network
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    
    const balance = await provider.getBalance(wallet.address);
    console.log(`Deployer: ${wallet.address}`);
    console.log(`Balance: ${ethers.formatEther(balance)} SOMI\n`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (balance === 0n) {
      throw new Error('Insufficient balance. Please fund your wallet.');
    }

    const deployments: DeploymentResult[] = [];

    // Deploy WSOMI
    const wsomiBytecode = getBytecode('WSOMI');
    const wsomiDeployment = await deployContract(provider, wallet, 'WSOMI', wsomiBytecode);
    deployments.push(wsomiDeployment);

    // Deploy Drew
    const drewBytecode = getBytecode('Drew');
    const drewDeployment = await deployContract(provider, wallet, 'Drew', drewBytecode);
    deployments.push(drewDeployment);

    // Deploy Ceejhay
    const ceejhayBytecode = getBytecode('Ceejhay');
    const ceejhayDeployment = await deployContract(provider, wallet, 'Ceejhay', ceejhayBytecode);
    deployments.push(ceejhayDeployment);

    // Save deployment addresses
    const deploymentInfo = {
      network: RPC_URL,
      deployer: wallet.address,
      timestamp: new Date().toISOString(),
      deployments: deployments
    };

    const outputPath = path.join(__dirname, '../deployments.json');
    fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));

    // Display summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ DEPLOYMENT SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    deployments.forEach(deployment => {
      console.log(`${deployment.contractName}: ${deployment.address}`);
    });
    console.log(`\n📄 Deployment info saved to: ${outputPath}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Verify deployments
    console.log('🔍 Verifying deployments...\n');
    for (const deployment of deployments) {
      const contract = new ethers.Contract(
        deployment.address,
        getABI(deployment.contractName),
        provider
      );
      
      try {
        const name = await contract.name();
        const symbol = await contract.symbol();
        const totalSupply = await contract.totalSupply();
        const deployerBalance = await contract.balanceOf(wallet.address);
        
        console.log(`${deployment.contractName}:`);
        console.log(`  Name: ${name}`);
        console.log(`  Symbol: ${symbol}`);
        console.log(`  Total Supply: ${ethers.formatEther(totalSupply)}`);
        console.log(`  Deployer Balance: ${ethers.formatEther(deployerBalance)}`);
        console.log(`  ✅ Verified\n`);
      } catch (error: any) {
        console.log(`  ⚠️  Verification failed: ${error.message}\n`);
      }
    }

  } catch (error: any) {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

// Run deployment
main()
  .then(() => {
    console.log('✅ Deployment script completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });

