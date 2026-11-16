// src/store/useAppStore.ts
// Storage Checker Live - Unified Application State Management

import { create } from 'zustand';
import type {
  AppInfoResponse,
  DbStatusResponse,
  ItemInspectionDetail,
  RecapAnalytics,
  ScanProgressPayload,
  SessionDiffSummary,
} from '../types/ipc';

export type NavTab = 'overview' | 'explorer' | 'orphan' | 'recap';

export interface BloatItemUI {
  id: string;
  fullPath: string;
  itemType: string;
  category: string;
  riskLevel: 'SAFE' | 'CAUTION' | 'DANGER';
  sizeBytes: number;
  sizeOnDiskBytes: number;
  isOutsideStandardTemp: boolean;
  status: string;
  lastModifiedAt: string;
}

interface AppStoreState {
  // Navigation & System Status
  currentTab: NavTab;
  setCurrentTab: (tab: NavTab) => void;
  appInfo: AppInfoResponse | null;
  setAppInfo: (info: AppInfoResponse | null) => void;
  dbStatus: DbStatusResponse | null;
  setDbStatus: (status: DbStatusResponse | null) => void;

  // Scanning State
  isScanning: boolean;
  setIsScanning: (scanning: boolean) => void;
  scanProgress: ScanProgressPayload | null;
  setScanProgress: (progress: ScanProgressPayload | null) => void;
  currentSessionId: string | null;
  setCurrentSessionId: (id: string | null) => void;

  // Detected Items & Filtering
  items: BloatItemUI[];
  setItems: (items: BloatItemUI[]) => void;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  selectedRisk: string;
  setSelectedRisk: (risk: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Split-Pane Inspector
  selectedItemId: string | null;
  selectedItemDetail: ItemInspectionDetail | null;
  setSelectedItemId: (id: string | null) => void;
  setSelectedItemDetail: (detail: ItemInspectionDetail | null) => void;
  isInspectorLoading: boolean;
  setIsInspectorLoading: (loading: boolean) => void;

  // Coding Session Diff State
  isSessionActive: boolean;
  setIsSessionActive: (active: boolean) => void;
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  baselineBytes: number;
  setBaselineBytes: (bytes: number) => void;
  diffSummary: SessionDiffSummary | null;
  setDiffSummary: (diff: SessionDiffSummary | null) => void;

  // Cleanup Queue Modal
  isCleanupModalOpen: boolean;
  setIsCleanupModalOpen: (open: boolean) => void;
  queuedItemIds: string[];
  setQueuedItemIds: (ids: string[]) => void;
  toggleQueueItem: (id: string) => void;
  clearQueue: () => void;
  selectAllSafe: () => void;

  // Recap Analytics
  recapRange: string;
  setRecapRange: (range: string) => void;
  recapAnalytics: RecapAnalytics | null;
  setRecapAnalytics: (analytics: RecapAnalytics | null) => void;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  currentTab: 'overview',
  setCurrentTab: (tab) => set({ currentTab: tab }),
  appInfo: null,
  setAppInfo: (info) => set({ appInfo: info }),
  dbStatus: null,
  setDbStatus: (status) => set({ dbStatus: status }),

  isScanning: false,
  setIsScanning: (scanning) => set({ isScanning: scanning }),
  scanProgress: null,
  setScanProgress: (progress) => set({ scanProgress: progress }),
  currentSessionId: null,
  setCurrentSessionId: (id) => set({ currentSessionId: id }),

  items: [],
  setItems: (items) => set({ items }),
  selectedCategory: 'ALL',
  setSelectedCategory: (cat) => set({ selectedCategory: cat }),
  selectedRisk: 'ALL',
  setSelectedRisk: (risk) => set({ selectedRisk: risk }),
  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  selectedItemId: null,
  selectedItemDetail: null,
  setSelectedItemId: (id) => set({ selectedItemId: id }),
  setSelectedItemDetail: (detail) => set({ selectedItemDetail: detail }),
  isInspectorLoading: false,
  setIsInspectorLoading: (loading) => set({ isInspectorLoading: loading }),

  isSessionActive: false,
  setIsSessionActive: (active) => set({ isSessionActive: active }),
  activeSessionId: null,
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  baselineBytes: 0,
  setBaselineBytes: (bytes) => set({ baselineBytes: bytes }),
  diffSummary: null,
  setDiffSummary: (diff) => set({ diffSummary: diff }),

  isCleanupModalOpen: false,
  setIsCleanupModalOpen: (open) => set({ isCleanupModalOpen: open }),
  queuedItemIds: [],
  setQueuedItemIds: (ids) => set({ queuedItemIds: ids }),
  toggleQueueItem: (id) => {
    const queue = get().queuedItemIds;
    if (queue.includes(id)) {
      set({ queuedItemIds: queue.filter((i) => i !== id) });
    } else {
      set({ queuedItemIds: [...queue, id] });
    }
  },
  clearQueue: () => set({ queuedItemIds: [] }),
  selectAllSafe: () => {
    const safeIds = get()
      .items.filter((item) => item.riskLevel === 'SAFE')
      .map((item) => item.id);
    set({ queuedItemIds: safeIds });
  },

  recapRange: 'TODAY',
  setRecapRange: (range) => set({ recapRange: range }),
  recapAnalytics: null,
  setRecapAnalytics: (analytics) => set({ recapAnalytics: analytics }),
}));
