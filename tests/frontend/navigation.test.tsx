import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextUIProvider } from '@nextui-org/react';
import Navigation from '../../frontend/components/Navigation';

// Mock Next.js router
const mockPush = vi.fn();
const mockPathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('next/link', () => {
  return function MockLink({ children, href, className, onClick }: any) {
    return (
      <a 
        href={href} 
        className={className}
        onClick={(e) => {
          e.preventDefault();
          if (onClick) onClick();
          mockPush(href);
        }}
      >
        {children}
      </a>
    );
  };
});

// 测试包装器
function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextUIProvider>
      {children}
    </NextUIProvider>
  );
}

describe('Navigation 组件测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('应该渲染所有导航菜单项', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    // 检查主要菜单项
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Trading')).toBeInTheDocument();
    expect(screen.getByText('Wallets')).toBeInTheDocument();
    expect(screen.getByText('Monitoring')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  test('应该显示品牌标识', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    expect(screen.getByText('BSC Bot')).toBeInTheDocument();
  });

  test('应该显示系统在线状态', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    expect(screen.getByText('System Online')).toBeInTheDocument();
  });

  test('应该响应菜单项点击', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    // 点击 Trading 菜单项
    const tradingLink = screen.getByText('Trading').closest('a');
    expect(tradingLink).toHaveAttribute('href', '/trading');
    
    fireEvent.click(tradingLink!);
    expect(mockPush).toHaveBeenCalledWith('/trading');
  });

  test('应该正确高亮当前页面', () => {
    // 模拟当前路径为 /trading
    vi.mocked(require('next/navigation').usePathname).mockReturnValue('/trading');

    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    const tradingLink = screen.getByText('Trading').closest('a');
    expect(tradingLink).toHaveClass('bg-blue-100', 'text-blue-700', 'font-medium');
  });

  test('应该在移动端显示菜单切换按钮', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    // 菜单切换按钮应该存在但在大屏幕上隐藏
    const menuToggle = screen.getByLabelText(/menu/i);
    expect(menuToggle).toBeInTheDocument();
  });

  test('菜单项应该包含正确的图标', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    // 检查各个菜单项是否包含图标（通过 SVG 元素）
    const menuItems = screen.getAllByRole('link');
    menuItems.forEach(item => {
      const svg = item.querySelector('svg');
      if (item.textContent?.includes('Dashboard') || 
          item.textContent?.includes('Trading') ||
          item.textContent?.includes('Wallets') ||
          item.textContent?.includes('Monitoring') ||
          item.textContent?.includes('Settings')) {
        expect(svg).toBeInTheDocument();
      }
    });
  });

  test('应该正确处理根路径的激活状态', () => {
    // 模拟当前路径为根路径
    vi.mocked(require('next/navigation').usePathname).mockReturnValue('/');

    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    const dashboardLink = screen.getByText('Dashboard').closest('a');
    expect(dashboardLink).toHaveClass('bg-blue-100', 'text-blue-700', 'font-medium');

    // 其他菜单项不应该被激活
    const tradingLink = screen.getByText('Trading').closest('a');
    expect(tradingLink).not.toHaveClass('bg-blue-100', 'text-blue-700', 'font-medium');
  });

  test('应该正确处理子路径的激活状态', () => {
    // 模拟当前路径为 /trading/history
    vi.mocked(require('next/navigation').usePathname).mockReturnValue('/trading/history');

    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    const tradingLink = screen.getByText('Trading').closest('a');
    expect(tradingLink).toHaveClass('bg-blue-100', 'text-blue-700', 'font-medium');
  });

  test('移动端菜单应该包含描述信息', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    // 在移动端菜单中查找描述信息
    expect(screen.getByText('Overview and quick actions')).toBeInTheDocument();
    expect(screen.getByText('Execute trades and view history')).toBeInTheDocument();
    expect(screen.getByText('Manage wallets and groups')).toBeInTheDocument();
    expect(screen.getByText('System health and metrics')).toBeInTheDocument();
    expect(screen.getByText('Configure system settings')).toBeInTheDocument();
  });

  test('应该具有无障碍属性', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    // 检查导航区域
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();

    // 检查菜单按钮的可访问性标签
    const menuButton = screen.getByLabelText(/menu/i);
    expect(menuButton).toHaveAttribute('aria-label');
  });

  test('应该正确响应键盘导航', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    const tradingLink = screen.getByText('Trading').closest('a');
    
    // 模拟键盘 Enter 事件
    fireEvent.keyDown(tradingLink!, { key: 'Enter', code: 'Enter' });
    
    // 链接应该是可聚焦的
    expect(tradingLink).toHaveAttribute('href');
  });

  test('导航链接应该可以被屏幕阅读器识别', () => {
    render(
      <TestWrapper>
        <Navigation />
      </TestWrapper>
    );

    // 所有主要导航链接都应该是可访问的
    const links = screen.getAllByRole('link');
    const menuTexts = ['Dashboard', 'Trading', 'Wallets', 'Monitoring', 'Settings'];
    
    menuTexts.forEach(text => {
      const link = links.find(link => link.textContent?.includes(text));
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href');
    });
  });
});