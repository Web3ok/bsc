"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const react_1 = require("@testing-library/react");
const react_2 = require("@nextui-org/react");
const page_1 = __importDefault(require("../../frontend/app/page"));
// Mock WebSocket Context
const mockWebSocketContext = {
    connected: true,
    lastMessage: null,
    sendMessage: vitest_1.vi.fn(),
    socket: null
};
vitest_1.vi.mock('../../frontend/contexts/WebSocketContext', () => ({
    useWebSocket: () => mockWebSocketContext
}));
// Mock fetch
global.fetch = vitest_1.vi.fn();
// Mock environment variables
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3010';
function TestWrapper({ children }) {
    return (<react_2.NextUIProvider>
      {children}
    </react_2.NextUIProvider>);
}
(0, vitest_1.describe)('Dashboard 组件测试', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
        // 默认模拟成功的API响应
        vitest_1.vi.mocked(fetch).mockImplementation((url) => {
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
                    });
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
                    });
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
                    });
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
                    });
                }
            }
            return Promise.reject(new Error('Unknown URL'));
        });
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.restoreAllMocks();
    });
    (0, vitest_1.test)('应该渲染页面标题和描述', () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        (0, vitest_1.expect)(react_1.screen.getByText('BSC Trading Bot Dashboard')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('Welcome to your trading control center')).toBeInTheDocument();
    });
    (0, vitest_1.test)('应该显示WebSocket连接状态', () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        (0, vitest_1.expect)(react_1.screen.getByText('WebSocket: Connected')).toBeInTheDocument();
    });
    (0, vitest_1.test)('应该显示WebSocket断开状态', () => {
        mockWebSocketContext.connected = false;
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        (0, vitest_1.expect)(react_1.screen.getByText('WebSocket: Disconnected')).toBeInTheDocument();
    });
    (0, vitest_1.test)('应该加载并显示仪表盘数据', async () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        // 等待数据加载
        await (0, react_1.waitFor)(() => {
            (0, vitest_1.expect)(react_1.screen.getByText('✅ Connected')).toBeInTheDocument();
        });
        // 检查系统状态卡片
        (0, vitest_1.expect)(react_1.screen.getByText('API Status')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('v1.0.0 • Uptime: 1h')).toBeInTheDocument();
        // 检查交易性能卡片
        (0, vitest_1.expect)(react_1.screen.getByText('Trading Performance')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('$+15.8')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('24h P&L • 120 trades')).toBeInTheDocument();
        // 检查钱包余额卡片
        (0, vitest_1.expect)(react_1.screen.getByText('Wallet Balance')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('25.5 BNB')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('5 wallets')).toBeInTheDocument();
        // 检查成功率卡片
        (0, vitest_1.expect)(react_1.screen.getByText('Success Rate')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('95.5%')).toBeInTheDocument();
    });
    (0, vitest_1.test)('应该处理API错误', async () => {
        vitest_1.vi.mocked(fetch).mockRejectedValue(new Error('API Error'));
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        await (0, react_1.waitFor)(() => {
            (0, vitest_1.expect)(react_1.screen.getByText('❌ Disconnected')).toBeInTheDocument();
        });
    });
    (0, vitest_1.test)('应该显示系统状态', async () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        await (0, react_1.waitFor)(() => {
            (0, vitest_1.expect)(react_1.screen.getByText('System Status')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('Overall Status')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('healthy')).toBeInTheDocument();
        });
    });
    (0, vitest_1.test)('Quick Trade 表单应该工作正常', async () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        await (0, react_1.waitFor)(() => {
            (0, vitest_1.expect)(react_1.screen.getByText('Quick Trade')).toBeInTheDocument();
        });
        // 填写交易表单
        const amountInput = react_1.screen.getByLabelText('Amount In');
        const walletInput = react_1.screen.getByLabelText('Wallet Address');
        react_1.fireEvent.change(amountInput, { target: { value: '1' } });
        react_1.fireEvent.change(walletInput, { target: { value: '0x1234567890123456789012345678901234567890' } });
        // 点击获取报价按钮
        const quoteButton = react_1.screen.getByText('Get Quote');
        react_1.fireEvent.click(quoteButton);
        await (0, react_1.waitFor)(() => {
            (0, vitest_1.expect)(fetch).toHaveBeenCalledWith(vitest_1.expect.stringContaining('/api/trading/quote'), vitest_1.expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }));
        });
    });
    (0, vitest_1.test)('应该显示报价信息', async () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        // 填写表单并获取报价
        const amountInput = react_1.screen.getByLabelText('Amount In');
        react_1.fireEvent.change(amountInput, { target: { value: '1' } });
        const quoteButton = react_1.screen.getByText('Get Quote');
        react_1.fireEvent.click(quoteButton);
        await (0, react_1.waitFor)(() => {
            (0, vitest_1.expect)(react_1.screen.getByText('Amount Out:')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('300.5')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('Price Impact:')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('0.15%')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('Route:')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('WBNB -> USDT')).toBeInTheDocument();
        });
    });
    (0, vitest_1.test)('应该能够执行交易', async () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        // 填写完整表单
        const amountInput = react_1.screen.getByLabelText('Amount In');
        const walletInput = react_1.screen.getByLabelText('Wallet Address');
        react_1.fireEvent.change(amountInput, { target: { value: '1' } });
        react_1.fireEvent.change(walletInput, { target: { value: '0x1234567890123456789012345678901234567890' } });
        // 先获取报价
        const quoteButton = react_1.screen.getByText('Get Quote');
        react_1.fireEvent.click(quoteButton);
        await (0, react_1.waitFor)(() => {
            (0, vitest_1.expect)(react_1.screen.getByText('Amount Out:')).toBeInTheDocument();
        });
        // 执行交易
        const executeButton = react_1.screen.getByText('Execute Trade');
        (0, vitest_1.expect)(executeButton).not.toBeDisabled();
        react_1.fireEvent.click(executeButton);
        await (0, react_1.waitFor)(() => {
            (0, vitest_1.expect)(fetch).toHaveBeenCalledWith(vitest_1.expect.stringContaining('/api/trading/execute'), vitest_1.expect.objectContaining({
                method: 'POST'
            }));
        });
    });
    (0, vitest_1.test)('执行交易按钮应该在没有报价时被禁用', () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        const executeButton = react_1.screen.getByText('Execute Trade');
        (0, vitest_1.expect)(executeButton).toBeDisabled();
    });
    (0, vitest_1.test)('应该有刷新按钮', () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        const refreshButton = react_1.screen.getByRole('button', { name: /refresh/i });
        (0, vitest_1.expect)(refreshButton).toBeInTheDocument();
        react_1.fireEvent.click(refreshButton);
        // 应该再次调用API
        (0, vitest_1.expect)(fetch).toHaveBeenCalledWith(vitest_1.expect.stringContaining('/api/dashboard/overview'));
    });
    (0, vitest_1.test)('应该处理WebSocket消息更新', () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
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
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        // 验证数据已更新（这需要组件重新渲染）
        (0, vitest_1.expect)(mockWebSocketContext.sendMessage).toHaveBeenCalledWith({
            type: 'subscribe',
            data: { channels: ['metrics', 'trades', 'system'] }
        });
    });
    (0, vitest_1.test)('应该显示正确的P&L颜色', async () => {
        // 测试正收益
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        await (0, react_1.waitFor)(() => {
            const pnlElement = react_1.screen.getByText('$+15.8');
            (0, vitest_1.expect)(pnlElement).toHaveClass('text-green-500');
        });
    });
    (0, vitest_1.test)('应该显示负收益的颜色', async () => {
        // 模拟负收益
        vitest_1.vi.mocked(fetch).mockImplementation((url) => {
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
                });
            }
            return Promise.reject(new Error('Unknown URL'));
        });
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        await (0, react_1.waitFor)(() => {
            const pnlElement = react_1.screen.getByText('$-5.2');
            (0, vitest_1.expect)(pnlElement).toHaveClass('text-red-500');
        });
    });
    (0, vitest_1.test)('应该正确处理系统组件状态', async () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        await (0, react_1.waitFor)(() => {
            // 验证系统组件状态显示
            (0, vitest_1.expect)(react_1.screen.getByText('Api')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('Database')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('Rpc Providers')).toBeInTheDocument();
            // 验证健康状态图标
            const healthyIcons = react_1.screen.getAllByText('✅');
            (0, vitest_1.expect)(healthyIcons.length).toBeGreaterThan(0);
        });
    });
    (0, vitest_1.test)('应该显示系统运行时间', async () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        await (0, react_1.waitFor)(() => {
            (0, vitest_1.expect)(react_1.screen.getByText('Uptime')).toBeInTheDocument();
            (0, vitest_1.expect)(react_1.screen.getByText('1h 0m')).toBeInTheDocument();
        });
    });
    (0, vitest_1.test)('表单验证应该工作', () => {
        (0, react_1.render)(<TestWrapper>
        <page_1.default />
      </TestWrapper>);
        // 不填写必要字段就点击获取报价
        const quoteButton = react_1.screen.getByText('Get Quote');
        react_1.fireEvent.click(quoteButton);
        // 应该不会调用API（由于验证失败）
        (0, vitest_1.expect)(fetch).not.toHaveBeenCalledWith(vitest_1.expect.stringContaining('/api/trading/quote'));
    });
});
//# sourceMappingURL=dashboard.test.js.map