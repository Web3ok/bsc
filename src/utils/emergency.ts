import { logger } from './logger';
import { alertManager } from '../monitor/alerts';

export interface EmergencyState {
  stopped: boolean;
  reason: string;
  timestamp: Date;
  triggeredBy: string;
  level: 'warning' | 'critical' | 'emergency';
}

export class EmergencyManager {
  private static instance: EmergencyManager;
  private emergencyState: EmergencyState | null = null;
  private stopCallbacks: (() => Promise<void>)[] = [];

  private constructor() {}

  public static getInstance(): EmergencyManager {
    if (!EmergencyManager.instance) {
      EmergencyManager.instance = new EmergencyManager();
    }
    return EmergencyManager.instance;
  }

  // Register callback to be called when emergency stop is triggered
  registerStopCallback(callback: () => Promise<void>): void {
    this.stopCallbacks.push(callback);
  }

  async emergencyStop(
    reason: string, 
    level: 'warning' | 'critical' | 'emergency' = 'critical',
    triggeredBy = 'system'
  ): Promise<void> {
    this.emergencyState = {
      stopped: true,
      reason,
      timestamp: new Date(),
      triggeredBy,
      level,
    };

    logger.error({
      reason,
      level,
      triggeredBy,
      timestamp: this.emergencyState.timestamp,
    }, '🚨 EMERGENCY STOP ACTIVATED');

    // Send alert
    await EmergencyAlerts.emergencyStop(reason, level, triggeredBy);

    // Execute all stop callbacks
    const stopPromises = this.stopCallbacks.map(async (callback, index) => {
      try {
        await callback();
        logger.info(`Emergency stop callback ${index + 1} executed successfully`);
      } catch (error) {
        logger.error({ error, callbackIndex: index }, 'Emergency stop callback failed');
      }
    });

    await Promise.allSettled(stopPromises);
    
    logger.error('🚨 ALL SYSTEMS STOPPED - Trading and queue processing halted');
  }

  async resume(reason: string, resumedBy = 'system'): Promise<void> {
    if (!this.emergencyState) {
      logger.warn('Attempted to resume but no emergency state exists');
      return;
    }

    const previousState = { ...this.emergencyState };
    this.emergencyState = null;

    logger.info({
      reason,
      resumedBy,
      previousReason: previousState.reason,
      stoppedDuration: Date.now() - previousState.timestamp.getTime(),
    }, '✅ Emergency stop lifted - Systems resuming');

    // Send recovery alert
    await alertManager.info(
      'Emergency Stop Lifted',
      `Systems have been resumed. Reason: ${reason}`,
      {
        resumedBy,
        previousReason: previousState.reason,
        stoppedFor: `${Math.round((Date.now() - previousState.timestamp.getTime()) / 1000)}s`,
      }
    );
  }

  isEmergencyStopped(): boolean {
    return this.emergencyState !== null;
  }

  getEmergencyState(): EmergencyState | null {
    return this.emergencyState ? { ...this.emergencyState } : null;
  }

  // Check if operations should proceed - use this in all critical paths
  checkEmergencyStatus(): { allowed: boolean; reason?: string } {
    if (this.emergencyState) {
      return {
        allowed: false,
        reason: `Emergency stop active: ${this.emergencyState.reason}`,
      };
    }
    return { allowed: true };
  }

  // Auto emergency stop based on conditions
  async checkAutoEmergencyConditions(): Promise<void> {
    // Example auto-trigger conditions - customize based on your needs
    
    // High failure rate trigger (implement based on metrics)
    // const failureRate = await this.getRecentFailureRate();
    // if (failureRate > 0.5) {
    //   await this.emergencyStop('High failure rate detected', 'critical', 'auto-monitor');
    // }
    
    // Could add more conditions here:
    // - Unusual price movements
    // - RPC connection failures
    // - Excessive gas costs
    // - Nonce conflicts
  }
}

// Emergency alerts extension
export namespace EmergencyAlerts {
  export async function emergencyStop(
    reason: string,
    level: 'warning' | 'critical' | 'emergency',
    triggeredBy: string
  ): Promise<void> {
    const emoji = level === 'emergency' ? '🚨🚨🚨' : '🚨';
    
    await alertManager.error(
      `${emoji} EMERGENCY STOP ACTIVATED`,
      `All trading operations have been halted. Reason: ${reason}`,
      {
        level,
        triggeredBy,
        timestamp: new Date().toISOString(),
        action: 'immediate_attention_required',
      }
    );
  }
}

export const emergencyManager = EmergencyManager.getInstance();