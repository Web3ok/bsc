# BSC Trading Bot - Production Deployment Checklist

## 🚀 Pre-Deployment Checklist

This checklist must be completed before deploying to production. Each item should be checked and verified.

### 📋 Environment Preparation

#### 1. Configuration
- [ ] Copy `.env.production.template` to `.env.production`
- [ ] Set strong `JWT_SECRET` (minimum 256 bits)
  ```bash
  openssl rand -hex 32
  ```
- [ ] Configure `WALLET_ENCRYPTION_PASSWORD`
- [ ] Set production database URL (PostgreSQL recommended)
- [ ] Configure all RPC endpoints (primary and backups)
- [ ] Set CoinGecko API key (Pro key for production)
- [ ] Configure alert channels (Slack, Discord, Email)
- [ ] Set appropriate rate limits
- [ ] Configure CORS origin for your domain
- [ ] Set backup encryption key
- [ ] Review all environment variables

#### 2. Security Audit
- [ ] Change all default passwords
- [ ] Verify JWT secret is unique and strong
- [ ] Ensure database has strong credentials
- [ ] Check file permissions (especially for .env files)
- [ ] Enable HTTPS/SSL certificates
- [ ] Configure firewall rules
- [ ] Disable debug endpoints (`ENABLE_DEBUG_ENDPOINTS=false`)
- [ ] Review and remove any test wallets
- [ ] Ensure no sensitive data in logs
- [ ] Verify encryption for wallet storage

### 🗄️ Database Setup

#### 3. Database Migration
- [ ] Backup existing database (if upgrading)
  ```bash
  ./scripts/backup.sh
  ```
- [ ] Run migration check
  ```bash
  ./scripts/check-db-migrations.sh
  ```
- [ ] Apply all pending migrations
  ```bash
  npx knex migrate:latest --env production
  ```
- [ ] Verify all tables created (54 tables expected)
- [ ] Check database indexes are created
- [ ] Verify database connectivity
- [ ] Test database performance
- [ ] Set up database backup schedule

### 🧪 Testing

#### 4. Integration Tests
- [ ] Run full test suite
  ```bash
  JWT_SECRET=test-secret npm run test:integration
  ```
- [ ] All tests passing (20/20 minimum)
- [ ] Test with production-like data
- [ ] Verify WebSocket connections
- [ ] Test alert channels
  ```bash
  node scripts/test-alert-channels.js
  ```
- [ ] Test blockchain monitoring
  ```bash
  JWT_SECRET=prod-secret node scripts/test-monitor-comprehensive.js
  ```

#### 5. Load Testing
- [ ] Perform load testing on API endpoints
- [ ] Test concurrent WebSocket connections
- [ ] Verify rate limiting works
- [ ] Check memory usage under load
- [ ] Monitor CPU usage patterns
- [ ] Test database connection pooling

### 🔍 Health Checks

#### 6. System Health
- [ ] Run comprehensive health check
  ```bash
  ./scripts/health-check-production.sh
  ```
- [ ] All services showing healthy
- [ ] Database connectivity confirmed
- [ ] RPC providers accessible
- [ ] WebSocket service operational
- [ ] No critical errors in logs

#### 7. Monitoring Setup
- [ ] Monitoring service configured
- [ ] Alert channels tested and working
- [ ] Log rotation configured
- [ ] Performance metrics collection enabled
- [ ] Error tracking system in place
- [ ] Uptime monitoring configured

### 📦 Deployment Process

#### 8. Pre-Deployment Backup
- [ ] Create full system backup
  ```bash
  ./scripts/backup.sh
  ```
- [ ] Verify backup integrity
- [ ] Store backup in secure location
- [ ] Document backup location and encryption key
- [ ] Test restore procedure

#### 9. Dependencies
- [ ] Update all npm packages to latest stable
  ```bash
  npm update
  npm audit fix
  ```
- [ ] Check for security vulnerabilities
  ```bash
  npm audit
  ```
- [ ] Lock dependency versions
- [ ] Remove dev dependencies for production
  ```bash
  npm prune --production
  ```

#### 10. Build Process
- [ ] Build TypeScript files
  ```bash
  npm run build
  ```
- [ ] Optimize for production
- [ ] Minify frontend assets (if applicable)
- [ ] Verify build output
- [ ] Test built version locally

### 🚀 Deployment

#### 11. Deployment Steps
- [ ] Stop existing services
  ```bash
  ./scripts/stop-all.sh
  ```
- [ ] Deploy new code
- [ ] Update environment variables
- [ ] Run database migrations
- [ ] Start services
  ```bash
  ./scripts/start-all.sh
  ```
- [ ] Verify services started correctly

#### 12. Post-Deployment Verification
- [ ] Check API health endpoint
  ```bash
  curl https://your-domain.com/api/health
  ```
- [ ] Verify WebSocket connectivity
- [ ] Test authentication flow
- [ ] Check price service
- [ ] Verify monitoring is active
- [ ] Test a sample transaction (small amount)
- [ ] Check log file generation
- [ ] Verify alert system

### 📊 Performance Validation

#### 13. Performance Metrics
- [ ] API response time < 100ms
- [ ] Database queries optimized
- [ ] Memory usage stable
- [ ] CPU usage acceptable
- [ ] No memory leaks detected
- [ ] WebSocket connections stable

### 🔒 Security Validation

#### 14. Security Checks
- [ ] SSL certificate valid
- [ ] Security headers configured
- [ ] Rate limiting active
- [ ] Authentication working
- [ ] Authorization checks in place
- [ ] Input validation functional
- [ ] XSS protection enabled
- [ ] CSRF protection active

### 📝 Documentation

#### 15. Documentation Updates
- [ ] Update README with production URLs
- [ ] Document API endpoints
- [ ] Update configuration guide
- [ ] Document backup procedures
- [ ] Create runbook for common issues
- [ ] Update team contacts
- [ ] Document rollback procedure

### 🆘 Rollback Plan

#### 16. Rollback Preparation
- [ ] Rollback script tested
  ```bash
  ./scripts/rollback.sh --help
  ```
- [ ] Previous version backup available
- [ ] Database rollback plan documented
- [ ] Team notified of deployment window
- [ ] Communication plan in place

### ✅ Final Checks

#### 17. Go-Live Checklist
- [ ] All critical features working
- [ ] No critical errors in logs
- [ ] Performance acceptable
- [ ] Security measures active
- [ ] Monitoring active
- [ ] Alerts configured
- [ ] Team ready for support
- [ ] Documentation complete

## 🎯 Launch Commands

Once all checks are complete, execute deployment:

```bash
# 1. Final backup
./scripts/backup.sh

# 2. Deploy to production
./scripts/deploy-production.sh

# 3. Verify deployment
./scripts/health-check-production.sh

# 4. Monitor logs
tail -f logs/combined-*.log
```

## 🚨 Emergency Contacts

- **DevOps Lead**: [Contact Info]
- **Database Admin**: [Contact Info]
- **Security Team**: [Contact Info]
- **On-Call Engineer**: [Contact Info]

## 📞 Rollback Procedure

If issues arise:

```bash
# 1. Stop services
./scripts/stop-all.sh

# 2. Execute rollback
./scripts/rollback.sh

# 3. Verify rollback
./scripts/health-check.sh
```

## 📊 Success Metrics

Deployment is considered successful when:
- All health checks pass
- No critical errors in first 30 minutes
- Performance metrics within acceptable range
- All configured wallets accessible
- Alert system functional
- No security warnings

---

**Deployment Date**: _______________  
**Deployed By**: _______________  
**Version**: _______________  
**Approval**: _______________

---

*This checklist must be reviewed and updated for each deployment.*