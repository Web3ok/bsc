// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LimitOrderBook is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        uint256 orderId;
        address maker;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 feeAmount;
        uint256 deadline;
        bool filled;
        bool cancelled;
    }

    uint256 public nextOrderId = 1;
    uint256 public feePercentage = 10;
    address public feeCollector;
    
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) public userOrders;
    
    event OrderCreated(
        uint256 indexed orderId,
        address indexed maker,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    );
    
    event OrderFilled(
        uint256 indexed orderId,
        address indexed filler,
        uint256 amountOut
    );
    
    event OrderCancelled(uint256 indexed orderId, address indexed maker);
    
    constructor(address _feeCollector) Ownable(msg.sender) {
        feeCollector = _feeCollector;
    }
    
    function createOrder(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external nonReentrant returns (uint256) {
        require(tokenIn != tokenOut, "Invalid tokens");
        require(amountIn > 0, "Amount must be > 0");
        require(minAmountOut > 0, "Min amount must be > 0");
        require(deadline > block.timestamp, "Invalid deadline");
        
        uint256 feeAmount = (amountIn * feePercentage) / 10000;
        uint256 totalAmount = amountIn + feeAmount;
        
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), totalAmount);
        
        uint256 orderId = nextOrderId++;
        
        orders[orderId] = Order({
            orderId: orderId,
            maker: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            feeAmount: feeAmount,
            deadline: deadline,
            filled: false,
            cancelled: false
        });
        
        userOrders[msg.sender].push(orderId);
        
        emit OrderCreated(
            orderId,
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            deadline
        );
        
        return orderId;
    }
    
    function fillOrder(uint256 orderId, uint256 amountOut) external nonReentrant {
        Order storage order = orders[orderId];
        
        require(!order.filled, "Order already filled");
        require(!order.cancelled, "Order cancelled");
        require(block.timestamp <= order.deadline, "Order expired");
        require(amountOut >= order.minAmountOut, "Insufficient output");
        
        order.filled = true;
        
        IERC20(order.tokenOut).safeTransferFrom(msg.sender, order.maker, amountOut);
        
        IERC20(order.tokenIn).safeTransfer(msg.sender, order.amountIn);
        
        if (order.feeAmount > 0) {
            IERC20(order.tokenIn).safeTransfer(feeCollector, order.feeAmount);
        }
        
        emit OrderFilled(orderId, msg.sender, amountOut);
    }
    
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        
        require(order.maker == msg.sender, "Not order maker");
        require(!order.filled, "Order already filled");
        require(!order.cancelled, "Order already cancelled");
        
        order.cancelled = true;
        
        uint256 refundAmount = order.amountIn + order.feeAmount;
        IERC20(order.tokenIn).safeTransfer(msg.sender, refundAmount);
        
        emit OrderCancelled(orderId, msg.sender);
    }
    
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }
    
    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user];
    }
    
    function setFeePercentage(uint256 newFee) external onlyOwner {
        require(newFee <= 100, "Fee too high");
        feePercentage = newFee;
    }
    
    function setFeeCollector(address newCollector) external onlyOwner {
        require(newCollector != address(0), "Invalid address");
        feeCollector = newCollector;
    }
}
