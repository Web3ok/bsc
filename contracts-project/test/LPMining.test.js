const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("LPMining", function () {
  let lpMining;
  let rewardToken;
  let lpToken;
  let owner;
  let user1;
  let user2;
  let startBlock;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    const RewardToken = await ethers.getContractFactory("RewardToken");
    rewardToken = await RewardToken.deploy();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    lpToken = await MockERC20.deploy("LP Token", "LP", ethers.parseEther("1000000"));

    const currentBlock = await ethers.provider.getBlockNumber();
    startBlock = currentBlock + 10;

    const LPMining = await ethers.getContractFactory("LPMining");
    lpMining = await LPMining.deploy(
      await rewardToken.getAddress(),
      ethers.parseEther("10"),
      startBlock
    );

    await rewardToken.transfer(await lpMining.getAddress(), ethers.parseEther("100000"));
    await lpToken.transfer(user1.address, ethers.parseEther("1000"));
    await lpToken.transfer(user2.address, ethers.parseEther("1000"));
  });

  describe("Pool Management", function () {
    it("Should add pool correctly", async function () {
      await lpMining.addPool(100, await lpToken.getAddress(), false);
      
      expect(await lpMining.poolLength()).to.equal(1);
      expect(await lpMining.totalAllocPoint()).to.equal(100);
      
      const pool = await lpMining.poolInfo(0);
      expect(pool.allocPoint).to.equal(100);
      expect(pool.totalStaked).to.equal(0);
    });

    it("Should set allocation points correctly", async function () {
      await lpMining.addPool(100, await lpToken.getAddress(), false);
      await lpMining.setAllocPoint(0, 200, false);
      
      expect(await lpMining.totalAllocPoint()).to.equal(200);
      
      const pool = await lpMining.poolInfo(0);
      expect(pool.allocPoint).to.equal(200);
    });

    it("Should only allow owner to add pools", async function () {
      await expect(
        lpMining.connect(user1).addPool(100, await lpToken.getAddress(), false)
      ).to.be.revertedWithCustomError(lpMining, "OwnableUnauthorizedAccount");
    });
  });

  describe("Staking and Rewards", function () {
    beforeEach(async function () {
      await lpMining.addPool(100, await lpToken.getAddress(), false);
      await lpToken.connect(user1).approve(await lpMining.getAddress(), ethers.parseEther("1000"));
      await lpToken.connect(user2).approve(await lpMining.getAddress(), ethers.parseEther("1000"));
    });

    it("Should deposit LP tokens correctly", async function () {
      await lpMining.connect(user1).deposit(0, ethers.parseEther("100"));
      
      const userInfo = await lpMining.userInfo(0, user1.address);
      expect(userInfo.amount).to.equal(ethers.parseEther("100"));
      
      const pool = await lpMining.poolInfo(0);
      expect(pool.totalStaked).to.equal(ethers.parseEther("100"));
    });

    it("Should withdraw LP tokens correctly", async function () {
      await lpMining.connect(user1).deposit(0, ethers.parseEther("100"));
      await lpMining.connect(user1).withdraw(0, ethers.parseEther("50"));
      
      const userInfo = await lpMining.userInfo(0, user1.address);
      expect(userInfo.amount).to.equal(ethers.parseEther("50"));
      
      const pool = await lpMining.poolInfo(0);
      expect(pool.totalStaked).to.equal(ethers.parseEther("50"));
    });

    it("Should calculate pending rewards correctly", async function () {
      await lpMining.connect(user1).deposit(0, ethers.parseEther("100"));
      
      await mine(10);
      
      const pending = await lpMining.pendingReward(0, user1.address);
      expect(pending).to.be.gt(0);
    });

    it("Should harvest rewards correctly", async function () {
      await lpMining.connect(user1).deposit(0, ethers.parseEther("100"));
      
      await mine(10);
      
      const balanceBefore = await rewardToken.balanceOf(user1.address);
      await lpMining.connect(user1).harvest(0);
      const balanceAfter = await rewardToken.balanceOf(user1.address);
      
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("Should distribute rewards proportionally", async function () {
      await lpMining.connect(user1).deposit(0, ethers.parseEther("100"));
      
      await mine(5);
      
      await lpMining.connect(user2).deposit(0, ethers.parseEther("100"));
      
      await mine(5);
      
      const pending1 = await lpMining.pendingReward(0, user1.address);
      const pending2 = await lpMining.pendingReward(0, user2.address);
      
      expect(pending1).to.be.gt(pending2);
    });

    it("Should emergency withdraw correctly", async function () {
      await lpMining.connect(user1).deposit(0, ethers.parseEther("100"));
      
      const balanceBefore = await lpToken.balanceOf(user1.address);
      await lpMining.connect(user1).emergencyWithdraw(0);
      const balanceAfter = await lpToken.balanceOf(user1.address);
      
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("100"));
      
      const userInfo = await lpMining.userInfo(0, user1.address);
      expect(userInfo.amount).to.equal(0);
      expect(userInfo.pendingRewards).to.equal(0);
    });

    it("Should revert withdraw with insufficient balance", async function () {
      await lpMining.connect(user1).deposit(0, ethers.parseEther("100"));
      
      await expect(
        lpMining.connect(user1).withdraw(0, ethers.parseEther("200"))
      ).to.be.revertedWith("Insufficient balance");
    });

    it("Should revert harvest with no rewards", async function () {
      await lpMining.connect(user1).deposit(0, ethers.parseEther("100"));
      
      await expect(
        lpMining.connect(user1).harvest(0)
      ).to.be.revertedWith("No rewards");
    });
  });

  describe("Multiple Pools", function () {
    let lpToken2;

    beforeEach(async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      lpToken2 = await MockERC20.deploy("LP Token 2", "LP2", ethers.parseEther("1000000"));
      
      await lpMining.addPool(100, await lpToken.getAddress(), false);
      await lpMining.addPool(200, await lpToken2.getAddress(), false);
      
      await lpToken.connect(user1).approve(await lpMining.getAddress(), ethers.parseEther("1000"));
      await lpToken2.transfer(user1.address, ethers.parseEther("1000"));
      await lpToken2.connect(user1).approve(await lpMining.getAddress(), ethers.parseEther("1000"));
    });

    it("Should handle multiple pools correctly", async function () {
      expect(await lpMining.poolLength()).to.equal(2);
      expect(await lpMining.totalAllocPoint()).to.equal(300);
    });

    it("Should distribute rewards based on allocation points", async function () {
      await lpMining.connect(user1).deposit(0, ethers.parseEther("100"));
      await lpMining.connect(user1).deposit(1, ethers.parseEther("100"));
      
      await mine(10);
      
      const pending1 = await lpMining.pendingReward(0, user1.address);
      const pending2 = await lpMining.pendingReward(1, user1.address);
      
      expect(pending2 / pending1).to.be.closeTo(2n, 1n);
    });
  });
});
