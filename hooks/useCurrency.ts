'use client';

import { useState, useEffect, useCallback } from 'react';

interface ExchangeRates {
  [key: string]: number;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  NGN: '₦',
};

const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  JPY: 'Japanese Yen',
  CNY: 'Chinese Yuan',
  NGN: 'Nigerian Naira',
};

// Cache for exchange rates
let exchangeRatesCache: ExchangeRates | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function fetchExchangeRates(): Promise<ExchangeRates> {
  try {
    // Use exchangerate-api.com (free tier, no API key needed)
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!response.ok) {
      throw new Error('Failed to fetch exchange rates');
    }
    const data = await response.json();
    
    // Convert to our format (all rates relative to USD)
    const rates: ExchangeRates = {
      USD: 1,
      EUR: data.rates.EUR || 1,
      GBP: data.rates.GBP || 1,
      JPY: data.rates.JPY || 1,
      CNY: data.rates.CNY || 1,
      NGN: data.rates.NGN || 1,
    };
    
    return rates;
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    // Fallback rates (approximate)
    return {
      USD: 1,
      EUR: 0.92,
      GBP: 0.79,
      JPY: 150,
      CNY: 7.2,
      NGN: 1500,
    };
  }
}

export function useCurrency() {
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates>({ USD: 1 });
  const [isLoading, setIsLoading] = useState(true);

  // Load currency preference and exchange rates
  useEffect(() => {
    const savedCurrency = localStorage.getItem('preferredCurrency') || 'USD';
    setSelectedCurrency(savedCurrency);

    // Check cache first
    const now = Date.now();
    if (exchangeRatesCache && (now - cacheTimestamp) < CACHE_DURATION) {
      setExchangeRates(exchangeRatesCache);
      setIsLoading(false);
    } else {
      // Fetch fresh rates
      fetchExchangeRates().then((rates) => {
        exchangeRatesCache = rates;
        cacheTimestamp = now;
        setExchangeRates(rates);
        setIsLoading(false);
      });
    }

    // Listen for currency changes
    const handleCurrencyChange = (event: CustomEvent) => {
      setSelectedCurrency(event.detail.currency);
    };

    window.addEventListener('currencyChanged', handleCurrencyChange as EventListener);
    return () => {
      window.removeEventListener('currencyChanged', handleCurrencyChange as EventListener);
    };
  }, []);

  // Refresh rates periodically
  useEffect(() => {
    const interval = setInterval(() => {
      fetchExchangeRates().then((rates) => {
        exchangeRatesCache = rates;
        cacheTimestamp = Date.now();
        setExchangeRates(rates);
      });
    }, CACHE_DURATION);

    return () => clearInterval(interval);
  }, []);

  const convert = useCallback((usdValue: number): number => {
    const rate = exchangeRates[selectedCurrency] || 1;
    return usdValue * rate;
  }, [selectedCurrency, exchangeRates]);

  const formatCurrency = useCallback((usdValue: number, options?: {
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  }): string => {
    if (usdValue === 0) {
      const symbol = CURRENCY_SYMBOLS[selectedCurrency] || '$';
      return `${symbol}0${selectedCurrency === 'JPY' || selectedCurrency === 'NGN' ? '' : '.00'}`;
    }
    
    const convertedValue = convert(usdValue);
    const symbol = CURRENCY_SYMBOLS[selectedCurrency] || '$';
    const decimals = options?.maximumFractionDigits ?? 2;
    
    // Special handling for currencies with different decimal conventions
    if (selectedCurrency === 'JPY' || selectedCurrency === 'NGN') {
      return `${symbol}${Math.round(convertedValue).toLocaleString()}`;
    }
    
    // For very small values
    if (convertedValue < 0.01) {
      return `<${symbol}0.01`;
    }
    
    return `${symbol}${convertedValue.toLocaleString(undefined, {
      minimumFractionDigits: options?.minimumFractionDigits ?? 2,
      maximumFractionDigits: decimals,
    })}`;
  }, [selectedCurrency, convert]);

  const formatPrice = useCallback((usdPrice: number): string => {
    if (usdPrice === 0) return 'N/A';
    
    const convertedPrice = convert(usdPrice);
    const symbol = CURRENCY_SYMBOLS[selectedCurrency] || '$';
    
    // For very small prices, show more decimals
    if (convertedPrice < 0.01) {
      return `${symbol}${convertedPrice.toFixed(6)}`;
    }
    if (convertedPrice < 1) {
      return `${symbol}${convertedPrice.toFixed(4)}`;
    }
    
    // For JPY and NGN, round to whole numbers
    if (selectedCurrency === 'JPY' || selectedCurrency === 'NGN') {
      return `${symbol}${Math.round(convertedPrice).toLocaleString()}`;
    }
    
    return `${symbol}${convertedPrice.toFixed(2)}`;
  }, [selectedCurrency, convert]);

  return {
    selectedCurrency,
    exchangeRates,
    isLoading,
    convert,
    formatCurrency,
    formatPrice,
    currencySymbol: CURRENCY_SYMBOLS[selectedCurrency] || '$',
    currencyName: CURRENCY_NAMES[selectedCurrency] || 'US Dollar',
  };
}

