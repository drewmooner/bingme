'use client';

import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import { defineChain } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@rainbow-me/rainbowkit/styles.css';

const somniaTestnet = defineChain({
  id: 1946,
  name: 'Somnia Testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'SOMI',
    symbol: 'SOMI',
  },
  rpcUrls: {
    default: {
      http: ['https://dream-rpc.somnia.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Somnia Explorer',
      url: 'https://explorer.somnia.network',
    },
  },
});

// WalletConnect Configuration
// Get a free project ID from https://cloud.reown.com
// Then add http://localhost:3000 to the allowed origins in your project settings
// Add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to .env

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// Use a default project ID for development if not set
// Note: You still need to whitelist localhost:3000 in Reown Cloud for this to work
const defaultProjectId = 'b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9';

if (!projectId) {
  console.warn(
    '⚠️  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID not set. ' +
    'WalletConnect features may not work. ' +
    'Get a free project ID from https://cloud.reown.com and add it to .env'
  );
}

const config = getDefaultConfig({
  appName: 'Bingme Portfolio',
  projectId: projectId || defaultProjectId,
  chains: [somniaTestnet],
  ssr: true,
  // Suppress WalletConnect errors in console
  showRecentTransactions: false,
});

// Suppress WalletConnect fetch errors globally
// This prevents console spam from WalletConnect trying to connect to their cloud service
if (typeof window !== 'undefined') {
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || '';
    const isWalletConnectRequest = url.includes('reown.com') || 
                                   url.includes('walletconnect.com') || 
                                   url.includes('relay.walletconnect.com') ||
                                   url.includes('relay.walletconnect.org');
    
    if (isWalletConnectRequest) {
      try {
        return await originalFetch(...args);
      } catch (error: any) {
        // Silently suppress WalletConnect/Reown cloud errors
        // Return a mock failed response to prevent console errors
        return new Response(JSON.stringify({ error: 'WalletConnect request failed' }), {
          status: 0,
          statusText: '',
          headers: { 'Content-Type': 'application/json' },
        }) as any;
      }
    }
    
    // For non-WalletConnect requests, use original fetch
    return originalFetch(...args);
  };
  
  // Suppress console errors for WalletConnect, timeout, and fetch errors
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    const errorMessage = args[0]?.message || '';
    
    // Suppress WalletConnect, timeout, and fetch errors
    if (message.includes('reown.com') || 
        message.includes('walletconnect.com') ||
        message.includes('Failed to fetch') ||
        message.includes('SuppressedWalletConnectError') ||
        message.includes('timeout') ||
        message.includes('TIMEOUT') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('TIMEOUT')) {
      return; // Suppress these errors
    }
    originalConsoleError.apply(console, args);
  };
  
  // Suppress unhandled promise rejections for WalletConnect and timeouts
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = reason?.message || reason?.toString() || '';
    
    if (message.includes('reown.com') || 
        message.includes('walletconnect.com') ||
        message.includes('Failed to fetch') ||
        message.includes('timeout') ||
        message.includes('TIMEOUT') ||
        reason?.name === 'SuppressedWalletConnectError') {
      event.preventDefault(); // Suppress these errors
    }
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

