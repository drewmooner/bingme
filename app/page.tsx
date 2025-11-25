'use client';

import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import WalletInterface from '@/components/WalletInterface';

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950">
      <Header />
      <Sidebar />
      <main className="ml-64 pt-16 px-8 py-8 min-h-screen">
        <WalletInterface />
      </main>
    </div>
  );
}

