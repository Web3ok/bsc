'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@nextui-org/react';
import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // 确保组件在客户端水合后才渲染
  useEffect(() => {
    setMounted(true);
  }, []);

  // 在未水合之前显示占位符，避免hydration错误
  if (!mounted) {
    return (
      <Button
        variant="light"
        size="sm"
        className="min-w-0 px-2 theme-button"
        disabled
      >
        <div className="h-4 w-4" />
      </Button>
    );
  }

  const isDarkMode = theme === 'dark';

  return (
    <Button
      variant="light"
      size="sm"
      onPress={() => setTheme(isDarkMode ? 'light' : 'dark')}
      className="min-w-0 px-2 theme-button"
      aria-label={isDarkMode ? '切换至浅色模式' : '切换至深色模式'}
    >
      {isDarkMode ? <Sun className="h-4 w-4 theme-icon" /> : <Moon className="h-4 w-4 theme-icon" />}
    </Button>
  );
}