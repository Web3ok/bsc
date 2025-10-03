const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BianDEX Production", function () {
  let factory, pool;
  let token0, token1;
  let owner, user1, user2;
  let INITIAL_SUPPLY;
  let LIQUIDITY_AMOUNT; 
  let SWAP_AMOUNT;
  const MINIMUM_LIQUIDITY = 1000n;

  // Helper function to get future deadline
  async function getDeadline() {
    const blockNumber = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(blockNumber);
    return block.timestamp + 3600; // 1 hour from now
  }

  beforeEach(async function () {
    // Initialize amounts
    INITIAL_SUPPLY = ethers.parseEther("10000");
    LIQUIDITY_AMOUNT = ethers.parseEther("100");
    SWAP_AMOUNT = ethers.parseEther("10");
    
    // Get accounts
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy test tokens
    const Token = await ethers.getContractFactory("TestToken");
    token0 = await Token.deploy("Token A", "TKA", INITIAL_SUPPLY);
    token1 = await Token.deploy("Token B", "TKB", INITIAL_SUPPLY);
    
    // Ensure token0 address < token1
    if (token0.target > token1.target) {
      [token0, token1] = [token1, token0];
    }

    // Deploy BianDEXFactory
    const Factory = await ethers.getContractFactory("BianDEXFactory");
    factory = await Factory.deploy();

    // Create pair
    await factory.createPair(token0.target, token1.target);
    const poolAddress = await factory.getPair(token0.target, token1.target);
    
    // Get liquidity pool contract
    const Pool = await ethers.getContractFactory("SimpleLiquidityPool");
    pool = Pool.attach(poolAddress);

    // Distribute tokens to users
    await token0.transfer(user1.address, ethers.parseEther("1000"));
    await token1.transfer(user1.address, ethers.parseEther("1000"));
    await token0.transfer(user2.address, ethers.parseEther("1000"));
    await token1.transfer(user2.address, ethers.parseEther("1000"));
  });

  describe("Factory", function () {
    it("Should create pairs correctly", async function () {
      expect(await factory.allPairsLength()).to.equal(1);
      const pair = await factory.getPair(token0.target, token1.target);
      expect(pair).to.not.equal(ethers.ZeroAddress);
      
      // Should get same pair with reversed order
      const reversePair = await factory.getPair(token1.target, token0.target);
      expect(pair).to.equal(reversePair);
    });

    it("Should not create duplicate pairs", async function () {
      await expect(
        factory.createPair(token0.target, token1.target)
      ).to.be.revertedWith("Pair exists");
    });

    it("Should not create pair with identical tokens", async function () {
      await expect(
        factory.createPair(token0.target, token0.target)
      ).to.be.revertedWith("Identical tokens");
    });
  });

  describe("Add Liquidity with Production Features", function () {
    it("Should add initial liquidity with minimum liquidity lock", async function () {
      const deadline = await getDeadline();
      
      // Approve tokens
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      
      // Add liquidity with slippoint protection
      const tx = await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT * 99n / 100n, // 1% slippage allowed for amount0Min
        LIQUIDITY_AMOUNT * 99n / 100n, // 1% slippage allowed for amount1Min
        deadline,
        user1.address
      );
      
      // Check reserves
      const reserves = await pool.getReserves();
      expect(reserves[0]).to.equal(LIQUIDITY_AMOUNT);
      expect(reserves[1]).to.equal(LIQUIDITY_AMOUNT);
      
      // Check LP tokens (should be sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY)
      const lpBalance = await pool.balanceOf(user1.address);
      const expectedLiquidity = BigInt(Math.sqrt(Number(LIQUIDITY_AMOUNT * LIQUIDITY_AMOUNT))) - MINIMUM_LIQUIDITY;
      expect(lpBalance).to.be.closeTo(expectedLiquidity, ethers.parseEther("0.001"));
      
      // Check minimum liquidity was locked to DEAD_ADDRESS
      const deadBalance = await pool.balanceOf("0x000000000000000000000000000000000000dEaD");
      expect(deadBalance).to.equal(MINIMUM_LIQUIDITY);
    });

    it("Should reject expired deadline", async function () {
      const pastDeadline = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      
      await expect(
        pool.connect(user1).addLiquidity(
          LIQUIDITY_AMOUNT,
          LIQUIDITY_AMOUNT,
          0,
          0,
          pastDeadline
        ,
        user1.address)
      ).to.be.revertedWith("Expired");
    });

    it("Should reject if slippoint protection triggered", async function () {
      const deadline = await getDeadline();
      
      // First user adds liquidity
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        0,
        0,
        deadline,
        user1.address
      );
      
      // Second user tries to add with different ratio but strict slippage
      const amount0 = ethers.parseEther("50");
      const amount1 = ethers.parseEther("100"); // 2:1 ratio instead of 1:1
      
      await token0.connect(user2).approve(pool.target, amount0);
      await token1.connect(user2).approve(pool.target, amount1);
      
      await expect(
        pool.connect(user2).addLiquidity(
          amount0,
          amount1,
          amount0, // Require exact amount0
          amount1, // Require exact amount1
          deadline
        ,
        user2.address)
      ).to.be.revertedWith("Insufficient amount1");
    });

    it("Should add liquidity proportionally", async function () {
      const deadline = await getDeadline();
      
      // User1 adds initial liquidity
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        0,
        0,
        deadline,
        user1.address
      );
      
      const initialLPBalance = await pool.balanceOf(user1.address);
      
      // User2 adds liquidity (same ratio)
      const addAmount = ethers.parseEther("50");
      await token0.connect(user2).approve(pool.target, addAmount);
      await token1.connect(user2).approve(pool.target, addAmount);
      await pool.connect(user2).addLiquidity(
        addAmount,
        addAmount,
        0,
        0,
        deadline,
        user2.address
      );
      
      // Check LP token ratio
      const user2LPBalance = await pool.balanceOf(user2.address);
      expect(user2LPBalance).to.be.closeTo(initialLPBalance / 2n, ethers.parseEther("0.001"));
    });

    it("Should reject zero amounts", async function () {
      const deadline = await getDeadline();
      
      await expect(
        pool.connect(user1).addLiquidity(0, LIQUIDITY_AMOUNT, 0, 0, deadline, user1.address)
      ).to.be.revertedWith("Invalid amounts");
    });
  });

  describe("Remove Liquidity with Production Features", function () {
    beforeEach(async function () {
      const deadline = await getDeadline();
      // Add initial liquidity
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        0,
        0,
        deadline,
        user1.address
      );
    });

    it("Should remove liquidity with slippoint protection", async function () {
      const deadline = await getDeadline();
      const lpBalance = await pool.balanceOf(user1.address);
      const initialToken0 = await token0.balanceOf(user1.address);
      const initialToken1 = await token1.balanceOf(user1.address);
      
      // Remove 50% liquidity
      const removeAmount = lpBalance / 2n;
      const expectedAmount0 = LIQUIDITY_AMOUNT / 2n;
      const expectedAmount1 = LIQUIDITY_AMOUNT / 2n;
      
      await pool.connect(user1).removeLiquidity(
        removeAmount,
        expectedAmount0 * 99n / 100n, // 1% slippage allowed
        expectedAmount1 * 99n / 100n, // 1% slippage allowed
        deadline,
        user1.address
      );
      
      // Check tokens returned
      const finalToken0 = await token0.balanceOf(user1.address);
      const finalToken1 = await token1.balanceOf(user1.address);
      
      expect(finalToken0 - initialToken0).to.be.closeTo(expectedAmount0, ethers.parseEther("0.001"));
      expect(finalToken1 - initialToken1).to.be.closeTo(expectedAmount1, ethers.parseEther("0.001"));
      
      // Check LP tokens burned
      expect(await pool.balanceOf(user1.address)).to.equal(lpBalance - removeAmount);
    });

    it("Should reject removal with insufficient output", async function () {
      const deadline = await getDeadline();
      const lpBalance = await pool.balanceOf(user1.address);
      
      await expect(
        pool.connect(user1).removeLiquidity(
          lpBalance,
          LIQUIDITY_AMOUNT * 2n, // Impossible amount0Min
          LIQUIDITY_AMOUNT,
          deadline
        ,
        user1.address)
      ).to.be.revertedWith("Insufficient amount0");
    });

    it("Should reject expired deadline", async function () {
      const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
      const lpBalance = await pool.balanceOf(user1.address);
      
      await expect(
        pool.connect(user1).removeLiquidity(lpBalance, 0, 0, pastDeadline, user1.address)
      ).to.be.revertedWith("Expired");
    });

    it("Should reject removing excess liquidity", async function () {
      const deadline = await getDeadline();
      const lpBalance = await pool.balanceOf(user1.address);
      
      await expect(
        pool.connect(user1).removeLiquidity(lpBalance + 1n, 0, 0, deadline, user1.address)
      ).to.be.revertedWith("Insufficient balance");
    });
  });

  describe("Token Swap with Production Features", function () {
    beforeEach(async function () {
      const deadline = await getDeadline();
      // Add liquidity
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        0,
        0,
        deadline,
        user1.address
      );
    });

    it("Should swap token0 to token1 with slippoint protection", async function () {
      const deadline = await getDeadline();
      const initialToken1 = await token1.balanceOf(user2.address);
      
      // Calculate expected output
      const expectedOut = await pool.getAmountOut(token0.target, SWAP_AMOUNT);
      
      // Execute swap with slippoint protection
      await token0.connect(user2).approve(pool.target, SWAP_AMOUNT);
      await pool.connect(user2).swap(
        token0.target,
        SWAP_AMOUNT,
        expectedOut * 99n / 100n, // Allow 1% slippage
        deadline
      );
      
      // Check result
      const finalToken1 = await token1.balanceOf(user2.address);
      expect(finalToken1 - initialToken1).to.equal(expectedOut);
    });

    it("Should swap token1 to token0", async function () {
      const deadline = await getDeadline();
      const initialToken0 = await token0.balanceOf(user2.address);
      
      // Calculate expected output
      const expectedOut = await pool.getAmountOut(token1.target, SWAP_AMOUNT);
      
      // Execute swap
      await token1.connect(user2).approve(pool.target, SWAP_AMOUNT);
      await pool.connect(user2).swap(
        token1.target,
        SWAP_AMOUNT,
        expectedOut * 99n / 100n,
        deadline
      );
      
      // Check result
      const finalToken0 = await token0.balanceOf(user2.address);
      expect(finalToken0 - initialToken0).to.equal(expectedOut);
    });

    it("Should charge 0.3% fee correctly", async function () {
      // Ideal output without fee
      const idealOutput = (SWAP_AMOUNT * LIQUIDITY_AMOUNT) / (LIQUIDITY_AMOUNT + SWAP_AMOUNT);
      
      // Actual output (with fee)
      const actualOutput = await pool.getAmountOut(token0.target, SWAP_AMOUNT);
      
      // Fee should be approximately 0.3%
      const feeAmount = idealOutput - actualOutput;
      const feePercent = (feeAmount * 10000n) / idealOutput;
      
      // Allow small error due to integer math
      expect(feePercent).to.be.closeTo(30n, 3n); // 0.3% = 30/10000
    });

    it("Should reject swap with excessive slippage", async function () {
      const deadline = await getDeadline();
      const expectedOut = await pool.getAmountOut(token0.target, SWAP_AMOUNT);
      
      await token0.connect(user2).approve(pool.target, SWAP_AMOUNT);
      await expect(
        pool.connect(user2).swap(
          token0.target,
          SWAP_AMOUNT,
          expectedOut + 1n, // Require more than possible
          deadline
        )
      ).to.be.revertedWith("Insufficient output amount");
    });

    it("Should reject expired deadline", async function () {
      const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
      
      await token0.connect(user2).approve(pool.target, SWAP_AMOUNT);
      await expect(
        pool.connect(user2).swap(token0.target, SWAP_AMOUNT, 0, pastDeadline)
      ).to.be.revertedWith("Expired");
    });

    it("Should reject invalid token address", async function () {
      const deadline = await getDeadline();
      
      await expect(
        pool.connect(user2).swap(user2.address, SWAP_AMOUNT, 0, deadline)
      ).to.be.revertedWith("Invalid token");
    });
  });

  describe("K-Value Protection", function () {
    beforeEach(async function () {
      const deadline = await getDeadline();
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        0,
        0,
        deadline,
        user1.address
      );
    });

    it("Should maintain or increase K value after swap", async function () {
      const deadline = await getDeadline();
      
      // Get initial K value
      const reserves = await pool.getReserves();
      const initialK = reserves[0] * reserves[1];
      
      // Perform swap
      const swapAmount = ethers.parseEther("10");
      const expectedOut = await pool.getAmountOut(token0.target, swapAmount);
      
      await token0.connect(user2).approve(pool.target, swapAmount);
      await pool.connect(user2).swap(
        token0.target,
        swapAmount,
        expectedOut * 99n / 100n,
        deadline
      );
      
      // Check K value after swap
      const newReserves = await pool.getReserves();
      const newK = newReserves[0] * newReserves[1];
      
      // K should increase due to fees
      expect(newK).to.be.gte(initialK);
    });
  });

  describe("Pause Functionality", function () {
    beforeEach(async function () {
      const deadline = await getDeadline();
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        0,
        0,
        deadline,
        user1.address
      );
    });

    it("Should allow owner to pause and unpause", async function () {
      // Pause the contract (owner is the first signer)
      await pool.pause();
      
      // Try to swap while paused
      const deadline = await getDeadline();
      await token0.connect(user2).approve(pool.target, SWAP_AMOUNT);
      
      await expect(
        pool.connect(user2).swap(token0.target, SWAP_AMOUNT, 0, deadline)
      ).to.be.revertedWithCustomError(pool, "EnforcedPause");
      
      // Unpause
      await pool.connect(owner).unpause();
      
      // Now swap should work
      const expectedOut = await pool.getAmountOut(token0.target, SWAP_AMOUNT);
      await pool.connect(user2).swap(
        token0.target,
        SWAP_AMOUNT,
        expectedOut * 99n / 100n,
        deadline
      );
    });

    it("Should prevent non-owner from pausing", async function () {
      await expect(
        pool.connect(user1).pause()
      ).to.be.revertedWithCustomError(pool, "OwnableUnauthorizedAccount");
    });

    it("Should prevent adding liquidity when paused", async function () {
      await pool.pause();
      
      const deadline = await getDeadline();
      await token0.connect(user2).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user2).approve(pool.target, LIQUIDITY_AMOUNT);
      
      await expect(
        pool.connect(user2).addLiquidity(
          LIQUIDITY_AMOUNT,
          LIQUIDITY_AMOUNT,
          0,
          0,
          deadline
        ,
        user2.address)
      ).to.be.revertedWithCustomError(pool, "EnforcedPause");
    });
  });

  describe("Reserve Updates and Sync", function () {
    it("Should update reserves correctly after operations", async function () {
      const deadline = await getDeadline();
      
      // Add liquidity
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        0,
        0,
        deadline,
        user1.address
      );
      
      let reserves = await pool.getReserves();
      expect(reserves[0]).to.equal(LIQUIDITY_AMOUNT);
      expect(reserves[1]).to.equal(LIQUIDITY_AMOUNT);
      
      // Execute swap
      await token0.connect(user2).approve(pool.target, SWAP_AMOUNT);
      const expectedOut = await pool.getAmountOut(token0.target, SWAP_AMOUNT);
      await pool.connect(user2).swap(
        token0.target,
        SWAP_AMOUNT,
        expectedOut * 99n / 100n,
        deadline
      );
      
      // Check reserves updated
      reserves = await pool.getReserves();
      expect(reserves[0]).to.equal(LIQUIDITY_AMOUNT + SWAP_AMOUNT);
      expect(reserves[1]).to.equal(LIQUIDITY_AMOUNT - expectedOut);
    });

    it("Should sync reserves correctly", async function () {
      const deadline = await getDeadline();
      
      // Add liquidity
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        0,
        0,
        deadline,
        user1.address
      );
      
      // Manually transfer tokens to pool (simulating external transfer)
      const extraAmount = ethers.parseEther("10");
      await token0.transfer(pool.target, extraAmount);
      
      // Reserves should not reflect the extra tokens yet
      let reserves = await pool.getReserves();
      expect(reserves[0]).to.equal(LIQUIDITY_AMOUNT);
      
      // Sync reserves
      await pool.sync();
      
      // Now reserves should include the extra tokens
      reserves = await pool.getReserves();
      expect(reserves[0]).to.equal(LIQUIDITY_AMOUNT + extraAmount);
    });
  });

  describe("Price Calculation", function () {
    beforeEach(async function () {
      const deadline = await getDeadline();
      await token0.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await token1.connect(user1).approve(pool.target, LIQUIDITY_AMOUNT);
      await pool.connect(user1).addLiquidity(
        LIQUIDITY_AMOUNT,
        LIQUIDITY_AMOUNT,
        0,
        0,
        deadline,
        user1.address
      );
    });

    it("Should calculate output correctly for different amounts", async function () {
      const amounts = [
        ethers.parseEther("1"),
        ethers.parseEther("5"),
        ethers.parseEther("10"),
        ethers.parseEther("20")
      ];
      
      for (const amount of amounts) {
        const output = await pool.getAmountOut(token0.target, amount);
        
        // Output should be positive
        expect(output).to.be.gt(0);
        
        // Verify constant product formula (with fees)
        const reserves = await pool.getReserves();
        const k = reserves[0] * reserves[1];
        
        const amountInWithFee = amount * 997n / 1000n;
        const newReserve0 = reserves[0] + amount;
        const newReserve1 = k / (reserves[0] + amountInWithFee);
        const expectedOutput = reserves[1] - newReserve1;
        
        // Allow small error
        expect(output).to.be.closeTo(expectedOutput, ethers.parseEther("0.001"));
      }
    });

    it("Should reject invalid token for getAmountOut", async function () {
      await expect(
        pool.getAmountOut(user1.address, ethers.parseEther("1"))
      ).to.be.revertedWith("Invalid token");
    });

    it("Should reject zero amount for getAmountOut", async function () {
      await expect(
        pool.getAmountOut(token0.target, 0)
      ).to.be.revertedWith("Invalid amount");
    });
  });
});

// Test token contract
const TestTokenCode = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestToken is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply) ERC20(name, symbol) {
        _mint(msg.sender, initialSupply);
    }
}
`;

// Save test token contract
const fs = require('fs');
const path = require('path');

const contractsDir = path.join(__dirname, '..', 'contracts');
if (!fs.existsSync(contractsDir)) {
  fs.mkdirSync(contractsDir);
}

fs.writeFileSync(
  path.join(contractsDir, 'TestToken.sol'),
  TestTokenCode
);