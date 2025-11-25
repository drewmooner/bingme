'use client';

import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useNotifications } from './useNotifications';

export function useServerNotifications() {
  const { address, isConnected } = useAccount();
  const { showNotification, permission } = useNotifications();
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCheckedRef = useRef<string>('');

  useEffect(() => {
    if (!isConnected || !address || permission !== 'granted') {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    const fetchNotifications = async () => {
      try {
        const response = await fetch(`/api/notifications?address=${address}`);
        if (!response.ok) return;

        const data = await response.json();
        const notifications = data.notifications || [];

        if (notifications.length > 0) {
          // Mark notifications as read after showing
          const notificationIds: string[] = [];

          notifications.forEach((notif: any) => {
            const id = `${notif.timestamp}-${notif.tokenSymbol}-${notif.direction}`;
            
            // Only show if we haven't shown this one before
            if (id !== lastCheckedRef.current) {
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
                  tag: `${notif.tokenSymbol}-${notif.direction}-${notif.timestamp}`,
                }
              );

              notificationIds.push(id);
              lastCheckedRef.current = id;
            }
          });

          // Mark notifications as read
          if (notificationIds.length > 0) {
            await fetch('/api/notifications', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                walletAddress: address,
                notificationIds,
              }),
            });
          }
        }
      } catch (error) {
        console.error('Error fetching notifications:', error);
      }
    };

    // Fetch immediately
    fetchNotifications();

    // Then poll every 10 seconds
    pollingIntervalRef.current = setInterval(fetchNotifications, 10000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isConnected, address, permission, showNotification]);
}

