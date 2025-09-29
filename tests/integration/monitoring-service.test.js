"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const sinon_1 = __importDefault(require("sinon"));
const monitoring_service_1 = require("../../src/services/monitoring-service");
describe('Monitoring Service Integration Tests', () => {
    let fetchStub;
    let consoleErrorStub;
    let processEnvBackup;
    before(() => {
        processEnvBackup = { ...process.env };
        consoleErrorStub = sinon_1.default.stub(console, 'error');
    });
    after(() => {
        process.env = processEnvBackup;
        consoleErrorStub.restore();
    });
    beforeEach(() => {
        fetchStub = sinon_1.default.stub(global, 'fetch');
        // Reset service health for clean tests
        monitoring_service_1.monitoringService.resetServiceHealth('price-service');
        monitoring_service_1.monitoringService.resetServiceHealth('blockchain-monitor');
    });
    afterEach(() => {
        fetchStub.restore();
    });
    describe('Service Health Tracking', () => {
        it('should track service health and trigger alerts on failures', async () => {
            // Record multiple failures to trigger alert
            for (let i = 0; i < 3; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('test-service', false, {
                    type: 'test_error',
                    message: `Test failure ${i + 1}`
                });
            }
            // Verify alert was triggered
            (0, chai_1.expect)(consoleErrorStub.calledWithMatch('🚨 ALERT [HIGH]')).to.be.true;
            const systemHealth = monitoring_service_1.monitoringService.getSystemHealth();
            (0, chai_1.expect)(systemHealth.overallHealth).to.equal('degraded');
            (0, chai_1.expect)(systemHealth.services['test-service']).to.exist;
            (0, chai_1.expect)(systemHealth.services['test-service'].consecutiveFailures).to.equal(3);
        });
        it('should reset consecutive failures on successful health check', () => {
            // Record failures
            monitoring_service_1.monitoringService.recordServiceHealth('test-service', false);
            monitoring_service_1.monitoringService.recordServiceHealth('test-service', false);
            // Record success
            monitoring_service_1.monitoringService.recordServiceHealth('test-service', true);
            const systemHealth = monitoring_service_1.monitoringService.getSystemHealth();
            (0, chai_1.expect)(systemHealth.services['test-service'].consecutiveFailures).to.equal(0);
            (0, chai_1.expect)(systemHealth.services['test-service'].isHealthy).to.be.true;
        });
        it('should trigger critical alert after 10 consecutive failures', () => {
            // Record 10 failures to trigger critical alert
            for (let i = 0; i < 10; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('critical-test-service', false);
            }
            (0, chai_1.expect)(consoleErrorStub.calledWithMatch('🚨 ALERT [CRITICAL]')).to.be.true;
            (0, chai_1.expect)(consoleErrorStub.calledWithMatch('CRITICAL SYSTEM FAILURE')).to.be.true;
        });
    });
    describe('External Alert Channels', () => {
        it('should send Slack alerts when webhook URL is configured', async () => {
            process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test/webhook';
            // Mock successful Slack response
            fetchStub.resolves({
                ok: true,
                status: 200
            });
            // Trigger alert
            for (let i = 0; i < 3; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('slack-test-service', false);
            }
            // Wait for async alert processing
            await new Promise(resolve => setTimeout(resolve, 100));
            (0, chai_1.expect)(fetchStub.calledWith('https://hooks.slack.com/test/webhook')).to.be.true;
            const slackCall = fetchStub.getCall(0);
            (0, chai_1.expect)(slackCall.args[1].method).to.equal('POST');
            (0, chai_1.expect)(slackCall.args[1].headers['Content-Type']).to.equal('application/json');
            const payload = JSON.parse(slackCall.args[1].body);
            (0, chai_1.expect)(payload.text).to.include('HIGH Alert');
            (0, chai_1.expect)(payload.attachments[0].fields).to.be.an('array');
            (0, chai_1.expect)(payload.attachments[0].fields.some(f => f.title === 'Service')).to.be.true;
            delete process.env.SLACK_WEBHOOK_URL;
        });
        it('should send Discord alerts when webhook URL is configured', async () => {
            process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/webhook';
            fetchStub.resolves({
                ok: true,
                status: 200
            });
            // Trigger alert
            for (let i = 0; i < 3; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('discord-test-service', false);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            (0, chai_1.expect)(fetchStub.calledWith('https://discord.com/api/webhooks/test/webhook')).to.be.true;
            const discordCall = fetchStub.getCall(0);
            const payload = JSON.parse(discordCall.args[1].body);
            (0, chai_1.expect)(payload.embeds).to.be.an('array');
            (0, chai_1.expect)(payload.embeds[0].title).to.include('HIGH Alert');
            (0, chai_1.expect)(payload.embeds[0].color).to.be.a('number');
            delete process.env.DISCORD_WEBHOOK_URL;
        });
        it('should handle webhook failures gracefully', async () => {
            process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test/webhook';
            // Mock failed Slack response
            fetchStub.resolves({
                ok: false,
                status: 500
            });
            // Trigger alert
            for (let i = 0; i < 3; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('webhook-fail-test', false);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            // Alert should still be logged even if webhook fails
            (0, chai_1.expect)(consoleErrorStub.calledWithMatch('🚨 ALERT [HIGH]')).to.be.true;
            (0, chai_1.expect)(fetchStub.called).to.be.true;
            delete process.env.SLACK_WEBHOOK_URL;
        });
        it('should send to multiple channels simultaneously', async () => {
            process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test/webhook';
            process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/webhook';
            process.env.CUSTOM_ALERT_WEBHOOK = 'https://custom.monitoring.system/alerts';
            fetchStub.resolves({
                ok: true,
                status: 200
            });
            // Trigger alert
            for (let i = 0; i < 3; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('multi-channel-test', false);
            }
            await new Promise(resolve => setTimeout(resolve, 200));
            // Should have called all three webhooks
            (0, chai_1.expect)(fetchStub.callCount).to.equal(3);
            (0, chai_1.expect)(fetchStub.calledWith('https://hooks.slack.com/test/webhook')).to.be.true;
            (0, chai_1.expect)(fetchStub.calledWith('https://discord.com/api/webhooks/test/webhook')).to.be.true;
            (0, chai_1.expect)(fetchStub.calledWith('https://custom.monitoring.system/alerts')).to.be.true;
            delete process.env.SLACK_WEBHOOK_URL;
            delete process.env.DISCORD_WEBHOOK_URL;
            delete process.env.CUSTOM_ALERT_WEBHOOK;
        });
    });
    describe('Price Service Specific Monitoring', () => {
        it('should track price service failures and send special alerts', () => {
            // Record multiple price service failures
            for (let i = 0; i < 5; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('price-service', false, {
                    type: 'api_failure',
                    message: 'CoinGecko API unavailable'
                });
            }
            (0, chai_1.expect)(consoleErrorStub.calledWithMatch('may be using fallback prices')).to.be.true;
        });
        it('should track fallback usage separately from failures', () => {
            monitoring_service_1.monitoringService.recordFallbackUsage('price-service', 'API rate limit reached');
            const systemHealth = monitoring_service_1.monitoringService.getSystemHealth();
            (0, chai_1.expect)(systemHealth.services['price-service']).to.exist;
            (0, chai_1.expect)(systemHealth.services['price-service'].isHealthy).to.be.false;
        });
    });
    describe('System Health Reporting', () => {
        it('should provide accurate system health overview', () => {
            // Add healthy service
            monitoring_service_1.monitoringService.recordServiceHealth('healthy-service', true);
            // Add degraded service
            monitoring_service_1.monitoringService.recordServiceHealth('degraded-service', false);
            // Add critical service
            for (let i = 0; i < 10; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('critical-service', false);
            }
            const health = monitoring_service_1.monitoringService.getSystemHealth();
            (0, chai_1.expect)(health.overallHealth).to.equal('critical');
            (0, chai_1.expect)(health.summary).to.include('1 critical failures');
            (0, chai_1.expect)(Object.keys(health.services)).to.have.length(3);
        });
        it('should provide monitoring statistics', () => {
            monitoring_service_1.monitoringService.recordServiceHealth('stats-test-1', true);
            monitoring_service_1.monitoringService.recordServiceHealth('stats-test-2', false);
            const stats = monitoring_service_1.monitoringService.getMonitoringStats();
            (0, chai_1.expect)(stats.totalServices).to.be.a('number');
            (0, chai_1.expect)(stats.healthyServices).to.be.a('number');
            (0, chai_1.expect)(stats.alertsActive).to.be.a('number');
            (0, chai_1.expect)(stats.uptime).to.be.a('string');
            (0, chai_1.expect)(stats.lastUpdate).to.be.instanceof(Date);
        });
    });
    describe('Service Recovery', () => {
        it('should reset service health manually', () => {
            // Create unhealthy service
            for (let i = 0; i < 5; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('recovery-test', false);
            }
            let health = monitoring_service_1.monitoringService.getSystemHealth();
            (0, chai_1.expect)(health.services['recovery-test'].consecutiveFailures).to.equal(5);
            (0, chai_1.expect)(health.services['recovery-test'].isHealthy).to.be.false;
            // Reset service health
            monitoring_service_1.monitoringService.resetServiceHealth('recovery-test');
            health = monitoring_service_1.monitoringService.getSystemHealth();
            (0, chai_1.expect)(health.services['recovery-test'].consecutiveFailures).to.equal(0);
            (0, chai_1.expect)(health.services['recovery-test'].isHealthy).to.be.true;
        });
    });
    describe('Environment-Specific Behavior', () => {
        it('should include environment information in alerts', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            // Trigger alert
            for (let i = 0; i < 3; i++) {
                monitoring_service_1.monitoringService.recordServiceHealth('env-test', false);
            }
            (0, chai_1.expect)(consoleErrorStub.calledWithMatch(sinon_1.default.match((value) => {
                return value && value.environment === 'production';
            }))).to.be.true;
            process.env.NODE_ENV = originalEnv;
        });
    });
});
//# sourceMappingURL=monitoring-service.test.js.map