const hre = require("hardhat");
const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Starting BianDEX Advanced Features Deployment...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB\n");

  const feeCollector = deployer.address;

  console.log("📋 Step 1: Deploying LimitOrderBook...");
  const LimitOrderBook = await ethers.getContractFactory("LimitOrderBook");
  const limitOrderBook = await LimitOrderBook.deploy(feeCollector);
  await limitOrderBook.waitForDeployment();
  const limitOrderBookAddress = await limitOrderBook.getAddress();
  console.log("✅ LimitOrderBook deployed to:", limitOrderBookAddress);
  console.log("   Fee Collector:", feeCollector);
  console.log("   Fee Percentage:", await limitOrderBook.feePercentage(), "basis points (0.1%)\n");

  console.log("📋 Step 2: Deploying DEXAggregator...");
  const DEXAggregator = await ethers.getContractFactory("DEXAggregator");
  const dexAggregator = await DEXAggregator.deploy(feeCollector);
  await dexAggregator.waitForDeployment();
  const dexAggregatorAddress = await dexAggregator.getAddress();
  console.log("✅ DEXAggregator deployed to:", dexAggregatorAddress);
  console.log("   Fee Collector:", feeCollector);
  console.log("   Fee Percentage:", await dexAggregator.feePercentage(), "basis points (0.1%)\n");

  console.log("📋 Step 3: Deployment Summary");
  console.log("=" .repeat(60));
  console.log("LimitOrderBook:", limitOrderBookAddress);
  console.log("DEXAggregator:", dexAggregatorAddress);
  console.log("=" .repeat(60));

  const addresses = {
    limitOrderBook: limitOrderBookAddress,
    dexAggregator: dexAggregatorAddress,
    feeCollector: feeCollector,
    deployer: deployer.address,
    network: hre.network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString()
  };

  console.log("\n📝 Deployment Info:");
  console.log(JSON.stringify(addresses, null, 2));

  if (hre.network.name === "bsc_testnet" || hre.network.name === "bsc_mainnet") {
    console.log("\n⏳ Waiting 60 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 60000));

    console.log("\n🔍 Verifying contracts on BSCScan...");
    
    try {
      await hre.run("verify:verify", {
        address: limitOrderBookAddress,
        constructorArguments: [feeCollector],
      });
      console.log("✅ LimitOrderBook verified");
    } catch (error) {
      console.log("❌ LimitOrderBook verification failed:", error.message);
    }

    try {
      await hre.run("verify:verify", {
        address: dexAggregatorAddress,
        constructorArguments: [feeCollector],
      });
      console.log("✅ DEXAggregator verified");
    } catch (error) {
      console.log("❌ DEXAggregator verification failed:", error.message);
    }
  }

  console.log("\n✅ Advanced Features Deployment Complete!");
  console.log("\n📌 Next Steps:");
  console.log("1. Update frontend with new contract addresses");
  console.log("2. Test limit order creation and filling");
  console.log("3. Add DEX routers to aggregator");
  console.log("4. Test aggregator with multiple DEXs");
  
  return addresses;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
