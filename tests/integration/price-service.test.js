"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const sinon_1 = __importDefault(require("sinon"));
const price_service_1 = require("../../src/services/price-service");
const monitoring_service_1 = require("../../src/services/monitoring-service");
describe('Price Service Integration Tests', () => {
    let fetchStub;
    let monitoringStub;
    beforeEach(() => {
        fetchStub = sinon_1.default.stub(global, 'fetch');
        monitoringStub = sinon_1.default.stub(monitoring_service_1.monitoringService, 'recordServiceHealth');
        // Clear cache before each test
        price_service_1.priceService.clearCache();
    });
    afterEach(() => {
        fetchStub.restore();
        monitoringStub.restore();
    });
    describe('Real Price Fetching', () => {
        it('should fetch real price data from CoinGecko successfully', async () => {
            const mockResponse = {
                'binancecoin': {
                    usd: 300.50,
                    usd_24h_change: 2.5,
                    usd_24h_vol: 1000000
                }
            };
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });
            const priceData = await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(priceData).to.not.be.null;
            (0, chai_1.expect)(priceData.symbol).to.equal('BNB');
            (0, chai_1.expect)(priceData.priceUSD).to.equal(300.50);
            (0, chai_1.expect)(priceData.priceChange24h).to.equal(2.5);
            (0, chai_1.expect)(priceData.volume24hUSD).to.equal(1000000);
            // Should record successful health check
            (0, chai_1.expect)(monitoringStub.calledWith('price-service', true)).to.be.true;
        });
        it('should handle CoinGecko API errors and use fallback prices', async () => {
            fetchStub.resolves({
                ok: false,
                status: 429, // Rate limit
                statusText: 'Too Many Requests'
            });
            const priceData = await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(priceData).to.not.be.null;
            (0, chai_1.expect)(priceData.symbol).to.equal('BNB');
            (0, chai_1.expect)(priceData.priceUSD).to.equal(300.00); // Fallback price
            (0, chai_1.expect)(priceData.priceChange24h).to.equal(0);
            // Should record service failure
            (0, chai_1.expect)(monitoringStub.calledWith('price-service', false)).to.be.true;
        });
        it('should handle network timeouts and use fallback prices', async () => {
            // Simulate timeout
            fetchStub.callsFake(() => {
                return new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('AbortError')), 100);
                });
            });
            const priceData = await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(priceData).to.not.be.null;
            (0, chai_1.expect)(priceData.symbol).to.equal('BNB');
            (0, chai_1.expect)(priceData.priceUSD).to.equal(300.00); // Fallback price
            // Should record timeout failure
            (0, chai_1.expect)(monitoringStub.calledWith('price-service', false)).to.be.true;
        });
        it('should handle malformed API responses gracefully', async () => {
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => ({}) // Empty response
            });
            const priceData = await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(priceData).to.not.be.null;
            (0, chai_1.expect)(priceData.priceUSD).to.equal(300.00); // Should use fallback
        });
    });
    describe('Caching Behavior', () => {
        it('should use cached data within TTL period', async () => {
            const mockResponse = {
                'binancecoin': {
                    usd: 300.50,
                    usd_24h_change: 2.5,
                    usd_24h_vol: 1000000
                }
            };
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });
            // First call should fetch from API
            const firstCall = await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(fetchStub.callCount).to.equal(1);
            // Second call within cache TTL should use cache
            const secondCall = await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(fetchStub.callCount).to.equal(1); // Should not increase
            (0, chai_1.expect)(firstCall.priceUSD).to.equal(secondCall.priceUSD);
        });
        it('should fetch fresh data after cache expires', async () => {
            const firstResponse = {
                'binancecoin': { usd: 300.50, usd_24h_change: 2.5, usd_24h_vol: 1000000 }
            };
            const secondResponse = {
                'binancecoin': { usd: 305.75, usd_24h_change: 3.2, usd_24h_vol: 1200000 }
            };
            fetchStub.onFirstCall().resolves({
                ok: true,
                status: 200,
                json: async () => firstResponse
            });
            fetchStub.onSecondCall().resolves({
                ok: true,
                status: 200,
                json: async () => secondResponse
            });
            // First call
            const firstCall = await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(firstCall.priceUSD).to.equal(300.50);
            // Clear cache to simulate expiry
            price_service_1.priceService.clearCache();
            // Second call should fetch fresh data
            const secondCall = await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(secondCall.priceUSD).to.equal(305.75);
            (0, chai_1.expect)(fetchStub.callCount).to.equal(2);
        });
    });
    describe('Multiple Price Fetching', () => {
        it('should fetch multiple prices in batches', async () => {
            const mockResponse = {
                'binancecoin': { usd: 300.50, usd_24h_change: 2.5, usd_24h_vol: 1000000 },
                'ethereum': { usd: 2400.00, usd_24h_change: 1.8, usd_24h_vol: 5000000 },
                'bitcoin': { usd: 43000.00, usd_24h_change: -0.5, usd_24h_vol: 20000000 }
            };
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });
            const symbols = ['BNB', 'ETH', 'BTC'];
            const results = await price_service_1.priceService.getMultiplePrices(symbols);
            (0, chai_1.expect)(results.size).to.equal(3);
            (0, chai_1.expect)(results.get('BNB').priceUSD).to.equal(300.50);
            (0, chai_1.expect)(results.get('ETH').priceUSD).to.equal(2400.00);
            (0, chai_1.expect)(results.get('BTC').priceUSD).to.equal(43000.00);
        });
        it('should handle partial failures in batch requests', async () => {
            // Mock partial response (missing BTC data)
            const mockResponse = {
                'binancecoin': { usd: 300.50, usd_24h_change: 2.5, usd_24h_vol: 1000000 },
                'ethereum': { usd: 2400.00, usd_24h_change: 1.8, usd_24h_vol: 5000000 }
            };
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });
            const symbols = ['BNB', 'ETH', 'BTC'];
            const results = await price_service_1.priceService.getMultiplePrices(symbols);
            (0, chai_1.expect)(results.size).to.equal(2); // Only BNB and ETH should be present
            (0, chai_1.expect)(results.has('BNB')).to.be.true;
            (0, chai_1.expect)(results.has('ETH')).to.be.true;
            (0, chai_1.expect)(results.has('BTC')).to.be.false;
        });
    });
    describe('Fallback Price Behavior', () => {
        it('should provide fallback prices for supported tokens', async () => {
            fetchStub.rejects(new Error('Network error'));
            const supportedTokens = ['BNB', 'BUSD', 'USDT', 'USDC', 'CAKE', 'WBNB', 'ETH', 'BTC'];
            for (const token of supportedTokens) {
                const priceData = await price_service_1.priceService.getPrice(token);
                (0, chai_1.expect)(priceData).to.not.be.null;
                (0, chai_1.expect)(priceData.symbol).to.equal(token);
                (0, chai_1.expect)(priceData.priceUSD).to.be.greaterThan(0);
                (0, chai_1.expect)(priceData.priceChange24h).to.equal(0); // Fallback change is 0
            }
        });
        it('should return null for unsupported tokens when API fails', async () => {
            fetchStub.rejects(new Error('Network error'));
            const priceData = await price_service_1.priceService.getPrice('UNKNOWN_TOKEN');
            (0, chai_1.expect)(priceData).to.be.null;
        });
        it('should log fallback usage for monitoring', async () => {
            const fallbackStub = sinon_1.default.stub(monitoring_service_1.monitoringService, 'recordFallbackUsage');
            fetchStub.rejects(new Error('Network error'));
            await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(fallbackStub.calledWith('price-service')).to.be.true;
            fallbackStub.restore();
        });
    });
    describe('Historical Price Data', () => {
        it('should fetch historical price data successfully', async () => {
            const mockHistoricalResponse = {
                market_data: {
                    current_price: {
                        usd: 295.25
                    }
                }
            };
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => mockHistoricalResponse
            });
            const historicalPrice = await price_service_1.priceService.getHistoricalPrice('BNB', 1);
            (0, chai_1.expect)(historicalPrice).to.equal(295.25);
            (0, chai_1.expect)(fetchStub.calledOnce).to.be.true;
            const callArgs = fetchStub.getCall(0).args;
            (0, chai_1.expect)(callArgs[0]).to.include('/coins/binancecoin/history');
        });
        it('should handle historical data API failures', async () => {
            fetchStub.rejects(new Error('Historical data unavailable'));
            const historicalPrice = await price_service_1.priceService.getHistoricalPrice('BNB', 1);
            (0, chai_1.expect)(historicalPrice).to.be.null;
        });
    });
    describe('Service Resilience', () => {
        it('should handle rapid consecutive requests without overwhelming API', async () => {
            const mockResponse = {
                'binancecoin': { usd: 300.50, usd_24h_change: 2.5, usd_24h_vol: 1000000 }
            };
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });
            // Make multiple rapid requests
            const promises = Array.from({ length: 5 }, () => price_service_1.priceService.getPrice('BNB'));
            const results = await Promise.all(promises);
            // Due to caching, should only make one API call
            (0, chai_1.expect)(fetchStub.callCount).to.equal(1);
            // All results should be identical
            results.forEach(result => {
                (0, chai_1.expect)(result.priceUSD).to.equal(300.50);
            });
        });
        it('should provide cache statistics', () => {
            const stats = price_service_1.priceService.getCacheStats();
            (0, chai_1.expect)(stats).to.have.property('size');
            (0, chai_1.expect)(stats).to.have.property('keys');
            (0, chai_1.expect)(stats.size).to.be.a('number');
            (0, chai_1.expect)(stats.keys).to.be.an('array');
        });
        it('should clear cache when requested', async () => {
            const mockResponse = {
                'binancecoin': { usd: 300.50, usd_24h_change: 2.5, usd_24h_vol: 1000000 }
            };
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });
            // Populate cache
            await price_service_1.priceService.getPrice('BNB');
            let stats = price_service_1.priceService.getCacheStats();
            (0, chai_1.expect)(stats.size).to.be.greaterThan(0);
            // Clear cache
            price_service_1.priceService.clearCache();
            stats = price_service_1.priceService.getCacheStats();
            (0, chai_1.expect)(stats.size).to.equal(0);
        });
    });
    describe('API Response Format Validation', () => {
        it('should handle missing price data in response', async () => {
            const mockResponse = {
                'binancecoin': {
                    // Missing usd price
                    usd_24h_change: 2.5,
                    usd_24h_vol: 1000000
                }
            };
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => mockResponse
            });
            const priceData = await price_service_1.priceService.getPrice('BNB');
            // Should use fallback when price data is invalid
            (0, chai_1.expect)(priceData.priceUSD).to.equal(300.00);
        });
        it('should handle completely empty API response', async () => {
            fetchStub.resolves({
                ok: true,
                status: 200,
                json: async () => null
            });
            const priceData = await price_service_1.priceService.getPrice('BNB');
            (0, chai_1.expect)(priceData.priceUSD).to.equal(300.00); // Should use fallback
        });
    });
});
//# sourceMappingURL=price-service.test.js.map