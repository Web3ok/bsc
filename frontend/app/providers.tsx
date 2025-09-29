'use client';

import { NextUIProvider } from '@nextui-org/react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Toaster } from 'react-hot-toast';
import React, { useState } from 'react';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import { LanguageProvider } from '../contexts/LanguageContext';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        staleTime: 5 * 60 * 1000,
        cacheTime: 10 * 60 * 1000,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <NextUIProvider>
          <NextThemesProvider attribute="class" defaultTheme="light" themes={['light', 'dark']}>
            <WebSocketProvider>
              {children}
              <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
            </WebSocketProvider>
          </NextThemesProvider>
        </NextUIProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}


