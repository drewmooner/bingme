'use client';

export default function SkeletonCard() {
  return (
    <div className="bg-[#1e3a5f] rounded-2xl p-6 border border-[#2d5a8f] animate-pulse">
      <div className="flex justify-between items-start mb-5">
        <div className="flex-1">
          <div className="h-6 w-20 bg-[#2d5a8f] rounded mb-2" />
          <div className="h-4 w-32 bg-[#2d5a8f] rounded" />
        </div>
        <div className="h-6 w-16 bg-[#2d5a8f] rounded-lg" />
      </div>
      
      <div className="mb-4">
        <div className="h-4 w-16 bg-[#2d5a8f] rounded mb-2" />
        <div className="h-8 w-32 bg-[#2d5a8f] rounded" />
      </div>
      
      <div className="bg-[#0a1929] rounded-xl p-4 mb-4">
        <div className="h-4 w-20 bg-[#2d5a8f] rounded mb-2" />
        <div className="h-7 w-24 bg-[#2d5a8f] rounded" />
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="h-3 w-20 bg-[#2d5a8f] rounded mb-1" />
          <div className="h-4 w-16 bg-[#2d5a8f] rounded" />
        </div>
        <div>
          <div className="h-3 w-24 bg-[#2d5a8f] rounded mb-1" />
          <div className="h-4 w-16 bg-[#2d5a8f] rounded" />
        </div>
      </div>
    </div>
  );
}
