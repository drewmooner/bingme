'use client';

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
}

export default function TokenRow({ token, portfolioPercent, isToggled, onToggle, isDisabled = false }: TokenRowProps) {
  const formatBalance = (balance: string, decimals: number) => {
    const num = parseFloat(balance);
    if (num === 0) return '0';
    if (num < 0.000001) return '<0.000001';
    if (num < 1) return num.toFixed(6);
    if (num < 1000) return num.toFixed(4);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const formatPrice = (price: number) => {
    if (price === 0) return 'N/A';
    if (price < 0.01) return `$${price.toFixed(6)}`;
    if (price < 1) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(2)}`;
  };

  const formatValue = (value: number) => {
    if (value === 0) return '$0.00';
    if (value < 0.01) return '<$0.01';
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="px-6 py-4 hover:bg-slate-700/30 transition-colors grid grid-cols-12 gap-4 items-center">
      {/* Token Column */}
      <div className="col-span-4 flex items-center gap-3 min-w-0">
        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
          <span className="text-sm font-bold text-slate-900">
            {token.symbol.charAt(0)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-100 truncate">{token.symbol}</h3>
            {token.isNative && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-cyan-400/20 text-cyan-400 rounded">
                Native
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 truncate">{token.name}</p>
        </div>
      </div>

      {/* Portfolio % Column */}
      <div className="col-span-2 text-right">
        <div className="text-sm font-medium text-slate-200">
          {portfolioPercent.toFixed(2)}%
        </div>
      </div>

      {/* Price Column */}
      <div className="col-span-2 text-right">
        <div className="text-sm font-medium text-slate-200">
          {formatPrice(token.usdPrice)}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">
          {token.usdPrice > 0 ? '+0.00%' : 'N/A'}
        </div>
      </div>

      {/* Balance Column */}
      <div className="col-span-3 text-right">
        <div className="text-sm font-semibold text-slate-100">
          {formatValue(token.usdValue)}
        </div>
        <div className="text-xs text-slate-400 mt-0.5">
          {formatBalance(token.balance, token.decimals)} {token.symbol}
        </div>
      </div>

      {/* Alert Column */}
      <div className="col-span-1 flex justify-center">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!isDisabled) {
              onToggle();
            }
          }}
          disabled={isDisabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-slate-800 ${
            isDisabled
              ? 'bg-slate-700 cursor-not-allowed opacity-50'
              : isToggled
              ? 'bg-cyan-400'
              : 'bg-slate-600'
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
      </div>
    </div>
  );
}

