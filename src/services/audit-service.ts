import { logger } from '../utils/logger';
import { database } from '../persistence/database';

interface AuditLogEntry {
  action: string;
  entityType: string;
  entityId?: string;
  userId?: string;
  userAgent?: string;
  ipAddress?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  notes?: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
}

interface RiskMetrics {
  totalTransactions24h: number;
  totalVolume24h: string;
  failedTransactions: number;
  unusualPatterns: string[];
  riskScore: number;
  alertsTriggered: number;
  suspiciousAddresses: string[];
}

interface SecurityEvent {
  type: 'suspicious_transaction' | 'unusual_volume' | 'failed_authentication' | 'rate_limit_exceeded';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  metadata: Record<string, any>;
  timestamp: Date;
}

export class AuditService {
  private static instance: AuditService;
  private securityEvents: SecurityEvent[] = [];
  private readonly MAX_SECURITY_EVENTS = 1000;

  // Risk thresholds
  private readonly RISK_THRESHOLDS = {
    HIGH_VOLUME_USD: 100000, // $100k+
    FAILED_TX_RATE: 0.1, // 10% failure rate
    UNUSUAL_TX_COUNT: 100, // 100+ transactions in 1 hour
    SUSPICIOUS_GAS_PRICE: 1000000000000 // 1000 gwei
  };

  private constructor() {}

  public static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  async logAction(entry: Omit<AuditLogEntry, 'timestamp'>): Promise<void> {
    try {
      await database.ensureConnection();
      
      const auditEntry: AuditLogEntry = {
        ...entry,
        timestamp: new Date()
      };

      if (database.connection) {
        await database.connection('audit_log').insert({
          action: auditEntry.action,
          entity_type: auditEntry.entityType,
          entity_id: auditEntry.entityId || null,
          user_agent: auditEntry.userAgent || null,
          old_values: auditEntry.oldValues ? JSON.stringify(auditEntry.oldValues) : null,
          new_values: auditEntry.newValues ? JSON.stringify(auditEntry.newValues) : null,
          notes: auditEntry.notes || null,
          created_at: auditEntry.timestamp
        });
      }

      // Log high-risk actions immediately
      if (entry.riskLevel === 'high' || entry.riskLevel === 'critical') {
        logger.warn({
          action: entry.action,
          entityType: entry.entityType,
          riskLevel: entry.riskLevel,
          notes: entry.notes
        }, 'High-risk action logged');

        // Create security event
        this.addSecurityEvent({
          type: 'suspicious_transaction',
          severity: entry.riskLevel === 'critical' ? 'critical' : 'high',
          description: `High-risk action: ${entry.action} on ${entry.entityType}`,
          metadata: {
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId
          },
          timestamp: new Date()
        });
      }

      logger.debug({
        action: entry.action,
        entityType: entry.entityType,
        riskLevel: entry.riskLevel
      }, 'Audit log entry created');

    } catch (error) {
      logger.error({ error, entry }, 'Failed to create audit log entry');
    }
  }

  async calculateRiskMetrics(): Promise<RiskMetrics> {
    try {
      await database.ensureConnection();
      
      if (!database.connection) {
        return this.getDefaultRiskMetrics();
      }

      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Get transaction metrics for last 24 hours
      const transactionMetrics = await database.connection('transactions')
        .where('created_at', '>=', yesterday)
        .select([
          database.connection.raw('COUNT(*) as total_count'),
          database.connection.raw('COUNT(CASE WHEN status = "failed" THEN 1 END) as failed_count'),
          database.connection.raw('SUM(CASE WHEN amount IS NOT NULL THEN CAST(amount as DECIMAL(36,18)) ELSE 0 END) as total_volume')
        ])
        .first();

      const totalTransactions24h = parseInt(String((transactionMetrics as any)?.total_count || 0));
      const failedTransactions = parseInt(String((transactionMetrics as any)?.failed_count || 0));
      const totalVolume24h = String((transactionMetrics as any)?.total_volume || '0');

      // Calculate unusual patterns
      const unusualPatterns = await this.detectUnusualPatterns();

      // Get suspicious addresses
      const suspiciousAddresses = await this.identifySuspiciousAddresses();

      // Calculate risk score (0-100)
      const riskScore = this.calculateRiskScore({
        totalTransactions24h,
        failedTransactions,
        totalVolume24h: parseFloat(totalVolume24h),
        unusualPatterns: unusualPatterns.length,
        suspiciousAddresses: suspiciousAddresses.length
      });

      // Count recent alerts
      const alertsTriggered = this.securityEvents.filter(
        event => event.timestamp.getTime() > yesterday.getTime()
      ).length;

      return {
        totalTransactions24h,
        totalVolume24h,
        failedTransactions,
        unusualPatterns,
        riskScore,
        alertsTriggered,
        suspiciousAddresses
      };

    } catch (error) {
      logger.error({ error }, 'Failed to calculate risk metrics');
      return this.getDefaultRiskMetrics();
    }
  }

  private async detectUnusualPatterns(): Promise<string[]> {
    const patterns: string[] = [];

    try {
      if (!database.connection) return patterns;

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Check for unusual transaction volume in last hour
      const recentTxCount = await database.connection('transactions')
        .where('created_at', '>=', oneHourAgo)
        .count('* as count')
        .first();

      const txCount = parseInt(String(recentTxCount?.count || 0));
      if (txCount > this.RISK_THRESHOLDS.UNUSUAL_TX_COUNT) {
        patterns.push(`Unusual transaction volume: ${txCount} transactions in last hour`);
      }

      // Check for high gas prices (possible MEV/frontrunning)
      const highGasTx = await database.connection('transactions')
        .where('created_at', '>=', oneHourAgo)
        .where('gas_price', '>', this.RISK_THRESHOLDS.SUSPICIOUS_GAS_PRICE.toString())
        .count('* as count')
        .first();

      const highGasCount = parseInt(String(highGasTx?.count || 0));
      if (highGasCount > 0) {
        patterns.push(`${highGasCount} transactions with unusually high gas prices`);
      }

      // Check for repeated failed transactions from same address
      const failedTxByAddress = await database.connection('transactions')
        .where('created_at', '>=', oneHourAgo)
        .where('status', 'failed')
        .groupBy('from_address')
        .having(database.connection.raw('COUNT(*) >= 5'))
        .select('from_address')
        .count('* as failed_count');

      if (failedTxByAddress.length > 0) {
        patterns.push(`${failedTxByAddress.length} addresses with multiple failed transactions`);
      }

    } catch (error) {
      logger.debug({ error }, 'Error detecting unusual patterns');
    }

    return patterns;
  }

  private async identifySuspiciousAddresses(): Promise<string[]> {
    const suspicious: string[] = [];

    try {
      if (!database.connection) return suspicious;

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Addresses with high failure rates
      const highFailureAddresses = await database.connection('transactions')
        .where('created_at', '>=', yesterday)
        .groupBy('from_address')
        .having(database.connection.raw('COUNT(*) >= 10'))
        .having(
          database.connection.raw(
            'COUNT(CASE WHEN status = "failed" THEN 1 END) / COUNT(*) > ?',
            [this.RISK_THRESHOLDS.FAILED_TX_RATE]
          )
        )
        .select('from_address');

      suspicious.push(...highFailureAddresses.map(row => row.from_address));

      // Remove duplicates
      return Array.from(new Set(suspicious));

    } catch (error) {
      logger.debug({ error }, 'Error identifying suspicious addresses');
      return suspicious;
    }
  }

  private calculateRiskScore(metrics: {
    totalTransactions24h: number;
    failedTransactions: number;
    totalVolume24h: number;
    unusualPatterns: number;
    suspiciousAddresses: number;
  }): number {
    let score = 0;

    // Base score from transaction volume
    if (metrics.totalTransactions24h > 1000) score += 10;
    if (metrics.totalTransactions24h > 5000) score += 20;

    // Penalty for failed transactions
    if (metrics.failedTransactions > 0) {
      const failureRate = metrics.failedTransactions / Math.max(metrics.totalTransactions24h, 1);
      score += Math.min(failureRate * 100, 30); // Max 30 points for failures
    }

    // High volume penalty
    if (metrics.totalVolume24h > this.RISK_THRESHOLDS.HIGH_VOLUME_USD) {
      score += 15;
    }

    // Unusual patterns penalty
    score += metrics.unusualPatterns * 5;

    // Suspicious addresses penalty
    score += metrics.suspiciousAddresses * 10;

    return Math.min(Math.round(score), 100); // Cap at 100
  }

  private getDefaultRiskMetrics(): RiskMetrics {
    return {
      totalTransactions24h: 0,
      totalVolume24h: '0',
      failedTransactions: 0,
      unusualPatterns: [],
      riskScore: 0,
      alertsTriggered: 0,
      suspiciousAddresses: []
    };
  }

  addSecurityEvent(event: SecurityEvent): void {
    if (this.securityEvents.length >= this.MAX_SECURITY_EVENTS) {
      this.securityEvents.shift(); // Remove oldest event
    }
    
    this.securityEvents.push(event);

    logger.info({
      type: event.type,
      severity: event.severity,
      description: event.description
    }, 'Security event added');
  }

  getRecentSecurityEvents(limit = 50): SecurityEvent[] {
    return this.securityEvents
      .slice(-limit)
      .reverse() // Most recent first
      .slice(0, limit);
  }

  async getAuditLog(filters: {
    action?: string;
    entityType?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<any[]> {
    try {
      await database.ensureConnection();
      
      if (!database.connection) return [];

      let query = database.connection('audit_log');

      if (filters.action) {
        query = query.where('action', filters.action);
      }

      if (filters.entityType) {
        query = query.where('entity_type', filters.entityType);
      }

      if (filters.startDate) {
        query = query.where('created_at', '>=', filters.startDate);
      }

      if (filters.endDate) {
        query = query.where('created_at', '<=', filters.endDate);
      }

      const results = await query
        .orderBy('created_at', 'desc')
        .limit(filters.limit || 100)
        .select('*');

      return results;

    } catch (error) {
      logger.error({ error, filters }, 'Failed to get audit log');
      return [];
    }
  }

  getSecurityEventStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    eventsBySeverity: Record<string, number>;
    recentEvents24h: number;
  } {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent24h = this.securityEvents.filter(
      event => event.timestamp.getTime() > yesterday.getTime()
    );

    const eventsByType = this.securityEvents.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const eventsBySeverity = this.securityEvents.reduce((acc, event) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalEvents: this.securityEvents.length,
      eventsByType,
      eventsBySeverity,
      recentEvents24h: recent24h.length
    };
  }
}

export const auditService = AuditService.getInstance();