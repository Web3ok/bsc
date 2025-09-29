'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  BarChart3, 
  Wallet, 
  Settings, 
  TrendingUp, 
  Shield, 
  Users, 
  Activity,
  ChevronLeft,
  ChevronRight,
  Home,
  Layers,
  Zap,
  FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navigation = [
  {
    name: 'Dashboard',
    href: '/',
    icon: Home,
    description: 'System overview and metrics'
  },
  {
    name: 'Trading',
    href: '/trading',
    icon: TrendingUp,
    description: 'Execute trades and manage orders',
    children: [
      { name: 'Spot Trading', href: '/trading/spot' },
      { name: 'Batch Trading', href: '/trading/batch' },
      { name: 'Limit Orders', href: '/trading/limits' },
      { name: 'DEX Aggregator', href: '/trading/aggregator' },
    ]
  },
  {
    name: 'Strategies',
    href: '/strategies',
    icon: Layers,
    description: 'Manage automated trading strategies',
    children: [
      { name: 'Grid Strategies', href: '/strategies/grid' },
      { name: 'DCA Strategies', href: '/strategies/dca' },
      { name: 'Strategy Builder', href: '/strategies/builder' },
      { name: 'Backtest', href: '/strategies/backtest' },
    ]
  },
  {
    name: 'Wallets',
    href: '/wallets',
    icon: Wallet,
    description: 'Manage wallets and balances',
    children: [
      { name: 'Wallet List', href: '/wallets/list' },
      { name: 'Batch Operations', href: '/wallets/batch' },
      { name: 'Fund Management', href: '/wallets/funds' },
      { name: 'Import/Export', href: '/wallets/import-export' },
    ]
  },
  {
    name: 'Risk Management',
    href: '/risk',
    icon: Shield,
    description: 'Monitor and control risk exposure',
    children: [
      { name: 'Risk Dashboard', href: '/risk/dashboard' },
      { name: 'Position Limits', href: '/risk/limits' },
      { name: 'Risk Actions', href: '/risk/actions' },
      { name: 'Emergency Controls', href: '/risk/emergency' },
    ]
  },
  {
    name: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
    description: 'Performance analysis and reports',
    children: [
      { name: 'Performance', href: '/analytics/performance' },
      { name: 'P&L Reports', href: '/analytics/pnl' },
      { name: 'Market Analysis', href: '/analytics/market' },
      { name: 'Strategy Comparison', href: '/analytics/comparison' },
    ]
  },
  {
    name: 'Monitoring',
    href: '/monitoring',
    icon: Activity,
    description: 'System health and alerts',
    children: [
      { name: 'System Status', href: '/monitoring/status' },
      { name: 'Alerts', href: '/monitoring/alerts' },
      { name: 'Logs', href: '/monitoring/logs' },
      { name: 'Metrics', href: '/monitoring/metrics' },
    ]
  },
  {
    name: 'Automation',
    href: '/automation',
    icon: Zap,
    description: 'Automated workflows and triggers',
    children: [
      { name: 'Workflows', href: '/automation/workflows' },
      { name: 'Triggers', href: '/automation/triggers' },
      { name: 'Schedules', href: '/automation/schedules' },
      { name: 'Webhooks', href: '/automation/webhooks' },
    ]
  },
  {
    name: 'Reports',
    href: '/reports',
    icon: FileText,
    description: 'Generate and export reports',
    children: [
      { name: 'Trading Reports', href: '/reports/trading' },
      { name: 'Tax Reports', href: '/reports/tax' },
      { name: 'Audit Logs', href: '/reports/audit' },
      { name: 'Custom Reports', href: '/reports/custom' },
    ]
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
    description: 'System configuration',
    children: [
      { name: 'General', href: '/settings/general' },
      { name: 'Security', href: '/settings/security' },
      { name: 'API Keys', href: '/settings/api-keys' },
      { name: 'Notifications', href: '/settings/notifications' },
    ]
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const toggleExpanded = (href: string) => {
    setExpandedItems(prev =>
      prev.includes(href)
        ? prev.filter(item => item !== href)
        : [...prev, href]
    );
  };

  const isActive = (href: string) => {
    if (href === '/' && pathname === '/') return true;
    if (href !== '/' && pathname.startsWith(href)) return true;
    return false;
  };

  const isChildActive = (children: any[]) => {
    return children.some(child => pathname.startsWith(child.href));
  };

  return (
    <motion.aside
      className={cn(
        "bg-card border-r border-border flex flex-col transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
      animate={{ width: collapsed ? 64 : 256 }}
    >
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-primary-foreground" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">BSC Bot</h2>
                <p className="text-xs text-muted-foreground">Trading Platform</p>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const Icon = item.icon;
          const hasChildren = item.children && item.children.length > 0;
          const isExpanded = expandedItems.includes(item.href);
          const hasActiveChild = hasChildren && isChildActive(item.children);

          return (
            <div key={item.name}>
              {/* Parent Item */}
              <div className="relative">
                <Link
                  href={hasChildren ? '#' : item.href}
                  onClick={(e) => {
                    if (hasChildren) {
                      e.preventDefault();
                      if (!collapsed) {
                        toggleExpanded(item.href);
                      }
                    }
                  }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 group",
                    (isActive(item.href) || hasActiveChild)
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate">{item.name}</span>
                      {hasChildren && (
                        <ChevronRight
                          className={cn(
                            "w-4 h-4 transition-transform duration-200",
                            isExpanded && "rotate-90"
                          )}
                        />
                      )}
                    </>
                  )}
                </Link>

                {/* Tooltip for collapsed state */}
                {collapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-popover border border-border rounded-md shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
                    <div className="text-xs font-medium">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.description}</div>
                  </div>
                )}
              </div>

              {/* Children Items */}
              {hasChildren && !collapsed && (
                <motion.div
                  initial={false}
                  animate={{
                    height: isExpanded ? 'auto' : 0,
                    opacity: isExpanded ? 1 : 0,
                  }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="mt-1 ml-8 space-y-1 border-l border-border/50 pl-3">
                    {item.children.map((child) => (
                      <Link
                        key={child.name}
                        href={child.href}
                        className={cn(
                          "block px-3 py-2 text-sm rounded-md transition-colors",
                          isActive(child.href)
                            ? "bg-primary/20 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                      >
                        {child.name}
                      </Link>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        {!collapsed && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span>System Online</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Version 2.0.0
            </div>
          </div>
        )}
      </div>
    </motion.aside>
  );
}