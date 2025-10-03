const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("LimitOrderBook", function () {
  let limitOrderBook;
  let tokenA, tokenB;
  let owner, user1, user2, feeCollector;
  
  beforeEach(async function () {
    [owner, user1, user2, feeCollector] = await ethers.getSigners();
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    tokenA = await MockERC20.deploy("Token A", "TKA", ethers.parseEther("1000000"));
    tokenB = await MockERC20.deploy("Token B", "TKB", ethers.parseEther("1000000"));
    
    await tokenA.mint(user1.address, ethers.parseEther("10000"));
    await tokenA.mint(user2.address, ethers.parseEther("10000"));
    await tokenB.mint(user1.address, ethers.parseEther("10000"));
    await tokenB.mint(user2.address, ethers.parseEther("10000"));
    
    const LimitOrderBook = await ethers.getContractFactory("LimitOrderBook");
    limitOrderBook = await LimitOrderBook.deploy(feeCollector.address);
  });
  
  describe("Order Creation", function () {
    it("Should create a limit order successfully", async function () {
      const amountIn = ethers.parseEther("100");
      const minAmountOut = ethers.parseEther("95");
      const deadline = (await ethers.provider.getBlock('latest')).timestamp + 3600;
      
      await tokenA.connect(user1).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      const tx = await limitOrderBook.connect(user1).createOrder(
        tokenA.target,
        tokenB.target,
        amountIn,
        minAmountOut,
        deadline
      );
      
      await expect(tx).to.emit(limitOrderBook, "OrderCreated");
      
      const order = await limitOrderBook.getOrder(1);
      expect(order.maker).to.equal(user1.address);
      expect(order.amountIn).to.equal(amountIn);
      expect(order.minAmountOut).to.equal(minAmountOut);
      expect(order.filled).to.equal(false);
      expect(order.cancelled).to.equal(false);
    });
    
    it("Should fail to create order with same tokens", async function () {
      const deadline = (await ethers.provider.getBlock('latest')).timestamp + 3600;
      
      await expect(
        limitOrderBook.connect(user1).createOrder(
          tokenA.target,
          tokenA.target,
          ethers.parseEther("100"),
          ethers.parseEther("95"),
          deadline
        )
      ).to.be.revertedWith("Invalid tokens");
    });
    
    it("Should fail with expired deadline", async function () {
      const deadline = (await ethers.provider.getBlock('latest')).timestamp - 1;
      
      await expect(
        limitOrderBook.connect(user1).createOrder(
          tokenA.target,
          tokenB.target,
          ethers.parseEther("100"),
          ethers.parseEther("95"),
          deadline
        )
      ).to.be.revertedWith("Invalid deadline");
    });
    
    it("Should collect fee on order creation", async function () {
      const amountIn = ethers.parseEther("100");
      const feeAmount = amountIn * BigInt(10) / BigInt(10000);
      const totalAmount = amountIn + feeAmount;
      const deadline = (await ethers.provider.getBlock('latest')).timestamp + 3600;
      
      await tokenA.connect(user1).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      const balanceBefore = await tokenA.balanceOf(user1.address);
      
      await limitOrderBook.connect(user1).createOrder(
        tokenA.target,
        tokenB.target,
        amountIn,
        ethers.parseEther("95"),
        deadline
      );
      
      const balanceAfter = await tokenA.balanceOf(user1.address);
      expect(balanceBefore - balanceAfter).to.equal(totalAmount);
    });
  });
  
  describe("Order Filling", function () {
    let orderId;
    const amountIn = ethers.parseEther("100");
    const minAmountOut = ethers.parseEther("95");
    
    beforeEach(async function () {
      const deadline = (await ethers.provider.getBlock('latest')).timestamp + 3600;
      
      await tokenA.connect(user1).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      const tx = await limitOrderBook.connect(user1).createOrder(
        tokenA.target,
        tokenB.target,
        amountIn,
        minAmountOut,
        deadline
      );
      
      orderId = 1;
    });
    
    it("Should fill order successfully", async function () {
      const amountOut = ethers.parseEther("100");
      
      await tokenB.connect(user2).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      const user1BalanceBefore = await tokenB.balanceOf(user1.address);
      const user2BalanceBefore = await tokenA.balanceOf(user2.address);
      
      await limitOrderBook.connect(user2).fillOrder(orderId, amountOut);
      
      const user1BalanceAfter = await tokenB.balanceOf(user1.address);
      const user2BalanceAfter = await tokenA.balanceOf(user2.address);
      
      expect(user1BalanceAfter - user1BalanceBefore).to.equal(amountOut);
      expect(user2BalanceAfter - user2BalanceBefore).to.equal(amountIn);
      
      const order = await limitOrderBook.getOrder(orderId);
      expect(order.filled).to.equal(true);
    });
    
    it("Should send fee to fee collector", async function () {
      const amountOut = ethers.parseEther("100");
      
      await tokenB.connect(user2).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      const feeCollectorBalanceBefore = await tokenA.balanceOf(feeCollector.address);
      
      await limitOrderBook.connect(user2).fillOrder(orderId, amountOut);
      
      const feeCollectorBalanceAfter = await tokenA.balanceOf(feeCollector.address);
      const expectedFee = amountIn * BigInt(10) / BigInt(10000);
      
      expect(feeCollectorBalanceAfter - feeCollectorBalanceBefore).to.equal(expectedFee);
    });
    
    it("Should fail to fill with insufficient output", async function () {
      const amountOut = ethers.parseEther("90");
      
      await tokenB.connect(user2).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      await expect(
        limitOrderBook.connect(user2).fillOrder(orderId, amountOut)
      ).to.be.revertedWith("Insufficient output");
    });
    
    it("Should fail to fill already filled order", async function () {
      const amountOut = ethers.parseEther("100");
      
      await tokenB.connect(user2).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      await limitOrderBook.connect(user2).fillOrder(orderId, amountOut);
      
      await expect(
        limitOrderBook.connect(user2).fillOrder(orderId, amountOut)
      ).to.be.revertedWith("Order already filled");
    });
    
    it("Should fail to fill expired order", async function () {
      await mine(3700);
      
      const amountOut = ethers.parseEther("100");
      
      await tokenB.connect(user2).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      await expect(
        limitOrderBook.connect(user2).fillOrder(orderId, amountOut)
      ).to.be.revertedWith("Order expired");
    });
  });
  
  describe("Order Cancellation", function () {
    let orderId;
    const amountIn = ethers.parseEther("100");
    
    beforeEach(async function () {
      const deadline = (await ethers.provider.getBlock('latest')).timestamp + 3600;
      
      await tokenA.connect(user1).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      await limitOrderBook.connect(user1).createOrder(
        tokenA.target,
        tokenB.target,
        amountIn,
        ethers.parseEther("95"),
        deadline
      );
      
      orderId = 1;
    });
    
    it("Should cancel order successfully", async function () {
      const balanceBefore = await tokenA.balanceOf(user1.address);
      
      await limitOrderBook.connect(user1).cancelOrder(orderId);
      
      const balanceAfter = await tokenA.balanceOf(user1.address);
      const expectedRefund = amountIn + (amountIn * BigInt(10) / BigInt(10000));
      
      expect(balanceAfter - balanceBefore).to.equal(expectedRefund);
      
      const order = await limitOrderBook.getOrder(orderId);
      expect(order.cancelled).to.equal(true);
    });
    
    it("Should fail if not order maker", async function () {
      await expect(
        limitOrderBook.connect(user2).cancelOrder(orderId)
      ).to.be.revertedWith("Not order maker");
    });
    
    it("Should fail to cancel already filled order", async function () {
      const amountOut = ethers.parseEther("100");
      
      await tokenB.connect(user2).approve(limitOrderBook.target, ethers.parseEther("1000"));
      await limitOrderBook.connect(user2).fillOrder(orderId, amountOut);
      
      await expect(
        limitOrderBook.connect(user1).cancelOrder(orderId)
      ).to.be.revertedWith("Order already filled");
    });
    
    it("Should fail to cancel already cancelled order", async function () {
      await limitOrderBook.connect(user1).cancelOrder(orderId);
      
      await expect(
        limitOrderBook.connect(user1).cancelOrder(orderId)
      ).to.be.revertedWith("Order already cancelled");
    });
  });
  
  describe("View Functions", function () {
    it("Should get user orders", async function () {
      const deadline = (await ethers.provider.getBlock('latest')).timestamp + 3600;
      
      await tokenA.connect(user1).approve(limitOrderBook.target, ethers.parseEther("1000"));
      
      await limitOrderBook.connect(user1).createOrder(
        tokenA.target,
        tokenB.target,
        ethers.parseEther("100"),
        ethers.parseEther("95"),
        deadline
      );
      
      await limitOrderBook.connect(user1).createOrder(
        tokenA.target,
        tokenB.target,
        ethers.parseEther("50"),
        ethers.parseEther("48"),
        deadline
      );
      
      const userOrders = await limitOrderBook.getUserOrders(user1.address);
      expect(userOrders.length).to.equal(2);
      expect(userOrders[0]).to.equal(1);
      expect(userOrders[1]).to.equal(2);
    });
  });
  
  describe("Admin Functions", function () {
    it("Should update fee percentage", async function () {
      await limitOrderBook.setFeePercentage(20);
      expect(await limitOrderBook.feePercentage()).to.equal(20);
    });
    
    it("Should fail to set fee too high", async function () {
      await expect(
        limitOrderBook.setFeePercentage(101)
      ).to.be.revertedWith("Fee too high");
    });
    
    it("Should update fee collector", async function () {
      await limitOrderBook.setFeeCollector(user1.address);
      expect(await limitOrderBook.feeCollector()).to.equal(user1.address);
    });
    
    it("Should fail to set invalid fee collector", async function () {
      await expect(
        limitOrderBook.setFeeCollector(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid address");
    });
    
    it("Should fail if not owner", async function () {
      await expect(
        limitOrderBook.connect(user1).setFeePercentage(20)
      ).to.be.reverted;
    });
  });
});
