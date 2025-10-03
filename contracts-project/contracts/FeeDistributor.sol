// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract FeeDistributor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    struct UserInfo {
        uint256 shares;
        uint256 rewardDebt;
        uint256 pendingRewards;
    }
    
    IERC20 public immutable lpToken;
    IERC20 public immutable rewardToken;
    
    uint256 public totalShares;
    uint256 public accRewardPerShare;
    uint256 public constant PRECISION = 1e12;
    
    mapping(address => UserInfo) public userInfo;
    
    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Claim(address indexed user, uint256 amount);
    event FeeDistributed(uint256 amount);
    
    constructor(address _lpToken, address _rewardToken) Ownable(msg.sender) {
        lpToken = IERC20(_lpToken);
        rewardToken = IERC20(_rewardToken);
    }
    
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "Cannot deposit 0");
        
        UserInfo storage user = userInfo[msg.sender];
        
        _updatePool();
        
        if (user.shares > 0) {
            uint256 pending = (user.shares * accRewardPerShare / PRECISION) - user.rewardDebt;
            if (pending > 0) {
                user.pendingRewards += pending;
            }
        }
        
        lpToken.safeTransferFrom(msg.sender, address(this), amount);
        user.shares += amount;
        totalShares += amount;
        
        user.rewardDebt = user.shares * accRewardPerShare / PRECISION;
        
        emit Deposit(msg.sender, amount);
    }
    
    function withdraw(uint256 amount) external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        require(user.shares >= amount, "Insufficient balance");
        require(amount > 0, "Cannot withdraw 0");
        
        _updatePool();
        
        uint256 pending = (user.shares * accRewardPerShare / PRECISION) - user.rewardDebt;
        if (pending > 0) {
            user.pendingRewards += pending;
        }
        
        user.shares -= amount;
        totalShares -= amount;
        
        lpToken.safeTransfer(msg.sender, amount);
        
        user.rewardDebt = user.shares * accRewardPerShare / PRECISION;
        
        emit Withdraw(msg.sender, amount);
    }
    
    function claim() external nonReentrant {
        UserInfo storage user = userInfo[msg.sender];
        
        _updatePool();
        
        uint256 pending = (user.shares * accRewardPerShare / PRECISION) - user.rewardDebt;
        uint256 totalClaim = user.pendingRewards + pending;
        
        require(totalClaim > 0, "No rewards to claim");
        
        user.pendingRewards = 0;
        user.rewardDebt = user.shares * accRewardPerShare / PRECISION;
        
        rewardToken.safeTransfer(msg.sender, totalClaim);
        
        emit Claim(msg.sender, totalClaim);
    }
    
    function distributeFees(uint256 amount) external onlyOwner {
        require(amount > 0, "Cannot distribute 0");
        require(totalShares > 0, "No shares");
        
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        
        accRewardPerShare += (amount * PRECISION) / totalShares;
        
        emit FeeDistributed(amount);
    }
    
    function pendingReward(address _user) external view returns (uint256) {
        UserInfo storage user = userInfo[_user];
        
        if (user.shares == 0) {
            return user.pendingRewards;
        }
        
        uint256 pending = (user.shares * accRewardPerShare / PRECISION) - user.rewardDebt;
        return user.pendingRewards + pending;
    }
    
    function _updatePool() private {
    }
}
