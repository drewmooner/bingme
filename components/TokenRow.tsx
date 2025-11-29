'use client';

import { useState, useEffect } from 'react';
import { useCurrency } from '@/hooks/useCurrency';

interface TokenData {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  usdPrice: number;
  usdValue: number;
  poolAddress: string | null;
  isNative?: boolean;
  decimals: number;
}

interface TokenRowProps {
  token: TokenData;
  portfolioPercent: number;
  isToggled: boolean;
  onToggle: () => void;
  isDisabled?: boolean;
  thresholdUp?: number;
  thresholdDown?: number;
  onThresholdChange?: (thresholdUp: number, thresholdDown: number) => void;
}

export default function TokenRow({ 
  token, 
  portfolioPercent, 
  isToggled, 
  onToggle, 
  isDisabled = false,
  thresholdUp = 2,
  thresholdDown = 2,
  onThresholdChange
}: TokenRowProps) {
  const { formatPrice, formatCurrency } = useCurrency();
  const [showThresholds, setShowThresholds] = useState(false);
  const [localThresholdUp, setLocalThresholdUp] = useState(thresholdUp);
  const [localThresholdDown, setLocalThresholdDown] = useState(thresholdDown);
  const [isEditing, setIsEditing] = useState(false);

  // Update local state when props change
  useEffect(() => {
    setLocalThresholdUp(thresholdUp);
    setLocalThresholdDown(thresholdDown);
  }, [thresholdUp, thresholdDown]);
  const formatBalance = (balance: string, decimals: number) => {
    const num = parseFloat(balance);
    if (num === 0) return '0';
    if (num < 0.000001) return '<0.000001';
    if (num < 1) return num.toFixed(6);
    if (num < 1000) return num.toFixed(4);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  // formatPrice and formatValue are now provided by useCurrency hook

  return (
    <div className="px-6 py-4 hover:bg-slate-100 dark:hover:bg-slate-700/30 transition-colors grid grid-cols-12 gap-4 items-center">
      {/* Token Column */}
      <div className="col-span-4 flex items-center gap-3 min-w-0">
        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
          <span className="text-sm font-bold text-slate-900">
            {token.symbol.charAt(0)}
          </span>
        </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{token.symbol}</h3>
              {token.isNative && (
                <span className="px-1.5 py-0.5 text-xs font-medium bg-cyan-400/20 dark:bg-cyan-400/20 text-cyan-600 dark:text-cyan-400 rounded">
                  Native
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 truncate">{token.name}</p>
          </div>
      </div>

      {/* Portfolio % Column */}
      <div className="col-span-2 text-right">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {portfolioPercent.toFixed(2)}%
        </div>
      </div>

      {/* Price Column */}
      <div className="col-span-2 text-right">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {formatPrice(token.usdPrice)}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
          {token.usdPrice > 0 ? '+0.00%' : 'N/A'}
        </div>
      </div>

      {/* Balance Column */}
      <div className="col-span-3 text-right">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {formatCurrency(token.usdValue)}
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
          {formatBalance(token.balance, token.decimals)} {token.symbol}
        </div>
      </div>

      {/* Alert Column */}
      <div className="col-span-1 flex flex-col items-center gap-2 min-h-[3rem]">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!isDisabled) {
              onToggle();
            }
          }}
          disabled={isDisabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-slate-800 ${
            isDisabled
              ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-50'
              : isToggled
              ? 'bg-cyan-400 dark:bg-cyan-400'
              : 'bg-slate-300 dark:bg-slate-600'
          }`}
          role="switch"
          aria-checked={isToggled}
          aria-disabled={isDisabled}
          title={isDisabled ? 'Connect wallet to enable alerts' : isToggled ? 'Disable alert' : 'Enable alert'}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-300 ease-in-out transform ${
              isToggled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
        
        {/* Threshold Display/Edit */}
        {isToggled && !isDisabled && (
          <div 
            className="flex items-center gap-1.5 cursor-pointer group min-w-[4rem] justify-center"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
              setShowThresholds(true);
            }}
          >
            <div className="text-xs font-medium text-cyan-400 group-hover:text-cyan-300 transition-colors whitespace-nowrap">
              {thresholdUp}% / {thresholdDown}%
            </div>
            <svg 
              className="w-3 h-3 text-slate-500 group-hover:text-cyan-400 transition-colors flex-shrink-0" 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </div>
        )}
      </div>
      
      {/* Threshold Edit Modal */}
      {showThresholds && isToggled && !isDisabled && (
        <div 
          className="fixed inset-0 bg-black/50 dark:bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowThresholds(false);
              setIsEditing(false);
            }
          }}
          onMouseDown={(e) => {
            // Prevent modal from closing when clicking inside
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
        >
          <div 
            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl shadow-2xl p-6 w-full max-w-md transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Set Alert Thresholds for {token.symbol}
              </h3>
              <button
                onClick={() => {
                  setShowThresholds(false);
                  setIsEditing(false);
                }}
                className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Threshold Up */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Price Increase Threshold (%)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={localThresholdUp}
                    onChange={(e) => setLocalThresholdUp(Number(e.target.value))}
                    className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="w-20 px-3 py-2 bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-center">
                    <span className="text-sm font-semibold text-cyan-600 dark:text-cyan-400">{localThresholdUp}%</span>
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                  Notify when price increases by {localThresholdUp}% or more
                </p>
              </div>
              
              {/* Threshold Down */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Price Decrease Threshold (%)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={localThresholdDown}
                    onChange={(e) => setLocalThresholdDown(Number(e.target.value))}
                    className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                  />
                  <div className="w-20 px-3 py-2 bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-center">
                    <span className="text-sm font-semibold text-cyan-600 dark:text-cyan-400">{localThresholdDown}%</span>
                  </div>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                  Notify when price decreases by {localThresholdDown}% or more
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => {
                  setShowThresholds(false);
                  setIsEditing(false);
                  setLocalThresholdUp(thresholdUp);
                  setLocalThresholdDown(thresholdDown);
                }}
                className="flex-1 px-4 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (onThresholdChange) {
                    onThresholdChange(localThresholdUp, localThresholdDown);
                  }
                  setShowThresholds(false);
                  setIsEditing(false);
                }}
                className="flex-1 px-4 py-2.5 bg-cyan-400 dark:bg-cyan-400 hover:bg-cyan-300 dark:hover:bg-cyan-300 text-slate-900 dark:text-slate-900 rounded-lg font-semibold transition-colors"
              >
                Save Thresholds
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

