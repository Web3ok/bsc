// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title BianDEX - 生产级去中心化交易所实现
 * @notice 包含完整的安全措施和核心DEX功能
 * @dev 使用 SafeERC20，包含最小流动性锁定、滑点保护、K值验证等
 */
contract SimpleLiquidityPool is ERC20, ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;
    
    IERC20 public immutable token0;
    IERC20 public immutable token1;
    
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public constant FEE_PERCENT = 3; // 0.3%
    uint256 public constant FEE_DENOMINATOR = 1000;
    
    // 最小流动性锁定，防止初始流动性攻击
    uint256 public constant MINIMUM_LIQUIDITY = 10**3;
    // 死地址，用于锁定最小流动性
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    
    // K值保护
    uint256 private lastK;
    
    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Swap(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);
    
    constructor(
        address _token0, 
        address _token1
    ) ERC20("BianDEX LP Token", "SDEX-LP") Ownable(msg.sender) {
        require(_token0 != _token1, "Identical tokens");
        token0 = IERC20(_token0);
        token1 = IERC20(_token1);
    }
    
    /**
     * @notice 添加流动性（带滑点保护和截止时间）
     * @param amount0Desired token0期望数量
     * @param amount1Desired token1期望数量
     * @param amount0Min token0最小数量（滑点保护）
     * @param amount1Min token1最小数量（滑点保护）
     * @param deadline 截止时间
     * @param to 接收LP代币的地址
     */
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline,
        address to
    ) external nonReentrant whenNotPaused returns (uint256 liquidity) {
        require(deadline >= block.timestamp, "Expired");
        require(amount0Desired > 0 && amount1Desired > 0, "Invalid amounts");
        
        uint256 amount0;
        uint256 amount1;
        
        if (totalSupply() == 0) {
            // 首次添加流动性
            amount0 = amount0Desired;
            amount1 = amount1Desired;
            
            // 计算流动性并锁定最小流动性
            liquidity = _sqrt(amount0 * amount1);
            require(liquidity > MINIMUM_LIQUIDITY, "Insufficient initial liquidity");
            
            // 永久锁定最小流动性到死地址（防止流动性攻击）
            _mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
            liquidity = liquidity - MINIMUM_LIQUIDITY;
        } else {
            // 计算最优比例
            uint256 amount1Optimal = (amount0Desired * reserve1) / reserve0;
            
            if (amount1Optimal <= amount1Desired) {
                require(amount1Optimal >= amount1Min, "Insufficient amount1");
                amount0 = amount0Desired;
                amount1 = amount1Optimal;
            } else {
                uint256 amount0Optimal = (amount1Desired * reserve0) / reserve1;
                assert(amount0Optimal <= amount0Desired);
                require(amount0Optimal >= amount0Min, "Insufficient amount0");
                amount0 = amount0Optimal;
                amount1 = amount1Desired;
            }
            
            liquidity = _min(
                (amount0 * totalSupply()) / reserve0,
                (amount1 * totalSupply()) / reserve1
            );
        }
        
        require(liquidity > 0, "Insufficient liquidity minted");
        
        // 使用 SafeERC20 安全转入代币
        token0.safeTransferFrom(msg.sender, address(this), amount0);
        token1.safeTransferFrom(msg.sender, address(this), amount1);
        
        _mint(to, liquidity);
        
        // 更新储备量
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
        lastK = reserve0 * reserve1;
        
        emit LiquidityAdded(msg.sender, amount0, amount1, liquidity);
    }
    
    /**
     * @notice 移除流动性（带滑点保护）
     * @param liquidity LP代币数量
     * @param amount0Min token0最小数量
     * @param amount1Min token1最小数量
     * @param deadline 截止时间
     * @param to 接收代币的地址
     */
    function removeLiquidity(
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline,
        address to
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(deadline >= block.timestamp, "Expired");
        require(liquidity > 0, "Invalid liquidity");
        require(balanceOf(msg.sender) >= liquidity, "Insufficient balance");
        
        uint256 _totalSupply = totalSupply();
        amount0 = (liquidity * reserve0) / _totalSupply;
        amount1 = (liquidity * reserve1) / _totalSupply;
        
        require(amount0 >= amount0Min, "Insufficient amount0");
        require(amount1 >= amount1Min, "Insufficient amount1");
        
        _burn(msg.sender, liquidity);
        
        // 使用 SafeERC20 安全转出代币
        token0.safeTransfer(to, amount0);
        token1.safeTransfer(to, amount1);
        
        // 更新储备量
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
        lastK = reserve0 * reserve1;
        
        emit LiquidityRemoved(msg.sender, amount0, amount1, liquidity);
    }
    
    /**
     * @notice 执行代币交换（带K值保护和滑点控制）
     * @param tokenIn 输入代币地址
     * @param amountIn 输入数量
     * @param minAmountOut 最小输出数量（滑点保护）
     * @param deadline 截止时间
     */
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        require(deadline >= block.timestamp, "Expired");
        require(tokenIn == address(token0) || tokenIn == address(token1), "Invalid token");
        require(amountIn > 0, "Invalid amount");
        
        bool isToken0 = tokenIn == address(token0);
        IERC20 tokenInContract = isToken0 ? token0 : token1;
        IERC20 tokenOutContract = isToken0 ? token1 : token0;
        uint256 reserveIn = isToken0 ? reserve0 : reserve1;
        uint256 reserveOut = isToken0 ? reserve1 : reserve0;
        
        // 验证流动性充足
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        
        // 计算输出金额 (包含手续费)
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_PERCENT);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
        
        require(amountOut >= minAmountOut, "Insufficient output amount");
        require(amountOut > 0 && amountOut < reserveOut, "Invalid output");
        
        // 记录旧K值
        uint256 oldK = reserve0 * reserve1;
        
        // 使用 SafeERC20 执行转账
        tokenInContract.safeTransferFrom(msg.sender, address(this), amountIn);
        tokenOutContract.safeTransfer(msg.sender, amountOut);
        
        // 更新储备量
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
        
        // K值保护：确保K值不减少（考虑手续费后应该增加）
        uint256 newK = reserve0 * reserve1;
        require(newK >= oldK, "K value decreased");
        lastK = newK;
        
        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
    }
    
    /**
     * @notice 获取报价
     */
    function getAmountOut(
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        require(tokenIn == address(token0) || tokenIn == address(token1), "Invalid token");
        require(amountIn > 0, "Invalid amount");
        
        bool isToken0 = tokenIn == address(token0);
        uint256 reserveIn = isToken0 ? reserve0 : reserve1;
        uint256 reserveOut = isToken0 ? reserve1 : reserve0;
        
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - FEE_PERCENT);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }
    
    /**
     * @notice 获取储备量
     */
    function getReserves() external view returns (uint256 _reserve0, uint256 _reserve1) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
    }
    
    /**
     * @notice 强制同步储备量（紧急情况）
     */
    function sync() external nonReentrant {
        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));
        lastK = reserve0 * reserve1;
    }
    
    /**
     * @notice 暂停合约（仅所有者）
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @notice 恢复合约（仅所有者）
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // 辅助函数
    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
    
    function _min(uint256 x, uint256 y) private pure returns (uint256) {
        return x < y ? x : y;
    }
}

/**
 * @title BianDEXFactory - 简化版工厂合约
 */
contract BianDEXFactory is Ownable {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;
    
    event PairCreated(address indexed token0, address indexed token1, address pair);
    
    constructor() Ownable(msg.sender) {}
    
    function createPair(
        address tokenA,
        address tokenB
    ) external returns (address pair) {
        require(tokenA != tokenB, "Identical tokens");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "Zero address");
        require(getPair[token0][token1] == address(0), "Pair exists");
        
        // 部署新的流动性池
        SimpleLiquidityPool pool = new SimpleLiquidityPool(token0, token1);
        pair = address(pool);
        
        pool.transferOwnership(msg.sender);
        
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        
        emit PairCreated(token0, token1, pair);
    }
    
    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }
}