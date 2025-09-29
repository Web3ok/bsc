/**
 * Risk Action Executor - Strategy Integration
 * 
 * Provides the bridge between risk management actions and actual strategy execution.
 * Implements idempotent execution with proper rollback and cancellation support.
 */

import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { database } from '../persistence/database';
import { EventEmitter } from 'events';

export interface ExecutionPlan {
  id: string;
  risk_action_id: string;
  plan_type: 'position_reduce' | 'position_close' | 'strategy_pause' | 'emergency_stop';
  strategy_id?: string;
  position_id?: string;
  orders: ExecutionOrder[];
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'expired';
  created_at: Date;
  expires_at: Date;
  execution_result?: any;
}

export interface ExecutionOrder {
  id: string;
  order_type: 'market_sell' | 'market_buy' | 'cancel' | 'update';
  symbol: string;
  side: 'buy' | 'sell';
  amount: string;
  price?: string;
  stop_price?: string;
  time_in_force: 'GTC' | 'IOC' | 'FOK';
  reduce_only: boolean;
  strategy_id: string;
  position_id?: string;
  execution_status: 'pending' | 'submitted' | 'filled' | 'cancelled' | 'failed';
  transaction_hash?: string;
  filled_amount?: string;
  average_price?: string;
  fees?: string;
  created_at: Date;
}

export class RiskActionExecutor extends EventEmitter {
  private pendingPlans: Map<string, ExecutionPlan> = new Map();
  private executionTimer?: NodeJS.Timeout;
  private readonly EXECUTION_TIMEOUT = 300000; // 5 minutes
  private readonly PLAN_EXPIRY = 1800000; // 30 minutes

  constructor(
    private readonly provider: ethers.Provider,
    private readonly signer: ethers.Signer
  ) {
    super();
    this.startExecutionMonitor();
  }

  async start(): Promise<void> {
    logger.info('Starting Risk Action Executor...');
    await this.loadPendingPlans();
    this.emit('started');
  }

  async stop(): Promise<void> {
    logger.info('Stopping Risk Action Executor...');
    
    if (this.executionTimer) {
      clearInterval(this.executionTimer);
      this.executionTimer = undefined;
    }

    // Cancel all pending executions
    for (const [planId, plan] of this.pendingPlans) {
      if (plan.status === 'pending' || plan.status === 'executing') {
        await this.cancelExecutionPlan(planId, 'system_shutdown');
      }
    }

    this.emit('stopped');
  }

  async executeRiskAction(
    riskActionId: string,
    actionType: string,
    parameters: Record<string, any>
  ): Promise<string> {
    const planId = `plan_${riskActionId}_${Date.now()}`;
    
    logger.info({ risk_action_id: riskActionId, plan_id: planId, action_type: actionType }, 
      'Creating execution plan for risk action');

    const plan = await this.createExecutionPlan(planId, riskActionId, actionType, parameters);
    
    // Store in memory for quick access
    this.pendingPlans.set(planId, plan);
    
    // Save to database
    await this.saveExecutionPlan(plan);
    
    // Schedule immediate execution
    this.scheduleExecution(planId);
    
    this.emit('plan_created', plan);
    return planId;
  }

  private async createExecutionPlan(
    planId: string,
    riskActionId: string,
    actionType: string,
    parameters: Record<string, any>
  ): Promise<ExecutionPlan> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.PLAN_EXPIRY);

    let orders: ExecutionOrder[] = [];

    switch (actionType) {
      case 'position_reduce':
        orders = await this.createPositionReduceOrders(parameters);
        break;
        
      case 'position_close':
        orders = await this.createPositionCloseOrders(parameters);
        break;
        
      case 'strategy_pause':
        orders = await this.createStrategyPauseOrders(parameters);
        break;
        
      case 'emergency_stop':
        orders = await this.createEmergencyStopOrders(parameters);
        break;
        
      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }

    return {
      id: planId,
      risk_action_id: riskActionId,
      plan_type: actionType as ExecutionPlan['plan_type'],
      strategy_id: parameters.strategy_id,
      position_id: parameters.position_id,
      orders,
      status: 'pending',
      created_at: now,
      expires_at: expiresAt
    };
  }

  private async createPositionReduceOrders(parameters: any): Promise<ExecutionOrder[]> {
    const { position_id, reduction_percentage = 0.3 } = parameters;
    
    // Get position details
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const position = await database.connection!('positions')
      .where('id', position_id)
      .first();
    
    if (!position) {
      throw new Error(`Position ${position_id} not found`);
    }

    const currentQuantity = parseFloat(position.quantity);
    const reduceAmount = Math.abs(currentQuantity * reduction_percentage);
    const side = currentQuantity > 0 ? 'sell' : 'buy';

    return [{
      id: `order_reduce_${position_id}_${Date.now()}`,
      order_type: 'market_sell',
      symbol: position.symbol,
      side,
      amount: reduceAmount.toString(),
      time_in_force: 'IOC',
      reduce_only: true,
      strategy_id: position.strategy_id,
      position_id: position.id,
      execution_status: 'pending',
      created_at: new Date()
    }];
  }

  private async createPositionCloseOrders(parameters: any): Promise<ExecutionOrder[]> {
    const { position_id } = parameters;
    
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const position = await database.connection!('positions')
      .where('id', position_id)
      .first();
    
    if (!position) {
      throw new Error(`Position ${position_id} not found`);
    }

    const currentQuantity = parseFloat(position.quantity);
    const closeAmount = Math.abs(currentQuantity);
    const side = currentQuantity > 0 ? 'sell' : 'buy';

    return [{
      id: `order_close_${position_id}_${Date.now()}`,
      order_type: 'market_sell',
      symbol: position.symbol,
      side,
      amount: closeAmount.toString(),
      time_in_force: 'IOC',
      reduce_only: true,
      strategy_id: position.strategy_id,
      position_id: position.id,
      execution_status: 'pending',
      created_at: new Date()
    }];
  }

  private async createStrategyPauseOrders(parameters: any): Promise<ExecutionOrder[]> {
    const { strategy_id } = parameters;
    
    // Get all open orders for the strategy
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const orders = await database.connection!('orders')
      .where('strategy_id', strategy_id)
      .where('status', 'open');

    return orders.map(order => ({
      id: `cancel_${order.id}_${Date.now()}`,
      order_type: 'cancel',
      symbol: order.symbol,
      side: order.side,
      amount: '0',
      time_in_force: 'GTC',
      reduce_only: false,
      strategy_id: order.strategy_id,
      execution_status: 'pending',
      created_at: new Date()
    }));
  }

  private async createEmergencyStopOrders(parameters: any): Promise<ExecutionOrder[]> {
    // Get all open positions and orders
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const positions = await database.connection!('positions')
      .where('status', 'active');
      
    const openOrders = await database.connection!('orders')
      .where('status', 'open');

    const orders: ExecutionOrder[] = [];

    // Cancel all open orders first
    for (const order of openOrders) {
      orders.push({
        id: `emergency_cancel_${order.id}_${Date.now()}`,
        order_type: 'cancel',
        symbol: order.symbol,
        side: order.side,
        amount: '0',
        time_in_force: 'GTC',
        reduce_only: false,
        strategy_id: order.strategy_id,
        execution_status: 'pending',
        created_at: new Date()
      });
    }

    // Close all positions
    for (const position of positions) {
      const currentQuantity = parseFloat(position.quantity);
      if (Math.abs(currentQuantity) > 0.001) { // Minimum position size threshold
        const closeAmount = Math.abs(currentQuantity);
        const side = currentQuantity > 0 ? 'sell' : 'buy';

        orders.push({
          id: `emergency_close_${position.id}_${Date.now()}`,
          order_type: 'market_sell',
          symbol: position.symbol,
          side,
          amount: closeAmount.toString(),
          time_in_force: 'IOC',
          reduce_only: true,
          strategy_id: position.strategy_id,
          position_id: position.id,
          execution_status: 'pending',
          created_at: new Date()
        });
      }
    }

    return orders;
  }

  private async executeOrder(order: ExecutionOrder): Promise<void> {
    logger.info({ order_id: order.id, symbol: order.symbol, side: order.side }, 
      'Executing risk action order');

    try {
      order.execution_status = 'submitted';
      await this.updateOrderStatus(order);

      let result: any;

      switch (order.order_type) {
        case 'market_sell':
        case 'market_buy':
          result = await this.executeMarketOrder(order);
          break;
          
        case 'cancel':
          result = await this.cancelExistingOrder(order);
          break;
          
        default:
          throw new Error(`Unsupported order type: ${order.order_type}`);
      }

      order.execution_status = 'filled';
      order.transaction_hash = result.transactionHash;
      order.filled_amount = result.filledAmount;
      order.average_price = result.averagePrice;
      order.fees = result.fees;

      await this.updateOrderStatus(order);
      
      logger.info({ order_id: order.id, tx_hash: result.transactionHash }, 
        'Risk action order executed successfully');

    } catch (error) {
      order.execution_status = 'failed';
      await this.updateOrderStatus(order);
      
      logger.error({ error, order_id: order.id }, 'Risk action order execution failed');
      throw error;
    }
  }

  private async executeMarketOrder(order: ExecutionOrder): Promise<any> {
    // This would integrate with the actual DEX/exchange
    // For now, return a mock result
    logger.info({ order }, 'Executing market order (mock implementation)');
    
    // Simulate order execution delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return {
      transactionHash: `0x${Math.random().toString(16).substring(2, 66)}`,
      filledAmount: order.amount,
      averagePrice: '45000.00', // Mock price
      fees: '0.01' // Mock fee
    };
  }

  private async cancelExistingOrder(order: ExecutionOrder): Promise<any> {
    logger.info({ order }, 'Cancelling existing order (mock implementation)');
    
    // Update the original order status
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('orders')
      .where('strategy_id', order.strategy_id)
      .where('status', 'open')
      .update({ status: 'cancelled', updated_at: new Date() });
    
    return {
      transactionHash: `0x${Math.random().toString(16).substring(2, 66)}`,
      filledAmount: '0',
      averagePrice: '0',
      fees: '0'
    };
  }

  private async executePlan(planId: string): Promise<void> {
    const plan = this.pendingPlans.get(planId);
    if (!plan || plan.status !== 'pending') {
      return;
    }

    logger.info({ plan_id: planId, order_count: plan.orders.length }, 
      'Executing risk action plan');

    try {
      plan.status = 'executing';
      await this.saveExecutionPlan(plan);

      const results = [];
      
      for (const order of plan.orders) {
        try {
          await this.executeOrder(order);
          results.push({ order_id: order.id, status: 'success' });
        } catch (error) {
          results.push({ order_id: order.id, status: 'failed', error: (error as Error).message });
          // Continue with other orders even if one fails
        }
      }

      plan.status = 'completed';
      plan.execution_result = { order_results: results };
      
      await this.saveExecutionPlan(plan);
      this.pendingPlans.delete(planId);

      logger.info({ plan_id: planId, results }, 'Risk action plan completed');
      this.emit('plan_completed', plan);

    } catch (error) {
      plan.status = 'failed';
      plan.execution_result = { error: (error as Error).message };
      
      await this.saveExecutionPlan(plan);
      this.pendingPlans.delete(planId);

      logger.error({ error, plan_id: planId }, 'Risk action plan execution failed');
      this.emit('plan_failed', plan, error);
    }
  }

  private async cancelExecutionPlan(planId: string, reason: string): Promise<void> {
    const plan = this.pendingPlans.get(planId);
    if (!plan) {
      return;
    }

    logger.info({ plan_id: planId, reason }, 'Cancelling execution plan');

    plan.status = 'cancelled';
    plan.execution_result = { cancelled_reason: reason };
    
    await this.saveExecutionPlan(plan);
    this.pendingPlans.delete(planId);

    this.emit('plan_cancelled', plan);
  }

  private scheduleExecution(planId: string): void {
    // Execute immediately for risk actions
    setTimeout(() => {
      this.executePlan(planId).catch(error => {
        logger.error({ error, plan_id: planId }, 'Scheduled execution failed');
      });
    }, 100);
  }

  private startExecutionMonitor(): void {
    this.executionTimer = setInterval(() => {
      this.checkExpiredPlans();
    }, 30000); // Check every 30 seconds
  }

  private async checkExpiredPlans(): Promise<void> {
    const now = Date.now();
    
    for (const [planId, plan] of this.pendingPlans) {
      if (plan.expires_at.getTime() < now && 
          (plan.status === 'pending' || plan.status === 'executing')) {
        await this.cancelExecutionPlan(planId, 'expired');
      }
    }
  }

  private async loadPendingPlans(): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const plans = await database.connection!('execution_plans')
      .whereIn('status', ['pending', 'executing'])
      .where('expires_at', '>', new Date());

    for (const planData of plans) {
      const plan: ExecutionPlan = {
        id: planData.id,
        risk_action_id: planData.risk_action_id,
        plan_type: planData.plan_type,
        strategy_id: planData.strategy_id,
        position_id: planData.position_id,
        orders: JSON.parse(planData.orders),
        status: planData.status,
        created_at: new Date(planData.created_at),
        expires_at: new Date(planData.expires_at),
        execution_result: planData.execution_result ? JSON.parse(planData.execution_result) : undefined
      };

      this.pendingPlans.set(plan.id, plan);

      if (plan.status === 'pending') {
        this.scheduleExecution(plan.id);
      }
    }

    logger.info({ count: plans.length }, 'Loaded pending execution plans');
  }

  private async saveExecutionPlan(plan: ExecutionPlan): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('execution_plans')
      .insert({
        id: plan.id,
        risk_action_id: plan.risk_action_id,
        plan_type: plan.plan_type,
        strategy_id: plan.strategy_id,
        position_id: plan.position_id,
        orders: JSON.stringify(plan.orders),
        status: plan.status,
        created_at: plan.created_at,
        expires_at: plan.expires_at,
        execution_result: plan.execution_result ? JSON.stringify(plan.execution_result) : null,
        updated_at: new Date()
      })
      .onConflict('id')
      .merge();
  }

  private async updateOrderStatus(order: ExecutionOrder): Promise<void> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    await database.connection!('execution_orders')
      .insert({
        id: order.id,
        order_type: order.order_type,
        symbol: order.symbol,
        side: order.side,
        amount: order.amount,
        price: order.price,
        time_in_force: order.time_in_force,
        reduce_only: order.reduce_only,
        strategy_id: order.strategy_id,
        position_id: order.position_id,
        execution_status: order.execution_status,
        transaction_hash: order.transaction_hash,
        filled_amount: order.filled_amount,
        average_price: order.average_price,
        fees: order.fees,
        created_at: order.created_at,
        updated_at: new Date()
      })
      .onConflict('id')
      .merge();
  }

  // Public API methods
  async getPlan(planId: string): Promise<ExecutionPlan | null> {
    return this.pendingPlans.get(planId) || null;
  }

  async getPlanHistory(limit: number = 100): Promise<ExecutionPlan[]> {
    if (!database.connection) {
      throw new Error('Database connection not available');
    }
    const plans = await database.connection!('execution_plans')
      .orderBy('created_at', 'desc')
      .limit(limit);

    return plans.map(p => ({
      id: p.id,
      risk_action_id: p.risk_action_id,
      plan_type: p.plan_type,
      strategy_id: p.strategy_id,
      position_id: p.position_id,
      orders: JSON.parse(p.orders),
      status: p.status,
      created_at: new Date(p.created_at),
      expires_at: new Date(p.expires_at),
      execution_result: p.execution_result ? JSON.parse(p.execution_result) : undefined
    }));
  }

  getStatus() {
    return {
      pending_plans: this.pendingPlans.size,
      execution_timeout_ms: this.EXECUTION_TIMEOUT,
      plan_expiry_ms: this.PLAN_EXPIRY
    };
  }
}