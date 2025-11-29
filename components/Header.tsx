'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import CustomConnectButton from './CustomConnectButton';
import { useTheme } from '@/contexts/ThemeContext';

export default function Header() {
  const { address, isConnected } = useAccount();
  const { theme, toggleTheme } = useTheme();
  const [showCurrencyMenu, setShowCurrencyMenu] = useState(false);
  const [showNetworkMenu, setShowNetworkMenu] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [selectedNetwork, setSelectedNetwork] = useState('Somnia Testnet');

  const currencies = [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'EUR', name: 'Euro', symbol: '€' },
    { code: 'GBP', name: 'British Pound', symbol: '£' },
    { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
    { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
    { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  ];

  const networks = [
    { name: 'Somnia Testnet', chainId: 'testnet', rpc: 'dream-rpc.somnia.network' },
    // Add more networks as they become available
  ];

  useEffect(() => {
    const savedCurrency = localStorage.getItem('preferredCurrency') || 'USD';
    setSelectedCurrency(savedCurrency);
  }, []);

  const handleCurrencyChange = (currency: string) => {
    setSelectedCurrency(currency);
    localStorage.setItem('preferredCurrency', currency);
    setShowCurrencyMenu(false);
    // Trigger a global event or context update to refresh prices
    window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency } }));
  };

  const handleNetworkChange = (network: string) => {
    setSelectedNetwork(network);
    setShowNetworkMenu(false);
    // Network switching logic would go here
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.currency-menu') && !target.closest('.currency-button')) {
        setShowCurrencyMenu(false);
      }
      if (!target.closest('.network-menu') && !target.closest('.network-button')) {
        setShowNetworkMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedCurrencyData = currencies.find(c => c.code === selectedCurrency) || currencies[0];

  return (
    <header className="border-b border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 fixed top-0 left-0 right-0 z-50 h-16 transition-colors">
      <div className="flex items-center justify-between h-full px-8 ml-64">
        {/* Left Side - Branding */}
        <div className="flex items-center">
          <Link href="/" className="text-xl font-semibold text-slate-900 dark:text-slate-100 hover:text-cyan-500 dark:hover:text-cyan-400 transition-colors">
            Bingme
          </Link>
        </div>

        {/* Right Side Controls */}
        <div className="flex items-center gap-4">
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg bg-slate-800 dark:bg-slate-800 border border-slate-700 dark:border-slate-700 hover:bg-slate-700 dark:hover:bg-slate-700 transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {/* Network Selector */}
          <div className="relative network-button">
            <button
              onClick={() => setShowNetworkMenu(!showNetworkMenu)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <span className="text-sm text-slate-700 dark:text-slate-300">{selectedNetwork}</span>
              <svg className={`w-4 h-4 text-slate-600 dark:text-slate-400 transition-transform ${showNetworkMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showNetworkMenu && (
              <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg shadow-xl z-50 network-menu">
                <div className="p-2">
                  {networks.map((network) => (
                    <button
                      key={network.name}
                      onClick={() => handleNetworkChange(network.name)}
                      className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-colors ${
                        selectedNetwork === network.name
                          ? 'bg-cyan-400/20 text-cyan-500 dark:text-cyan-400'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <div className="font-medium">{network.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">{network.rpc}</div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-slate-700 p-2">
                  <button className="w-full text-left px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Network
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Currency Selector */}
          <div className="relative currency-button">
            <button
              onClick={() => setShowCurrencyMenu(!showCurrencyMenu)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              <span className="text-sm text-slate-700 dark:text-slate-300">{selectedCurrency}</span>
              <svg className={`w-4 h-4 text-slate-600 dark:text-slate-400 transition-transform ${showCurrencyMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showCurrencyMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg shadow-xl z-50 currency-menu">
                <div className="p-2">
                  {currencies.map((currency) => (
                    <button
                      key={currency.code}
                      onClick={() => handleCurrencyChange(currency.code)}
                      className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-colors ${
                        selectedCurrency === currency.code
                          ? 'bg-cyan-400/20 text-cyan-500 dark:text-cyan-400'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{currency.code}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-500">{currency.name}</div>
                        </div>
                        <div className="text-slate-600 dark:text-slate-400">{currency.symbol}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Connect Button */}
          <CustomConnectButton />
        </div>
      </div>
    </header>
  );
}
