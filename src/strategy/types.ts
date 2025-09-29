import { BigNumberish } from 'ethers';

// Core strategy types
export type StrategyType = 'grid' | 'dca' | 'arbitrage' | 'market_making' | 'conditional';
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop_loss' | 'take_profit';
export type OrderStatus = 'pending' | 'submitted' | 'filled' | 'partial' | 'cancelled' | 'expired' | 'failed';
export type PositionSide = 'long' | 'short' | 'neutral';

// Strategy execution states
export type StrategyStatus = 'inactive' | 'active' | 'paused' | 'stopped' | 'error';
export type ExecutionMode = 'live' | 'paper' | 'backtest' | 'simulation';

// Risk management
export interface RiskLimits {
  max_position_size: string; // in base currency
  max_daily_volume: string;
  max_slippage_percent: number;
  max_concurrent_orders: number;
  stop_loss_percent?: number;
  take_profit_percent?: number;
  max_drawdown_percent: number;
}

// Market data structures
export interface MarketData {
  symbol: string;
  price: string;
  volume_24h: string;
  timestamp: Date;
  bid?: string;
  ask?: string;
  spread?: string;
}

export interface Candlestick {
  symbol: string;
  interval: string;
  open_time: Date;
  close_time: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  trades: number;
}

// Order structures
export interface OrderRequest {
  id: string;
  strategy_id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  amount: string; // in base currency
  price?: string; // for limit orders
  stop_price?: string; // for stop orders
  time_in_force?: 'GTC' | 'IOC' | 'FOK';
  expire_time?: Date;
  reduce_only?: boolean;
  metadata?: Record<string, any>;
}

export interface Order extends OrderRequest {
  status: OrderStatus;
  filled_amount: string;
  average_price?: string;
  fee_paid?: string;
  fee_asset?: string;
  created_at: Date;
  updated_at: Date;
  submitted_at?: Date;
  filled_at?: Date;
  tx_hash?: string;
  error_message?: string;
}

// Position structures
export interface Position {
  id: string;
  strategy_id: string;
  symbol: string;
  side: PositionSide;
  size: string; // positive for long, negative for short
  entry_price: string;
  mark_price: string;
  unrealized_pnl: string;
  realized_pnl: string;
  margin_used: string;
  created_at: Date;
  updated_at: Date;
}

// Strategy base interface
export interface StrategyConfig {
  id: string;
  name: string;
  type: StrategyType;
  description: string;
  symbol: string;
  status: StrategyStatus;
  execution_mode: ExecutionMode;
  risk_limits: RiskLimits;
  parameters: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

// Strategy execution context
export interface ExecutionContext {
  strategy: StrategyConfig;
  market_data: MarketData;
  recent_candles: Candlestick[];
  open_orders: Order[];
  positions: Position[];
  balance: Record<string, string>; // asset -> balance
  metrics: StrategyMetrics;
}

// Strategy performance metrics
export interface StrategyMetrics {
  strategy_id: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: string;
  realized_pnl: string;
  unrealized_pnl: string;
  max_drawdown: string;
  sharpe_ratio?: number;
  sortino_ratio?: number;
  max_position_size: string;
  volume_traded: string;
  fees_paid: string;
  start_time: Date;
  end_time?: Date;
  updated_at: Date;
}

// Strategy signals and actions
export interface StrategySignal {
  id: string;
  strategy_id: string;
  type: 'buy' | 'sell' | 'hold' | 'close' | 'adjust';
  confidence: number; // 0-1
  price: string;
  amount: string;
  reason: string;
  metadata?: Record<string, any>;
  created_at: Date;
}

export interface StrategyAction {
  id: string;
  strategy_id: string;
  signal_id?: string;
  type: 'place_order' | 'cancel_order' | 'modify_order' | 'close_position' | 'pause_strategy';
  parameters: Record<string, any>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  created_at: Date;
  executed_at?: Date;
}

// Grid strategy specific types
export interface GridStrategyParams {
  grid_spacing: string; // percentage between grid levels
  grid_count: number; // number of grid levels
  base_order_size: string; // size of each grid order
  upper_price: string; // upper bound of grid
  lower_price: string; // lower bound of grid
  center_price?: string; // center price (default: current market price)
  rebalance_threshold: number; // percentage threshold to rebalance grid
  inventory_target: number; // target inventory ratio (0.5 = balanced)
}

export interface GridLevel {
  id: string;
  strategy_id: string;
  level: number; // grid level index
  price: string;
  side: OrderSide;
  amount: string;
  order_id?: string;
  filled: boolean;
  created_at: Date;
  updated_at: Date;
}

// Conditional order types
export interface ConditionalOrderParams {
  trigger_condition: TriggerCondition;
  trigger_price?: string;
  order_request: OrderRequest;
}

export interface TriggerCondition {
  type: 'price_above' | 'price_below' | 'price_cross_up' | 'price_cross_down' | 
        'rsi_above' | 'rsi_below' | 'volume_above' | 'time_based' | 'custom';
  symbol: string;
  value: string | number;
  timeframe?: string; // for indicator-based triggers
  custom_logic?: string; // for custom triggers
}

// Backtest and simulation types
export interface BacktestConfig {
  id: string;
  name: string;
  strategy_config: StrategyConfig;
  start_date: Date;
  end_date: Date;
  initial_balance: Record<string, string>;
  data_source: 'historical' | 'generated';
  slippage_model: 'fixed' | 'linear' | 'impact';
  commission_rate: number;
  price_impact: number;
}

export interface BacktestResult {
  config_id: string;
  total_return: number;
  annualized_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  win_rate: number;
  total_trades: number;
  avg_trade_return: number;
  profit_factor: number;
  calmar_ratio: number;
  daily_returns: number[];
  equity_curve: Array<{ date: Date; value: number }>;
  trades: Order[];
  metrics: StrategyMetrics;
  created_at: Date;
}

// Fund management types
export interface FundManagementConfig {
  gas_management: {
    min_gas_balance: string; // minimum ETH/BNB balance for gas
    top_up_amount: string; // amount to top up when low
    top_up_threshold: string; // threshold to trigger top-up
  };
  sweep_config: {
    enabled: boolean;
    min_balance_threshold: string; // minimum balance to leave
    sweep_frequency_hours: number;
    target_wallet?: string; // where to sweep to
  };
  rebalance_config: {
    enabled: boolean;
    target_allocation: Record<string, number>; // asset -> percentage
    rebalance_threshold: number; // percentage deviation to trigger
    frequency_hours: number;
  };
}

// Error types
export class StrategyError extends Error {
  constructor(
    message: string,
    public code: string,
    public strategy_id?: string,
    public context?: any
  ) {
    super(message);
    this.name = 'StrategyError';
  }
}

export class OrderError extends Error {
  constructor(
    message: string,
    public code: string,
    public order_id?: string,
    public context?: any
  ) {
    super(message);
    this.name = 'OrderError';
  }
}