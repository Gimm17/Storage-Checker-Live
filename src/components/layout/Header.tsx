// src/components/layout/Header.tsx
// Storage Checker Live - Header Bar with Actions & Status Badges

import React from 'react';
import { ShieldCheck, Play, Square } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../store/useAppStore';
import type { StartCodingSessionResult, SessionDiffSummary } from '../../types/ipc';

export const Header: React.FC = () => {
  const {
    currentTab,
    isSessionActive,
    setIsSessionActive,
    activeSessionId,
    setActiveSessionId,
    setBaselineBytes,
    setDiffSummary,
    setCurrentTab,
  } = useAppStore();

  const handleToggleSession = async () => {
    if (!isSessionActive) {
      try {
        const res = await invoke<StartCodingSessionResult>('start_coding_session', {
          args: { watchPaths: [] },
        });
        setActiveSessionId(res.sessionId);
        setBaselineBytes(res.baselineBytes);
        setIsSessionActive(true);
      } catch (err) {
        console.error('Failed to start coding session:', err);
      }
    } else if (activeSessionId) {
      try {
        const diff = await invoke<SessionDiffSummary>('compare_coding_session', {
          args: { sessionId: activeSessionId },
        });
        setDiffSummary(diff);
        setIsSessionActive(false);
        setActiveSessionId(null);
        setCurrentTab('overview');
      } catch (err) {
        console.error('Failed to stop/compare coding session:', err);
      }
    }
  };

  const getTabTitle = () => {
    switch (currentTab) {
      case 'overview':
        return { title: 'Live Overview & Session Diff', desc: 'Real-time disk usage, bloat detection, and live session delta' };
      case 'explorer':
        return { title: 'Deep Explorer & Bloat Inspector', desc: 'Scan and inspect developer dependencies, AI caches, and VHDX' };
      case 'orphan':
        return { title: 'Orphaned Temp Hunter', desc: 'Detect .tmp, .bak, and .dmp files scattered outside standard Temp' };
      case 'recap':
        return { title: 'Recap & Savings Center', desc: 'Historical storage savings, Top 5 bloat culprits, and export reports' };
    }
  };

  const info = getTabTitle();

  return (
    <header className="flex items-center justify-between pb-4 border-b border-[#1F2937] select-none shrink-0">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-white">{info.title}</h2>
        <p className="text-xs text-[#9CA3AF] mt-0.5">{info.desc}</p>
      </div>

      <div className="flex items-center gap-3">
        {/* Coding Session Toggle Button */}
        <button
          onClick={handleToggleSession}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shadow-sm ${
            isSessionActive
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30 animate-pulse'
              : 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30'
          }`}
        >
          {isSessionActive ? (
            <>
              <Square className="w-3.5 h-3.5 fill-rose-400" />
              Sesi Ngoding Aktif — Stop & Hitung Delta
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-emerald-400" />
              Mulai Sesi Ngoding
            </>
          )}
        </button>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            Always Elevated
          </span>
        </div>
      </div>
    </header>
  );
};
