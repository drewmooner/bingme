'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useCurrency } from '@/hooks/useCurrency';

const RPC_URL = 'https://dream-rpc.somnia.network';
const FACTORY_ADDRESS = '0xBABE473c0986bf6A986307Bcf52EAe1C96f921B2';
const WSOMI_ADDRESS = '0xb8DabbA9EAa4957Dce08e31Ad729F89C1F7C88b4';

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function name() external view returns (string)',
  'function totalSupply() external view returns (uint256)',
] as const;

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
] as const;

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
  'function allPairsLength() external view returns (uint256)',
  'function allPairs(uint256) external view returns (address)',
] as const;

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

async function getSomniaPrice(): Promise<number> {
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=somnia&vs_currencies=usd';
    const response = await fetch(url);
    if (!response.ok) return 0;
    const data = await response.json();
    return parseFloat(data?.somnia?.usd || '0');
  } catch {
    return 0;
  }
}

async function getTokenPriceFromPool(
  provider: ethers.Provider,
  tokenAddress: string,
  poolAddress: string
): Promise<number> {
  try {
    const pair = new ethers.Contract(poolAddress, PAIR_ABI, provider);
    const [token0, token1, reserves] = await Promise.all([
      pair.token0(),
      pair.token1(),
      pair.getReserves(),
    ]);

    const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
    const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
    const [token0Decimals, token1Decimals] = await Promise.all([
      token0Contract.decimals(),
      token1Contract.decimals(),
    ]);

    const isTokenToken0 = tokenAddress.toLowerCase() === token0.toLowerCase();
    const tokenReserve = isTokenToken0 ? reserves[0] : reserves[1];
    const wsomiReserve = isTokenToken0 ? reserves[1] : reserves[0];

    const tokenReserveFormatted = Number(
      ethers.formatUnits(tokenReserve, isTokenToken0 ? token0Decimals : token1Decimals)
    );
    const wsomiReserveFormatted = Number(
      ethers.formatUnits(wsomiReserve, isTokenToken0 ? token1Decimals : token0Decimals)
    );

    const MIN_WSOMI_LIQUIDITY = 1000;
    if (wsomiReserveFormatted < MIN_WSOMI_LIQUIDITY) {
      return 0;
    }

    const priceInWsomi = wsomiReserveFormatted / tokenReserveFormatted;
    const wsomiUsdPrice = await getSomniaPrice();
    if (wsomiUsdPrice === 0) {
      return 0;
    }

    return priceInWsomi * wsomiUsdPrice;
  } catch (error) {
    console.error('Error getting token price from pool:', error);
    return 0;
  }
}

async function getAllTokensWithLiquidity(
  provider: ethers.Provider,
  walletAddress: string
): Promise<TokenData[]> {
  const tokens: TokenData[] = [];
  const processedAddresses = new Set<string>();

  try {
    const nativeBalance = await provider.getBalance(walletAddress);
    const nativeBalanceFormatted = ethers.formatEther(nativeBalance);
    const somniaPrice = await getSomniaPrice();
    const nativeUsdValue = parseFloat(nativeBalanceFormatted) * somniaPrice;

    if (parseFloat(nativeBalanceFormatted) > 0) {
      tokens.push({
        address: 'native',
        symbol: 'SOMI',
        name: 'Somnia',
        balance: nativeBalanceFormatted,
        usdPrice: somniaPrice,
        usdValue: nativeUsdValue,
        poolAddress: null,
        isNative: true,
        decimals: 18,
      });
      processedAddresses.add('native');
    }

    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);

    try {
      const allPairsLength = await factory.allPairsLength();
      const pairAddresses: string[] = [];

      for (let i = 0; i < Number(allPairsLength); i++) {
        try {
          const pairAddress = await factory.allPairs(i);
          pairAddresses.push(pairAddress);
        } catch (error) {
          console.error(`Error getting pair ${i}:`, error);
        }
      }

      for (const pairAddress of pairAddresses) {
        try {
          const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
          const [token0, token1, reserves] = await Promise.all([
            pair.token0(),
            pair.token1(),
            pair.getReserves(),
          ]);

          const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
          const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
          const [token0Decimals, token1Decimals] = await Promise.all([
            token0Contract.decimals(),
            token1Contract.decimals(),
          ]);

          const isWsomiToken0 = token0.toLowerCase() === WSOMI_ADDRESS.toLowerCase();
          const wsomiReserve = isWsomiToken0 ? reserves[0] : reserves[1];
          const wsomiReserveFormatted = Number(
            ethers.formatUnits(wsomiReserve, isWsomiToken0 ? token0Decimals : token1Decimals)
          );

          if (wsomiReserveFormatted >= 1000) {
            const otherTokenAddress = isWsomiToken0 ? token1 : token0;
            const otherTokenDecimals = isWsomiToken0 ? token1Decimals : token0Decimals;

            if (!processedAddresses.has(otherTokenAddress.toLowerCase())) {
              processedAddresses.add(otherTokenAddress.toLowerCase());

              const otherTokenContract = new ethers.Contract(otherTokenAddress, ERC20_ABI, provider);
              const [symbol, name, balance] = await Promise.all([
                otherTokenContract.symbol(),
                otherTokenContract.name(),
                otherTokenContract.balanceOf(walletAddress),
              ]);

              const balanceFormatted = ethers.formatUnits(balance, otherTokenDecimals);

              if (balance > 0n) {
                const usdPrice = await Promise.race([
                  getTokenPriceFromPool(provider, otherTokenAddress, pairAddress),
                  new Promise<number>((_, reject) => 
                    setTimeout(() => reject(new Error('Price fetch timeout')), 10000)
                  )
                ]).catch(() => 0);
                const usdValue = parseFloat(balanceFormatted) * usdPrice;

                tokens.push({
                  address: otherTokenAddress,
                  symbol,
                  name,
                  balance: balanceFormatted,
                  usdPrice,
                  usdValue,
                  poolAddress: pairAddress,
                  isNative: false,
                  decimals: otherTokenDecimals,
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error processing pair ${pairAddress}:`, error);
        }
      }
    } catch (error) {
      console.error('Error getting all pairs from factory:', error);
      const knownTokens = [
        { address: '0x92ef9494FABC919392F22561d28BC216A1fACE74', poolPair: 'WSOMI/DREW' },
        { address: '0xf12Ce9E09071D0506a114bf29D4A8088174a812B', poolPair: 'WSOMI/CEEJHAY' },
      ];

      for (const { address: tokenAddress } of knownTokens) {
        if (processedAddresses.has(tokenAddress.toLowerCase())) continue;

        try {
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
          const [balance, decimals, symbol, name] = await Promise.all([
            tokenContract.balanceOf(walletAddress),
            tokenContract.decimals(),
            tokenContract.symbol(),
            tokenContract.name(),
          ]);

          const balanceFormatted = ethers.formatUnits(balance, decimals);

          if (balance > 0n) {
            const poolAddress = await factory.getPair(WSOMI_ADDRESS, tokenAddress);
            if (poolAddress && poolAddress !== ethers.ZeroAddress) {
              const usdPrice = await Promise.race([
                getTokenPriceFromPool(provider, tokenAddress, poolAddress),
                new Promise<number>((_, reject) => 
                  setTimeout(() => reject(new Error('Price fetch timeout')), 10000)
                )
              ]).catch(() => 0);
              const usdValue = parseFloat(balanceFormatted) * usdPrice;

              tokens.push({
                address: tokenAddress,
                symbol,
                name,
                balance: balanceFormatted,
                usdPrice,
                usdValue,
                poolAddress,
                isNative: false,
                decimals,
              });
            }
          }
        } catch (error) {
          console.error(`Error loading token ${tokenAddress}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error loading tokens:', error);
  }

  return tokens;
}

export default function Portfolio() {
  const { address, isConnected } = useAccount();
  const { formatCurrency, formatPrice } = useCurrency();
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [timeRange, setTimeRange] = useState<'1D' | '7D' | '30D' | 'ALL'>('7D');

  useEffect(() => {
    if (isConnected && address) {
      loadPortfolio();
    } else {
      setTokens([]);
    }
  }, [isConnected, address]);

  const loadPortfolio = async () => {
    setIsLoading(true);
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
        staticNetwork: true,
        batchMaxCount: 1,
      });
      
      const tokensData = await Promise.race([
        getAllTokensWithLiquidity(provider, address!),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout after 60 seconds')), 60000)
        )
      ]);
      
      setTokens(tokensData);
    } catch (error: any) {
      if (error?.code === 'TIMEOUT' || error?.message?.includes('timeout') || error?.message?.includes('Request timeout')) {
        setTokens([]);
        return;
      }
      if (!error?.message?.includes('timeout')) {
        console.error('Error loading portfolio:', error);
      }
      setTokens([]);
    } finally {
      setIsLoading(false);
    }
  };

  const totalValue = useMemo(() => {
    return tokens.reduce((sum, token) => sum + token.usdValue, 0);
  }, [tokens]);

  const portfolioWithAllocation = useMemo(() => {
    return tokens.map(token => ({
      ...token,
      allocation: totalValue > 0 ? (token.usdValue / totalValue) * 100 : 0,
    }));
  }, [tokens, totalValue]);

  const formatBalance = (balance: string, decimals: number) => {
    const num = parseFloat(balance);
    if (num === 0) return '0';
    if (num < 0.000001) return '<0.000001';
    if (num < 1) return num.toFixed(6);
    if (num < 1000) return num.toFixed(4);
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  // formatPrice and formatValue are now provided by useCurrency hook

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 transition-colors">
        <Header />
        <Sidebar />
        <main className="ml-64 pt-16 px-8 py-8 min-h-screen">
          <div className="max-w-6xl mx-auto text-center py-20">
            <p className="text-slate-600 dark:text-slate-400 text-lg">Please connect your wallet to view your portfolio</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 transition-colors">
      <Header />
      <Sidebar />
      <main className="ml-64 pt-16 px-8 py-8 min-h-screen">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Portfolio</h1>
            <div className="flex gap-2">
              {(['1D', '7D', '30D', 'ALL'] as const).map((range) => (
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

          {isLoading ? (
            <div className="text-center py-20">
              <p className="text-slate-400 text-lg">Loading portfolio...</p>
            </div>
          ) : (
            <>
              {/* Portfolio Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Total Portfolio Value</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {formatCurrency(totalValue)}
                  </p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">24h Change</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">+0.00%</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Total Tokens</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{tokens.length}</p>
                </div>
              </div>

              {tokens.length === 0 ? (
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-12 text-center transition-colors">
                  <p className="text-slate-600 dark:text-slate-400 text-lg">No tokens found in your wallet</p>
                </div>
              ) : (
                <>
                  {/* Portfolio Breakdown */}
                  <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 mb-6 transition-colors">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">Asset Allocation</h2>
                    <div className="space-y-4">
                      {portfolioWithAllocation.map((token, index) => (
                        <div key={token.address} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                                <span className="text-sm font-bold text-slate-900">{token.symbol.charAt(0)}</span>
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{token.symbol}</p>
                                <p className="text-xs text-slate-600 dark:text-slate-400">{token.name}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{formatCurrency(token.usdValue)}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-500">+0.00%</p>
                            </div>
                          </div>
                          <div className="w-full bg-slate-200 dark:bg-slate-900 rounded-full h-2">
                            <div
                              className="bg-cyan-400 dark:bg-cyan-400 h-2 rounded-full transition-all"
                              style={{ width: `${token.allocation}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Token Details Table */}
                  <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden transition-colors">
                    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
                      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Holdings</h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-100/50 dark:bg-slate-900/50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Asset</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Balance</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Price</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Value</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">24h Change</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wider">Allocation</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                          {portfolioWithAllocation.map((token) => (
                            <tr key={token.address} className="hover:bg-slate-100/50 dark:hover:bg-slate-700/30 transition-colors">
                              <td className="px-6 py-4 whitespace-nowrap">
                                <div className="flex items-center gap-3">
                                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                                    <span className="text-xs font-bold text-slate-900">{token.symbol.charAt(0)}</span>
                                  </div>
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{token.symbol}</p>
                                    <p className="text-xs text-slate-600 dark:text-slate-400">{token.name}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-slate-700 dark:text-slate-200">
                                {formatBalance(token.balance, token.decimals)} {token.symbol}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-slate-700 dark:text-slate-200">
                                {formatPrice(token.usdPrice)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {formatCurrency(token.usdValue)}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-slate-600 dark:text-slate-400">
                                +0.00%
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-slate-700 dark:text-slate-200">
                                {token.allocation.toFixed(2)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
