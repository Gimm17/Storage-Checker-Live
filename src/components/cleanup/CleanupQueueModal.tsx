// src/components/cleanup/CleanupQueueModal.tsx
// Storage Checker Live - Safety Cleanup Confirmation Modal

import React, { useState } from 'react';
import {
  X,
  Trash2,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../../store/useAppStore';
import type { CleanupBatchResult } from '../../types/ipc';

export const CleanupQueueModal: React.FC = () => {
  const {
    isCleanupModalOpen,
    setIsCleanupModalOpen,
    queuedItemIds,
    items,
    clearQueue,
    setItems,
  } = useAppStore();

  const [mode, setMode] = useState<'RECYCLE_BIN' | 'PERMANENT'>('RECYCLE_BIN');
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<CleanupBatchResult | null>(null);

  if (!isCleanupModalOpen) return null;

  const queuedItems = items.filter((i) => queuedItemIds.includes(i.id));
  const safeCount = queuedItems.filter((i) => i.riskLevel === 'SAFE').length;
  const cautionCount = queuedItems.filter((i) => i.riskLevel === 'CAUTION').length;
  const dangerCount = queuedItems.filter((i) => i.riskLevel === 'DANGER').length;
  const totalBytes = queuedItems.reduce((acc, i) => acc + i.sizeBytes, 0);

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      const res = await invoke<CleanupBatchResult>('execute_cleanup', {
        args: {
          itemIds: queuedItemIds,
          mode,
        },
      });

      setResult(res);

      // Remove successful items from local state
      setItems(items.filter((i) => !res.successfulIds.includes(i.id)));
      clearQueue();
    } catch (err) {
      alert(`Cleanup failed: ${err}`);
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm select-none p-4">
      <div className="w-full max-w-lg bg-[#141923] border border-[#1F2937] rounded-2xl shadow-2xl overflow-hidden flex flex-col space-y-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#1F2937]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-rose-500/15 text-rose-400 border border-rose-500/30">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Konfirmasi Pembersihan Disk</h3>
              <p className="text-xs text-[#9CA3AF]">Tinjau item terpilih sebelum dieksekusi</p>
            </div>
          </div>
          <button
            onClick={() => {
              setIsCleanupModalOpen(false);
              setResult(null);
            }}
            className="text-[#9CA3AF] hover:text-white p-1 rounded-lg hover:bg-[#1E2533]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Execution Summary / Result */}
        {result ? (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5" />
              <span>Pembersihan Berhasil Dieksekusi!</span>
            </div>
            <p className="text-xs text-white">
              Total ruang yang berhasil dibebaskan:{' '}
              <span className="font-mono font-bold text-emerald-400">
                {formatSize(result.totalFreedBytes)}
              </span>
            </p>

            {result.skippedLockedIds.length > 0 && (
              <div className="p-2.5 rounded bg-[#0B0E14] text-xs text-amber-400 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Lock className="w-3.5 h-3.5" />
                  <span>{result.skippedLockedIds.length} item dilewati karena sedang terkunci proses:</span>
                </div>
                {result.skippedLockedIds.map((item, idx) => (
                  <p key={idx} className="font-mono text-[11px] text-[#9CA3AF]">
                    • Terkunci oleh {item.lockingProcess}
                  </p>
                ))}
              </div>
            )}

            <button
              onClick={() => {
                setIsCleanupModalOpen(false);
                setResult(null);
              }}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs"
            >
              Tutup & Selesai
            </button>
          </div>
        ) : (
          <>
            {/* Risk Breakdown Cards */}
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2.5 rounded-lg bg-[#0B0E14] border border-[#1F2937] space-y-0.5">
                <span className="text-[10px] text-emerald-400 font-bold">🟢 SAFE</span>
                <div className="font-mono font-bold text-white">{safeCount} item</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0B0E14] border border-[#1F2937] space-y-0.5">
                <span className="text-[10px] text-amber-400 font-bold">🟡 CAUTION</span>
                <div className="font-mono font-bold text-white">{cautionCount} item</div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0B0E14] border border-[#1F2937] space-y-0.5">
                <span className="text-[10px] text-rose-400 font-bold">🔴 DANGER</span>
                <div className="font-mono font-bold text-white">{dangerCount} item</div>
              </div>
            </div>

            {cautionCount > 0 && (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Terdapat {cautionCount} item bertaraf CAUTION (seperti folder dependencies/build).
                  Proyek akan memerlukan <code>npm install</code> atau <code>cargo build</code> ulang.
                </span>
              </div>
            )}

            {/* Mode Selector */}
            <div className="space-y-2">
              <span className="text-xs text-[#9CA3AF] font-semibold">Pilih Metode Penghapusan:</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('RECYCLE_BIN')}
                  className={`p-3 rounded-xl border text-left text-xs transition-all space-y-1 ${
                    mode === 'RECYCLE_BIN'
                      ? 'bg-blue-600/15 border-blue-500 text-white font-semibold'
                      : 'bg-[#0B0E14] border-[#1F2937] text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-blue-400 font-bold">
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Recycle Bin (Aman)</span>
                  </div>
                  <p className="text-[11px] text-[#9CA3AF]">
                    Dapat di-restore sewaktu-waktu dari Windows Recycle Bin.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setMode('PERMANENT')}
                  className={`p-3 rounded-xl border text-left text-xs transition-all space-y-1 ${
                    mode === 'PERMANENT'
                      ? 'bg-rose-600/15 border-rose-500 text-white font-semibold'
                      : 'bg-[#0B0E14] border-[#1F2937] text-[#9CA3AF] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-rose-400 font-bold">
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Permanent Delete</span>
                  </div>
                  <p className="text-[11px] text-[#9CA3AF]">
                    Dihapus permanen dari storage tanpa melewati Recycle Bin.
                  </p>
                </button>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="pt-2 flex items-center justify-between">
              <div className="text-xs">
                <span className="text-[#9CA3AF]">Estimasi Ruang Bebas:</span>{' '}
                <span className="font-mono font-bold text-emerald-400">{formatSize(totalBytes)}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCleanupModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#9CA3AF] hover:text-white hover:bg-[#1E2533]"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={isExecuting || queuedItemIds.length === 0}
                  onClick={handleExecute}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isExecuting ? 'Menghapus...' : `Eksekusi Hapus (${queuedItemIds.length})`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
