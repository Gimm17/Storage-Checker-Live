// src/App.tsx
// Storage Checker Live - Main Application Shell & Views Router

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { OverviewDashboard } from './components/overview/OverviewDashboard';
import { DeepExplorer } from './components/explorer/DeepExplorer';
import { OrphanTempView } from './components/orphan/OrphanTempView';
import { RecapCenter } from './components/recap/RecapCenter';
import { CleanupQueueModal } from './components/cleanup/CleanupQueueModal';
import { useAppStore } from './store/useAppStore';
import type { AppInfoResponse, DbStatusResponse } from './types/ipc';

export default function App() {
  const { currentTab, setAppInfo, setDbStatus } = useAppStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function initApp() {
      try {
        const info = await invoke<AppInfoResponse>('get_app_info');
        setAppInfo(info);

        const db = await invoke<DbStatusResponse>('init_db_command');
        setDbStatus(db);
      } catch (err) {
        console.error('Initialization error:', err);
        setError(String(err));
      }
    }

    initApp();
  }, [setAppInfo, setDbStatus]);

  return (
    <div className="flex h-screen w-screen bg-[#0B0E14] text-[#F9FAFB] font-sans antialiased overflow-hidden select-none">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#0B0E14] p-6 space-y-6">
        <Header />

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-hidden flex flex-col">
          {currentTab === 'overview' && <OverviewDashboard />}
          {currentTab === 'explorer' && <DeepExplorer />}
          {currentTab === 'orphan' && <OrphanTempView />}
          {currentTab === 'recap' && <RecapCenter />}
        </div>
      </main>

      {/* Global Cleanup Confirmation Modal */}
      <CleanupQueueModal />
    </div>
  );
}
