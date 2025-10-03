// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDEXRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) 
        external view returns (uint256[] memory amounts);
    
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

contract DEXAggregator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    struct DEXInfo {
        address router;
        bool isActive;
        string name;
    }
    
    struct Quote {
        uint256 dexId;
        uint256 amountOut;
        address[] path;
    }
    
    mapping(uint256 => DEXInfo) public dexes;
    uint256 public dexCount;
    
    uint256 public feePercentage = 10;
    address public feeCollector;
    
    event DEXAdded(uint256 indexed dexId, address router, string name);
    event DEXUpdated(uint256 indexed dexId, bool isActive);
    event SwapExecuted(
        address indexed user,
        uint256 dexId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    
    constructor(address _feeCollector) Ownable(msg.sender) {
        feeCollector = _feeCollector;
    }
    
    function addDEX(address router, string calldata name) external onlyOwner {
        require(router != address(0), "Invalid router");
        
        dexCount++;
        dexes[dexCount] = DEXInfo({
            router: router,
            isActive: true,
            name: name
        });
        
        emit DEXAdded(dexCount, router, name);
    }
    
    function setDEXStatus(uint256 dexId, bool isActive) external onlyOwner {
        require(dexId > 0 && dexId <= dexCount, "Invalid DEX ID");
        dexes[dexId].isActive = isActive;
        emit DEXUpdated(dexId, isActive);
    }
    
    function getBestQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) public view returns (Quote memory bestQuote) {
        require(amountIn > 0, "Amount must be > 0");
        
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        uint256 bestAmount = 0;
        uint256 bestDexId = 0;
        
        for (uint256 i = 1; i <= dexCount; i++) {
            if (!dexes[i].isActive) continue;
            
            try IDEXRouter(dexes[i].router).getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
                if (amounts[1] > bestAmount) {
                    bestAmount = amounts[1];
                    bestDexId = i;
                }
            } catch {
                continue;
            }
        }
        
        require(bestDexId > 0, "No valid route found");
        
        bestQuote = Quote({
            dexId: bestDexId,
            amountOut: bestAmount,
            path: path
        });
    }
    
    function getBestQuoteWithPath(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address[] calldata customPath
    ) public view returns (Quote memory bestQuote) {
        require(amountIn > 0, "Amount must be > 0");
        require(customPath.length >= 2, "Invalid path");
        require(customPath[0] == tokenIn, "Path must start with tokenIn");
        require(customPath[customPath.length - 1] == tokenOut, "Path must end with tokenOut");
        
        uint256 bestAmount = 0;
        uint256 bestDexId = 0;
        
        for (uint256 i = 1; i <= dexCount; i++) {
            if (!dexes[i].isActive) continue;
            
            try IDEXRouter(dexes[i].router).getAmountsOut(amountIn, customPath) returns (uint256[] memory amounts) {
                if (amounts[amounts.length - 1] > bestAmount) {
                    bestAmount = amounts[amounts.length - 1];
                    bestDexId = i;
                }
            } catch {
                continue;
            }
        }
        
        require(bestDexId > 0, "No valid route found");
        
        bestQuote = Quote({
            dexId: bestDexId,
            amountOut: bestAmount,
            path: customPath
        });
    }
    
    function swapWithBestRate(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(deadline >= block.timestamp, "Expired deadline");
        
        Quote memory bestQuote = getBestQuote(tokenIn, tokenOut, amountIn);
        require(bestQuote.amountOut >= minAmountOut, "Insufficient output amount");
        
        uint256 feeAmount = (amountIn * feePercentage) / 10000;
        uint256 swapAmount = amountIn - feeAmount;
        
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        
        if (feeAmount > 0) {
            IERC20(tokenIn).safeTransfer(feeCollector, feeAmount);
        }
        
        IERC20(tokenIn).approve(dexes[bestQuote.dexId].router, swapAmount);
        
        uint256[] memory amounts = IDEXRouter(dexes[bestQuote.dexId].router)
            .swapExactTokensForTokens(
                swapAmount,
                minAmountOut,
                bestQuote.path,
                msg.sender,
                deadline
            );
        
        amountOut = amounts[amounts.length - 1];
        
        emit SwapExecuted(
            msg.sender,
            bestQuote.dexId,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut
        );
    }
    
    function swapWithBestRateAndPath(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline,
        address[] calldata customPath
    ) external nonReentrant returns (uint256 amountOut) {
        require(deadline >= block.timestamp, "Expired deadline");
        
        Quote memory bestQuote = getBestQuoteWithPath(tokenIn, tokenOut, amountIn, customPath);
        require(bestQuote.amountOut >= minAmountOut, "Insufficient output amount");
        
        uint256 feeAmount = (amountIn * feePercentage) / 10000;
        uint256 swapAmount = amountIn - feeAmount;
        
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        
        if (feeAmount > 0) {
            IERC20(tokenIn).safeTransfer(feeCollector, feeAmount);
        }
        
        IERC20(tokenIn).approve(dexes[bestQuote.dexId].router, swapAmount);
        
        uint256[] memory amounts = IDEXRouter(dexes[bestQuote.dexId].router)
            .swapExactTokensForTokens(
                swapAmount,
                minAmountOut,
                customPath,
                msg.sender,
                deadline
            );
        
        amountOut = amounts[amounts.length - 1];
        
        emit SwapExecuted(
            msg.sender,
            bestQuote.dexId,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut
        );
    }
    
    function swapOnSpecificDEX(
        uint256 dexId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        require(dexId > 0 && dexId <= dexCount, "Invalid DEX ID");
        require(dexes[dexId].isActive, "DEX not active");
        require(deadline >= block.timestamp, "Expired deadline");
        
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        uint256 feeAmount = (amountIn * feePercentage) / 10000;
        uint256 swapAmount = amountIn - feeAmount;
        
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        
        if (feeAmount > 0) {
            IERC20(tokenIn).safeTransfer(feeCollector, feeAmount);
        }
        
        IERC20(tokenIn).approve(dexes[dexId].router, swapAmount);
        
        uint256[] memory amounts = IDEXRouter(dexes[dexId].router)
            .swapExactTokensForTokens(
                swapAmount,
                minAmountOut,
                path,
                msg.sender,
                deadline
            );
        
        amountOut = amounts[amounts.length - 1];
        
        emit SwapExecuted(
            msg.sender,
            dexId,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut
        );
    }
    
    function getAllQuotes(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (Quote[] memory quotes) {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        uint256 activeCount = 0;
        for (uint256 i = 1; i <= dexCount; i++) {
            if (dexes[i].isActive) activeCount++;
        }
        
        quotes = new Quote[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 1; i <= dexCount; i++) {
            if (!dexes[i].isActive) continue;
            
            try IDEXRouter(dexes[i].router).getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
                quotes[index] = Quote({
                    dexId: i,
                    amountOut: amounts[1],
                    path: path
                });
                index++;
            } catch {
                quotes[index] = Quote({
                    dexId: i,
                    amountOut: 0,
                    path: path
                });
                index++;
            }
        }
    }
    
    function setFeePercentage(uint256 newFee) external onlyOwner {
        require(newFee <= 100, "Fee too high");
        feePercentage = newFee;
    }
    
    function setFeeCollector(address newCollector) external onlyOwner {
        require(newCollector != address(0), "Invalid address");
        feeCollector = newCollector;
    }
    
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
}
