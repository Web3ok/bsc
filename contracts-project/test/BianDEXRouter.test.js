const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("BianDEXRouter", function () {
  let owner, user1, user2;
  let factory, router, wbnb;
  let tokenA, tokenB, tokenC;
  let pair;

  // Helper function to get current block timestamp
  async function getCurrentTimestamp() {
    const block = await ethers.provider.getBlock('latest');
    return block.timestamp;
  }

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy WBNB
    const WBNB = await ethers.getContractFactory("WBNB");
    wbnb = await WBNB.deploy();

    // Deploy Factory
    const Factory = await ethers.getContractFactory("BianDEXFactory");
    factory = await Factory.deploy();

    // Deploy Router
    const Router = await ethers.getContractFactory("BianDEXRouter");
    router = await Router.deploy(await factory.getAddress(), await wbnb.getAddress());

    // Deploy test tokens
    const TestToken = await ethers.getContractFactory("TestToken");
    tokenA = await TestToken.deploy("Token A", "TKA", ethers.parseEther("10000"));
    tokenB = await TestToken.deploy("Token B", "TKB", ethers.parseEther("10000"));
    tokenC = await TestToken.deploy("Token C", "TKC", ethers.parseEther("10000"));

    // Transfer tokens to users
    await tokenA.transfer(user1.address, ethers.parseEther("1000"));
    await tokenB.transfer(user1.address, ethers.parseEther("1000"));
    await tokenC.transfer(user1.address, ethers.parseEther("1000"));
  });

  describe("Security: Deadline Enforcement", function () {
    it("Should respect user-provided deadline in swaps", async function () {
      // Setup liquidity
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");
      
      await tokenA.approve(await router.getAddress(), amountA);
      await tokenB.approve(await router.getAddress(), amountB);
      
      const currentTime = await getCurrentTimestamp();
      const deadline = currentTime + 60;
      await router.addLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0,
        0,
        owner.address,
        deadline
      );

      // Try to swap with expired deadline
      const expiredDeadline = Math.floor(Date.now() / 1000) - 60;
      const swapAmount = ethers.parseEther("1");
      
      await tokenA.connect(user1).approve(await router.getAddress(), swapAmount);
      
      await expect(
        router.connect(user1).swapExactTokensForTokens(
          swapAmount,
          0,
          [await tokenA.getAddress(), await tokenB.getAddress()],
          user1.address,
          expiredDeadline
        )
      ).to.be.revertedWith("Router: EXPIRED");
    });

    it("Should pass deadline to underlying pool swap", async function () {
      // Setup liquidity
      const amountA = ethers.parseEther("100");
      const amountB = ethers.parseEther("100");
      
      await tokenA.approve(await router.getAddress(), amountA);
      await tokenB.approve(await router.getAddress(), amountB);
      
      const currentTime = await getCurrentTimestamp();
      const deadline = currentTime + 60;
      await router.addLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0,
        0,
        owner.address,
        deadline
      );

      // Perform swap with short deadline
      const swapAmount = ethers.parseEther("1");
      const currentTime2 = await getCurrentTimestamp();
      const shortDeadline = currentTime2 + 60;
      
      await tokenA.connect(user1).approve(await router.getAddress(), swapAmount);
      
      // This should succeed if deadline is respected
      await router.connect(user1).swapExactTokensForTokens(
        swapAmount,
        0,
        [await tokenA.getAddress(), await tokenB.getAddress()],
        user1.address,
        shortDeadline
      );

      // Advance time and try again - should fail
      await time.increase(61);
      
      await tokenA.connect(user1).approve(await router.getAddress(), swapAmount);
      await expect(
        router.connect(user1).swapExactTokensForTokens(
          swapAmount,
          0,
          [await tokenA.getAddress(), await tokenB.getAddress()],
          user1.address,
          shortDeadline
        )
      ).to.be.revertedWith("Router: EXPIRED");
    });
  });

  describe("Security: Minimum Output Protection", function () {
    beforeEach(async function () {
      // Setup liquidity for testing
      const amountA = ethers.parseEther("1000");
      const amountB = ethers.parseEther("1000");
      
      await tokenA.approve(await router.getAddress(), amountA);
      await tokenB.approve(await router.getAddress(), amountB);
      
      const currentTime = await getCurrentTimestamp();
      const deadline = currentTime + 3600;
      await router.addLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amountA,
        amountB,
        0,
        0,
        owner.address,
        deadline
      );
    });

    it("Should revert if output is less than minAmountOut", async function () {
      const swapAmount = ethers.parseEther("10");
      const [, expectedOut] = await router.getAmountsOut(
        swapAmount,
        [await tokenA.getAddress(), await tokenB.getAddress()]
      );
      
      await tokenA.connect(user1).approve(await router.getAddress(), swapAmount);
      
      // Request more than possible output
      const unreasonableMinOut = expectedOut + ethers.parseEther("1");
      
      await expect(
        router.connect(user1).swapExactTokensForTokens(
          swapAmount,
          unreasonableMinOut,
          [await tokenA.getAddress(), await tokenB.getAddress()],
          user1.address,
  (await getCurrentTimestamp()) + 60
        )
      ).to.be.revertedWith("Router: INSUFFICIENT_OUTPUT");
    });

    it("Should return exactly the calculated amount without arbitrary slippage", async function () {
      const swapAmount = ethers.parseEther("10");
      const balanceBefore = await tokenB.balanceOf(user1.address);
      
      const [, expectedOut] = await router.getAmountsOut(
        swapAmount,
        [await tokenA.getAddress(), await tokenB.getAddress()]
      );
      
      await tokenA.connect(user1).approve(await router.getAddress(), swapAmount);
      
      await router.connect(user1).swapExactTokensForTokens(
        swapAmount,
        expectedOut, // Request exact calculated amount
        [await tokenA.getAddress(), await tokenB.getAddress()],
        user1.address,
(await getCurrentTimestamp()) + 60
      );
      
      const balanceAfter = await tokenB.balanceOf(user1.address);
      const actualOut = balanceAfter - balanceBefore;
      
      // Should receive exactly the calculated amount, not 99% of it
      expect(actualOut).to.equal(expectedOut);
    });
  });

  describe("Multi-hop Swaps", function () {
    beforeEach(async function () {
      // Create A-B and B-C pairs
      const amount = ethers.parseEther("1000");
      
      await tokenA.approve(await router.getAddress(), amount * 2n);
      await tokenB.approve(await router.getAddress(), amount * 2n);
      await tokenC.approve(await router.getAddress(), amount);
      
      const currentTime = await getCurrentTimestamp();
      const deadline = currentTime + 3600;
      
      // Add A-B liquidity
      await router.addLiquidity(
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        amount,
        amount,
        0,
        0,
        owner.address,
        deadline
      );
      
      // Add B-C liquidity
      await router.addLiquidity(
        await tokenB.getAddress(),
        await tokenC.getAddress(),
        amount,
        amount,
        0,
        0,
        owner.address,
        deadline
      );
    });

    it("Should execute multi-hop swap A->B->C correctly", async function () {
      const swapAmount = ethers.parseEther("10");
      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress()
      ];
      
      const amounts = await router.getAmountsOut(swapAmount, path);
      const expectedOut = amounts[2];
      
      await tokenA.connect(user1).approve(await router.getAddress(), swapAmount);
      
      const balanceBefore = await tokenC.balanceOf(user1.address);
      
      await router.connect(user1).swapExactTokensForTokens(
        swapAmount,
        expectedOut,
        path,
        user1.address,
(await getCurrentTimestamp()) + 60
      );
      
      const balanceAfter = await tokenC.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(expectedOut);
    });

    it("Should respect deadline for all hops", async function () {
      const swapAmount = ethers.parseEther("10");
      const path = [
        await tokenA.getAddress(),
        await tokenB.getAddress(),
        await tokenC.getAddress()
      ];
      
      await tokenA.connect(user1).approve(await router.getAddress(), swapAmount);
      
      const expiredDeadline = Math.floor(Date.now() / 1000) - 60;
      
      await expect(
        router.connect(user1).swapExactTokensForTokens(
          swapAmount,
          0,
          path,
          user1.address,
          expiredDeadline
        )
      ).to.be.revertedWith("Router: EXPIRED");
    });
  });

  describe("BNB Integration", function () {
    it("Should swap exact BNB for tokens", async function () {
      // Setup WBNB-TokenA liquidity
      const tokenAmount = ethers.parseEther("1000");
      const bnbAmount = ethers.parseEther("10");
      
      await tokenA.approve(await router.getAddress(), tokenAmount);
      
      await router.addLiquidityBNB(
        await tokenA.getAddress(),
        tokenAmount,
        0,
        0,
        owner.address,
(await getCurrentTimestamp()) + 60,
        { value: bnbAmount }
      );
      
      // Swap BNB for tokens
      const swapBnb = ethers.parseEther("1");
      const path = [await wbnb.getAddress(), await tokenA.getAddress()];
      const [, expectedOut] = await router.getAmountsOut(swapBnb, path);
      
      const balanceBefore = await tokenA.balanceOf(user1.address);
      
      await router.connect(user1).swapExactBNBForTokens(
        expectedOut,
        path,
        user1.address,
(await getCurrentTimestamp()) + 60,
        { value: swapBnb }
      );
      
      const balanceAfter = await tokenA.balanceOf(user1.address);
      expect(balanceAfter - balanceBefore).to.equal(expectedOut);
    });

    it("Should swap exact tokens for BNB", async function () {
      // Setup TokenA-WBNB liquidity
      const tokenAmount = ethers.parseEther("1000");
      const bnbAmount = ethers.parseEther("10");
      
      await tokenA.approve(await router.getAddress(), tokenAmount);
      
      await router.addLiquidityBNB(
        await tokenA.getAddress(),
        tokenAmount,
        0,
        0,
        owner.address,
(await getCurrentTimestamp()) + 60,
        { value: bnbAmount }
      );
      
      // Swap tokens for BNB
      const swapAmount = ethers.parseEther("100");
      const path = [await tokenA.getAddress(), await wbnb.getAddress()];
      const [, expectedOut] = await router.getAmountsOut(swapAmount, path);
      
      await tokenA.connect(user1).approve(await router.getAddress(), swapAmount);
      
      const balanceBefore = await ethers.provider.getBalance(user1.address);
      
      const tx = await router.connect(user1).swapExactTokensForBNB(
        swapAmount,
        expectedOut,
        path,
        user1.address,
(await getCurrentTimestamp()) + 60
      );
      
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * tx.gasPrice;
      
      const balanceAfter = await ethers.provider.getBalance(user1.address);
      const actualReceived = balanceAfter - balanceBefore + gasUsed;
      
      // Allow small deviation due to gas calculations
      expect(actualReceived).to.be.closeTo(expectedOut, ethers.parseEther("0.001"));
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero liquidity pairs correctly", async function () {
      const path = [await tokenA.getAddress(), await tokenB.getAddress()];
      
      // Try to get amounts for non-existent pair
      await expect(
        router.getAmountsOut(ethers.parseEther("1"), path)
      ).to.be.revertedWith("Router: PAIR_NOT_FOUND");
    });

    it("Should validate path length", async function () {
      // Single token path should fail
      await expect(
        router.getAmountsOut(ethers.parseEther("1"), [await tokenA.getAddress()])
      ).to.be.revertedWith("Router: INVALID_PATH");
      
      // Empty path should fail
      await expect(
        router.getAmountsOut(ethers.parseEther("1"), [])
      ).to.be.revertedWith("Router: INVALID_PATH");
    });

    it("Should handle identical token pairs", async function () {
      const sameToken = await tokenA.getAddress();
      
      // Should revert when trying to create pair with same token
      await expect(
        factory.createPair(sameToken, sameToken)
      ).to.be.revertedWith("Identical tokens");
    });
  });
});