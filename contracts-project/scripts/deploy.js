const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("🚀 Deploying BianDEX with account:", deployer.address);
  console.log("💰 Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // 部署工厂合约
  console.log("\n📦 Deploying BianDEXFactory...");
  const Factory = await hre.ethers.getContractFactory("BianDEXFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ BianDEXFactory deployed to:", factoryAddress);

  // 部署示例代币（仅用于测试）
  if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
    console.log("\n📦 Deploying test tokens...");
    const Token = await hre.ethers.getContractFactory("TestToken");
    
    const tokenA = await Token.deploy("Test Token A", "TKA", hre.ethers.parseEther("1000000"));
    await tokenA.waitForDeployment();
    const tokenAAddress = await tokenA.getAddress();
    console.log("✅ Token A deployed to:", tokenAAddress);
    
    const tokenB = await Token.deploy("Test Token B", "TKB", hre.ethers.parseEther("1000000"));
    await tokenB.waitForDeployment();
    const tokenBAddress = await tokenB.getAddress();
    console.log("✅ Token B deployed to:", tokenBAddress);
    
    // 创建交易对
    console.log("\n🔄 Creating pair...");
    const tx = await factory.createPair(tokenAAddress, tokenBAddress);
    await tx.wait();
    
    const pairAddress = await factory.getPair(tokenAAddress, tokenBAddress);
    console.log("✅ Pair created at:", pairAddress);
    
    // 添加初始流动性
    console.log("\n💧 Adding initial liquidity...");
    const Pool = await hre.ethers.getContractFactory("SimpleLiquidityPool");
    const pool = Pool.attach(pairAddress);
    
    const liquidityAmount = hre.ethers.parseEther("10000");
    await tokenA.approve(pairAddress, liquidityAmount);
    await tokenB.approve(pairAddress, liquidityAmount);
    
    await pool.addLiquidity(liquidityAmount, liquidityAmount);
    console.log("✅ Initial liquidity added");
  }

  // 保存部署信息
  const deploymentInfo = {
    network: hre.network.name,
    factory: factoryAddress,
    deployer: deployer.address,
    timestamp: new Date().toISOString()
  };

  console.log("\n📊 Deployment Summary:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // 写入文件
  const fs = require('fs');
  const path = require('path');
  const deploymentsDir = path.join(__dirname, '../deployments');
  
  if (!fs.existsSync(deploymentsDir)){
    fs.mkdirSync(deploymentsDir);
  }
  
  fs.writeFileSync(
    path.join(deploymentsDir, `${hre.network.name}_deployment.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("✅ Deployment info saved to deployments/");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });