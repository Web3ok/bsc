import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextUIProvider } from '@nextui-org/react';
import Dashboard from '../../frontend/app/page';

// Mock WebSocket Context
const mockWebSocketContext = {
  connected: true,
  lastMessage: null,
  sendMessage: vi.fn(),
  socket: null
};

vi.mock('../../frontend/contexts/WebSocketContext', () => ({
  useWebSocket: () => mockWebSocketContext
}));

// Mock fetch
global.fetch = vi.fn();

// Mock environment variables
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3010';

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextUIProvider>
      {children}
    </NextUIProvider>
  );
}

describe('Dashboard 组件测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // 默认模拟成功的API响应
    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string') {
        if (url.includes('/api/dashboard/overview')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                system: {
                  status: 'healthy',
                  uptime: 3600,
                  version: '1.0.0'
                },
                wallets: {
                  total: 5,
                  totalBalance: '25.5 BNB'
                },
                trading: {
                  totalTrades24h: 120,
                  pnl24h: '+15.8',
                  volume24h: '450.2',
                  successRate: '95.5%'
                }
              }
            })
          } as Response);
        }
        
        if (url.includes('/api/dashboard/status')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                overall: 'healthy',
                components: {
                  api: 'healthy',
                  database: 'healthy',
                  rpc_providers: 'healthy'
                },
                uptime: 3600
              }
            })
          } as Response);
        }

        if (url.includes('/api/trading/quote')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                amountOut: '300.5',
                priceImpact: '0.15%',
                route: 'WBNB -> USDT'
              }
            })
          } as Response);
        }

        if (url.includes('/api/trading/execute')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              success: true,
              data: {
                txHash: '0x1234567890abcdef'
              }
            })
          } as Response);
        }
      }
      
      return Promise.reject(new Error('Unknown URL'));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('应该渲染页面标题和描述', () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    expect(screen.getByText('BSC Trading Bot Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Welcome to your trading control center')).toBeInTheDocument();
  });

  test('应该显示WebSocket连接状态', () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    expect(screen.getByText('WebSocket: Connected')).toBeInTheDocument();
  });

  test('应该显示WebSocket断开状态', () => {
    mockWebSocketContext.connected = false;

    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    expect(screen.getByText('WebSocket: Disconnected')).toBeInTheDocument();
  });

  test('应该加载并显示仪表盘数据', async () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    // 等待数据加载
    await waitFor(() => {
      expect(screen.getByText('✅ Connected')).toBeInTheDocument();
    });

    // 检查系统状态卡片
    expect(screen.getByText('API Status')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0 • Uptime: 1h')).toBeInTheDocument();

    // 检查交易性能卡片
    expect(screen.getByText('Trading Performance')).toBeInTheDocument();
    expect(screen.getByText('$+15.8')).toBeInTheDocument();
    expect(screen.getByText('24h P&L • 120 trades')).toBeInTheDocument();

    // 检查钱包余额卡片
    expect(screen.getByText('Wallet Balance')).toBeInTheDocument();
    expect(screen.getByText('25.5 BNB')).toBeInTheDocument();
    expect(screen.getByText('5 wallets')).toBeInTheDocument();

    // 检查成功率卡片
    expect(screen.getByText('Success Rate')).toBeInTheDocument();
    expect(screen.getByText('95.5%')).toBeInTheDocument();
  });

  test('应该处理API错误', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('API Error'));

    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('❌ Disconnected')).toBeInTheDocument();
    });
  });

  test('应该显示系统状态', async () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('System Status')).toBeInTheDocument();
      expect(screen.getByText('Overall Status')).toBeInTheDocument();
      expect(screen.getByText('healthy')).toBeInTheDocument();
    });
  });

  test('Quick Trade 表单应该工作正常', async () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Quick Trade')).toBeInTheDocument();
    });

    // 填写交易表单
    const amountInput = screen.getByLabelText('Amount In');
    const walletInput = screen.getByLabelText('Wallet Address');
    
    fireEvent.change(amountInput, { target: { value: '1' } });
    fireEvent.change(walletInput, { target: { value: '0x1234567890123456789012345678901234567890' } });

    // 点击获取报价按钮
    const quoteButton = screen.getByText('Get Quote');
    fireEvent.click(quoteButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/trading/quote'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      );
    });
  });

  test('应该显示报价信息', async () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    // 填写表单并获取报价
    const amountInput = screen.getByLabelText('Amount In');
    fireEvent.change(amountInput, { target: { value: '1' } });

    const quoteButton = screen.getByText('Get Quote');
    fireEvent.click(quoteButton);

    await waitFor(() => {
      expect(screen.getByText('Amount Out:')).toBeInTheDocument();
      expect(screen.getByText('300.5')).toBeInTheDocument();
      expect(screen.getByText('Price Impact:')).toBeInTheDocument();
      expect(screen.getByText('0.15%')).toBeInTheDocument();
      expect(screen.getByText('Route:')).toBeInTheDocument();
      expect(screen.getByText('WBNB -> USDT')).toBeInTheDocument();
    });
  });

  test('应该能够执行交易', async () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    // 填写完整表单
    const amountInput = screen.getByLabelText('Amount In');
    const walletInput = screen.getByLabelText('Wallet Address');
    
    fireEvent.change(amountInput, { target: { value: '1' } });
    fireEvent.change(walletInput, { target: { value: '0x1234567890123456789012345678901234567890' } });

    // 先获取报价
    const quoteButton = screen.getByText('Get Quote');
    fireEvent.click(quoteButton);

    await waitFor(() => {
      expect(screen.getByText('Amount Out:')).toBeInTheDocument();
    });

    // 执行交易
    const executeButton = screen.getByText('Execute Trade');
    expect(executeButton).not.toBeDisabled();
    
    fireEvent.click(executeButton);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/trading/execute'),
        expect.objectContaining({
          method: 'POST'
        })
      );
    });
  });

  test('执行交易按钮应该在没有报价时被禁用', () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    const executeButton = screen.getByText('Execute Trade');
    expect(executeButton).toBeDisabled();
  });

  test('应该有刷新按钮', () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    const refreshButton = screen.getByRole('button', { name: /refresh/i });
    expect(refreshButton).toBeInTheDocument();

    fireEvent.click(refreshButton);
    
    // 应该再次调用API
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/dashboard/overview')
    );
  });

  test('应该处理WebSocket消息更新', () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    // 模拟WebSocket消息
    mockWebSocketContext.lastMessage = {
      type: 'metrics_update',
      data: {
        trading: {
          totalTrades: 150,
          pnl: '+20.5',
          volume24h: '500.0'
        },
        wallets: {
          total: 6,
          totalBalance: '30.0 BNB'
        }
      }
    };

    // 重新渲染以触发useEffect
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    // 验证数据已更新（这需要组件重新渲染）
    expect(mockWebSocketContext.sendMessage).toHaveBeenCalledWith({
      type: 'subscribe',
      data: { channels: ['metrics', 'trades', 'system'] }
    });
  });

  test('应该显示正确的P&L颜色', async () => {
    // 测试正收益
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    await waitFor(() => {
      const pnlElement = screen.getByText('$+15.8');
      expect(pnlElement).toHaveClass('text-green-500');
    });
  });

  test('应该显示负收益的颜色', async () => {
    // 模拟负收益
    vi.mocked(fetch).mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/api/dashboard/overview')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              system: { status: 'healthy', uptime: 3600, version: '1.0.0' },
              wallets: { total: 5, totalBalance: '25.5 BNB' },
              trading: {
                totalTrades24h: 120,
                pnl24h: '-5.2', // 负收益
                volume24h: '450.2',
                successRate: '95.5%'
              }
            }
          })
        } as Response);
      }
      return Promise.reject(new Error('Unknown URL'));
    });

    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    await waitFor(() => {
      const pnlElement = screen.getByText('$-5.2');
      expect(pnlElement).toHaveClass('text-red-500');
    });
  });

  test('应该正确处理系统组件状态', async () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    await waitFor(() => {
      // 验证系统组件状态显示
      expect(screen.getByText('Api')).toBeInTheDocument();
      expect(screen.getByText('Database')).toBeInTheDocument();
      expect(screen.getByText('Rpc Providers')).toBeInTheDocument();
      
      // 验证健康状态图标
      const healthyIcons = screen.getAllByText('✅');
      expect(healthyIcons.length).toBeGreaterThan(0);
    });
  });

  test('应该显示系统运行时间', async () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByText('Uptime')).toBeInTheDocument();
      expect(screen.getByText('1h 0m')).toBeInTheDocument();
    });
  });

  test('表单验证应该工作', () => {
    render(
      <TestWrapper>
        <Dashboard />
      </TestWrapper>
    );

    // 不填写必要字段就点击获取报价
    const quoteButton = screen.getByText('Get Quote');
    fireEvent.click(quoteButton);

    // 应该不会调用API（由于验证失败）
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/trading/quote')
    );
  });
});