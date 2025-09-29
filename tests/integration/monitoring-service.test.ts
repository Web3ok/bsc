import { expect } from 'chai';
import sinon from 'sinon';
import { monitoringService, ALERT_LEVELS } from '../../src/services/monitoring-service';

describe('Monitoring Service Integration Tests', () => {
  let fetchStub: sinon.SinonStub;
  let consoleErrorStub: sinon.SinonStub;
  let processEnvBackup: NodeJS.ProcessEnv;

  before(() => {
    processEnvBackup = { ...process.env };
    consoleErrorStub = sinon.stub(console, 'error');
  });

  after(() => {
    process.env = processEnvBackup;
    consoleErrorStub.restore();
  });

  beforeEach(() => {
    fetchStub = sinon.stub(global, 'fetch');
    // Reset service health for clean tests
    monitoringService.resetServiceHealth('price-service');
    monitoringService.resetServiceHealth('blockchain-monitor');
  });

  afterEach(() => {
    fetchStub.restore();
  });

  describe('Service Health Tracking', () => {
    it('should track service health and trigger alerts on failures', async () => {
      // Record multiple failures to trigger alert
      for (let i = 0; i < 3; i++) {
        monitoringService.recordServiceHealth('test-service', false, {
          type: 'test_error',
          message: `Test failure ${i + 1}`
        });
      }

      // Verify alert was triggered
      expect(consoleErrorStub.calledWithMatch('🚨 ALERT [HIGH]')).to.be.true;
      
      const systemHealth = monitoringService.getSystemHealth();
      expect(systemHealth.overallHealth).to.equal('degraded');
      expect(systemHealth.services['test-service']).to.exist;
      expect(systemHealth.services['test-service'].consecutiveFailures).to.equal(3);
    });

    it('should reset consecutive failures on successful health check', () => {
      // Record failures
      monitoringService.recordServiceHealth('test-service', false);
      monitoringService.recordServiceHealth('test-service', false);
      
      // Record success
      monitoringService.recordServiceHealth('test-service', true);
      
      const systemHealth = monitoringService.getSystemHealth();
      expect(systemHealth.services['test-service'].consecutiveFailures).to.equal(0);
      expect(systemHealth.services['test-service'].isHealthy).to.be.true;
    });

    it('should trigger critical alert after 10 consecutive failures', () => {
      // Record 10 failures to trigger critical alert
      for (let i = 0; i < 10; i++) {
        monitoringService.recordServiceHealth('critical-test-service', false);
      }

      expect(consoleErrorStub.calledWithMatch('🚨 ALERT [CRITICAL]')).to.be.true;
      expect(consoleErrorStub.calledWithMatch('CRITICAL SYSTEM FAILURE')).to.be.true;
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
        monitoringService.recordServiceHealth('slack-test-service', false);
      }

      // Wait for async alert processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(fetchStub.calledWith('https://hooks.slack.com/test/webhook')).to.be.true;
      
      const slackCall = fetchStub.getCall(0);
      expect(slackCall.args[1].method).to.equal('POST');
      expect(slackCall.args[1].headers['Content-Type']).to.equal('application/json');
      
      const payload = JSON.parse(slackCall.args[1].body);
      expect(payload.text).to.include('HIGH Alert');
      expect(payload.attachments[0].fields).to.be.an('array');
      expect(payload.attachments[0].fields.some(f => f.title === 'Service')).to.be.true;

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
        monitoringService.recordServiceHealth('discord-test-service', false);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(fetchStub.calledWith('https://discord.com/api/webhooks/test/webhook')).to.be.true;
      
      const discordCall = fetchStub.getCall(0);
      const payload = JSON.parse(discordCall.args[1].body);
      expect(payload.embeds).to.be.an('array');
      expect(payload.embeds[0].title).to.include('HIGH Alert');
      expect(payload.embeds[0].color).to.be.a('number');

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
        monitoringService.recordServiceHealth('webhook-fail-test', false);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      // Alert should still be logged even if webhook fails
      expect(consoleErrorStub.calledWithMatch('🚨 ALERT [HIGH]')).to.be.true;
      expect(fetchStub.called).to.be.true;

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
        monitoringService.recordServiceHealth('multi-channel-test', false);
      }

      await new Promise(resolve => setTimeout(resolve, 200));

      // Should have called all three webhooks
      expect(fetchStub.callCount).to.equal(3);
      expect(fetchStub.calledWith('https://hooks.slack.com/test/webhook')).to.be.true;
      expect(fetchStub.calledWith('https://discord.com/api/webhooks/test/webhook')).to.be.true;
      expect(fetchStub.calledWith('https://custom.monitoring.system/alerts')).to.be.true;

      delete process.env.SLACK_WEBHOOK_URL;
      delete process.env.DISCORD_WEBHOOK_URL;
      delete process.env.CUSTOM_ALERT_WEBHOOK;
    });
  });

  describe('Price Service Specific Monitoring', () => {
    it('should track price service failures and send special alerts', () => {
      // Record multiple price service failures
      for (let i = 0; i < 5; i++) {
        monitoringService.recordServiceHealth('price-service', false, {
          type: 'api_failure',
          message: 'CoinGecko API unavailable'
        });
      }

      expect(consoleErrorStub.calledWithMatch('may be using fallback prices')).to.be.true;
    });

    it('should track fallback usage separately from failures', () => {
      monitoringService.recordFallbackUsage('price-service', 'API rate limit reached');
      
      const systemHealth = monitoringService.getSystemHealth();
      expect(systemHealth.services['price-service']).to.exist;
      expect(systemHealth.services['price-service'].isHealthy).to.be.false;
    });
  });

  describe('System Health Reporting', () => {
    it('should provide accurate system health overview', () => {
      // Add healthy service
      monitoringService.recordServiceHealth('healthy-service', true);
      
      // Add degraded service
      monitoringService.recordServiceHealth('degraded-service', false);
      
      // Add critical service
      for (let i = 0; i < 10; i++) {
        monitoringService.recordServiceHealth('critical-service', false);
      }

      const health = monitoringService.getSystemHealth();
      
      expect(health.overallHealth).to.equal('critical');
      expect(health.summary).to.include('1 critical failures');
      expect(Object.keys(health.services)).to.have.length(3);
    });

    it('should provide monitoring statistics', () => {
      monitoringService.recordServiceHealth('stats-test-1', true);
      monitoringService.recordServiceHealth('stats-test-2', false);
      
      const stats = monitoringService.getMonitoringStats();
      
      expect(stats.totalServices).to.be.a('number');
      expect(stats.healthyServices).to.be.a('number');
      expect(stats.alertsActive).to.be.a('number');
      expect(stats.uptime).to.be.a('string');
      expect(stats.lastUpdate).to.be.instanceof(Date);
    });
  });

  describe('Service Recovery', () => {
    it('should reset service health manually', () => {
      // Create unhealthy service
      for (let i = 0; i < 5; i++) {
        monitoringService.recordServiceHealth('recovery-test', false);
      }

      let health = monitoringService.getSystemHealth();
      expect(health.services['recovery-test'].consecutiveFailures).to.equal(5);
      expect(health.services['recovery-test'].isHealthy).to.be.false;

      // Reset service health
      monitoringService.resetServiceHealth('recovery-test');

      health = monitoringService.getSystemHealth();
      expect(health.services['recovery-test'].consecutiveFailures).to.equal(0);
      expect(health.services['recovery-test'].isHealthy).to.be.true;
    });
  });

  describe('Environment-Specific Behavior', () => {
    it('should include environment information in alerts', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Trigger alert
      for (let i = 0; i < 3; i++) {
        monitoringService.recordServiceHealth('env-test', false);
      }

      expect(consoleErrorStub.calledWithMatch(sinon.match((value: any) => {
        return value && value.environment === 'production';
      }))).to.be.true;

      process.env.NODE_ENV = originalEnv;
    });
  });
});