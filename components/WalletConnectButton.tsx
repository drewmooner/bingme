'use client';

import { useState } from 'react';
import { ethers } from 'ethers';

interface WalletConnectButtonProps {
  onConnect: (address: string, provider: ethers.BrowserProvider) => void;
  account: string | null;
}

export default function WalletConnectButton({ onConnect, account }: WalletConnectButtonProps) {
  const [isConnecting, setIsConnecting] = useState(false);

  const connectWallet = async () => {
    setIsConnecting(true);
    try {
      if (typeof window.ethereum === 'undefined') {
        alert('Please install MetaMask or another Web3 wallet extension');
        setIsConnecting(false);
        return;
      }

      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (!accounts || accounts.length === 0) {
        alert('No accounts found. Please unlock your wallet.');
        setIsConnecting(false);
        return;
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      
      const SOMNIA_CHAIN_ID = 1946;
      const chainIdHex = `0x${SOMNIA_CHAIN_ID.toString(16)}`;
      
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });
      } catch (switchError: any) {
        if (switchError.code === 4902 || switchError.code === -32603) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: chainIdHex,
                  chainName: 'Somnia Testnet',
                  nativeCurrency: {
                    name: 'SOMI',
                    symbol: 'SOMI',
                    decimals: 18,
                  },
                  rpcUrls: ['https://dream-rpc.somnia.network'],
                  blockExplorerUrls: ['https://explorer.somnia.network'],
                },
              ],
            });
          } catch (addError) {
            console.error('Error adding chain:', addError);
            alert('Failed to add Somnia Testnet. Please add it manually in your wallet.');
            setIsConnecting(false);
            return;
          }
        }
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      
      if (!address) {
        throw new Error('Failed to get wallet address');
      }

      onConnect(address, provider);
    } catch (error: any) {
      console.error('Error connecting wallet:', error);
      
      let errorMessage = 'Failed to connect wallet';
      if (error.code === 4001) {
        errorMessage = 'Connection rejected. Please approve the connection request.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert(errorMessage);
    } finally {
      setIsConnecting(false);
    }
  };

  if (account) {
    return (
      <button
        onClick={connectWallet}
        className="bg-[#2d5a8f] text-white border-none rounded-[50px] px-7 py-3 text-[15px] font-medium cursor-pointer transition-all hover:bg-[#3d6a9f]"
      >
        {account.slice(0, 6)}...{account.slice(-4)}
      </button>
    );
  }

  return (
    <button
      onClick={connectWallet}
      disabled={isConnecting}
      className="bg-[#2d5a8f] text-white border-none rounded-[50px] px-7 py-3 text-[15px] font-medium cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#3d6a9f]"
    >
      {isConnecting ? 'Connecting...' : 'Connect Wallet'}
    </button>
  );
}
