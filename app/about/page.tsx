'use client';

import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';

export default function About() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 transition-colors">
      <Header />
      <Sidebar />
      <main className="ml-64 pt-16 px-8 py-8 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-8">About Bingme</h1>

          <div className="space-y-6">
            {/* Introduction */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">What is Bingme?</h2>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                Bingme is a professional portfolio tracker and DeFi management platform built for the Somnia Testnet. 
                Our platform provides real-time token tracking, price alerts, limit orders, and comprehensive analytics 
                to help you manage your cryptocurrency portfolio with ease.
              </p>
            </div>

            {/* Features */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Features</h2>
              <ul className="space-y-3 text-slate-700 dark:text-slate-300">
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-cyan-500 dark:text-cyan-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span><strong className="text-slate-900 dark:text-slate-100">Portfolio Tracking:</strong> Real-time tracking of all your tokens with USD values and portfolio allocation</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span><strong className="text-slate-100">Price Alerts:</strong> Customizable price change notifications with configurable thresholds (1-100%)</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span><strong className="text-slate-100">Limit Orders:</strong> Create and manage limit orders for token swaps</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span><strong className="text-slate-100">Analytics:</strong> Comprehensive charts and statistics for market analysis</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span><strong className="text-slate-100">Multi-Currency Support:</strong> View your portfolio in USD, EUR, GBP, JPY, and CNY</span>
                </li>
              </ul>
            </div>

            {/* Technology */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Technology</h2>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed mb-4">
                Bingme is built with modern web technologies to provide a fast, secure, and user-friendly experience:
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Frontend</h3>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <li>• Next.js 16</li>
                    <li>• React 18</li>
                    <li>• Tailwind CSS</li>
                    <li>• Wagmi & RainbowKit</li>
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Blockchain</h3>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <li>• Somnia Testnet</li>
                    <li>• Ethers.js</li>
                    <li>• Smart Contract Integration</li>
                    <li>• Real-time Event Monitoring</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Network Info */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Network</h2>
              <div className="space-y-3 text-slate-700 dark:text-slate-300">
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Network:</span>
                  <span className="font-medium">Somnia Testnet</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">RPC URL:</span>
                  <span className="font-mono text-sm">dream-rpc.somnia.network</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Chain ID:</span>
                  <span className="font-medium">Testnet</span>
                </div>
              </div>
            </div>

            {/* Contact/Support */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Support</h2>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed mb-4">
                For questions, issues, or feature requests, please reach out through our support channels.
              </p>
              <div className="flex gap-4">
                <button className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors">
                  Documentation
                </button>
                <button className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors">
                  GitHub
                </button>
                <button className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors">
                  Discord
                </button>
              </div>
            </div>

            {/* Version */}
            <div className="text-center text-sm text-slate-500 dark:text-slate-500 pt-4">
              <p>Bingme v0.1.0</p>
              <p className="mt-1">Built for Somnia Testnet</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
