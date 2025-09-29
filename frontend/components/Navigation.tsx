'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLanguage } from '../contexts/LanguageContext';
import Link from 'next/link';
import { Navbar, NavbarBrand, NavbarContent, NavbarItem, NavbarMenuToggle, NavbarMenu, NavbarMenuItem, Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@nextui-org/react';
import { Activity, TrendingUp, Wallet, Settings, Monitor, Home, Menu, Zap, Globe } from 'lucide-react';
import ThemeToggle from './ThemeToggle';

export default function Navigation() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();
  const { language, setLanguage, t } = useLanguage();

  const menuItems = [
    {
      name: t('nav.dashboard'),
      href: '/',
      icon: Home,
      description: t('dashboard.subtitle')
    },
    {
      name: t('nav.trading'),
      href: '/trading',
      icon: TrendingUp,
      description: t('nav.trading')
    },
    {
      name: t('nav.wallets'),
      href: '/wallets',
      icon: Wallet,
      description: t('wallets.subtitle')
    },
    {
      name: t('nav.monitoring'),
      href: '/monitoring',
      icon: Monitor,
      description: t('nav.monitoring')
    },
    {
      name: t('nav.settings'),
      href: '/settings',
      icon: Settings,
      description: t('settings.subtitle')
    }
  ];

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <Navbar 
      onMenuOpenChange={setIsMenuOpen} 
      className="bg-background/80 backdrop-blur-md border-b border-border"
      maxWidth="full"
    >
      <NavbarContent>
        <NavbarMenuToggle
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          className="sm:hidden"
        />
        <NavbarBrand>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <p className="font-bold text-xl">BSC Bot</p>
          </div>
        </NavbarBrand>
      </NavbarContent>

      <NavbarContent className="hidden sm:flex gap-4" justify="center">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavbarItem key={item.href} isActive={isActive(item.href)}>
              <Link 
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg navbar-item ${
                  isActive(item.href) 
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium' 
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.name}
              </Link>
            </NavbarItem>
          );
        })}
      </NavbarContent>

      <NavbarContent justify="end">
        <NavbarItem>
          <div className="flex items-center gap-3">
            {/* Language Toggle */}
            <Dropdown>
              <DropdownTrigger>
                <Button
                  variant="light"
                  size="sm"
                  className="min-w-0 px-2"
                  aria-label="选择语言"
                >
                  <Globe className="h-4 w-4 mr-1" />
                  {language === 'zh' ? '中文' : language === 'en' ? 'EN' : language === 'ja' ? '日本語' : '한국어'}
                </Button>
              </DropdownTrigger>
              <DropdownMenu 
                aria-label="Language selection"
                onAction={(key) => setLanguage(key as any)}
              >
                <DropdownItem key="zh" textValue="中文">中文</DropdownItem>
                <DropdownItem key="en" textValue="English">English</DropdownItem>
                <DropdownItem key="ja" textValue="日本語">日本語</DropdownItem>
                <DropdownItem key="ko" textValue="한국어">한국어</DropdownItem>
              </DropdownMenu>
            </Dropdown>
            
            {/* Dark Mode Toggle */}
            <ThemeToggle />
            
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-gray-600 dark:text-gray-300">System Online</span>
            </div>
          </div>
        </NavbarItem>
      </NavbarContent>

      <NavbarMenu>
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavbarMenuItem key={item.href}>
              <Link
                href={item.href}
                className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  isActive(item.href)
                    ? 'bg-blue-100 text-blue-700 font-medium'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
                onClick={() => setIsMenuOpen(false)}
              >
                <Icon className="h-5 w-5" />
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-gray-500">{item.description}</p>
                </div>
              </Link>
            </NavbarMenuItem>
          );
        })}
      </NavbarMenu>
    </Navbar>
  );
}