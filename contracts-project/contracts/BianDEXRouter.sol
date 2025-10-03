// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./BianDEX.sol";
import "./WETH.sol";

interface IBianDEXFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
    function allPairs(uint256) external view returns (address);
    function allPairsLength() external view returns (uint256);
}

interface ISimpleLiquidityPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint256 reserve0, uint256 reserve1);
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline,
        address to
    ) external returns (uint256 liquidity);
    function removeLiquidity(
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline,
        address to
    ) external returns (uint256 amount0, uint256 amount1);
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 deadline
    ) external returns (uint256 amountOut);
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256);
}

/**
 * @title BianDEX Router
 * @notice Router for BianDEX with WBNB support and multi-hop swaps
 */
contract BianDEXRouter is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    
    IBianDEXFactory public immutable factory;
    WBNB public immutable wbnb;
    
    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "Router: EXPIRED");
        _;
    }
    
    event LiquidityAdded(
        address indexed tokenA,
        address indexed tokenB,
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );
    
    event LiquidityRemoved(
        address indexed tokenA,
        address indexed tokenB,
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );
    
    event SwapExecuted(
        address indexed user,
        address[] path,
        uint256 amountIn,
        uint256 amountOut
    );
    
    constructor(address _factory, address _wbnb) Ownable(msg.sender) {
        factory = IBianDEXFactory(_factory);
        wbnb = WBNB(payable(_wbnb));
    }
    
    receive() external payable {
        require(msg.sender == address(wbnb), "Router: Only WBNB");
    }
    
    // ========== LIQUIDITY FUNCTIONS ==========
    
    /**
     * @notice Add liquidity to a pool
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    ) {
        // Get or create pair
        address pair = factory.getPair(tokenA, tokenB);
        if (pair == address(0)) {
            pair = factory.createPair(tokenA, tokenB);
        }
        
        // Calculate optimal amounts
        (amountA, amountB) = _calculateOptimalAmounts(
            pair,
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin
        );
        
        // Transfer tokens to this contract
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);
        
        // Approve pair
        IERC20(tokenA).approve(pair, amountA);
        IERC20(tokenB).approve(pair, amountB);
        
        // Check token ordering in the pair and add liquidity accordingly
        ISimpleLiquidityPool pool = ISimpleLiquidityPool(pair);
        bool isCorrectOrder = pool.token0() == tokenA;
        
        // Add liquidity (LP tokens will be minted directly to 'to' address)
        if (isCorrectOrder) {
            liquidity = pool.addLiquidity(
                amountA,
                amountB,
                amountAMin,
                amountBMin,
                deadline,
                to
            );
        } else {
            liquidity = pool.addLiquidity(
                amountB,
                amountA,
                amountBMin,
                amountAMin,
                deadline,
                to
            );
        }
        
        emit LiquidityAdded(tokenA, tokenB, msg.sender, amountA, amountB, liquidity);
    }
    
    /**
     * @notice Add liquidity with BNB
     */
    function addLiquidityBNB(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountBNBMin,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) nonReentrant returns (
        uint256 amountToken,
        uint256 amountBNB,
        uint256 liquidity
    ) {
        // Wrap BNB
        wbnb.deposit{value: msg.value}();
        
        // Get or create pair
        address pair = factory.getPair(token, address(wbnb));
        if (pair == address(0)) {
            pair = factory.createPair(token, address(wbnb));
        }
        
        // Calculate optimal amounts
        (amountToken, amountBNB) = _calculateOptimalAmounts(
            pair,
            token,
            address(wbnb),
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountBNBMin
        );
        
        // Transfer token from user
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountToken);
        
        // Approve pair
        IERC20(token).approve(pair, amountToken);
        wbnb.approve(pair, msg.value); // Approve full msg.value since we wrapped it all
        
        // Check token ordering in the pair and add liquidity accordingly
        ISimpleLiquidityPool pool = ISimpleLiquidityPool(pair);
        bool isToken0 = pool.token0() == token;
        
        // Add liquidity (LP tokens will be minted directly to 'to' address)
        if (isToken0) {
            liquidity = pool.addLiquidity(
                amountToken,
                amountBNB,
                amountTokenMin,
                amountBNBMin,
                deadline,
                to
            );
        } else {
            liquidity = pool.addLiquidity(
                amountBNB,
                amountToken,
                amountBNBMin,
                amountTokenMin,
                deadline,
                to
            );
        }
        
        // Refund excess BNB
        if (msg.value > amountBNB) {
            wbnb.withdraw(msg.value - amountBNB);
            payable(msg.sender).transfer(msg.value - amountBNB);
        }
        
        emit LiquidityAdded(token, address(wbnb), msg.sender, amountToken, amountBNB, liquidity);
    }
    
    /**
     * @notice Remove liquidity
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256 amountA, uint256 amountB) {
        address pair = factory.getPair(tokenA, tokenB);
        require(pair != address(0), "Router: PAIR_NOT_FOUND");
        
        // Transfer LP tokens from user to pool
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        
        // Remove liquidity (tokens will be sent directly to 'to' address)
        (amountA, amountB) = ISimpleLiquidityPool(pair).removeLiquidity(
            liquidity,
            amountAMin,
            amountBMin,
            deadline,
            to
        );
        
        emit LiquidityRemoved(tokenA, tokenB, msg.sender, amountA, amountB, liquidity);
    }
    
    /**
     * @notice Remove liquidity and receive BNB
     */
    function removeLiquidityBNB(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountBNBMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256 amountToken, uint256 amountBNB) {
        address pair = factory.getPair(token, address(wbnb));
        require(pair != address(0), "Router: PAIR_NOT_FOUND");
        
        // Transfer LP tokens from user to pool
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        
        // Remove liquidity (tokens will be sent to this contract for WBNB unwrapping)
        (amountToken, amountBNB) = ISimpleLiquidityPool(pair).removeLiquidity(
            liquidity,
            amountTokenMin,
            amountBNBMin,
            deadline,
            address(this)
        );
        
        // Transfer token to user
        IERC20(token).safeTransfer(to, amountToken);
        
        // Unwrap WBNB and send BNB
        wbnb.withdraw(amountBNB);
        payable(to).transfer(amountBNB);
        
        emit LiquidityRemoved(token, address(wbnb), msg.sender, amountToken, amountBNB, liquidity);
    }
    
    // ========== SWAP FUNCTIONS ==========
    
    /**
     * @notice Swap exact tokens for tokens (single or multi-hop)
     */
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256[] memory amounts) {
        require(path.length >= 2, "Router: INVALID_PATH");
        
        amounts = _getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "Router: INSUFFICIENT_OUTPUT");
        
        // Transfer first token from user
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        
        // Execute swaps
        _swap(amounts, path, to, deadline);
        
        emit SwapExecuted(msg.sender, path, amountIn, amounts[amounts.length - 1]);
    }
    
    /**
     * @notice Swap exact BNB for tokens
     */
    function swapExactBNBForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) nonReentrant returns (uint256[] memory amounts) {
        require(path[0] == address(wbnb), "Router: INVALID_PATH");
        
        // Wrap BNB
        wbnb.deposit{value: msg.value}();
        
        amounts = _getAmountsOut(msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "Router: INSUFFICIENT_OUTPUT");
        
        // Execute swaps
        _swap(amounts, path, to, deadline);
        
        emit SwapExecuted(msg.sender, path, msg.value, amounts[amounts.length - 1]);
    }
    
    /**
     * @notice Swap exact tokens for BNB
     */
    function swapExactTokensForBNB(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256[] memory amounts) {
        require(path[path.length - 1] == address(wbnb), "Router: INVALID_PATH");
        
        amounts = _getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "Router: INSUFFICIENT_OUTPUT");
        
        // Transfer first token from user
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        
        // Execute swaps (send to this contract for last swap)
        _swap(amounts, path, address(this), deadline);
        
        // Unwrap WBNB and send BNB
        wbnb.withdraw(amounts[amounts.length - 1]);
        payable(to).transfer(amounts[amounts.length - 1]);
        
        emit SwapExecuted(msg.sender, path, amountIn, amounts[amounts.length - 1]);
    }
    
    // ========== INTERNAL FUNCTIONS ==========
    
    function _calculateOptimalAmounts(
        address pair,
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) private view returns (uint256 amountA, uint256 amountB) {
        ISimpleLiquidityPool pool = ISimpleLiquidityPool(pair);
        (uint256 reserveA, uint256 reserveB) = pool.getReserves();
        
        if (pool.token0() != tokenA) {
            (reserveA, reserveB) = (reserveB, reserveA);
        }
        
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = (amountADesired * reserveB) / reserveA;
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "Router: INSUFFICIENT_B_AMOUNT");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = (amountBDesired * reserveA) / reserveB;
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, "Router: INSUFFICIENT_A_AMOUNT");
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }
    
    function _swap(uint256[] memory amounts, address[] memory path, address to, uint256 deadline) private {
        for (uint256 i = 0; i < path.length - 1; i++) {
            address tokenIn = path[i];
            address tokenOut = path[i + 1];
            uint256 amountOut = amounts[i + 1];
            
            address pair = factory.getPair(tokenIn, tokenOut);
            require(pair != address(0), "Router: PAIR_NOT_FOUND");
            
            // Approve pair
            IERC20(tokenIn).approve(pair, amounts[i]);
            
            // Determine if this is the last swap
            address recipient = i < path.length - 2 ? address(this) : to;
            
            // Execute swap
            // For the last swap, use exact amountOut to ensure user gets at least minAmountOut
            // For intermediate swaps, use the calculated amount from getAmountsOut
            uint256 minOut = amounts[i + 1];
            ISimpleLiquidityPool(pair).swap(
                tokenIn,
                amounts[i],
                minOut, // Use exact calculated amount, no arbitrary slippage
                deadline // Use user-provided deadline
            );
            
            // Transfer output to next destination
            if (recipient != address(this)) {
                IERC20(tokenOut).safeTransfer(recipient, amountOut);
            }
        }
    }
    
    function _getAmountsOut(uint256 amountIn, address[] memory path) private view returns (uint256[] memory amounts) {
        require(path.length >= 2, "Router: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        
        for (uint256 i = 0; i < path.length - 1; i++) {
            address pair = factory.getPair(path[i], path[i + 1]);
            require(pair != address(0), "Router: PAIR_NOT_FOUND");
            amounts[i + 1] = ISimpleLiquidityPool(pair).getAmountOut(path[i], amounts[i]);
        }
    }
    
    // ========== VIEW FUNCTIONS ==========
    
    /**
     * @notice Calculate output amount for a swap path
     */
    function getAmountsOut(uint256 amountIn, address[] memory path) external view returns (uint256[] memory amounts) {
        return _getAmountsOut(amountIn, path);
    }
    
    /**
     * @notice Get optimal swap path between two tokens
     */
    function getOptimalPath(
        address tokenIn,
        address tokenOut
    ) external view returns (address[] memory path, bool exists) {
        // Direct path
        address directPair = factory.getPair(tokenIn, tokenOut);
        if (directPair != address(0)) {
            path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
            return (path, true);
        }
        
        // Try path through WBNB
        address pairInWBNB = factory.getPair(tokenIn, address(wbnb));
        address pairWBNBOut = factory.getPair(address(wbnb), tokenOut);
        
        if (pairInWBNB != address(0) && pairWBNBOut != address(0)) {
            path = new address[](3);
            path[0] = tokenIn;
            path[1] = address(wbnb);
            path[2] = tokenOut;
            return (path, true);
        }
        
        return (path, false);
    }
}