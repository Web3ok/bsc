/**
 * Module Configuration System
 * 模块化配置系统 - 支持独立启用/禁用各个功能模块
 */

import { logger } from '../utils/logger';

export interface ModuleConfig {
  enabled: boolean;
  name: string;
  description: string;
  dependencies?: string[];
}

export interface PlatformModules {
  core: ModuleConfig;
  tradingBot: ModuleConfig;
  bianDEX: ModuleConfig;
  monitoring: ModuleConfig;
  governance: ModuleConfig;
}

/**
 * Load module configuration from environment variables
 */
export function loadModuleConfig(): PlatformModules {
  const config: PlatformModules = {
    // Core services - always enabled
    core: {
      enabled: true,
      name: 'Core Services',
      description: 'Wallet management, RPC, Database, Authentication',
    },

    // Trading Bot module
    tradingBot: {
      enabled: process.env.ENABLE_TRADING_BOT !== 'false', // Default: true
      name: 'Trading Bot',
      description: 'Automated trading strategies, batch trading, risk management',
      dependencies: ['core'],
    },

    // BianDEX module
    bianDEX: {
      enabled: process.env.ENABLE_BIANDEX !== 'false', // Default: true
      name: 'BianDEX',
      description: 'Decentralized exchange, liquidity pools, governance',
      dependencies: ['core'],
    },

    // Monitoring module
    monitoring: {
      enabled: process.env.ENABLE_MONITORING !== 'false', // Default: true
      name: 'Monitoring',
      description: 'System metrics, alerts, logs',
      dependencies: ['core'],
    },

    // Governance module (part of BianDEX)
    governance: {
      enabled: process.env.ENABLE_GOVERNANCE === 'true', // Default: false
      name: 'DAO Governance',
      description: 'Proposal voting, timelock execution',
      dependencies: ['core', 'bianDEX'],
    },
  };

  return config;
}

/**
 * Validate module dependencies
 */
export function validateModuleDependencies(config: PlatformModules): boolean {
  const errors: string[] = [];

  Object.entries(config).forEach(([key, module]) => {
    if (!module.enabled) return;

    if (module.dependencies) {
      for (const dep of module.dependencies) {
        const depModule = config[dep as keyof PlatformModules];
        if (!depModule?.enabled) {
          errors.push(`Module "${module.name}" requires "${dep}" to be enabled`);
        }
      }
    }
  });

  if (errors.length > 0) {
    logger.error({ errors }, 'Module dependency validation failed');
    errors.forEach(err => console.error(`❌ ${err}`));
    return false;
  }

  return true;
}

/**
 * Print enabled modules
 */
export function printModuleStatus(config: PlatformModules): void {
  console.log('\n📦 Platform Modules Status:\n');

  Object.entries(config).forEach(([key, module]) => {
    const status = module.enabled ? '✅ ENABLED' : '⭕ DISABLED';
    const deps = module.dependencies ? ` (deps: ${module.dependencies.join(', ')})` : '';
    console.log(`  ${status}  ${module.name}${deps}`);
    console.log(`           ${module.description}`);
  });

  console.log('');
}

/**
 * Get module configuration
 */
export function getModuleConfig(): PlatformModules {
  const config = loadModuleConfig();

  // Validate dependencies
  if (!validateModuleDependencies(config)) {
    throw new Error('Module configuration validation failed. Check dependencies.');
  }

  // Print status in development
  if (process.env.NODE_ENV === 'development') {
    printModuleStatus(config);
  }

  return config;
}

/**
 * Check if a specific module is enabled
 */
export function isModuleEnabled(moduleName: keyof PlatformModules): boolean {
  const config = loadModuleConfig();
  return config[moduleName]?.enabled || false;
}

/**
 * Get BianDEX contract addresses from environment
 */
export function getBianDEXConfig() {
  return {
    factoryAddress: process.env.BIANDEX_FACTORY_ADDRESS || '',
    routerAddress: process.env.BIANDEX_ROUTER_ADDRESS || '',
    lpMiningAddress: process.env.BIANDEX_LP_MINING_ADDRESS || '',
    governanceAddress: process.env.BIANDEX_GOVERNANCE_ADDRESS || '',
    rewardTokenAddress: process.env.BIANDEX_REWARD_TOKEN_ADDRESS || '',
  };
}

// Singleton instance
let moduleConfigInstance: PlatformModules | null = null;

export function getModuleConfigInstance(): PlatformModules {
  if (!moduleConfigInstance) {
    moduleConfigInstance = getModuleConfig();
  }
  return moduleConfigInstance;
}
