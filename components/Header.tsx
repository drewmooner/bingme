'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import CustomConnectButton from './CustomConnectButton';

export default function Header() {
  const { address, isConnected } = useAccount();

  return (
    <header className="border-b border-slate-700 bg-slate-900 fixed top-0 left-0 right-0 z-50 h-16">
      <div className="flex items-center justify-between h-full px-8 ml-64">
        {/* Left Side - Branding */}
        <div className="flex items-center">
          <Link href="/" className="text-xl font-semibold text-slate-100 hover:text-cyan-400 transition-colors">
            Bingme
          </Link>
        </div>

        {/* Right Side Controls */}
        <div className="flex items-center gap-4">
          {/* Network Selector */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg cursor-pointer hover:bg-slate-700 transition-colors">
            <span className="text-sm text-slate-300">Somnia Testnet</span>
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {/* Currency Selector */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg cursor-pointer hover:bg-slate-700 transition-colors">
            <span className="text-sm text-slate-300">USD</span>
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {/* Connect Button */}
          <CustomConnectButton />
        </div>
      </div>
    </header>
  );
}

