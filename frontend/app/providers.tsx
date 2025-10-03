'use client';

import { NextUIProvider } from '@nextui-org/react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { Toaster } from 'react-hot-toast';
import React from 'react';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import { LanguageProvider } from '../contexts/LanguageContext';
import { Web3Provider } from '../src/providers/Web3Provider';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <Web3Provider>
        <NextUIProvider>
          <NextThemesProvider attribute="class" defaultTheme="light" themes={['light', 'dark']}>
            <WebSocketProvider>
              {children}
              <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
            </WebSocketProvider>
          </NextThemesProvider>
        </NextUIProvider>
      </Web3Provider>
    </LanguageProvider>
  );
}


