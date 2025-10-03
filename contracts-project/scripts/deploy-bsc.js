const hre = require("hardhat");
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("🚀 Deploying BianDEX to BSC");
  console.log("📍 Network:", hre.network.name);
  console.log("👤 Deployer:", deployer.address);
  console.log("💰 Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "BNB");
  
  const isTestnet = hre.network.name === "bsc_testnet";
  const wbnbAddress = isTestnet 
    ? "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"
    : "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  
  console.log("\n🔗 WBNB Address:", wbnbAddress);
  
  console.log("\n📦 Step 1/3: Deploying BianDEXFactory...");
  const Factory = await hre.ethers.getContractFactory("BianDEXFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ Factory deployed:", factoryAddress);
  
  console.log("\n📦 Step 2/3: Deploying BianDEXRouter...");
  const Router = await hre.ethers.getContractFactory("BianDEXRouter");
  const router = await Router.deploy(factoryAddress, wbnbAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("✅ Router deployed:", routerAddress);
  
  console.log("\n⏳ Waiting 30 seconds for block confirmations...");
  await new Promise(resolve => setTimeout(resolve, 30000));
  
  const deploymentInfo = {
    network: hre.network.name,
    chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    contracts: {
      factory: factoryAddress,
      router: routerAddress,
      wbnb: wbnbAddress
    },
    timestamp: new Date().toISOString(),
    blockNumber: await hre.ethers.provider.getBlockNumber()
  };
  
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)){
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const filename = `${hre.network.name}_${Date.now()}.json`;
  const filepath = path.join(deploymentsDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  
  console.log("\n📊 Deployment Summary:");
  console.log("═══════════════════════════════════════════════");
  console.log("Factory:", factoryAddress);
  console.log("Router:", routerAddress);
  console.log("WBNB:", wbnbAddress);
  console.log("═══════════════════════════════════════════════");
  console.log("\n💾 Saved to:", filepath);
  
  if (process.env.BSCSCAN_API_KEY) {
    console.log("\n📝 Step 3/3: Verifying contracts on BSCScan...");
    try {
      await hre.run("verify:verify", {
        address: factoryAddress,
        constructorArguments: []
      });
      console.log("✅ Factory verified");
      
      await hre.run("verify:verify", {
        address: routerAddress,
        constructorArguments: [factoryAddress, wbnbAddress]
      });
      console.log("✅ Router verified");
    } catch (error) {
      console.log("⚠️ Verification failed:", error.message);
      console.log("You can verify manually later using:");
      console.log(`npx hardhat verify --network ${hre.network.name} ${factoryAddress}`);
      console.log(`npx hardhat verify --network ${hre.network.name} ${routerAddress} ${factoryAddress} ${wbnbAddress}`);
    }
  } else {
    console.log("\n⚠️ BSCSCAN_API_KEY not set, skipping verification");
    console.log("Add BSCSCAN_API_KEY to .env to enable auto-verification");
  }
  
  console.log("\n✅ Deployment complete!");
  console.log("\n📝 Next steps:");
  console.log("1. Add liquidity through the router");
  console.log("2. Test swaps on testnet");
  console.log("3. Update frontend with contract addresses");
  console.log("4. Set up monitoring and alerts");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
