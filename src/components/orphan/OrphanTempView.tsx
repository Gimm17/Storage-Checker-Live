// src/components/orphan/OrphanTempView.tsx
// Storage Checker Live - Dedicated Orphaned Temp & Scatter Hunter View

import React from 'react';
import {
  FileQuestion,
  Trash2,
  FolderOpen,
  AlertCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

export const OrphanTempView: React.FC = () => {
  const { items, queuedItemIds, toggleQueueItem, setIsCleanupModalOpen } = useAppStore();

  const orphanItems = React.useMemo(() => {
    return items.filter(
      (item) => item.category === 'ORPHAN_TEMP' || item.isOutsideStandardTemp
    );
  }, [items]);

  const outsideTempItems = React.useMemo(() => {
    return orphanItems.filter((i) => i.isOutsideStandardTemp);
  }, [orphanItems]);

  const insideTempItems = React.useMemo(() => {
    return orphanItems.filter((i) => !i.isOutsideStandardTemp);
  }, [orphanItems]);

  const totalBytes = orphanItems.reduce((acc, i) => acc + i.sizeBytes, 0);

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleQueueAllOrphans = () => {
    for (const item of orphanItems) {
      if (!queuedItemIds.includes(item.id)) {
        toggleQueueItem(item.id);
      }
    }
    setIsCleanupModalOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col space-y-5 overflow-auto select-none">
      {/* Overview Banner */}
      <div className="p-5 rounded-xl bg-gradient-to-r from-amber-950/20 to-orange-950/20 border border-amber-500/30 flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
            <FileQuestion className="w-5 h-5" />
            <span>Radar File Temp Tercecer (Orphaned Temp)</span>
          </div>
          <p className="text-xs text-[#9CA3AF]">
            Menemukan file .tmp, .temp, .bak, .old, dan crash dump yang tertinggal di luar folder Temp standar.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
            <span className="text-xs text-[#9CA3AF]">Total Sampah Tercecer:</span>
            <div className="text-xl font-bold font-mono text-amber-400">{formatSize(totalBytes)}</div>
          </div>
          <button
            onClick={handleQueueAllOrphans}
            disabled={orphanItems.length === 0}
            className="py-2 px-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-[#0B0E14] font-bold text-xs rounded-lg transition-colors flex items-center gap-2 shadow"
          >
            <Trash2 className="w-4 h-4" />
            Bersihkan Semua ke Recycle Bin
          </button>
        </div>
      </div>

      {/* 2 Column Grouped Display */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 flex-1 overflow-hidden">
        {/* Left: Scattered Outside Standard Temp */}
        <div className="flex flex-col bg-[#141923] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="p-3 bg-[#0B0E14] border-b border-[#1F2937] flex items-center justify-between">
            <div className="flex items-center gap-2 text-rose-400 font-semibold text-xs">
              <AlertCircle className="w-4 h-4" />
              <span>Tercecer di Luar Folder Temp ({outsideTempItems.length})</span>
            </div>
            <span className="text-xs font-mono text-[#9CA3AF]">
              {formatSize(outsideTempItems.reduce((acc, i) => acc + i.sizeBytes, 0))}
            </span>
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-2">
            {outsideTempItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center text-[#6B7280] text-xs">
                Tidak ada file .tmp yatim piatu di luar folder Temp.
              </div>
            ) : (
              outsideTempItems.map((item) => {
                const isQueued = queuedItemIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-lg bg-[#0B0E14] border border-[#1F2937] flex items-center justify-between gap-3 text-xs hover:border-[#374151] transition-colors"
                  >
                    <div className="truncate flex-1">
                      <p className="font-mono text-white truncate text-[11px]">{item.fullPath}</p>
                      <span className="text-[10px] text-amber-400">File sementara tak bertuan</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-white font-semibold">
                        {formatSize(item.sizeBytes)}
                      </span>
                      <input
                        type="checkbox"
                        checked={isQueued}
                        onChange={() => toggleQueueItem(item.id)}
                        className="rounded bg-[#0B0E14] border-[#1F2937] text-amber-500 focus:ring-0 cursor-pointer"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Standard System Temp */}
        <div className="flex flex-col bg-[#141923] border border-[#1F2937] rounded-xl overflow-hidden">
          <div className="p-3 bg-[#0B0E14] border-b border-[#1F2937] flex items-center justify-between">
            <div className="flex items-center gap-2 text-blue-400 font-semibold text-xs">
              <FolderOpen className="w-4 h-4" />
              <span>Di Dalam Folder Temp Standar ({insideTempItems.length})</span>
            </div>
            <span className="text-xs font-mono text-[#9CA3AF]">
              {formatSize(insideTempItems.reduce((acc, i) => acc + i.sizeBytes, 0))}
            </span>
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-2">
            {insideTempItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center text-[#6B7280] text-xs">
                Folder Temp standar bersih.
              </div>
            ) : (
              insideTempItems.map((item) => {
                const isQueued = queuedItemIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-lg bg-[#0B0E14] border border-[#1F2937] flex items-center justify-between gap-3 text-xs hover:border-[#374151] transition-colors"
                  >
                    <div className="truncate flex-1">
                      <p className="font-mono text-white truncate text-[11px]">{item.fullPath}</p>
                      <span className="text-[10px] text-[#6B7280]">Temp Windows / AppData</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono text-white font-semibold">
                        {formatSize(item.sizeBytes)}
                      </span>
                      <input
                        type="checkbox"
                        checked={isQueued}
                        onChange={() => toggleQueueItem(item.id)}
                        className="rounded bg-[#0B0E14] border-[#1F2937] text-blue-500 focus:ring-0 cursor-pointer"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
