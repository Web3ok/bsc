const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  
  console.log("🚀 Deploying BianDEX Full Suite");
  console.log("📍 Network:", network);
  console.log("👤 Deployer:", deployer.address);
  console.log("💰 Balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());
  console.log("=====================================\n");

  const deployments = {};

  try {
    // 1. Deploy WBNB
    console.log("1️⃣  Deploying WBNB...");
    const WBNB = await hre.ethers.getContractFactory("WBNB");
    const wbnb = await WBNB.deploy();
    await wbnb.waitForDeployment();
    deployments.wbnb = await wbnb.getAddress();
    console.log("✅ WBNB deployed to:", deployments.wbnb);

    // 2. Deploy Factory
    console.log("\n2️⃣  Deploying BianDEXFactory...");
    const Factory = await hre.ethers.getContractFactory("BianDEXFactory");
    const factory = await Factory.deploy();
    await factory.waitForDeployment();
    deployments.factory = await factory.getAddress();
    console.log("✅ Factory deployed to:", deployments.factory);

    // 3. Deploy Router
    console.log("\n3️⃣  Deploying BianDEXRouter...");
    const Router = await hre.ethers.getContractFactory("BianDEXRouter");
    const router = await Router.deploy(deployments.factory, deployments.wbnb);
    await router.waitForDeployment();
    deployments.router = await router.getAddress();
    console.log("✅ Router deployed to:", deployments.router);

    // 4. Deploy Test Tokens (only for testnet/localhost)
    if (network === "localhost" || network === "hardhat" || network === "bsc_testnet") {
      console.log("\n4️⃣  Deploying Test Tokens...");
      
      const TestToken = await hre.ethers.getContractFactory("TestToken");
      
      // Deploy USDT Mock
      const usdt = await TestToken.deploy("Tether USD", "USDT", hre.ethers.parseEther("1000000000"));
      await usdt.waitForDeployment();
      deployments.usdt = await usdt.getAddress();
      console.log("✅ USDT deployed to:", deployments.usdt);
      
      // Deploy BUSD Mock
      const busd = await TestToken.deploy("Binance USD", "BUSD", hre.ethers.parseEther("1000000000"));
      await busd.waitForDeployment();
      deployments.busd = await busd.getAddress();
      console.log("✅ BUSD deployed to:", deployments.busd);
      
      // Deploy CAKE Mock
      const cake = await TestToken.deploy("PancakeSwap Token", "CAKE", hre.ethers.parseEther("1000000000"));
      await cake.waitForDeployment();
      deployments.cake = await cake.getAddress();
      console.log("✅ CAKE deployed to:", deployments.cake);

      // 5. Create initial pairs
      console.log("\n5️⃣  Creating Initial Pairs...");
      
      // WBNB-USDT
      let tx = await factory.createPair(deployments.wbnb, deployments.usdt);
      await tx.wait();
      deployments.pairWBNB_USDT = await factory.getPair(deployments.wbnb, deployments.usdt);
      console.log("✅ WBNB-USDT pair:", deployments.pairWBNB_USDT);
      
      // WBNB-BUSD
      tx = await factory.createPair(deployments.wbnb, deployments.busd);
      await tx.wait();
      deployments.pairWBNB_BUSD = await factory.getPair(deployments.wbnb, deployments.busd);
      console.log("✅ WBNB-BUSD pair:", deployments.pairWBNB_BUSD);
      
      // USDT-BUSD
      tx = await factory.createPair(deployments.usdt, deployments.busd);
      await tx.wait();
      deployments.pairUSDT_BUSD = await factory.getPair(deployments.usdt, deployments.busd);
      console.log("✅ USDT-BUSD pair:", deployments.pairUSDT_BUSD);
      
      // WBNB-CAKE
      tx = await factory.createPair(deployments.wbnb, deployments.cake);
      await tx.wait();
      deployments.pairWBNB_CAKE = await factory.getPair(deployments.wbnb, deployments.cake);
      console.log("✅ WBNB-CAKE pair:", deployments.pairWBNB_CAKE);

      // 6. Add initial liquidity (optional)
      if (network === "localhost" || network === "hardhat") {
        console.log("\n6️⃣  Adding Initial Liquidity...");
        
        const liquidityAmount = hre.ethers.parseEther("10000");
        const bnbAmount = hre.ethers.parseEther("10");
        
        // Approve router
        await usdt.approve(deployments.router, liquidityAmount);
        await busd.approve(deployments.router, liquidityAmount);
        await cake.approve(deployments.router, liquidityAmount);
        
        // Add WBNB-USDT liquidity (1 BNB = 300 USDT)
        await router.addLiquidityBNB(
          deployments.usdt,
          hre.ethers.parseEther("3000"), // 3000 USDT
          0,
          0,
          deployer.address,
          Math.floor(Date.now() / 1000) + 3600,
          { value: bnbAmount }
        );
        console.log("✅ Added WBNB-USDT liquidity");
        
        // Add WBNB-BUSD liquidity (1 BNB = 300 BUSD)
        await router.addLiquidityBNB(
          deployments.busd,
          hre.ethers.parseEther("3000"), // 3000 BUSD
          0,
          0,
          deployer.address,
          Math.floor(Date.now() / 1000) + 3600,
          { value: bnbAmount }
        );
        console.log("✅ Added WBNB-BUSD liquidity");
        
        // Add USDT-BUSD liquidity (1:1)
        await router.addLiquidity(
          deployments.usdt,
          deployments.busd,
          hre.ethers.parseEther("5000"),
          hre.ethers.parseEther("5000"),
          0,
          0,
          deployer.address,
          Math.floor(Date.now() / 1000) + 3600
        );
        console.log("✅ Added USDT-BUSD liquidity");
      }
    }

    // 7. Save deployment info
    console.log("\n7️⃣  Saving Deployment Info...");
    
    const deploymentInfo = {
      network: network,
      timestamp: new Date().toISOString(),
      deployer: deployer.address,
      contracts: deployments,
      verified: false
    };

    const deploymentsDir = path.join(__dirname, "../deployments");
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }

    const filename = `${network}_${Date.now()}.json`;
    fs.writeFileSync(
      path.join(deploymentsDir, filename),
      JSON.stringify(deploymentInfo, null, 2)
    );
    
    fs.writeFileSync(
      path.join(deploymentsDir, `${network}_latest.json`),
      JSON.stringify(deploymentInfo, null, 2)
    );

    console.log("✅ Deployment info saved to:", filename);

    // 8. Verify contracts (for testnet/mainnet)
    if (network === "bsc_testnet" || network === "bsc_mainnet") {
      console.log("\n8️⃣  Verifying Contracts...");
      console.log("⏳ Waiting 30 seconds for blockchain to index...");
      await new Promise(resolve => setTimeout(resolve, 30000));

      try {
        // Verify WBNB
        await hre.run("verify:verify", {
          address: deployments.wbnb,
          constructorArguments: []
        });
        console.log("✅ WBNB verified");

        // Verify Factory
        await hre.run("verify:verify", {
          address: deployments.factory,
          constructorArguments: []
        });
        console.log("✅ Factory verified");

        // Verify Router
        await hre.run("verify:verify", {
          address: deployments.router,
          constructorArguments: [deployments.factory, deployments.wbnb]
        });
        console.log("✅ Router verified");

        deploymentInfo.verified = true;
        fs.writeFileSync(
          path.join(deploymentsDir, `${network}_latest.json`),
          JSON.stringify(deploymentInfo, null, 2)
        );
      } catch (error) {
        console.log("⚠️  Verification failed:", error.message);
        console.log("   You can verify manually later using:");
        console.log(`   npx hardhat verify --network ${network} ${deployments.wbnb}`);
        console.log(`   npx hardhat verify --network ${network} ${deployments.factory}`);
        console.log(`   npx hardhat verify --network ${network} ${deployments.router} ${deployments.factory} ${deployments.wbnb}`);
      }
    }

    console.log("\n=====================================");
    console.log("🎉 DEPLOYMENT SUCCESSFUL!");
    console.log("=====================================");
    console.log("\n📋 Summary:");
    console.log(JSON.stringify(deployments, null, 2));

    return deployments;

  } catch (error) {
    console.error("\n❌ Deployment failed:", error);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });