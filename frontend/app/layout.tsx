import { Inter } from 'next/font/google';
import Navigation from '../components/Navigation';
import ErrorBoundary from '../components/ErrorBoundary';
import Providers from './providers';

import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>
          <ErrorBoundary>
            <div className="min-h-screen bg-background">
              <Navigation />
              <main className="container mx-auto p-6 max-w-7xl">
                {children}
              </main>
            </div>
          </ErrorBoundary>
        </Providers>
      </body>
    </html>
  );
}