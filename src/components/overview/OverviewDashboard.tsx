// src/components/overview/OverviewDashboard.tsx
// Storage Checker Live - Real-time Drive Meters, Category Cards & Session Diff

import React from 'react';
import {
  HardDrive,
  Cpu,
  Package,
  FileQuestion,
  Layers,
  ArrowUpRight,
  Sparkles,
  Play,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../../store/useAppStore';
import type { StartDeepScanResult, ScanProgressPayload } from '../../types/ipc';

export const OverviewDashboard: React.FC = () => {
  const {
    items,
    isScanning,
    setIsScanning,
    scanProgress,
    setScanProgress,
    setCurrentSessionId,
    diffSummary,
    setCurrentTab,
    setSelectedCategory,
  } = useAppStore();

  const handleStartDeepScan = async () => {
    setIsScanning(true);
    try {
      const unlisten = await listen<ScanProgressPayload>('scan:progress', (event) => {
        setScanProgress(event.payload);
      });

      const res = await invoke<StartDeepScanResult>('start_deep_scan', {
        args: { targetPaths: [], includeSystemTemp: true },
      });

      setCurrentSessionId(res.sessionId);
      unlisten();
    } catch (err) {
      console.error('Deep scan failed:', err);
    } finally {
      setIsScanning(false);
    }
  };

  // Compute category sums from items
  const categoryStats = React.useMemo(() => {
    const stats: Record<string, { count: number; bytes: number }> = {
      AI_IDE: { count: 0, bytes: 0 },
      DEV_DEPS: { count: 0, bytes: 0 },
      ORPHAN_TEMP: { count: 0, bytes: 0 },
      VIRTUALIZATION: { count: 0, bytes: 0 },
    };

    for (const item of items) {
      if (stats[item.category]) {
        stats[item.category].count += 1;
        stats[item.category].bytes += item.sizeBytes;
      }
    }
    return stats;
  }, [items]);

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6 select-none">
      {/* Scanning Progress Bar Banner */}
      {isScanning && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-2.5 animate-pulse">
          <div className="flex items-center justify-between text-xs text-blue-400 font-semibold">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 animate-spin" />
              Memindai Storage (Multi-threaded Traversal)...
            </span>
            <span className="font-mono">
              {scanProgress?.scannedFiles.toLocaleString() || 0} file | {scanProgress?.foundItemsCount || 0} bloat item
            </span>
          </div>
          <div className="w-full bg-[#1F2937] h-2 rounded-full overflow-hidden">
            <div className="bg-blue-500 h-full w-2/3 rounded-full animate-progress" />
          </div>
          <p className="text-[11px] font-mono text-[#9CA3AF] truncate">
            {scanProgress?.currentPath || 'Memulai pemindaian...'}
          </p>
        </div>
      )}

      {/* Main Drive Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 rounded-xl bg-[#141923] border border-[#1F2937] space-y-3">
          <div className="flex items-center justify-between text-[#9CA3AF]">
            <span className="text-xs font-semibold tracking-wide uppercase">System Drive (C:)</span>
            <HardDrive className="w-4 h-4 text-blue-400" />
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold font-mono text-white">Drive C:</div>
            <p className="text-xs text-[#9CA3AF]">Pemantauan real-time lonjakan disk aktif</p>
          </div>
          <div className="pt-2">
            <button
              onClick={handleStartDeepScan}
              disabled={isScanning}
              className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 shadow"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              {isScanning ? 'Memindai...' : 'Mulai Deep Scan Lengkap'}
            </button>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#141923] border border-[#1F2937] space-y-3">
          <div className="flex items-center justify-between text-[#9CA3AF]">
            <span className="text-xs font-semibold tracking-wide uppercase">Total Bloat Terdeteksi</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold font-mono text-amber-400">
              {formatSize(
                Object.values(categoryStats).reduce((acc, c) => acc + c.bytes, 0)
              )}
            </div>
            <p className="text-xs text-[#9CA3AF]">
              {items.length} item membengkak teridentifikasi
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => setCurrentTab('explorer')}
              className="w-full py-2 px-3 bg-[#1F2937] hover:bg-[#283548] text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              Lihat di Deep Explorer
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="p-5 rounded-xl bg-[#141923] border border-[#1F2937] space-y-3">
          <div className="flex items-center justify-between text-[#9CA3AF]">
            <span className="text-xs font-semibold tracking-wide uppercase">Proteksi Sistem</span>
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="space-y-1">
            <div className="text-2xl font-bold font-mono text-emerald-400">Aman & Terkunci</div>
            <p className="text-xs text-[#9CA3AF]">
              Whitelist Win32 & Restart Manager lock guard aktif
            </p>
          </div>
          <div className="pt-2 text-xs text-[#6B7280]">
            Anti-hapus folder OS & verifikasi perubahan Git repo
          </div>
        </div>
      </div>

      {/* Coding Session Delta Highlight */}
      {diffSummary && (
        <div className="p-5 rounded-xl bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/30 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-blue-400 font-semibold text-sm">
              <Sparkles className="w-4 h-4" />
              <span>Hasil Komparasi Sesi Ngoding Terakhir</span>
            </div>
            <span className="text-xs font-mono text-[#9CA3AF]">
              Durasi: {Math.round(diffSummary.durationSeconds / 60)} menit
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-3 rounded-lg bg-[#0B0E14]/70 border border-[#1F2937] space-y-1">
              <span className="text-xs text-[#9CA3AF]">Total Pembengkakan Selama Sesi:</span>
              <div className="text-xl font-bold font-mono text-rose-400">
                +{formatSize(Math.max(0, diffSummary.totalDeltaBytes))}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-[#0B0E14]/70 border border-[#1F2937] space-y-1">
              <span className="text-xs text-[#9CA3AF]">Folder yang Mengembang:</span>
              <div className="text-xl font-bold font-mono text-white">
                {diffSummary.expandedFolders.length} folder
              </div>
            </div>
          </div>

          {diffSummary.expandedFolders.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs text-[#9CA3AF] font-medium">Top Folder yang Membengkak:</span>
              <div className="space-y-1.5 max-h-36 overflow-auto">
                {diffSummary.expandedFolders.slice(0, 5).map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs p-2 rounded bg-[#0B0E14] border border-[#1F2937]"
                  >
                    <span className="font-mono text-white truncate max-w-[70%]">{f.path}</span>
                    <span className="font-mono text-rose-400 font-semibold">
                      +{formatSize(f.deltaBytes)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4 Bloat Category Summary Cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-[#9CA3AF] uppercase tracking-wider">
          4 Kategori Utama Pembengkakan Disk
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. AI & IDE */}
          <div
            onClick={() => {
              setSelectedCategory('AI_IDE');
              setCurrentTab('explorer');
            }}
            className="p-4 rounded-xl bg-[#141923] hover:bg-[#1A212E] border border-[#1F2937] cursor-pointer transition-all space-y-3 group"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 group-hover:bg-purple-500/20">
                <Cpu className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono text-[#9CA3AF]">{categoryStats.AI_IDE.count} item</span>
            </div>
            <div>
              <div className="text-lg font-bold font-mono text-white">
                {formatSize(categoryStats.AI_IDE.bytes)}
              </div>
              <p className="text-xs text-[#9CA3AF]">AI Agent & IDE Logs</p>
            </div>
            <p className="text-[11px] text-[#6B7280]">
              .gemini brain, .cursor, .vscode cache, ollama
            </p>
          </div>

          {/* 2. Dev Dependencies */}
          <div
            onClick={() => {
              setSelectedCategory('DEV_DEPS');
              setCurrentTab('explorer');
            }}
            className="p-4 rounded-xl bg-[#141923] hover:bg-[#1A212E] border border-[#1F2937] cursor-pointer transition-all space-y-3 group"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 group-hover:bg-blue-500/20">
                <Package className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono text-[#9CA3AF]">{categoryStats.DEV_DEPS.count} item</span>
            </div>
            <div>
              <div className="text-lg font-bold font-mono text-white">
                {formatSize(categoryStats.DEV_DEPS.bytes)}
              </div>
              <p className="text-xs text-[#9CA3AF]">Dependencies & Builds</p>
            </div>
            <p className="text-[11px] text-[#6B7280]">
              node_modules, target, venv, .pnpm-store
            </p>
          </div>

          {/* 3. Orphaned Temp */}
          <div
            onClick={() => setCurrentTab('orphan')}
            className="p-4 rounded-xl bg-[#141923] hover:bg-[#1A212E] border border-[#1F2937] cursor-pointer transition-all space-y-3 group"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:bg-amber-500/20">
                <FileQuestion className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono text-[#9CA3AF]">{categoryStats.ORPHAN_TEMP.count} item</span>
            </div>
            <div>
              <div className="text-lg font-bold font-mono text-white">
                {formatSize(categoryStats.ORPHAN_TEMP.bytes)}
              </div>
              <p className="text-xs text-[#9CA3AF]">Orphaned Temp Files</p>
            </div>
            <p className="text-[11px] text-[#6B7280]">
              .tmp, .bak, .dmp di luar folder Temp
            </p>
          </div>

          {/* 4. Virtualization */}
          <div
            onClick={() => {
              setSelectedCategory('VIRTUALIZATION');
              setCurrentTab('explorer');
            }}
            className="p-4 rounded-xl bg-[#141923] hover:bg-[#1A212E] border border-[#1F2937] cursor-pointer transition-all space-y-3 group"
          >
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 group-hover:bg-rose-500/20">
                <Layers className="w-4 h-4" />
              </div>
              <span className="text-xs font-mono text-[#9CA3AF]">{categoryStats.VIRTUALIZATION.count} item</span>
            </div>
            <div>
              <div className="text-lg font-bold font-mono text-white">
                {formatSize(categoryStats.VIRTUALIZATION.bytes)}
              </div>
              <p className="text-xs text-[#9CA3AF]">VHDX & Emulators</p>
            </div>
            <p className="text-[11px] text-[#6B7280]">
              Docker WSL2 ext4.vhdx, Android AVD
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
