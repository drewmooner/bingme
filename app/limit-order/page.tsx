'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAccount, useBalance, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { ethers } from 'ethers';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useLimitOrders, getTokenPriceInWSOMI, getWSOMIPrice } from '@/hooks/useLimitOrders';

const RPC_URL = 'https://dream-rpc.somnia.network';
const WSOMI_ADDRESS = '0xb8DabbA9EAa4957Dce08e31Ad729F89C1F7C88b4';
const ROUTER_ADDRESS = '0x87F31cC7cd09532Ac352C620A5e3c9FC5BDC9e5D';

const LIMIT_ORDER_MANAGER_ADDRESS = '0xbC3cD7975CE5D13bdB9752FDc6CeBAa3ed52bEE7';

// ABI for wagmi (object format)
const ERC20_ABI_WAGMI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

// ABI for ethers (string format)
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
] as const;

const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
] as const;

export default function LimitOrder() {
  const { address, isConnected } = useAccount();
  const { orders, createOrder, cancelOrder, nonce } = useLimitOrders();
  
  // Get WSOMI balance using wagmi
  const { data: wsomiBalanceData, isLoading: isLoadingBalance, error: balanceError, refetch: refetchBalance } = useBalance({
    address,
    token: WSOMI_ADDRESS as `0x${string}`,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 10000, // Refresh every 10s
    },
  });

  const wsomiBalance = wsomiBalanceData?.value 
    ? ethers.formatEther(wsomiBalanceData.value) 
    : '0';
  
  // Debug: Log balance data
  useEffect(() => {
    if (isConnected && address) {
      console.log('WSOMI Balance Data:', wsomiBalanceData);
      console.log('WSOMI Balance:', wsomiBalance);
      console.log('Is Loading:', isLoadingBalance);
      console.log('Error:', balanceError);
    }
  }, [wsomiBalanceData, wsomiBalance, isLoadingBalance, balanceError, isConnected, address]);
  
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy');
  const [tokenOut, setTokenOut] = useState('');
  const [amount, setAmount] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [priceCurrency, setPriceCurrency] = useState<'WSOMI' | 'USD'>('WSOMI');
  const [slippage, setSlippage] = useState('0.5');
  const [expiry, setExpiry] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [needsApproval, setNeedsApproval] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  
  // Token price
  const [tokenPriceWSOMI, setTokenPriceWSOMI] = useState<number>(0);
  const [tokenPriceUSD, setTokenPriceUSD] = useState<number>(0);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);

  const { writeContract, data: approveHash, isPending: isApprovingTx, error: approveError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isApproved } = useWaitForTransactionReceipt({
    hash: approveHash,
  });

  // Handle approval errors
  useEffect(() => {
    if (approveError) {
      console.error('Approval error:', approveError);
      setError(approveError.message || 'Failed to approve');
      setIsApproving(false);
    }
  }, [approveError]);

  // Check allowance for buy orders
  const { data: allowance, refetch: refetchAllowance, isLoading: isLoadingAllowance } = useReadContract({
    address: WSOMI_ADDRESS as `0x${string}`,
    abi: ERC20_ABI_WAGMI,
    functionName: 'allowance',
    args: address && orderType === 'buy' ? [address, LIMIT_ORDER_MANAGER_ADDRESS as `0x${string}`] : undefined,
    query: {
      enabled: isConnected && !!address && orderType === 'buy',
      refetchInterval: 3000, // Check every 3 seconds
      staleTime: 1000, // Consider data stale after 1 second
    },
  });

  // Check if approval is needed
  useEffect(() => {
    console.log('Checking approval:', { 
      orderType, 
      amount, 
      allowance: allowance?.toString(), 
      isLoadingAllowance 
    });
    
    if (orderType === 'buy' && amount && parseFloat(amount) > 0) {
      if (allowance !== undefined && allowance !== null) {
        try {
          const amountWei = ethers.parseEther(amount);
          // allowance from wagmi is always bigint
          const allowanceBigInt = allowance as bigint;
          const needs = allowanceBigInt < amountWei;
          console.log('Approval check:', {
            allowance: allowanceBigInt.toString(),
            needed: amountWei.toString(),
            needsApproval: needs
          });
          setNeedsApproval(needs);
        } catch (error) {
          console.error('Error checking approval:', error);
          // If we can't parse, assume approval needed
          setNeedsApproval(true);
        }
      } else if (!isLoadingAllowance) {
        // If allowance is null/undefined and not loading, assume no approval
        console.log('Allowance is null/undefined, assuming approval needed');
        setNeedsApproval(true);
      }
    } else {
      setNeedsApproval(false);
    }
  }, [amount, allowance, orderType, isLoadingAllowance]);

  // Refresh allowance after approval
  useEffect(() => {
    if (isApproved) {
      console.log('Approval confirmed, refreshing allowance...');
      setIsApproving(false);
      // Refresh multiple times
      setTimeout(() => refetchAllowance(), 1000);
      setTimeout(() => refetchAllowance(), 3000);
      setTimeout(() => refetchAllowance(), 5000);
    }
  }, [isApproved, refetchAllowance]);

  // Also refresh when transaction hash changes
  useEffect(() => {
    if (approveHash) {
      console.log('Approval transaction hash:', approveHash);
      setIsApproving(false); // Stop showing "Approving..." since tx is sent
    }
  }, [approveHash]);

  // Load token price when tokenOut changes (for buy orders)
  useEffect(() => {
    if (!isConnected || !address || orderType !== 'buy' || !tokenOut) {
      setTokenPriceWSOMI(0);
      setTokenPriceUSD(0);
      return;
    }

    const loadPrice = async () => {
      setIsLoadingPrice(true);
      try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
        
        // Get price: 1 tokenOut = X WSOMI
        const oneToken = ethers.parseEther('1');
        const path = [WSOMI_ADDRESS, tokenOut];
        
        try {
          const amounts = await router.getAmountsOut(oneToken, path);
          // amounts[0] = WSOMI in, amounts[1] = tokenOut out
          // We want: 1 tokenOut = ? WSOMI, so we need to reverse
          // Actually, let's get it the other way: 1 tokenOut in, get WSOMI out
          const pathReverse = [tokenOut, WSOMI_ADDRESS];
          const amountsReverse = await router.getAmountsOut(oneToken, pathReverse);
          const priceInWSOMI = parseFloat(ethers.formatEther(amountsReverse[1]));
          setTokenPriceWSOMI(priceInWSOMI);
          
          // Get USD price
          const wsomiPriceUSD = await getWSOMIPrice();
          setTokenPriceUSD(priceInWSOMI * wsomiPriceUSD);
        } catch (error) {
          // Try direct pool price if router fails
          const priceInWSOMI = await getTokenPriceInWSOMI(provider, tokenOut);
          setTokenPriceWSOMI(priceInWSOMI);
          const wsomiPriceUSD = await getWSOMIPrice();
          setTokenPriceUSD(priceInWSOMI * wsomiPriceUSD);
        }
      } catch (error) {
        console.error('Error loading token price:', error);
        setTokenPriceWSOMI(0);
        setTokenPriceUSD(0);
      } finally {
        setIsLoadingPrice(false);
      }
    };

    loadPrice();
    const interval = setInterval(loadPrice, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [isConnected, address, orderType, tokenOut, getTokenPriceInWSOMI, getWSOMIPrice]);

  const handleApprove = async () => {
    if (!isConnected || !address || !amount) {
      setError('Please connect wallet and enter amount');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setIsApproving(true);
    setError('');

    try {
      // Use wagmi's writeContract - it handles RPC better
      const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
      
      writeContract({
        address: WSOMI_ADDRESS as `0x${string}`,
        abi: ERC20_ABI_WAGMI,
        functionName: 'approve',
        args: [LIMIT_ORDER_MANAGER_ADDRESS as `0x${string}`, maxApproval],
      });
    } catch (err: any) {
      console.error('Approval error:', err);
      setError(err.message || 'Failed to approve. Please try again.');
      setIsApproving(false);
    }
  };

  const handleCreateOrder = async () => {
    if (!isConnected || !address) {
      setError('Please connect your wallet');
      return;
    }

    if (orderType === 'buy') {
      if (!tokenOut || !amount || !priceInput) {
        setError('Please fill in all required fields');
        return;
      }

      // Validate amount doesn't exceed balance
      const amountNum = parseFloat(amount);
      const balanceNum = parseFloat(wsomiBalance);
      if (amountNum > balanceNum) {
        setError(`Insufficient WSOMI balance. You have ${balanceNum.toFixed(6)} WSOMI`);
        return;
      }

      // Check if approval is needed
      if (needsApproval) {
        setError('Please approve the contract to spend your WSOMI first');
        return;
      }
    } else {
      if (!tokenOut || !amount || !priceInput) {
        setError('Please fill in all required fields');
        return;
      }
    }

    setIsCreating(true);
    setError('');

    try {
      // Calculate deadline (default 30 days if not specified)
      const deadline = expiry 
        ? Math.floor(new Date(expiry).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

      const slippageBps = Math.round(parseFloat(slippage) * 100);

      // For buy orders: tokenIn is always WSOMI
      const tokenIn = orderType === 'buy' ? WSOMI_ADDRESS : tokenOut;
      const actualTokenOut = orderType === 'buy' ? tokenOut : WSOMI_ADDRESS;

      // Convert price to WSOMI
      // limitPriceE18 in contract represents: tokenOut per 1 tokenIn (scaled by 1e18)
      // For buy orders: tokenIn = WSOMI, tokenOut = target token
      // User enters: price per token (in WSOMI or USD)
      // We need: tokenOut per 1 WSOMI
      // If user says "I want to buy at 0.5 WSOMI per token"
      // Then: 1 token = 0.5 WSOMI, so 1 WSOMI = 2 tokens
      // limitPriceE18 = 2 * 1e18
      let limitPriceInWSOMI: string;
      if (priceCurrency === 'USD') {
        // priceInput = USD per tokenOut
        // Convert to WSOMI per tokenOut first
        const wsomiPriceUSD = await getWSOMIPrice();
        if (wsomiPriceUSD === 0) {
          throw new Error('Unable to get WSOMI price. Please try again.');
        }
        // USD per token -> WSOMI per token
        const priceInWSOMI = parseFloat(priceInput) / wsomiPriceUSD;
        // tokenOut per 1 WSOMI = 1 / (WSOMI per tokenOut)
        limitPriceInWSOMI = (1 / priceInWSOMI).toString();
      } else {
        // priceInput = WSOMI per tokenOut
        // tokenOut per 1 WSOMI = 1 / priceInput
        limitPriceInWSOMI = (1 / parseFloat(priceInput)).toString();
      }

      await createOrder(
        tokenIn,
        actualTokenOut,
        amount,
        limitPriceInWSOMI,
        slippageBps,
        deadline,
        orderType
      );

      // Reset form
      setAmount('');
      setPriceInput('');
      setExpiry('');
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to create order');
      console.error('Error creating order:', err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    try {
      await cancelOrder(orderId);
    } catch (err: any) {
      setError(err.message || 'Failed to cancel order');
      console.error('Error canceling order:', err);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const formatAmount = (amount: string, decimals: number = 18) => {
    try {
      const formatted = ethers.formatUnits(amount, decimals);
      const num = parseFloat(formatted);
      if (num < 0.000001) return '<0.000001';
      if (num < 1) return num.toFixed(6);
      return num.toLocaleString(undefined, { maximumFractionDigits: 4 });
    } catch {
      return amount;
    }
  };

  // Calculate estimated tokens to receive based on limit price
  const estimatedTokens = (() => {
    if (orderType !== 'buy' || !amount || !priceInput || parseFloat(amount) === 0 || parseFloat(priceInput) === 0) {
      return null;
    }
    
    try {
      let priceInWSOMI: number;
      if (priceCurrency === 'WSOMI') {
        priceInWSOMI = parseFloat(priceInput);
      } else if (priceCurrency === 'USD') {
        // Convert USD price to WSOMI
        // If tokenPriceUSD = USD per token, and tokenPriceWSOMI = WSOMI per token
        // Then: USD per token -> WSOMI per token = (USD per token) * (WSOMI per token / USD per token)
        // = priceInput * (tokenPriceWSOMI / tokenPriceUSD)
        if (tokenPriceUSD > 0 && tokenPriceWSOMI > 0) {
          priceInWSOMI = parseFloat(priceInput) * (tokenPriceWSOMI / tokenPriceUSD);
        } else {
          return null;
        }
      } else {
        return null;
      }
      
      if (priceInWSOMI > 0) {
        const tokens = parseFloat(amount) / priceInWSOMI;
        return tokens;
      }
      return null;
    } catch {
      return null;
    }
  })();

  // Calculate estimated USD value
  const estimatedUSDValue = estimatedTokens && tokenPriceUSD > 0
    ? estimatedTokens * tokenPriceUSD
    : null;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 transition-colors">
      <Header />
      <Sidebar />
      <main className="ml-64 pt-16 px-8 py-8 min-h-screen">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-8">Limit Orders</h1>

          {error && (
            <div className="mb-6 p-4 bg-red-500/20 dark:bg-red-500/20 border border-red-500/50 dark:border-red-500/50 rounded-lg">
              <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Create Order Form */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 transition-colors">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Create Limit Order</h2>

              <div className="space-y-3">
                {/* Order Type */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Order Type</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setOrderType('buy');
                        setTokenOut('');
                        setAmount('');
                        setPriceInput('');
                      }}
                      className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        orderType === 'buy'
                          ? 'bg-green-500 dark:bg-green-500 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                      }`}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => {
                        setOrderType('sell');
                        setTokenOut('');
                        setAmount('');
                        setPriceInput('');
                      }}
                      className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        orderType === 'sell'
                          ? 'bg-red-500 dark:bg-red-500 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                      }`}
                    >
                      Sell
                    </button>
                  </div>
                </div>

                {orderType === 'buy' && (
                  <>
                    {/* WSOMI Balance Display */}
                    <div className="bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-2.5">
                      <div className="flex justify-between items-center text-sm mb-1">
                        <span className="text-slate-600 dark:text-slate-400">Balance:</span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {isLoadingBalance ? 'Loading...' : `${parseFloat(wsomiBalance).toFixed(4)} WSOMI`}
                        </span>
                      </div>
                      {amount && parseFloat(amount) > 0 && (
                        <div className="flex justify-between items-center text-xs mt-1 pt-1 border-t border-slate-300 dark:border-slate-700">
                          <span className="text-slate-500 dark:text-slate-500">Approval:</span>
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${
                              needsApproval ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                            }`}>
                              {isLoadingAllowance ? 'Checking...' : needsApproval ? 'Required' : 'Approved'}
                            </span>
                            <button
                              onClick={() => refetchAllowance()}
                              className="text-xs px-2 py-0.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded text-slate-600 dark:text-slate-400"
                              title="Refresh approval status"
                            >
                              ↻
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Token Out (Buy) */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                        Token Address
                      </label>
                      <input
                        type="text"
                        value={tokenOut}
                        onChange={(e) => setTokenOut(e.target.value)}
                        placeholder="0x..."
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                      />
                      {tokenOut && tokenPriceWSOMI > 0 && (
                        <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                          {tokenPriceWSOMI.toFixed(6)} WSOMI • ${tokenPriceUSD.toFixed(2)}
                        </div>
                      )}
                    </div>

                    {/* Amount in WSOMI */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                        Amount (WSOMI)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={amount}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '' || parseFloat(val) <= parseFloat(wsomiBalance)) {
                              setAmount(val);
                            }
                          }}
                          placeholder="0.0"
                          step="any"
                          min="0"
                          max={wsomiBalance}
                          className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                        />
                        <button
                          type="button"
                          onClick={() => setAmount(wsomiBalance)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs font-medium bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded"
                        >
                          MAX
                        </button>
                      </div>
                      {amount && parseFloat(amount) > 0 && estimatedTokens !== null && estimatedTokens > 0 && (
                        <div className="mt-2 p-2.5 bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-lg">
                          <div className="flex items-baseline justify-between">
                            <span className="text-xs text-cyan-700 dark:text-cyan-300">Receive:</span>
                            <div className="text-right">
                              <div className="text-base font-bold text-cyan-700 dark:text-cyan-300">
                                {estimatedTokens.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                              </div>
                              {estimatedUSDValue !== null && estimatedUSDValue > 0 && (
                                <div className="text-xs text-cyan-600 dark:text-cyan-400">
                                  ${estimatedUSDValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Limit Price */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-medium text-slate-700 dark:text-slate-200">
                          Limit Price
                        </label>
                        {tokenOut && tokenPriceWSOMI > 0 && (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Current: {tokenPriceWSOMI.toFixed(4)} WSOMI
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={priceInput}
                          onChange={(e) => setPriceInput(e.target.value)}
                          placeholder={tokenPriceWSOMI > 0 ? tokenPriceWSOMI.toFixed(4) : "0.0"}
                          step="any"
                          min="0"
                          className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                        />
                        <select
                          value={priceCurrency}
                          onChange={(e) => setPriceCurrency(e.target.value as 'WSOMI' | 'USD')}
                          className="px-2 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                        >
                          <option value="WSOMI">WSOMI</option>
                          <option value="USD">USD</option>
                        </select>
                      </div>
                      {priceInput && parseFloat(priceInput) > 0 && tokenPriceWSOMI > 0 && priceCurrency === 'WSOMI' && (
                        <div className={`mt-1.5 text-xs ${
                          parseFloat(priceInput) < tokenPriceWSOMI
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}>
                          {parseFloat(priceInput) < tokenPriceWSOMI 
                            ? `${((1 - parseFloat(priceInput) / tokenPriceWSOMI) * 100).toFixed(1)}% below market`
                            : `${((parseFloat(priceInput) / tokenPriceWSOMI - 1) * 100).toFixed(1)}% above market`
                          }
                        </div>
                      )}
                    </div>
                  </>
                )}

                {orderType === 'sell' && (
                  <>
                    {/* Token In (Sell) */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                        Token Address
                      </label>
                      <input
                        type="text"
                        value={tokenOut}
                        onChange={(e) => setTokenOut(e.target.value)}
                        placeholder="0x..."
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                      />
                    </div>

                    {/* Amount */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">Amount</label>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.0"
                        step="any"
                        min="0"
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                      />
                    </div>

                    {/* Limit Price */}
                    <div>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1.5">
                        Limit Price (WSOMI)
                      </label>
                      <input
                        type="number"
                        value={priceInput}
                        onChange={(e) => setPriceInput(e.target.value)}
                        placeholder="0.0"
                        step="any"
                        min="0"
                        className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400"
                      />
                    </div>
                  </>
                )}

                {/* Slippage */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                    Slippage Tolerance (%)
                  </label>
                  <input
                    type="number"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    placeholder="0.5"
                    step="0.1"
                    min="0"
                    max="50"
                    className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-colors"
                  />
                </div>

                {/* Expiry */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                    Expiry Date (Optional - defaults to 30 days)
                  </label>
                  <input
                    type="datetime-local"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-colors"
                  />
                </div>

                {/* Approval Button (if needed) */}
                {orderType === 'buy' && needsApproval && (
                  <div className="mb-2">
                    <button
                      onClick={handleApprove}
                      disabled={!isConnected || isApproving || isApprovingTx || isConfirming}
                      className={`w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors mb-2 ${
                        isConnected && !isApproving && !isApprovingTx && !isConfirming
                          ? 'bg-yellow-500 hover:bg-yellow-400 text-slate-900'
                          : 'bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      {isApproving || isApprovingTx || isConfirming 
                        ? 'Approving...' 
                        : `Approve WSOMI`}
                    </button>
                    {error && error.includes('RPC') && (
                      <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-xs">
                        <p className="text-amber-800 dark:text-amber-200 mb-1">
                          <strong>RPC Error:</strong> You can approve manually in MetaMask:
                        </p>
                        <ol className="list-decimal list-inside text-amber-700 dark:text-amber-300 space-y-1">
                          <li>Open MetaMask</li>
                          <li>Find WSOMI token</li>
                          <li>Click "Approve" or "Revoke"</li>
                          <li>Spender: <code className="text-xs">{LIMIT_ORDER_MANAGER_ADDRESS}</code></li>
                          <li>Amount: Max (or {amount} WSOMI)</li>
                        </ol>
                        <button
                          onClick={() => refetchAllowance()}
                          className="mt-2 w-full px-2 py-1 bg-amber-200 dark:bg-amber-800 hover:bg-amber-300 dark:hover:bg-amber-700 rounded text-xs font-medium text-amber-900 dark:text-amber-100"
                        >
                          ↻ Refresh After Approving
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  onClick={handleCreateOrder}
                  disabled={!isConnected || isCreating || !!error || (orderType === 'buy' && needsApproval)}
                  className={`w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                    isConnected && !isCreating && !error && !(orderType === 'buy' && needsApproval)
                      ? 'bg-cyan-400 hover:bg-cyan-300 text-slate-900'
                      : 'bg-slate-300 dark:bg-slate-700 text-slate-500 dark:text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {isCreating ? 'Creating...' : isConnected ? 'Create Order' : 'Connect Wallet'}
                </button>
              </div>
            </div>

            {/* Active Orders */}
            <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 transition-colors">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">Active Orders</h2>

              {orders.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-slate-600 dark:text-slate-400">No active orders</p>
                  <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                    Create a limit order to get started
                  </p>
                </div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {orders.map((order) => (
                    <div
                      key={order.id}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-4 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          order.status === 'pending' 
                            ? 'bg-yellow-500/20 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' 
                            : order.status === 'executed'
                            ? 'bg-green-500/20 dark:bg-green-500/20 text-green-600 dark:text-green-400'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                        }`}>
                          {order.status.toUpperCase()}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-500">
                          Nonce: {order.nonce}
                        </span>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Type:</span>
                          <span className="text-slate-900 dark:text-slate-100 font-medium uppercase">
                            {order.orderType}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Token In:</span>
                          <span className="text-slate-900 dark:text-slate-100 font-mono text-xs">
                            {order.tokenIn.slice(0, 6)}...{order.tokenIn.slice(-4)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Token Out:</span>
                          <span className="text-slate-900 dark:text-slate-100 font-mono text-xs">
                            {order.tokenOut.slice(0, 6)}...{order.tokenOut.slice(-4)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Amount:</span>
                          <span className="text-slate-900 dark:text-slate-100 font-medium">
                            {formatAmount(order.amountIn)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Limit Price (WSOMI):</span>
                          <span className="text-slate-900 dark:text-slate-100 font-medium">
                            {formatAmount(order.limitPriceE18)}
                          </span>
                        </div>
                        {order.limitPriceWSOMI && parseFloat(order.limitPriceWSOMI) > 0 && (
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Price in WSOMI:</span>
                            <span className="text-slate-900 dark:text-slate-100 font-medium">
                              {parseFloat(order.limitPriceWSOMI).toFixed(6)} WSOMI
                            </span>
                          </div>
                        )}
                        {order.limitPriceUSD && parseFloat(order.limitPriceUSD) > 0 && (
                          <div className="flex justify-between">
                            <span className="text-slate-600 dark:text-slate-400">Price in USD:</span>
                            <span className="text-slate-900 dark:text-slate-100 font-medium">
                              ${parseFloat(order.limitPriceUSD).toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Slippage:</span>
                          <span className="text-slate-900 dark:text-slate-100">
                            {(order.slippageBps / 100).toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-600 dark:text-slate-400">Expires:</span>
                          <span className="text-slate-900 dark:text-slate-100 text-xs">
                            {formatDate(order.deadline)}
                          </span>
                        </div>
                      </div>
                      {order.status === 'pending' && (
                        <button
                          onClick={() => handleCancelOrder(order.id)}
                          className="mt-3 w-full px-3 py-1.5 bg-red-500/20 dark:bg-red-500/20 hover:bg-red-500/30 dark:hover:bg-red-500/30 text-red-600 dark:text-red-400 rounded text-xs font-medium transition-colors"
                        >
                          Cancel Order
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Info Section */}
          <div className="mt-8 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 transition-colors">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">How Limit Orders Work</h3>
            <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
              <p>• <strong>Buy Orders:</strong> Automatically use WSOMI. Enter the token address you want to buy and the amount of WSOMI to spend.</p>
              <p>• <strong>Price Input:</strong> Enter limit price in WSOMI or USD. Prices are converted internally to WSOMI for execution.</p>
              <p>• <strong>Balance Check:</strong> System prevents entering more WSOMI than you have available.</p>
              <p>• <strong>Non-custodial:</strong> Your tokens stay in your wallet until the order executes</p>
              <p>• <strong>EIP-712 Signing:</strong> Orders are signed off-chain using your wallet</p>
              <p>• <strong>Token Approval Required:</strong> You must approve the Limit Order Manager contract to spend your tokens before creating an order</p>
              <p>• <strong>Automatic Execution:</strong> Our monitoring system watches pools and executes orders when price conditions are met</p>
              <p>• <strong>Platform fee:</strong> A small fee (1%) is taken from your input token before swapping</p>
              <p>• <strong>Notifications:</strong> You'll receive a notification when your order executes</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
