'use client';

interface TokenCardProps {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  factoryPrice: number;
  geckoPrice: number;
  usdValue: number;
  isNative?: boolean;
}

export default function TokenCard({
  symbol,
  name,
  address,
  balance,
  factoryPrice,
  geckoPrice,
  usdValue,
  isNative = false,
}: TokenCardProps) {
  const priceDifference = geckoPrice > 0 && factoryPrice > 0 
    ? ((geckoPrice - factoryPrice) / factoryPrice * 100).toFixed(2)
    : '0.00';

  const hasPriceDiff = Math.abs(parseFloat(priceDifference)) > 0.01;
  const isPositive = parseFloat(priceDifference) > 0;

  return (
    <div className="bg-[#1e3a5f] rounded-2xl p-6 border border-[#2d5a8f]">
      {/* Token Header */}
      <div className="flex justify-between items-start mb-5">
        <div>
          <h3 className="text-xl font-semibold text-white mb-1">
            {symbol}
          </h3>
          <p className="text-[#94a3b8] text-sm m-0">
            {address === 'native' ? 'Native Token' : `${address.slice(0, 6)}...${address.slice(-4)}`}
          </p>
        </div>
        <div className="bg-[#2d5a8f] rounded-lg px-3 py-1.5 text-xs text-[#94a3b8]">
          {isNative ? 'Native' : 'ERC-20'}
        </div>
      </div>

      {/* Balance */}
      <div className="mb-4">
        <p className="text-[#94a3b8] text-sm mb-1.5">
          Balance
        </p>
        <p className="text-white text-3xl font-semibold m-0">
          {parseFloat(balance).toLocaleString(undefined, {
            maximumFractionDigits: 6,
          })}
        </p>
      </div>

      {/* USD Value */}
      <div className="bg-[#0a1929] rounded-xl p-4 mb-4">
        <p className="text-[#94a3b8] text-sm mb-1.5">
          USD Value
        </p>
        <p className="text-[#5b9bd5] text-2xl font-semibold m-0">
          ${usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>

      {/* Price Comparison */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[#94a3b8] text-xs mb-1">
            Factory Price
          </p>
          <p className="text-white text-base font-medium m-0">
            ${factoryPrice.toFixed(4)}
          </p>
        </div>
        <div>
          <p className="text-[#94a3b8] text-xs mb-1">
            Gecko Terminal
          </p>
          <p className="text-white text-base font-medium m-0">
            ${geckoPrice > 0 ? geckoPrice.toFixed(4) : 'N/A'}
          </p>
        </div>
      </div>

      {/* Price Difference */}
      {hasPriceDiff && geckoPrice > 0 && (
        <div 
          className="mt-3 px-3 py-2 rounded-lg text-sm"
          style={{
            background: isPositive ? '#1e3a5f' : '#1e3a5f',
            color: isPositive ? '#5b9bd5' : '#5b9bd5',
            border: `1px solid ${isPositive ? '#2d5a8f' : '#2d5a8f'}`
          }}
        >
          {isPositive ? '+' : ''}{priceDifference}% difference
        </div>
      )}
    </div>
  );
}
