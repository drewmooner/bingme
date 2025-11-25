'use client';

interface PortfolioHeaderProps {
  activeTab: 'home' | 'dashboard' | 'metrics';
  onTabChange: (tab: 'home' | 'dashboard' | 'metrics') => void;
}

export default function PortfolioHeader({
  activeTab,
  onTabChange,
}: PortfolioHeaderProps) {
  return (
    <nav className="flex gap-2">
      {['home', 'dashboard', 'metrics'].map(tab => (
        <button
          key={tab}
          onClick={() => onTabChange(tab as 'home' | 'dashboard' | 'metrics')}
          className="px-6 py-2 rounded-lg border-none transition-all text-sm font-medium capitalize cursor-pointer"
          style={{
            background: activeTab === tab ? '#2d5a8f' : 'transparent',
            color: activeTab === tab ? '#ffffff' : '#94a3b8',
          }}
        >
          {tab}
        </button>
      ))}
    </nav>
  );
}
