'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useTheme } from '@/contexts/ThemeContext';

export default function Settings() {
  const { address, isConnected } = useAccount();
  const { theme, setTheme } = useTheme();
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [currency, setCurrency] = useState('USD');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30);

  useEffect(() => {
    if ('Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
    const savedCurrency = localStorage.getItem('preferredCurrency') || 'USD';
    const savedAutoRefresh = localStorage.getItem('autoRefresh') !== 'false';
    const savedInterval = parseInt(localStorage.getItem('refreshInterval') || '30');
    setCurrency(savedCurrency);
    setAutoRefresh(savedAutoRefresh);
    setRefreshInterval(savedInterval);
  }, []);

  const requestNotificationPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    }
  };

  const handleCurrencyChange = (newCurrency: string) => {
    setCurrency(newCurrency);
    localStorage.setItem('preferredCurrency', newCurrency);
  };

  const handleThemeChange = (newTheme: 'light' | 'dark') => {
    setTheme(newTheme);
  };

  const handleAutoRefreshChange = (enabled: boolean) => {
    setAutoRefresh(enabled);
    localStorage.setItem('autoRefresh', enabled.toString());
  };

  const handleIntervalChange = (interval: number) => {
    setRefreshInterval(interval);
    localStorage.setItem('refreshInterval', interval.toString());
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 transition-colors">
      <Header />
      <Sidebar />
      <main className="ml-64 pt-16 px-8 py-8 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-8">Settings</h1>

          <div className="space-y-6">
            {/* Notification Settings */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Notification Settings</h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">Browser Notifications</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {notificationPermission === 'granted' 
                        ? 'Notifications are enabled' 
                        : notificationPermission === 'denied'
                        ? 'Notifications are blocked'
                        : 'Click to enable notifications'}
                    </p>
                  </div>
                  <button
                    onClick={requestNotificationPermission}
                    disabled={notificationPermission === 'granted'}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      notificationPermission === 'granted'
                        ? 'bg-green-500/20 text-green-400 cursor-not-allowed'
                        : 'bg-cyan-400 hover:bg-cyan-300 text-slate-900'
                    }`}
                  >
                    {notificationPermission === 'granted' ? 'Enabled' : 'Enable'}
                  </button>
                </div>

                {isConnected && address && (
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Wallet Address</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono break-all">{address}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Display Preferences */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Display Preferences</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Currency</label>
                  <div className="flex gap-2">
                    {['USD', 'EUR', 'GBP', 'JPY', 'CNY'].map((curr) => (
                      <button
                        key={curr}
                        onClick={() => handleCurrencyChange(curr)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          currency === curr
                            ? 'bg-cyan-400 dark:bg-cyan-400 text-slate-900 dark:text-slate-900'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                        }`}
                      >
                        {curr}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Theme</label>
                  <div className="flex gap-2">
                    {(['dark', 'light'] as const).map((th) => (
                      <button
                        key={th}
                        onClick={() => handleThemeChange(th)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                          theme === th
                            ? 'bg-cyan-400 dark:bg-cyan-400 text-slate-900 dark:text-slate-900'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                        }`}
                      >
                        {th}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Data Refresh Settings */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Data Refresh</h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-slate-700 dark:text-slate-200">Auto Refresh</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Automatically refresh token prices</p>
                  </div>
                  <button
                    onClick={() => handleAutoRefreshChange(!autoRefresh)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      autoRefresh ? 'bg-cyan-400 dark:bg-cyan-400' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                        autoRefresh ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {autoRefresh && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                      Refresh Interval: {refreshInterval} seconds
                    </label>
                    <input
                      type="range"
                      min="10"
                      max="300"
                      step="10"
                      value={refreshInterval}
                      onChange={(e) => handleIntervalChange(Number(e.target.value))}
                      className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-500 mt-1">
                      <span>10s</span>
                      <span>300s</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Account Actions */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Account</h2>
              
              <div className="space-y-3">
                <button className="w-full px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors">
                  Export Portfolio Data
                </button>
                <button className="w-full px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors">
                  Clear Cache
                </button>
                <button className="w-full px-4 py-2 bg-red-500/20 dark:bg-red-500/20 hover:bg-red-500/30 dark:hover:bg-red-500/30 text-red-600 dark:text-red-400 rounded-lg text-sm font-medium transition-colors">
                  Reset All Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
