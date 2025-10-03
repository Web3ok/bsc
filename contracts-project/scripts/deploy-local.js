const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🚀 Starting BianDEX Local Deployment...\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  const deployedContracts = {};

  console.log("📋 Step 1: Deploying Mock Tokens...");
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  
  const tokenA = await MockERC20.deploy("Token A", "TKA", ethers.parseEther("1000000"));
  await tokenA.waitForDeployment();
  const tokenAAddress = await tokenA.getAddress();
  console.log("✅ Token A deployed to:", tokenAAddress);

  const tokenB = await MockERC20.deploy("Token B", "TKB", ethers.parseEther("1000000"));
  await tokenB.waitForDeployment();
  const tokenBAddress = await tokenB.getAddress();
  console.log("✅ Token B deployed to:", tokenBAddress);

  const tokenC = await MockERC20.deploy("Token C", "TKC", ethers.parseEther("1000000"));
  await tokenC.waitForDeployment();
  const tokenCAddress = await tokenC.getAddress();
  console.log("✅ Token C deployed to:", tokenCAddress);

  deployedContracts.tokens = {
    tokenA: tokenAAddress,
    tokenB: tokenBAddress,
    tokenC: tokenCAddress,
  };

  console.log("\n📋 Step 2: Deploying BianDEX Core...");
  const BianDEXFactory = await ethers.getContractFactory("BianDEXFactory");
  const factory = await BianDEXFactory.deploy(deployer.address);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ BianDEXFactory deployed to:", factoryAddress);
  deployedContracts.factory = factoryAddress;

  console.log("\n📋 Step 3: Deploying BianDEXRouter...");
  const BianDEXRouter = await ethers.getContractFactory("BianDEXRouter");
  const router = await BianDEXRouter.deploy(factoryAddress);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log("✅ BianDEXRouter deployed to:", routerAddress);
  deployedContracts.router = routerAddress;

  console.log("\n📋 Step 4: Deploying Reward Token...");
  const RewardToken = await ethers.getContractFactory("RewardToken");
  const rewardToken = await RewardToken.deploy();
  await rewardToken.waitForDeployment();
  const rewardTokenAddress = await rewardToken.getAddress();
  console.log("✅ RewardToken deployed to:", rewardTokenAddress);
  deployedContracts.rewardToken = rewardTokenAddress;

  console.log("\n📋 Step 5: Deploying LPMining...");
  const LPMining = await ethers.getContractFactory("LPMining");
  const lpMining = await LPMining.deploy(
    rewardTokenAddress,
    ethers.parseEther("10"),
    0
  );
  await lpMining.waitForDeployment();
  const lpMiningAddress = await lpMining.getAddress();
  console.log("✅ LPMining deployed to:", lpMiningAddress);
  deployedContracts.lpMining = lpMiningAddress;

  console.log("\n📋 Step 6: Deploying Advanced Features...");
  const LimitOrderBook = await ethers.getContractFactory("LimitOrderBook");
  const limitOrderBook = await LimitOrderBook.deploy(deployer.address);
  await limitOrderBook.waitForDeployment();
  const limitOrderBookAddress = await limitOrderBook.getAddress();
  console.log("✅ LimitOrderBook deployed to:", limitOrderBookAddress);
  deployedContracts.limitOrderBook = limitOrderBookAddress;

  const DEXAggregator = await ethers.getContractFactory("DEXAggregator");
  const dexAggregator = await DEXAggregator.deploy(deployer.address);
  await dexAggregator.waitForDeployment();
  const dexAggregatorAddress = await dexAggregator.getAddress();
  console.log("✅ DEXAggregator deployed to:", dexAggregatorAddress);
  deployedContracts.dexAggregator = dexAggregatorAddress;

  console.log("\n📋 Step 7: Creating Initial Liquidity Pools...");
  
  await tokenA.approve(routerAddress, ethers.parseEther("10000"));
  await tokenB.approve(routerAddress, ethers.parseEther("10000"));
  
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  await router.addLiquidity(
    tokenAAddress,
    tokenBAddress,
    ethers.parseEther("1000"),
    ethers.parseEther("1000"),
    0,
    0,
    deadline
  );
  
  const pairAddress = await factory.getPair(tokenAAddress, tokenBAddress);
  console.log("✅ Created TKA-TKB pair at:", pairAddress);
  deployedContracts.pairs = { "TKA-TKB": pairAddress };

  console.log("\n📋 Step 8: Setting up LP Mining Pool...");
  await lpMining.add(100, pairAddress, false);
  console.log("✅ Added TKA-TKB LP pool to mining");

  await rewardToken.transfer(lpMiningAddress, ethers.parseEther("100000"));
  console.log("✅ Transferred reward tokens to LPMining");

  console.log("\n📋 Step 9: Saving Deployment Info...");
  const deploymentInfo = {
    network: hre.network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployedContracts,
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const filename = `local-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );
  console.log(`✅ Deployment info saved to deployments/${filename}`);

  const latestFile = path.join(deploymentsDir, "local-latest.json");
  fs.writeFileSync(latestFile, JSON.stringify(deploymentInfo, null, 2));
  console.log("✅ Updated local-latest.json");

  console.log("\n" + "=".repeat(60));
  console.log("📊 Deployment Summary");
  console.log("=".repeat(60));
  console.log("Factory:        ", factoryAddress);
  console.log("Router:         ", routerAddress);
  console.log("LPMining:       ", lpMiningAddress);
  console.log("LimitOrderBook: ", limitOrderBookAddress);
  console.log("DEXAggregator:  ", dexAggregatorAddress);
  console.log("=".repeat(60));
  console.log("\n✅ BianDEX Local Deployment Complete!\n");

  console.log("📌 Next Steps:");
  console.log("1. Update frontend config with these addresses");
  console.log("2. Start the frontend: cd ../frontend && npm run dev");
  console.log("3. Start the backend: npm run server:dev");
  console.log("4. Visit http://localhost:3000/dex\n");

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
