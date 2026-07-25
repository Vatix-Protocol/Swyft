import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { WalletProvider } from '@/context/WalletContext';
import { NetworkProvider } from '@/context/NetworkContext';
import { TransactionStatusProvider } from '@/context/TransactionStatusContext';
import { QueryProvider } from '@/context/QueryProvider';
import { Navbar } from '@/components/Navbar';
import { Providers } from './providers';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Swyft',
  description: 'Concentrated liquidity DEX on Stellar',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* Inline script to apply the `dark` class before first paint,
            preventing a flash of unstyled content in dark mode. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>
          <NetworkProvider>
            <TransactionStatusProvider>
              <WalletProvider>
                <Navbar />
                {children}
              </WalletProvider>
            </TransactionStatusProvider>
          </NetworkProvider>
        </Providers>
      </body>
    </html>
  );
}
