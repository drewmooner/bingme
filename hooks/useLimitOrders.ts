'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';

// Load from deployment file or use default
let LIMIT_ORDER_MANAGER_ADDRESS = '0xbC3cD7975CE5D13bdB9752FDc6CeBAa3ed52bEE7';
const RPC_URL = 'https://dream-rpc.somnia.network';
const FACTORY_ADDRESS = '0xBABE473c0986bf6A986307Bcf52EAe1C96f921B2';
const WSOMI_ADDRESS = '0xb8DabbA9EAa4957Dce08e31Ad729F89C1F7C88b4';
const ROUTER_ADDRESS = '0x87F31cC7cd09532Ac352C620A5e3c9FC5BDC9e5D';

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
] as const;

const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
] as const;

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
] as const;

const ROUTER_ABI = [
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)',
] as const;

interface LimitOrder {
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin: string;
  limitPriceE18: string;
  slippageBps: number;
  deadline: number;
  nonce: number;
}

interface OrderWithSignature {
  id: string;
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOutMin: string;
  limitPriceE18: string;
  slippageBps: number;
  deadline: number;
  nonce: number;
  signature: string;
  createdAt: string;
  status: 'pending' | 'executed' | 'canceled' | 'expired';
  orderType: 'buy' | 'sell';
  limitPriceWSOMI: string;
  limitPriceUSD: string;
}

// Get WSOMI price in USD
async function getWSOMIPrice(): Promise<number> {
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

// Get token price in WSOMI using router quote (preferred method)
async function getTokenPriceInWSOMI(
  provider: ethers.Provider,
  tokenAddress: string
): Promise<number> {
  try {
    // Try router quote first (most accurate)
    const router = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
    const oneToken = ethers.parseEther('1');
    const path = [tokenAddress, WSOMI_ADDRESS];
    
    try {
      const amounts = await router.getAmountsOut(oneToken, path);
      // amounts[0] = token in, amounts[1] = WSOMI out
      // Price = WSOMI per 1 token
      return parseFloat(ethers.formatEther(amounts[1]));
    } catch (routerError) {
      // Fallback to pool reserves if router fails
      console.log('Router quote failed, using pool reserves');
    }

    // Fallback to pool reserves
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    let poolAddress = await factory.getPair(tokenAddress, WSOMI_ADDRESS);
    
    if (poolAddress === ethers.ZeroAddress) {
      poolAddress = await factory.getPair(WSOMI_ADDRESS, tokenAddress);
    }

    if (poolAddress === ethers.ZeroAddress) {
      return 0;
    }

    const pair = new ethers.Contract(poolAddress, PAIR_ABI, provider);
    const [token0, reserves] = await Promise.all([
      pair.token0(),
      pair.getReserves(),
    ]);

    const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
    const token1Address = token0.toLowerCase() === WSOMI_ADDRESS.toLowerCase() 
      ? await pair.token1() 
      : token0;
    const token1Contract = new ethers.Contract(token1Address, ERC20_ABI, provider);

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

    if (wsomiReserveFormatted < 1000 || tokenReserveFormatted === 0) {
      return 0;
    }

    // Price in WSOMI: how much WSOMI per 1 token
    return wsomiReserveFormatted / tokenReserveFormatted;
  } catch (error) {
    console.error('Error getting token price in WSOMI:', error);
    return 0;
  }
}

// Export helper functions
export { getTokenPriceInWSOMI, getWSOMIPrice };

export function useLimitOrders() {
  const { address, isConnected } = useAccount();
  const [orders, setOrders] = useState<OrderWithSignature[]>([]);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (isConnected && address) {
      loadOrders();
      loadNonce();
    }
  }, [isConnected, address]);

  const loadOrders = async () => {
    if (!address) return;
    
    try {
      const response = await fetch(`/api/limit-orders?trader=${address}`);
      if (response.ok) {
        const data = await response.json();
        setOrders(data.orders || []);
      }
    } catch (error) {
      console.error('Error loading orders:', error);
    }
  };

  const loadNonce = async () => {
    if (!address || !isConnected) return;
    
    try {
      const savedNonce = localStorage.getItem(`limitOrderNonce_${address.toLowerCase()}`);
      if (savedNonce) {
        setNonce(parseInt(savedNonce));
      }
    } catch (error) {
      console.error('Error loading nonce:', error);
    }
  };

  const createOrder = async (
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    limitPrice: string,
    slippageBps: number = 50,
    deadline: number,
    orderType: 'buy' | 'sell'
  ): Promise<OrderWithSignature | null> => {
    if (!address || !isConnected) {
      throw new Error('Wallet not connected');
    }

    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      
      // Convert amount to wei (assuming 18 decimals for now)
      const amountInWei = ethers.parseEther(amountIn);
      const limitPriceE18 = ethers.parseEther(limitPrice);
      
      // Calculate minimum output (with slippage)
      const expectedOut = (amountInWei * limitPriceE18) / ethers.parseEther('1');
      const amountOutMin = (expectedOut * BigInt(10000 - slippageBps)) / BigInt(10000);

      const order: LimitOrder = {
        trader: address,
        tokenIn,
        tokenOut,
        amountIn: amountInWei.toString(),
        amountOutMin: amountOutMin.toString(),
        limitPriceE18: limitPriceE18.toString(),
        slippageBps,
        deadline,
        nonce,
      };

      // Sign order using EIP-712
      const signature = await signOrder(order);

      // Calculate prices in WSOMI and USD for display
      // limitPriceE18 = tokenOut per 1 tokenIn
      // For buy orders: tokenIn = WSOMI, so limitPriceE18 = tokenOut per 1 WSOMI
      // For display: WSOMI per token = 1 / limitPrice
      let limitPriceWSOMI = '0';
      let limitPriceUSD = '0';

      try {
        const limitPriceNum = parseFloat(limitPrice);
        if (limitPriceNum > 0) {
          // limitPrice = tokenOut per 1 WSOMI
          // WSOMI per token = 1 / limitPrice
          limitPriceWSOMI = (1 / limitPriceNum).toFixed(6);
          
          // Get USD price
          const wsomiPriceUSD = await getWSOMIPrice();
          if (wsomiPriceUSD > 0) {
            limitPriceUSD = (parseFloat(limitPriceWSOMI) * wsomiPriceUSD).toFixed(2);
          }
        }
      } catch (error) {
        console.error('Error calculating prices:', error);
      }

      const orderWithSig: OrderWithSignature = {
        id: `${address}-${nonce}-${Date.now()}`,
        trader: address,
        tokenIn,
        tokenOut,
        amountIn: amountInWei.toString(),
        amountOutMin: amountOutMin.toString(),
        limitPriceE18: limitPriceE18.toString(),
        slippageBps,
        deadline,
        nonce,
        signature,
        createdAt: new Date().toISOString(),
        status: 'pending',
        orderType,
        limitPriceWSOMI,
        limitPriceUSD,
      };

      // Save to API
      const response = await fetch('/api/limit-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderWithSig),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save order');
      }

      // Reload orders
      await loadOrders();
      
      // Increment nonce
      const newNonce = nonce + 1;
      setNonce(newNonce);
      if (address) {
        localStorage.setItem(`limitOrderNonce_${address.toLowerCase()}`, newNonce.toString());
      }

      return orderWithSig;
    } catch (error) {
      console.error('Error creating order:', error);
      throw error;
    }
  };

  const signOrder = async (order: LimitOrder): Promise<string> => {
    if (!address) throw new Error('Wallet not connected');
    if (!(window as any).ethereum) throw new Error('No wallet found');

    // EIP-712 domain
    const domain = {
      name: 'Bingme LimitOrders',
      version: '1',
      chainId: 1946, // Somnia Testnet
      verifyingContract: LIMIT_ORDER_MANAGER_ADDRESS,
    };

    // Order type
    const types = {
      Order: [
        { name: 'trader', type: 'address' },
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMin', type: 'uint256' },
        { name: 'limitPriceE18', type: 'uint256' },
        { name: 'slippageBps', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
      ],
    };

    // Sign using ethers
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const signer = await provider.getSigner();
    
    try {
      const signature = await signer.signTypedData(domain, types, order);
      return signature;
    } catch (error: any) {
      if (error.code === 4001) {
        throw new Error('User rejected signing');
      }
      throw error;
    }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      const response = await fetch(`/api/limit-orders?orderId=${orderId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to cancel order');
      }

      await loadOrders();
    } catch (error: any) {
      console.error('Error canceling order:', error);
      throw error;
    }
  };

  return {
    orders,
    createOrder,
    cancelOrder,
    nonce,
    refreshOrders: loadOrders,
    getTokenPriceInWSOMI,
    getWSOMIPrice,
  };
}
