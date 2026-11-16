// src/components/layout/Sidebar.tsx
// Storage Checker Live - Industrial Dark Navigation Sidebar

import React from 'react';
import {
  HardDrive,
  Activity,
  FolderSearch,
  Trash2,
  RefreshCw,
  ShieldCheck,
  Database,
  Sparkles,
} from 'lucide-react';
import { useAppStore, NavTab } from '../../store/useAppStore';

export const Sidebar: React.FC = () => {
  const { currentTab, setCurrentTab, appInfo, dbStatus, queuedItemIds, setIsCleanupModalOpen } = useAppStore();

  const navItems: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Live Overview', icon: <Activity className="w-4 h-4" /> },
    { id: 'explorer', label: 'Deep Explorer', icon: <FolderSearch className="w-4 h-4" /> },
    { id: 'orphan', label: 'Orphaned Temp', icon: <Trash2 className="w-4 h-4" /> },
    { id: 'recap', label: 'Recap Center', icon: <RefreshCw className="w-4 h-4" /> },
  ];

  return (
    <aside className="w-64 border-r border-[#1F2937] bg-[#141923] flex flex-col justify-between p-4 select-none shrink-0">
      <div className="space-y-6">
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-2">
          <div className="p-2 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-semibold tracking-wide text-white">Storage Checker</h1>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-blue-500/20 text-blue-400 border border-blue-500/30">
                LIVE
              </span>
            </div>
            <p className="text-xs text-[#9CA3AF]">AI & Dev Bloat Monitor</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 font-semibold'
                    : 'text-[#9CA3AF] hover:text-white hover:bg-[#1E2533]'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Cleanup Queue Trigger Banner */}
        {queuedItemIds.length > 0 && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs space-y-2">
            <div className="flex items-center justify-between text-amber-400 font-medium">
              <span>Antrean Hapus:</span>
              <span className="font-mono bg-amber-500/20 px-1.5 py-0.5 rounded text-[11px]">
                {queuedItemIds.length} item
              </span>
            </div>
            <button
              onClick={() => setIsCleanupModalOpen(true)}
              className="w-full py-1.5 px-2 bg-amber-500 hover:bg-amber-600 text-[#0B0E14] font-semibold text-xs rounded transition-colors"
            >
              Tinjau & Eksekusi Hapus
            </button>
          </div>
        )}
      </div>

      {/* Status Footer */}
      <div className="space-y-3">
        <div className="p-3 rounded-lg bg-[#0B0E14] border border-[#1F2937] text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[#9CA3AF]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Privilege:</span>
            </div>
            <span
              className={`font-mono text-[11px] font-semibold ${
                appInfo?.isAdmin ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {appInfo?.isAdmin ? 'Administrator' : 'Standard'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[#9CA3AF]">
              <Database className="w-3.5 h-3.5" />
              <span>Database:</span>
            </div>
            <span className="font-mono text-[11px] text-emerald-400">
              {dbStatus?.walMode ? 'SQLite WAL' : 'Connecting...'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[#9CA3AF]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Rules Seeded:</span>
            </div>
            <span className="font-mono text-[11px] text-blue-400">
              {dbStatus?.rulesSeeded ?? 15} rules
            </span>
          </div>
        </div>

        <div className="px-2 text-[11px] text-[#6B7280] flex justify-between font-mono">
          <span>v{appInfo?.version || '0.1.0'}</span>
          <span>{appInfo?.arch || 'x64'}</span>
        </div>
      </div>
    </aside>
  );
};
