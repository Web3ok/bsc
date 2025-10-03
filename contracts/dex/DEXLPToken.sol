// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title DEX LP Token
 * @notice 流动性提供者代币，代表用户在流动性池中的份额
 */
contract DEXLPToken is ERC20 {
    constructor() ERC20("DEX Liquidity Provider", "DEX-LP") {}
}