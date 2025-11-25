'use client';

import { useState, useEffect, useMemo } from 'react';
import { ethers } from 'ethers';
import { useAccount } from 'wagmi';
import TokenRow from './TokenRow';
import { useNotifications } from '@/hooks/useNotifications';
import { usePoolMonitor } from '@/hooks/usePoolMonitor';
import { useServerNotifications } from '@/hooks/useServerNotifications';

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
                const usdPrice = await getTokenPriceFromPool(provider, otherTokenAddress, pairAddress);
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
              const usdPrice = await getTokenPriceFromPool(provider, tokenAddress, poolAddress);
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

export default function WalletInterface() {
  const { address, isConnected } = useAccount();
  const { requestPermission, permission, isSupported, showNotification } = useNotifications();
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toggledTokens, setToggledTokens] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);

  const loadTokenData = async (walletAddress: string) => {
    setIsLoading(true);
    try {
      // Create provider with increased timeout
      const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
        staticNetwork: true,
        batchMaxCount: 1,
      });
      
      const tokensData = await Promise.race([
        getAllTokensWithLiquidity(provider, walletAddress),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout after 60 seconds')), 60000)
        )
      ]);
      
      setTokens(tokensData);
      console.log('Loaded tokens:', tokensData.length);
    } catch (error: any) {
      // Suppress timeout errors silently
      if (error?.code === 'TIMEOUT' || error?.message?.includes('timeout') || error?.message?.includes('Request timeout')) {
        // Silently handle timeout - will retry on next load
        setTokens([]);
        return;
      }
      // Only log non-timeout errors
      if (!error?.message?.includes('timeout')) {
        console.error('Error loading token data:', error);
      }
      setTokens([]); // Set empty array on error
    } finally {
      setIsLoading(false);
    }
  };

  const registerUser = async (walletAddress: string) => {
    setIsRegistering(true);
    try {
      // Request notification permission
      const notificationGranted = await requestPermission();

      // Register user via API
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress,
          notificationPermission: notificationGranted ? 'granted' : 'denied',
        }),
      });

      if (response.ok) {
        setIsRegistered(true);
      } else {
        console.error('Registration failed');
      }
    } catch (error) {
      console.error('Error registering user:', error);
    } finally {
      setIsRegistering(false);
    }
  };

  const checkSubscription = async (walletAddress: string) => {
    try {
      const response = await fetch(`/api/subscription?address=${walletAddress}`);
      const data = await response.json();
      
      if (data.subscription) {
        setIsRegistered(true);
        // Load existing alert states - sync with subscription
        const alertTokens = new Set<string>();
        Object.entries(data.subscription.tokens || {}).forEach(([address, token]: [string, any]) => {
          // Only add tokens that have alertEnabled: true
          if (token.alertEnabled === true) {
            // Use lowercase address to match token addresses
            alertTokens.add(address.toLowerCase());
          }
        });
        setToggledTokens(alertTokens);
      } else {
        setIsRegistered(false);
        // Clear toggles if no subscription
        setToggledTokens(new Set());
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
      setIsRegistered(false);
    }
  };

  useEffect(() => {
    if (address && isConnected) {
      // Always load tokens first
      loadTokenData(address);
      // Then check subscription to set toggles
      checkSubscription(address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected]);

  // Re-sync toggles after tokens are loaded to ensure they match subscription
  useEffect(() => {
    if (address && isConnected && isRegistered && tokens.length > 0) {
      // Re-check subscription to sync toggles with loaded tokens
      checkSubscription(address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens.length]);

  useEffect(() => {
    if (address && isConnected && !isRegistered && !isRegistering) {
      registerUser(address);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected, isRegistered, isRegistering]);

  const handleToggle = async (tokenAddress: string) => {
    if (!address || !isConnected || !isRegistered) {
      return;
    }

    const newToggledState = !toggledTokens.has(tokenAddress);
    
    // If enabling alerts, request notification permission if not granted
    if (newToggledState && permission !== 'granted') {
      const granted = await requestPermission();
      if (!granted) {
        // User denied permission, don't enable alert
        return;
      }
    }
    
    // Update local state immediately
    setToggledTokens((prev) => {
      const newSet = new Set(prev);
      if (newToggledState) {
        newSet.add(tokenAddress);
      } else {
        newSet.delete(tokenAddress);
      }
      return newSet;
    });

    // Find token data
    const token = tokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase());
    if (!token) return;

    try {
      // Update subscription via API
      const response = await fetch('/api/subscription', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          walletAddress: address,
          tokenAddress: tokenAddress.toLowerCase(),
          alertEnabled: newToggledState,
          tokenData: {
            address: token.address,
            symbol: token.symbol,
            poolAddress: token.poolAddress,
          },
        }),
      });

      if (!response.ok) {
        // Revert on error
        setToggledTokens((prev) => {
          const newSet = new Set(prev);
          if (newToggledState) {
            newSet.delete(tokenAddress);
          } else {
            newSet.add(tokenAddress);
          }
          return newSet;
        });
      }
    } catch (error) {
      console.error('Error updating subscription:', error);
      // Revert on error
      setToggledTokens((prev) => {
        const newSet = new Set(prev);
        if (newToggledState) {
          newSet.delete(tokenAddress);
        } else {
          newSet.add(tokenAddress);
        }
        return newSet;
      });
    }
  };

  const filteredTokens = tokens.filter((token) => {
    const query = searchQuery.toLowerCase();
    return (
      token.symbol.toLowerCase().includes(query) ||
      token.name.toLowerCase().includes(query) ||
      token.address.toLowerCase().includes(query)
    );
  });

  const totalValue = tokens.reduce((sum, token) => sum + token.usdValue, 0);

  // Get unique pool addresses from toggled tokens
  const monitoredPools = useMemo(() => {
    const pools = new Set<string>();
    tokens.forEach(token => {
      if (toggledTokens.has(token.address.toLowerCase()) && token.poolAddress) {
        pools.add(token.poolAddress);
      }
    });
    return Array.from(pools);
  }, [tokens, toggledTokens]);

  // Monitor pools for swap events (client-side, works when browser is open)
  usePoolMonitor({
    poolAddresses: monitoredPools,
    onSwap: (poolAddress) => {
      console.log('Swap detected on pool:', poolAddress);
    },
  });

  // Fetch server-side notifications (works even when browser tab is in background)
  useServerNotifications();

  if (!isConnected) {
    return (
      <div className="flex items-center justify-center min-h-[500px]">
        <div className="text-center">
          <p className="text-slate-100 text-xl font-semibold mb-2">Connect Your Wallet</p>
          <p className="text-slate-400 text-sm">Connect to view your token portfolio</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4">
      {/* Net Worth Section */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
        <h2 className="text-sm font-medium text-slate-400 mb-2">Net Worth</h2>
        <p className="text-3xl font-bold text-slate-100">
          ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>

      {/* Assets Section */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden mt-8">
        {/* Section Header */}
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Assets</h2>
          <div className="flex items-center gap-4">
            {/* View Toggle */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 border border-slate-600 rounded-lg">
              <span className="text-sm text-slate-300">List view</span>
              <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {/* Tabs */}
            <div className="flex items-center gap-1 bg-slate-700 rounded-lg p-1">
              <button className="px-4 py-1.5 bg-cyan-400 text-slate-900 rounded-md text-sm font-medium">
                Tokens
              </button>
              <button className="px-4 py-1.5 text-slate-300 rounded-md text-sm font-medium hover:text-slate-100">
                NFTs
              </button>
              <button className="px-4 py-1.5 text-slate-300 rounded-md text-sm font-medium hover:text-slate-100">
                Transactions
              </button>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        {filteredTokens.length > 0 && (
          <div className="px-6 py-4 border-b border-slate-700 bg-slate-800/50">
            <div className="relative">
              <input
                type="text"
                placeholder="Search tokens..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-600 rounded-lg bg-slate-900 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 font-medium"
              />
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <svg
                  className="w-5 h-5 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="px-6 py-12 text-center">
            <p className="text-slate-300 font-medium">Loading tokens...</p>
          </div>
        ) : filteredTokens.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-slate-300 font-medium">
              {searchQuery ? 'No tokens found matching your search' : 'No tokens found'}
            </p>
          </div>
        ) : (
          <div>
            {/* Table Header */}
            <div className="px-6 py-3 bg-slate-900/30 border-b border-slate-700 grid grid-cols-12 gap-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <div className="col-span-4">Token</div>
              <div className="col-span-2 text-right">Portfolio %</div>
              <div className="col-span-2 text-right">Price</div>
              <div className="col-span-3 text-right">Balance</div>
              <div className="col-span-1 text-center">Alert</div>
            </div>
            
            {/* Token Rows */}
            <div className="divide-y divide-slate-700/30">
                {filteredTokens.map((token) => {
                const portfolioPercent = totalValue > 0 ? (token.usdValue / totalValue) * 100 : 0;
                
                return (
                  <TokenRow
                    key={token.address}
                    token={token}
                    portfolioPercent={portfolioPercent}
                    isToggled={toggledTokens.has(token.address.toLowerCase())}
                    onToggle={() => handleToggle(token.address.toLowerCase())}
                    isDisabled={!isConnected || !isRegistered}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
