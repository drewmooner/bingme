'use client';

import { useEffect, useState } from 'react';

interface TotalBalanceProps {
  value: number;
  isLoading?: boolean;
}

export default function TotalBalance({ value, isLoading }: TotalBalanceProps) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (isLoading) return;
    
    const duration = 1000;
    const steps = 40;
    const increment = value / steps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      const current = Math.min(increment * step, value);
      setDisplayValue(current);

      if (step >= steps) {
        setDisplayValue(value);
        clearInterval(timer);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [value, isLoading]);

  if (isLoading) {
    return (
      <div className="mb-12">
        <div className="h-16 w-64 bg-[#1a1f3a] rounded-lg mb-2 animate-pulse" />
        <div className="h-6 w-48 bg-[#1a1f3a] rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <div className="mb-12 text-center">
      <p className="text-sm font-medium text-[#94a3b8] mb-3 tracking-wider uppercase">
        Total Portfolio Value
      </p>
      <h1 className="text-5xl md:text-6xl font-bold text-[#5b9bd5] mb-2">
        ${displayValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </h1>
    </div>
  );
}
