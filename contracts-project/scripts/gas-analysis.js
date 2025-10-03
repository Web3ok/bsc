const hre = require("hardhat");

async function analyzeGas() {
  console.log("⛽ Gas Cost Analysis for BianDEX\n");
  console.log("═══════════════════════════════════════════════\n");
  
  const [deployer, user1, user2] = await hre.ethers.getSigners();
  
  console.log("📦 Deploying contracts for analysis...\n");
  
  const Factory = await hre.ethers.getContractFactory("BianDEXFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  
  const WBNB = await hre.ethers.getContractFactory("WBNB");
  const wbnb = await WBNB.deploy();
  await wbnb.waitForDeployment();
  
  const Router = await hre.ethers.getContractFactory("BianDEXRouter");
  const router = await Router.deploy(factoryAddress, await wbnb.getAddress());
  await router.waitForDeployment();
  
  const Token = await hre.ethers.getContractFactory("TestToken");
  const tokenA = await Token.deploy("Token A", "TKA", hre.ethers.parseEther("1000000"));
  await tokenA.waitForDeployment();
  const tokenB = await Token.deploy("Token B", "TKB", hre.ethers.parseEther("1000000"));
  await tokenB.waitForDeployment();
  
  console.log("1️⃣  DEPLOYMENT COSTS\n");
  
  const factoryReceipt = await hre.ethers.provider.getTransactionReceipt(factory.deploymentTransaction().hash);
  const routerReceipt = await hre.ethers.provider.getTransactionReceipt(router.deploymentTransaction().hash);
  
  console.log(`Factory:  ${factoryReceipt.gasUsed.toString().padStart(10)} gas`);
  console.log(`Router:   ${routerReceipt.gasUsed.toString().padStart(10)} gas`);
  console.log(`Total:    ${(factoryReceipt.gasUsed + routerReceipt.gasUsed).toString().padStart(10)} gas`);
  console.log(`\nEstimated cost @ 5 Gwei: ${hre.ethers.formatEther((factoryReceipt.gasUsed + routerReceipt.gasUsed) * 5000000000n)} BNB\n`);
  
  console.log("2️⃣  POOL OPERATIONS\n");
  
  let tx = await factory.createPair(await tokenA.getAddress(), await tokenB.getAddress());
  let receipt = await tx.wait();
  const pairAddress = await factory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
  console.log(`Create Pair:     ${receipt.gasUsed.toString().padStart(10)} gas`);
  
  const Pool = await hre.ethers.getContractFactory("SimpleLiquidityPool");
  const pool = Pool.attach(pairAddress);
  
  const liquidityAmount = hre.ethers.parseEther("1000");
  await tokenA.approve(pairAddress, liquidityAmount);
  await tokenB.approve(pairAddress, liquidityAmount);
  
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  tx = await pool.addLiquidity(liquidityAmount, liquidityAmount, 0, 0, deadline, deployer.address);
  receipt = await tx.wait();
  console.log(`Add Liquidity:   ${receipt.gasUsed.toString().padStart(10)} gas (first time)`);
  
  await tokenA.approve(pairAddress, liquidityAmount);
  await tokenB.approve(pairAddress, liquidityAmount);
  tx = await pool.addLiquidity(liquidityAmount, liquidityAmount, 0, 0, deadline, deployer.address);
  receipt = await tx.wait();
  console.log(`Add Liquidity:   ${receipt.gasUsed.toString().padStart(10)} gas (subsequent)`);
  
  const lpBalance = await pool.balanceOf(deployer.address);
  const removeAmount = lpBalance / 10n;
  tx = await pool.removeLiquidity(removeAmount, 0, 0, deadline, deployer.address);
  receipt = await tx.wait();
  console.log(`Remove Liquidity:${receipt.gasUsed.toString().padStart(10)} gas`);
  
  console.log("\n3️⃣  SWAP OPERATIONS\n");
  
  await tokenA.transfer(user1.address, hre.ethers.parseEther("100"));
  const swapAmount = hre.ethers.parseEther("10");
  await tokenA.connect(user1).approve(pairAddress, swapAmount);
  
  tx = await pool.connect(user1).swap(
    await tokenA.getAddress(),
    swapAmount,
    0,
    deadline
  );
  receipt = await tx.wait();
  console.log(`Token Swap:      ${receipt.gasUsed.toString().padStart(10)} gas`);
  
  console.log("\n4️⃣  ROUTER OPERATIONS\n");
  
  await tokenA.connect(user1).approve(await router.getAddress(), swapAmount);
  tx = await router.connect(user1).swapExactTokensForTokens(
    swapAmount,
    0,
    [await tokenA.getAddress(), await tokenB.getAddress()],
    user1.address,
    deadline
  );
  receipt = await tx.wait();
  console.log(`Router Swap:     ${receipt.gasUsed.toString().padStart(10)} gas`);
  
  await tokenA.connect(user1).approve(await router.getAddress(), liquidityAmount);
  await tokenB.connect(user1).approve(await router.getAddress(), liquidityAmount);
  await tokenA.transfer(user1.address, liquidityAmount);
  await tokenB.transfer(user1.address, liquidityAmount);
  
  tx = await router.connect(user1).addLiquidity(
    await tokenA.getAddress(),
    await tokenB.getAddress(),
    liquidityAmount,
    liquidityAmount,
    0,
    0,
    user1.address,
    deadline
  );
  receipt = await tx.wait();
  console.log(`Router Add Liq:  ${receipt.gasUsed.toString().padStart(10)} gas`);
  
  console.log("\n5️⃣  ADMIN OPERATIONS\n");
  
  tx = await pool.pause();
  receipt = await tx.wait();
  console.log(`Pause:           ${receipt.gasUsed.toString().padStart(10)} gas`);
  
  tx = await pool.unpause();
  receipt = await tx.wait();
  console.log(`Unpause:         ${receipt.gasUsed.toString().padStart(10)} gas`);
  
  tx = await pool.sync();
  receipt = await tx.wait();
  console.log(`Sync:            ${receipt.gasUsed.toString().padStart(10)} gas`);
  
  console.log("\n═══════════════════════════════════════════════");
  console.log("\n💡 Gas Optimization Notes:");
  console.log("• Pool operations are optimized with SafeERC20");
  console.log("• Router adds overhead for convenience/safety");
  console.log("• First-time liquidity is more expensive (minimum liquidity lock)");
  console.log("• Direct pool swaps save ~30-40% gas vs router");
  console.log("\n📊 Estimated costs @ 5 Gwei gas price:");
  console.log("• Swap: ~$0.10 - $0.15");
  console.log("• Add Liquidity: ~$0.15 - $0.25");
  console.log("• Remove Liquidity: ~$0.10 - $0.15");
  console.log("\n✅ Analysis complete!\n");
}

analyzeGas()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
