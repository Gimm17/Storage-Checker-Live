// src/components/explorer/DeepExplorer.tsx
// Storage Checker Live - High Performance Virtualized Explorer & Split-Pane Inspector

import React, { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Search,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Folder,
  File,
  Lock,
  GitBranch,
  Trash2,
  Zap,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore, BloatItemUI } from '../../store/useAppStore';
import type { ItemInspectionDetail, SpecialActionResult } from '../../types/ipc';

export const DeepExplorer: React.FC = () => {
  const {
    items,
    selectedCategory,
    setSelectedCategory,
    selectedRisk,
    setSelectedRisk,
    searchQuery,
    setSearchQuery,
    selectedItemId,
    setSelectedItemId,
    selectedItemDetail,
    setSelectedItemDetail,
    isInspectorLoading,
    setIsInspectorLoading,
    queuedItemIds,
    toggleQueueItem,
    selectAllSafe,
  } = useAppStore();

  const parentRef = useRef<HTMLDivElement>(null);

  // Filter items based on active criteria
  const filteredItems = React.useMemo(() => {
    return items.filter((item) => {
      if (selectedCategory !== 'ALL' && item.category !== selectedCategory) return false;
      if (selectedRisk !== 'ALL' && item.riskLevel !== selectedRisk) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return item.fullPath.toLowerCase().includes(q);
      }
      return true;
    });
  }, [items, selectedCategory, selectedRisk, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  const handleSelectItem = async (item: BloatItemUI) => {
    setSelectedItemId(item.id);
    setIsInspectorLoading(true);
    try {
      const detail = await invoke<ItemInspectionDetail>('get_item_inspection', {
        args: { itemId: item.id },
      });
      setSelectedItemDetail(detail);
    } catch (err) {
      console.error('Failed to inspect item:', err);
    } finally {
      setIsInspectorLoading(false);
    }
  };

  const handleRunSpecialAction = async (action: string) => {
    if (!selectedItemId) return;
    try {
      const res = await invoke<SpecialActionResult>('run_special_action', {
        args: { itemId: selectedItemId, action },
      });
      alert(res.message);
    } catch (err) {
      alert(`Action failed: ${err}`);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getRiskBadge = (level: string) => {
    switch (level) {
      case 'SAFE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <ShieldCheck className="w-3 h-3" />
            SAFE
          </span>
        );
      case 'CAUTION':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3" />
            CAUTION
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <ShieldAlert className="w-3 h-3" />
            DANGER
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col space-y-4 overflow-hidden select-none">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-[#141923] border border-[#1F2937]">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#9CA3AF]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari path file atau direktori..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#0B0E14] border border-[#1F2937] rounded-lg text-white placeholder-[#6B7280] focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#0B0E14] border border-[#1F2937] rounded-lg text-white focus:outline-none"
          >
            <option value="ALL">Semua Kategori</option>
            <option value="AI_IDE">AI & IDE Logs</option>
            <option value="DEV_DEPS">Dependencies & Builds</option>
            <option value="ORPHAN_TEMP">Orphaned Temp</option>
            <option value="VIRTUALIZATION">Virtualization (VHDX)</option>
          </select>

          {/* Risk Level Dropdown */}
          <select
            value={selectedRisk}
            onChange={(e) => setSelectedRisk(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#0B0E14] border border-[#1F2937] rounded-lg text-white focus:outline-none"
          >
            <option value="ALL">Semua Risiko</option>
            <option value="SAFE">SAFE (Aman Dihapus)</option>
            <option value="CAUTION">CAUTION (Perlu Rebuild)</option>
            <option value="DANGER">DANGER (Bahaya/Terkunci)</option>
          </select>
        </div>

        <button
          onClick={selectAllSafe}
          className="py-1.5 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Centang Semua SAFE
        </button>
      </div>

      {/* Main Split-Pane Explorer */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Left Side: Virtualized Table */}
        <div className="flex-1 flex flex-col bg-[#141923] border border-[#1F2937] rounded-xl overflow-hidden">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 p-3 border-b border-[#1F2937] text-xs font-semibold text-[#9CA3AF] bg-[#0B0E14]">
            <div className="col-span-1 text-center">Pilih</div>
            <div className="col-span-6">Path Item</div>
            <div className="col-span-2">Kategori</div>
            <div className="col-span-1">Risiko</div>
            <div className="col-span-2 text-right">Ukuran</div>
          </div>

          {/* Table Body */}
          <div ref={parentRef} className="flex-1 overflow-auto">
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-8 text-center text-[#9CA3AF] space-y-2">
                <Folder className="w-8 h-8 text-[#6B7280]" />
                <p className="text-sm">Belum ada item bloat yang ditemukan.</p>
                <p className="text-xs text-[#6B7280]">
                  Gunakan tombol "Mulai Deep Scan" di Live Overview untuk memindai folder.
                </p>
              </div>
            ) : (
              <div
                style={{
                  height: `${rowVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const item = filteredItems[virtualRow.index];
                  const isSelected = selectedItemId === item.id;
                  const isQueued = queuedItemIds.includes(item.id);

                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className={`grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center border-b border-[#1F2937]/50 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-600/15 border-l-2 border-l-blue-500'
                          : 'hover:bg-[#1A212E]'
                      }`}
                    >
                      {/* Checkbox */}
                      <div className="col-span-1 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isQueued}
                          onChange={() => toggleQueueItem(item.id)}
                          className="rounded bg-[#0B0E14] border-[#1F2937] text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </div>

                      {/* Path */}
                      <div className="col-span-6 flex items-center gap-2 truncate">
                        {item.itemType === 'DIRECTORY' ? (
                          <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        ) : (
                          <File className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                        )}
                        <span className="font-mono text-white truncate" title={item.fullPath}>
                          {item.fullPath}
                        </span>
                      </div>

                      {/* Category */}
                      <div className="col-span-2 text-[#9CA3AF] truncate">{item.category}</div>

                      {/* Risk Badge */}
                      <div className="col-span-1">{getRiskBadge(item.riskLevel)}</div>

                      {/* Size */}
                      <div className="col-span-2 text-right font-mono font-semibold text-white">
                        {formatSize(item.sizeBytes)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Inspector Side Panel */}
        <div className="w-80 bg-[#141923] border border-[#1F2937] rounded-xl flex flex-col p-4 space-y-4 overflow-auto shrink-0">
          <div className="flex items-center justify-between pb-3 border-b border-[#1F2937]">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Inspector Panel
            </h4>
            {selectedItemDetail && getRiskBadge(selectedItemDetail.riskLevel)}
          </div>

          {isInspectorLoading ? (
            <div className="flex-1 flex items-center justify-center text-xs text-[#9CA3AF]">
              Memeriksa file lock & status Git...
            </div>
          ) : selectedItemDetail ? (
            <div className="space-y-4 text-xs">
              {/* Path & Open in Explorer */}
              <div className="space-y-1">
                <span className="text-[#9CA3AF] text-[11px] font-semibold">Path Lengkap:</span>
                <p className="font-mono text-[11px] text-white break-all p-2 rounded bg-[#0B0E14] border border-[#1F2937]">
                  {selectedItemDetail.fullPath}
                </p>
                <button
                  onClick={() => handleRunSpecialAction('OPEN_EXPLORER')}
                  className="w-full mt-1 py-1 px-2 bg-[#1F2937] hover:bg-[#283548] text-white rounded text-[11px] font-medium flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3 h-3" />
                  Buka di Windows Explorer
                </button>
              </div>

              {/* Sizes */}
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded bg-[#0B0E14] border border-[#1F2937] space-y-0.5">
                  <span className="text-[10px] text-[#9CA3AF]">Ukuran Nyata:</span>
                  <div className="font-mono font-bold text-white">
                    {formatSize(selectedItemDetail.sizeBytes)}
                  </div>
                </div>
                <div className="p-2 rounded bg-[#0B0E14] border border-[#1F2937] space-y-0.5">
                  <span className="text-[10px] text-[#9CA3AF]">Size on Disk:</span>
                  <div className="font-mono font-bold text-white">
                    {formatSize(selectedItemDetail.sizeOnDiskBytes)}
                  </div>
                </div>
              </div>

              {/* Process Lock Status */}
              <div className="p-2.5 rounded bg-[#0B0E14] border border-[#1F2937] space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                  <Lock
                    className={`w-3.5 h-3.5 ${
                      selectedItemDetail.isLocked ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  />
                  <span>Process Lock:</span>
                </div>
                <p className="text-[11px] text-[#9CA3AF]">
                  {selectedItemDetail.isLocked
                    ? `Terkunci oleh ${selectedItemDetail.lockingProcess || 'proses aktif'}`
                    : 'Tidak ada proses yang mengunci file ini.'}
                </p>
              </div>

              {/* Git Status */}
              <div className="p-2.5 rounded bg-[#0B0E14] border border-[#1F2937] space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                  <GitBranch
                    className={`w-3.5 h-3.5 ${
                      selectedItemDetail.isGitDirty ? 'text-amber-400' : 'text-emerald-400'
                    }`}
                  />
                  <span>Status Git Repo:</span>
                </div>
                <p className="text-[11px] text-[#9CA3AF]">
                  {selectedItemDetail.isGitDirty
                    ? 'Ada perubahan source code yang belum di-commit!'
                    : 'Working tree bersih.'}
                </p>
              </div>

              {/* Why & Impact Box */}
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 space-y-2">
                <div className="space-y-1">
                  <span className="text-blue-400 font-semibold text-[11px]">Kenapa Ini Muncul?</span>
                  <p className="text-[#9CA3AF] text-[11px] leading-relaxed">
                    {selectedItemDetail.originExplanation}
                  </p>
                </div>
                <div className="space-y-1 pt-1 border-t border-blue-500/20">
                  <span className="text-blue-400 font-semibold text-[11px]">Efek Jika Dihapus:</span>
                  <p className="text-[#9CA3AF] text-[11px] leading-relaxed">
                    {selectedItemDetail.deletionImpact}
                  </p>
                </div>
              </div>

              {/* Rebuild Suggestion */}
              {selectedItemDetail.rebuildSuggestion && (
                <div className="p-2.5 rounded bg-[#0B0E14] border border-[#1F2937] space-y-1">
                  <span className="text-amber-400 font-semibold text-[10px]">Saran Pemulihan:</span>
                  <p className="font-mono text-[10px] text-white">
                    {selectedItemDetail.rebuildSuggestion}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-2 pt-2">
                {selectedItemDetail.specialAction === 'COMPACT_VHDX' && (
                  <button
                    onClick={() => handleRunSpecialAction('COMPACT_VHDX')}
                    className="w-full py-2 px-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Jalankan Safe Compact VHDX
                  </button>
                )}

                {selectedItemDetail.specialAction === 'GIT_GC' && (
                  <button
                    onClick={() => handleRunSpecialAction('GIT_GC')}
                    className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 shadow"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Jalankan Git GC Prune
                  </button>
                )}

                <button
                  onClick={() => toggleQueueItem(selectedItemDetail.id)}
                  className={`w-full py-2 px-3 font-semibold rounded-lg text-xs flex items-center justify-center gap-1.5 transition-colors ${
                    queuedItemIds.includes(selectedItemDetail.id)
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {queuedItemIds.includes(selectedItemDetail.id)
                    ? 'Hapus dari Antrean'
                    : 'Tambahkan ke Antrean Hapus'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-[#9CA3AF] p-4 space-y-2">
              <Folder className="w-6 h-6 text-[#6B7280]" />
              <p className="text-xs">Klik salah satu item di tabel untuk melihat analisis risiko detail.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
