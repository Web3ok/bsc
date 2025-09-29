"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const react_1 = require("@testing-library/react");
const react_2 = require("@nextui-org/react");
const Navigation_1 = __importDefault(require("../../frontend/components/Navigation"));
// Mock Next.js router
const mockPush = vitest_1.vi.fn();
const mockPathname = '/';
vitest_1.vi.mock('next/navigation', () => ({
    usePathname: () => mockPathname,
    useRouter: () => ({
        push: mockPush,
        replace: vitest_1.vi.fn(),
        prefetch: vitest_1.vi.fn(),
    }),
}));
vitest_1.vi.mock('next/link', () => {
    return function MockLink({ children, href, className, onClick }) {
        return (<a href={href} className={className} onClick={(e) => {
                e.preventDefault();
                if (onClick)
                    onClick();
                mockPush(href);
            }}>
        {children}
      </a>);
    };
});
// 测试包装器
function TestWrapper({ children }) {
    return (<react_2.NextUIProvider>
      {children}
    </react_2.NextUIProvider>);
}
(0, vitest_1.describe)('Navigation 组件测试', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.test)('应该渲染所有导航菜单项', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        // 检查主要菜单项
        (0, vitest_1.expect)(react_1.screen.getByText('Dashboard')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('Trading')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('Wallets')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('Monitoring')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('Settings')).toBeInTheDocument();
    });
    (0, vitest_1.test)('应该显示品牌标识', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        (0, vitest_1.expect)(react_1.screen.getByText('BSC Bot')).toBeInTheDocument();
    });
    (0, vitest_1.test)('应该显示系统在线状态', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        (0, vitest_1.expect)(react_1.screen.getByText('System Online')).toBeInTheDocument();
    });
    (0, vitest_1.test)('应该响应菜单项点击', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        // 点击 Trading 菜单项
        const tradingLink = react_1.screen.getByText('Trading').closest('a');
        (0, vitest_1.expect)(tradingLink).toHaveAttribute('href', '/trading');
        react_1.fireEvent.click(tradingLink);
        (0, vitest_1.expect)(mockPush).toHaveBeenCalledWith('/trading');
    });
    (0, vitest_1.test)('应该正确高亮当前页面', () => {
        // 模拟当前路径为 /trading
        vitest_1.vi.mocked(require('next/navigation').usePathname).mockReturnValue('/trading');
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        const tradingLink = react_1.screen.getByText('Trading').closest('a');
        (0, vitest_1.expect)(tradingLink).toHaveClass('bg-blue-100', 'text-blue-700', 'font-medium');
    });
    (0, vitest_1.test)('应该在移动端显示菜单切换按钮', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        // 菜单切换按钮应该存在但在大屏幕上隐藏
        const menuToggle = react_1.screen.getByLabelText(/menu/i);
        (0, vitest_1.expect)(menuToggle).toBeInTheDocument();
    });
    (0, vitest_1.test)('菜单项应该包含正确的图标', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        // 检查各个菜单项是否包含图标（通过 SVG 元素）
        const menuItems = react_1.screen.getAllByRole('link');
        menuItems.forEach(item => {
            const svg = item.querySelector('svg');
            if (item.textContent?.includes('Dashboard') ||
                item.textContent?.includes('Trading') ||
                item.textContent?.includes('Wallets') ||
                item.textContent?.includes('Monitoring') ||
                item.textContent?.includes('Settings')) {
                (0, vitest_1.expect)(svg).toBeInTheDocument();
            }
        });
    });
    (0, vitest_1.test)('应该正确处理根路径的激活状态', () => {
        // 模拟当前路径为根路径
        vitest_1.vi.mocked(require('next/navigation').usePathname).mockReturnValue('/');
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        const dashboardLink = react_1.screen.getByText('Dashboard').closest('a');
        (0, vitest_1.expect)(dashboardLink).toHaveClass('bg-blue-100', 'text-blue-700', 'font-medium');
        // 其他菜单项不应该被激活
        const tradingLink = react_1.screen.getByText('Trading').closest('a');
        (0, vitest_1.expect)(tradingLink).not.toHaveClass('bg-blue-100', 'text-blue-700', 'font-medium');
    });
    (0, vitest_1.test)('应该正确处理子路径的激活状态', () => {
        // 模拟当前路径为 /trading/history
        vitest_1.vi.mocked(require('next/navigation').usePathname).mockReturnValue('/trading/history');
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        const tradingLink = react_1.screen.getByText('Trading').closest('a');
        (0, vitest_1.expect)(tradingLink).toHaveClass('bg-blue-100', 'text-blue-700', 'font-medium');
    });
    (0, vitest_1.test)('移动端菜单应该包含描述信息', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        // 在移动端菜单中查找描述信息
        (0, vitest_1.expect)(react_1.screen.getByText('Overview and quick actions')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('Execute trades and view history')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('Manage wallets and groups')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('System health and metrics')).toBeInTheDocument();
        (0, vitest_1.expect)(react_1.screen.getByText('Configure system settings')).toBeInTheDocument();
    });
    (0, vitest_1.test)('应该具有无障碍属性', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        // 检查导航区域
        const nav = react_1.screen.getByRole('navigation');
        (0, vitest_1.expect)(nav).toBeInTheDocument();
        // 检查菜单按钮的可访问性标签
        const menuButton = react_1.screen.getByLabelText(/menu/i);
        (0, vitest_1.expect)(menuButton).toHaveAttribute('aria-label');
    });
    (0, vitest_1.test)('应该正确响应键盘导航', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        const tradingLink = react_1.screen.getByText('Trading').closest('a');
        // 模拟键盘 Enter 事件
        react_1.fireEvent.keyDown(tradingLink, { key: 'Enter', code: 'Enter' });
        // 链接应该是可聚焦的
        (0, vitest_1.expect)(tradingLink).toHaveAttribute('href');
    });
    (0, vitest_1.test)('导航链接应该可以被屏幕阅读器识别', () => {
        (0, react_1.render)(<TestWrapper>
        <Navigation_1.default />
      </TestWrapper>);
        // 所有主要导航链接都应该是可访问的
        const links = react_1.screen.getAllByRole('link');
        const menuTexts = ['Dashboard', 'Trading', 'Wallets', 'Monitoring', 'Settings'];
        menuTexts.forEach(text => {
            const link = links.find(link => link.textContent?.includes(text));
            (0, vitest_1.expect)(link).toBeInTheDocument();
            (0, vitest_1.expect)(link).toHaveAttribute('href');
        });
    });
});
//# sourceMappingURL=navigation.test.js.map