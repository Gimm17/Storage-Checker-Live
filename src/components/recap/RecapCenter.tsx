// src/components/recap/RecapCenter.tsx
// Storage Checker Live - Historical Recap Analytics & Multi-Format Report Exporter

import React, { useEffect } from 'react';
import {
  Download,
  Trophy,
  FileText,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../store/useAppStore';
import type { RecapAnalytics, ExportReportResult } from '../../types/ipc';

export const RecapCenter: React.FC = () => {
  const { recapRange, setRecapRange, recapAnalytics, setRecapAnalytics } = useAppStore();

  const loadRecap = async (range: string) => {
    try {
      const res = await invoke<RecapAnalytics>('get_recap_summary', {
        args: { range, sessionId: null },
      });
      setRecapAnalytics(res);
    } catch (err) {
      console.error('Failed to load recap:', err);
    }
  };

  useEffect(() => {
    loadRecap(recapRange);
  }, [recapRange]);

  const handleExport = async (format: 'MD' | 'JSON' | 'CSV') => {
    try {
      const defaultName = `StorageChecker_Recap_${recapRange}_${new Date().toISOString().slice(0, 10)}.${format.toLowerCase()}`;
      const savePath = defaultName;

      const res = await invoke<ExportReportResult>('export_recap_report', {
        args: { range: recapRange, format, savePath },
      });

      alert(`Laporan berhasil diekspor ke: ${res.filePath}`);
    } catch (err) {
      alert(`Export failed: ${err}`);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 flex flex-col space-y-6 overflow-auto select-none">
      {/* Range Filter & Export Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-[#141923] border border-[#1F2937]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#9CA3AF]">Rentang Waktu:</span>
          <div className="flex bg-[#0B0E14] p-1 rounded-lg border border-[#1F2937]">
            {(['TODAY', 'WEEK', 'ALL'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRecapRange(r)}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                  recapRange === r
                    ? 'bg-blue-600 text-white'
                    : 'text-[#9CA3AF] hover:text-white'
                }`}
              >
                {r === 'TODAY' ? 'Hari Ini' : r === 'WEEK' ? 'Minggu Ini' : 'Semua Riwayat'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleExport('MD')}
            className="py-1.5 px-3 bg-[#1F2937] hover:bg-[#283548] text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5 text-blue-400" />
            Export Markdown (.md)
          </button>
          <button
            onClick={() => handleExport('JSON')}
            className="py-1.5 px-3 bg-[#1F2937] hover:bg-[#283548] text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            Export JSON
          </button>
          <button
            onClick={() => handleExport('CSV')}
            className="py-1.5 px-3 bg-[#1F2937] hover:bg-[#283548] text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-purple-400" />
            Export CSV
          </button>
        </div>
      </div>

      {/* 4 Metric Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#141923] border border-[#1F2937] space-y-2">
          <span className="text-xs text-[#9CA3AF] font-semibold uppercase">Total Bloat Terdeteksi</span>
          <div className="text-2xl font-bold font-mono text-white">
            {formatSize(recapAnalytics?.totalBloatDetectedBytes || 0)}
          </div>
          <p className="text-[11px] text-[#6B7280]">Akumulasi ukuran seluruh temuan</p>
        </div>

        <div className="p-4 rounded-xl bg-[#141923] border border-[#1F2937] space-y-2">
          <span className="text-xs text-[#9CA3AF] font-semibold uppercase">Total Ruang Diselamatkan</span>
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {formatSize(recapAnalytics?.totalFreedBytes || 0)}
          </div>
          <p className="text-[11px] text-[#6B7280]">Berhasil dibersihkan / di-compact</p>
        </div>

        <div className="p-4 rounded-xl bg-[#141923] border border-[#1F2937] space-y-2">
          <span className="text-xs text-[#9CA3AF] font-semibold uppercase">Potensi Penghematan Sisa</span>
          <div className="text-2xl font-bold font-mono text-amber-400">
            {formatSize(recapAnalytics?.potentialSavingsBytes || 0)}
          </div>
          <p className="text-[11px] text-[#6B7280]">Item aman yang belum dibersihkan</p>
        </div>

        <div className="p-4 rounded-xl bg-[#141923] border border-[#1F2937] space-y-2">
          <span className="text-xs text-[#9CA3AF] font-semibold uppercase">Storage Spike Alerts</span>
          <div className="text-2xl font-bold font-mono text-purple-400">
            {recapAnalytics?.spikeCount || 0}
          </div>
          <p className="text-[11px] text-[#6B7280]">Lonjakan disk &gt; 500 MB terpantau</p>
        </div>
      </div>

      {/* Top 5 Bloat Culprits Table */}
      <div className="bg-[#141923] border border-[#1F2937] rounded-xl overflow-hidden space-y-3 p-4">
        <div className="flex items-center gap-2 text-white font-bold text-sm">
          <Trophy className="w-4 h-4 text-amber-400" />
          <span>Top 5 Biang Kerok Pembengkakan Disk</span>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[#1F2937] text-[#9CA3AF]">
                <th className="py-2 px-3">#</th>
                <th className="py-2 px-3">Nama / File</th>
                <th className="py-2 px-3">Kategori</th>
                <th className="py-2 px-3 text-right">Ukuran</th>
                <th className="py-2 px-3">Path Lengkap</th>
              </tr>
            </thead>
            <tbody>
              {recapAnalytics?.top5Culprits && recapAnalytics.top5Culprits.length > 0 ? (
                recapAnalytics.top5Culprits.map((item, idx) => (
                  <tr key={idx} className="border-b border-[#1F2937]/50 hover:bg-[#1A212E]">
                    <td className="py-2.5 px-3 font-mono text-amber-400 font-bold">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-semibold text-white">{item.name}</td>
                    <td className="py-2.5 px-3 text-[#9CA3AF]">{item.category}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-white">
                      {formatSize(item.sizeBytes)}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#6B7280] truncate max-w-xs" title={item.path}>
                      {item.path}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[#6B7280]">
                    Belum ada data biang kerok disk. Lakukan pemindaian terlebih dahulu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
