'use client';

import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useNotifications } from './useNotifications';

const SWAP_EVENT_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const RPC_URL = 'https://dream-rpc.somnia.network';

interface PoolMonitorOptions {
  poolAddresses: string[];
  onSwap?: (poolAddress: string) => void;
}

export function usePoolMonitor({ poolAddresses, onSwap }: PoolMonitorOptions) {
  const { address, isConnected } = useAccount();
  const { showNotification, permission } = useNotifications();
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedBlocksRef = useRef<Map<string, number>>(new Map());
  const providerRef = useRef<any>(null);

  useEffect(() => {
    if (!isConnected || !address || poolAddresses.length === 0) {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Initialize ethers provider
    const initProvider = async () => {
      try {
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
          staticNetwork: true,
          batchMaxCount: 1,
        });
        providerRef.current = provider;
        
        // Initialize last checked blocks with timeout handling
        try {
          const currentBlock = await Promise.race([
            provider.getBlockNumber(),
            new Promise<never>((_, reject) => 
              setTimeout(() => reject(new Error('Timeout')), 30000)
            )
          ]) as bigint;
          
          poolAddresses.forEach(poolAddress => {
            lastCheckedBlocksRef.current.set(poolAddress, Number(currentBlock));
          });
        } catch (error: any) {
          // Silently handle timeout - will retry on next poll
          if (!error?.message?.includes('Timeout')) {
            console.warn('Error getting block number, will retry on next poll');
          }
        }
      } catch (error) {
        console.error('Error initializing provider:', error);
      }
    };

    initProvider();

    const checkPoolForNotifications = async (poolAddress: string) => {
      try {
        const response = await fetch('/api/monitor', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ poolAddress }),
        });

        if (response.ok) {
          const data = await response.json();
          
          if (data.notifications && data.notifications.length > 0) {
            data.notifications.forEach((notif: any) => {
              // Only show notification for current user
              if (notif.walletAddress.toLowerCase() === address?.toLowerCase() && permission === 'granted') {
                const emoji = notif.direction === 'up' ? '📈' : '📉';
                const sign = notif.direction === 'up' ? '+' : '-';
                
                showNotification(
                  `${emoji} ${notif.tokenSymbol} Alert`,
                  {
                    body: `Your ${notif.tokenSymbol} has moved ${sign}${notif.changePercent.toFixed(2)}%\n` +
                          `Current Value: $${notif.currentValue.toFixed(2)}\n` +
                          `Previous: $${notif.previousValue.toFixed(2)}`,
                    icon: '/favicon.ico',
                    badge: '/favicon.ico',
                    tag: `${notif.tokenSymbol}-${notif.direction}`,
                  }
                );
              }
            });
          }
        }
      } catch (error) {
        console.error('Error checking pool for notifications:', error);
      }
    };

    const startPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }

      pollingIntervalRef.current = setInterval(async () => {
        if (!providerRef.current) return;

        try {
          for (const poolAddress of poolAddresses) {
            const fromBlock = lastCheckedBlocksRef.current.get(poolAddress) || 0;
            let toBlock: number;
            
            try {
              toBlock = await providerRef.current.getBlockNumber();
            } catch (error) {
              console.error('Error getting block number:', error);
              continue;
            }

            if (toBlock > fromBlock) {
              const swapFilter = {
                address: poolAddress,
                topics: [SWAP_EVENT_TOPIC],
                fromBlock: fromBlock + 1,
                toBlock: toBlock,
              };

              try {
                const logs = await providerRef.current.getLogs(swapFilter);
                
                if (logs.length > 0) {
                  if (onSwap) {
                    onSwap(poolAddress);
                  }
                  
                  await checkPoolForNotifications(poolAddress);
                }
              } catch (error: any) {
                if (error.message?.includes('query returned more than')) {
                  // Query in smaller chunks
                  const chunkSize = 1000;
                  for (let start = fromBlock + 1; start <= toBlock; start += chunkSize) {
                    const end = Math.min(start + chunkSize - 1, toBlock);
                    try {
                      const logs = await providerRef.current.getLogs({
                        address: poolAddress,
                        topics: [SWAP_EVENT_TOPIC],
                        fromBlock: start,
                        toBlock: end,
                      });
                      
                      if (logs.length > 0) {
                        if (onSwap) {
                          onSwap(poolAddress);
                        }
                        
                        await checkPoolForNotifications(poolAddress);
                      }
                    } catch (chunkError: any) {
                      // Suppress timeout and common RPC errors
                      if (!chunkError?.message?.includes('timeout') && 
                          !chunkError?.message?.includes('TIMEOUT') &&
                          !chunkError?.code?.includes('TIMEOUT')) {
                        console.error(`Error querying blocks ${start}-${end}:`, chunkError);
                      }
                    }
                  }
                } else if (!error?.message?.includes('timeout') && 
                          !error?.message?.includes('TIMEOUT') &&
                          !error?.code?.includes('TIMEOUT')) {
                  console.error(`Error getting logs for ${poolAddress}:`, error.message);
                }
              }

              lastCheckedBlocksRef.current.set(poolAddress, toBlock);
            }
          }
        } catch (error: any) {
          // Suppress timeout errors
          if (!error?.message?.includes('timeout') && 
              !error?.message?.includes('TIMEOUT') &&
              !error?.code?.includes('TIMEOUT')) {
            console.error('Polling error:', error);
          }
        }
      }, 5000); // Poll every 5 seconds
    };

    // Start polling after a short delay to allow provider initialization
    const startTimeout = setTimeout(() => {
      startPolling();
    }, 1000);

    return () => {
      clearTimeout(startTimeout);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isConnected, address, poolAddresses, onSwap, permission, showNotification]);
}

