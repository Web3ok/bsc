// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISimpleLiquidityPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint256 reserve0, uint256 reserve1);
}

contract TWAPOracle {
    struct Observation {
        uint256 timestamp;
        uint256 price0Cumulative;
        uint256 price1Cumulative;
    }
    
    uint256 public constant MIN_UPDATE_INTERVAL = 10 minutes;
    uint256 public constant WINDOW_SIZE = 24 hours;
    uint256 public constant MAX_OBSERVATIONS = 144;
    
    ISimpleLiquidityPool public immutable pair;
    address public immutable token0;
    address public immutable token1;
    
    Observation[] public observations;
    uint256 public observationIndex;
    uint256 private price0CumulativeLast;
    uint256 private price1CumulativeLast;
    uint256 private blockTimestampLast;
    
    event ObservationRecorded(uint256 timestamp, uint256 price0Cumulative, uint256 price1Cumulative);
    
    constructor(address _pair) {
        pair = ISimpleLiquidityPool(_pair);
        token0 = pair.token0();
        token1 = pair.token1();
        
        (uint256 reserve0, uint256 reserve1) = pair.getReserves();
        require(reserve0 > 0 && reserve1 > 0, "No liquidity");
        
        blockTimestampLast = block.timestamp;
        observations.push(Observation({
            timestamp: block.timestamp,
            price0Cumulative: 0,
            price1Cumulative: 0
        }));
    }
    
    function update() external returns (bool) {
        uint256 length = observations.length;
        Observation memory lastObservation = observations[length - 1];
        
        if (block.timestamp < lastObservation.timestamp + MIN_UPDATE_INTERVAL) {
            return false;
        }
        
        uint256 timeElapsed = block.timestamp - blockTimestampLast;
        if (timeElapsed == 0) {
            return false;
        }
        
        (uint256 reserve0, uint256 reserve1) = pair.getReserves();
        require(reserve0 > 0 && reserve1 > 0, "No liquidity");
        
        unchecked {
            price0CumulativeLast += (reserve1 * (2**112) / reserve0) * timeElapsed;
            price1CumulativeLast += (reserve0 * (2**112) / reserve1) * timeElapsed;
        }
        
        blockTimestampLast = block.timestamp;
        
        if (length < MAX_OBSERVATIONS) {
            observations.push(Observation({
                timestamp: block.timestamp,
                price0Cumulative: price0CumulativeLast,
                price1Cumulative: price1CumulativeLast
            }));
        } else {
            observationIndex = (observationIndex + 1) % MAX_OBSERVATIONS;
            observations[observationIndex] = Observation({
                timestamp: block.timestamp,
                price0Cumulative: price0CumulativeLast,
                price1Cumulative: price1CumulativeLast
            });
        }
        
        emit ObservationRecorded(block.timestamp, price0CumulativeLast, price1CumulativeLast);
        return true;
    }
    
    function consult(address token, uint256 amountIn) external view returns (uint256 amountOut) {
        require(token == token0 || token == token1, "Invalid token");
        
        uint256 length = observations.length;
        require(length > 1, "Insufficient observations");
        
        Observation memory firstObservation = _getFirstObservation();
        Observation memory lastObservation = observations[length > MAX_OBSERVATIONS ? observationIndex : length - 1];
        
        uint256 timeElapsed = lastObservation.timestamp - firstObservation.timestamp;
        require(timeElapsed >= MIN_UPDATE_INTERVAL, "Insufficient time elapsed");
        
        if (token == token0) {
            uint256 priceCumulativeDiff = lastObservation.price0Cumulative - firstObservation.price0Cumulative;
            uint256 priceAverage = priceCumulativeDiff / timeElapsed;
            amountOut = (amountIn * priceAverage) / (2**112);
        } else {
            uint256 priceCumulativeDiff = lastObservation.price1Cumulative - firstObservation.price1Cumulative;
            uint256 priceAverage = priceCumulativeDiff / timeElapsed;
            amountOut = (amountIn * priceAverage) / (2**112);
        }
    }
    
    function _getFirstObservation() private view returns (Observation memory) {
        uint256 length = observations.length;
        
        if (length <= MAX_OBSERVATIONS) {
            return observations[0];
        }
        
        uint256 oldestIndex = (observationIndex + 1) % MAX_OBSERVATIONS;
        Observation memory oldestObservation = observations[oldestIndex];
        
        if (block.timestamp - oldestObservation.timestamp <= WINDOW_SIZE) {
            return oldestObservation;
        }
        
        for (uint256 i = 1; i < MAX_OBSERVATIONS; i++) {
            uint256 index = (oldestIndex + i) % MAX_OBSERVATIONS;
            Observation memory obs = observations[index];
            if (block.timestamp - obs.timestamp <= WINDOW_SIZE) {
                return obs;
            }
        }
        
        return oldestObservation;
    }
    
    function getObservationsLength() external view returns (uint256) {
        return observations.length;
    }
    
    function getLatestObservation() external view returns (uint256 timestamp, uint256 price0Cumulative, uint256 price1Cumulative) {
        uint256 length = observations.length;
        Observation memory latest = observations[length > MAX_OBSERVATIONS ? observationIndex : length - 1];
        return (latest.timestamp, latest.price0Cumulative, latest.price1Cumulative);
    }
}
