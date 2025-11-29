'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';

export default function Analytics() {
  const { address, isConnected } = useAccount();
  const [timeRange, setTimeRange] = useState<'1D' | '7D' | '30D' | '90D' | 'ALL'>('7D');

  const stats = [
    { label: 'Total Volume', value: '$1,234,567', change: '+12.5%' },
    { label: 'Active Pairs', value: '24', change: '+3' },
    { label: 'Liquidity', value: '$567,890', change: '+8.2%' },
    { label: 'Transactions', value: '1,234', change: '+15.3%' },
  ];

  const topTokens = [
    { symbol: 'SOMI', volume: '$500,000', change: '+5.2%', liquidity: '$250,000' },
    { symbol: 'DREW', volume: '$300,000', change: '-2.1%', liquidity: '$150,000' },
    { symbol: 'CEEJHAY', volume: '$200,000', change: '+8.5%', liquidity: '$100,000' },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 transition-colors">
      <Header />
      <Sidebar />
      <main className="ml-64 pt-16 px-8 py-8 min-h-screen">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Analytics</h1>
            <div className="flex gap-2">
              {(['1D', '7D', '30D', '90D', 'ALL'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    timeRange === range
                      ? 'bg-cyan-400 dark:bg-cyan-400 text-slate-900 dark:text-slate-900'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {stats.map((stat, index) => (
              <div key={index} className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">{stat.label}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-1">{stat.value}</p>
                <p className="text-xs text-green-600 dark:text-green-400">{stat.change}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Volume Chart Placeholder */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Trading Volume</h2>
              <div className="h-64 flex items-center justify-center bg-slate-100/50 dark:bg-slate-900/50 rounded-lg">
                <p className="text-slate-500 dark:text-slate-500">Chart visualization coming soon</p>
              </div>
            </div>

            {/* Price Chart Placeholder */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Price Trends</h2>
              <div className="h-64 flex items-center justify-center bg-slate-100/50 dark:bg-slate-900/50 rounded-lg">
                <p className="text-slate-500 dark:text-slate-500">Chart visualization coming soon</p>
              </div>
            </div>
          </div>

          {/* Top Tokens */}
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden transition-colors">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Top Tokens by Volume</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-100/50 dark:bg-slate-900/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Token</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Volume (24h)</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Change</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Liquidity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {topTokens.map((token, index) => (
                    <tr key={index} className="hover:bg-slate-100/50 dark:hover:bg-slate-700/30 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                            <span className="text-xs font-bold text-slate-900">{token.symbol.charAt(0)}</span>
                          </div>
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{token.symbol}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-slate-700 dark:text-slate-200">
                        {token.volume}
                      </td>
                      <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-medium ${
                        token.change.startsWith('+') ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {token.change}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-slate-700 dark:text-slate-200">
                        {token.liquidity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Additional Analytics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Market Overview</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Total Market Cap</span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">$2,500,000</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">24h Active Users</span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">1,234</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-600 dark:text-slate-400">Average Trade Size</span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">$1,234</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Recent Activity</h2>
              <div className="space-y-3">
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  <p>Large swap detected: 10,000 SOMI → DREW</p>
                  <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">2 minutes ago</p>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  <p>New liquidity pool added: CEEJHAY/WSOMI</p>
                  <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">15 minutes ago</p>
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  <p>Price alert triggered: DREW +5%</p>
                  <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">1 hour ago</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
