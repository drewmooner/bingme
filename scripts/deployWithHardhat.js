const hre = require("hardhat");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
require("dotenv").config({ path: path.join(__dirname, "../.env.local") });

const RPC_URL = process.env.RPC_URL || "https://dream-rpc.somnia.network";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

async function main() {
  console.log("🚀 Deploying Factory and Router using Hardhat\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Network: ${RPC_URL}`);
  
  if (!PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY not found in .env");
  }
  
  // Use ethers directly
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Deployer: ${wallet.address}`);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} SOMI\n`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Get compiled artifacts from Hardhat
  const factoryArtifact = await hre.artifacts.readArtifact("SomniaExchangeFactory");
  const routerArtifact = await hre.artifacts.readArtifact("SomniaExchangeRouter02");

  // Deploy Factory
  console.log("📦 Deploying SomniaExchangeFactory...");
  const factoryFactory = new ethers.ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    wallet
  );
  const factory = await factoryFactory.deploy(wallet.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log(`   ✅ Factory deployed at: ${factoryAddress}\n`);

  // Get WSOMI address
  const deploymentsPath = path.join(__dirname, "../deployments.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf-8"));
  const wsomiAddress = deployments.deployments.WSOMI;

  // Deploy Router
  console.log("📦 Deploying SomniaExchangeRouter02...");
  console.log(`   Factory: ${factoryAddress}`);
  console.log(`   WETH (WSOMI): ${wsomiAddress}`);
  const routerFactory = new ethers.ContractFactory(
    routerArtifact.abi,
    routerArtifact.bytecode,
    wallet
  );
  const router = await routerFactory.deploy(factoryAddress, wsomiAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`   ✅ Router deployed at: ${routerAddress}\n`);

  // Save deployments
  const deploymentInfo = {
    network: RPC_URL,
    deployer: wallet.address,
    timestamp: new Date().toISOString(),
    factory: factoryAddress,
    router: routerAddress,
    wsomi: wsomiAddress,
    feeToSetter: wallet.address,
  };

  const outputPath = path.join(__dirname, "../factory-router-deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ DEPLOYMENT COMPLETE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Factory: ${factoryAddress}`);
  console.log(`Router: ${routerAddress}`);
  console.log(`WETH: ${wsomiAddress}`);
  console.log(`\n📄 Saved to: ${outputPath}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

