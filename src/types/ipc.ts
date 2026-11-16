/**
 * Storage Checker Live - Shared Tauri IPC TypeScript Type Definitions
 * Generated to match PRD § 8.2, § 7.1, § 7.2, and native system contracts.
 */

// ============================================================================
// 1. Primitive Unions & Enums
// ============================================================================

export type RiskLevel = 'SAFE' | 'CAUTION' | 'DANGER';

export type BloatCategory =
  | 'AI_IDE'
  | 'DEV_DEPS'
  | 'ORPHAN_TEMP'
  | 'VIRTUALIZATION'
  | 'OTHER';

export type ItemType = 'FILE' | 'DIRECTORY';

export type ItemStatus =
  | 'DETECTED'
  | 'ANALYZED_SAFE'
  | 'ANALYZED_CAUTION'
  | 'ANALYZED_DANGER'
  | 'QUEUED_FOR_CLEANUP'
  | 'SKIPPED_LOCKED'
  | 'MOVED_TO_TRASH'
  | 'PERMANENTLY_DELETED'
  | 'OPTIMIZED'
  | 'RECAPPED';

export type SessionType = 'DEEP_SCAN' | 'CODING_SESSION' | 'BACKGROUND_WATCH';

export type SessionStatus = 'RUNNING' | 'COMPLETED' | 'CANCELLED';

export type CleanupMode = 'RECYCLE_BIN' | 'PERMANENT';

export type SpecialActionType = 'COMPACT_VHDX' | 'GIT_GC' | 'OPEN_EXPLORER';

export type RecapRange = 'SESSION' | 'TODAY' | 'WEEK' | 'ALL';

export type ExportFormat = 'MD' | 'JSON' | 'CSV';

// ============================================================================
// 2. Database Record Models (SQLite 6 Tables)
// ============================================================================

export interface ScanSessionRecord {
  id: string; // UUID v4
  sessionType: SessionType;
  status: SessionStatus;
  baselineUsedBytes: number;
  peakUsedBytes: number;
  endedUsedBytes: number;
  totalFreedBytes: number;
  startedAt: string; // ISO-8601 UTC
  endedAt: string | null; // ISO-8601 UTC
}

export interface DiskSnapshotRecord {
  id: string; // UUID v4
  sessionId: string;
  phase: 'BEFORE' | 'AFTER' | 'PERIODIC';
  rootPath: string;
  totalBytes: number;
  fileCount: number;
  capturedAt: string; // ISO-8601 UTC
}

export interface RiskRuleRecord {
  id: string;
  patternName: string;
  category: BloatCategory;
  defaultRiskLevel: RiskLevel;
  originExplanation: string;
  deletionImpact: string;
  specialAction: SpecialActionType | null;
}

export interface DetectedItemRecord {
  id: string; // UUID v4
  sessionId: string;
  ruleId: string | null;
  fullPath: string;
  itemType: ItemType;
  category: BloatCategory;
  riskLevel: RiskLevel;
  sizeBytes: number; // Win32 actual size on disk
  deltaBytes: number;
  isOutsideStandardTemp: boolean;
  status: ItemStatus;
  lastModifiedAt: string; // ISO-8601 UTC
}

export interface SpikeEventRecord {
  id: string; // UUID v4
  sessionId: string | null;
  driveLetter: string;
  deltaBytes: number;
  durationSeconds: number;
  suspectedPath: string | null;
  suspectedCategory: BloatCategory | null;
  detectedAt: string; // ISO-8601 UTC
}

export interface CleanupLogRecord {
  id: string; // UUID v4
  itemId: string | null;
  actionType: CleanupMode | SpecialActionType;
  resultStatus: 'SUCCESS' | 'SKIPPED_LOCKED' | 'FAILED';
  freedBytes: number;
  errorMessage: string | null;
  executedAt: string; // ISO-8601 UTC
}

// ============================================================================
// 3. Command Request & Response DTOs
// ============================================================================

export interface AppInfoResponse {
  name: string;
  version: string;
  isAdmin: boolean;
  isElevated: boolean;
  osVersion: string;
  arch: string;
}

export interface DbStatusResponse {
  initialized: boolean;
  path: string;
  walMode: boolean;
  rulesSeeded: number;
}

export interface StartDeepScanArgs {
  targetPaths: string[];
  includeSystemTemp: boolean;
}

export interface StartDeepScanResult {
  sessionId: string;
}

export interface CancelScanArgs {
  sessionId: string;
}

export interface CancelScanResult {
  cancelled: boolean;
}

export interface StartCodingSessionArgs {
  watchPaths: string[];
}

export interface StartCodingSessionResult {
  sessionId: string;
  baselineBytes: number;
}

export interface CompareCodingSessionArgs {
  sessionId: string;
}

export interface ExpandedFolderItem {
  path: string;
  deltaBytes: number;
  currentBytes: number;
}

export interface NewItem {
  path: string;
  sizeBytes: number;
  category: BloatCategory;
}

export interface SessionDiffSummary {
  sessionId: string;
  durationSeconds: number;
  totalDeltaBytes: number;
  expandedFolders: ExpandedFolderItem[];
  newItems: NewItem[];
}

export interface GetItemInspectionArgs {
  itemId: string;
}

export interface ItemInspectionDetail {
  id: string;
  fullPath: string;
  itemType: ItemType;
  category: BloatCategory;
  riskLevel: RiskLevel;
  sizeBytes: number;
  sizeOnDiskBytes: number;
  lastModifiedAt: string;
  originExplanation: string;
  deletionImpact: string;
  specialAction?: SpecialActionType;
  rebuildSuggestion?: string;
  isLocked: boolean;
  lockingProcess?: string;
  isGitDirty: boolean;
  hasEnvFile: boolean;
  isOutsideStandardTemp: boolean;
}

export interface CleanupBatchArgs {
  itemIds: string[];
  mode: CleanupMode;
}

export interface SkippedLockedItem {
  id: string;
  lockingProcess: string;
}

export interface FailedItem {
  id: string;
  error: string;
}

export interface CleanupBatchResult {
  successfulIds: string[];
  skippedLockedIds: SkippedLockedItem[];
  failedIds: FailedItem[];
  totalFreedBytes: number;
}

export interface SpecialActionArgs {
  itemId: string;
  action: SpecialActionType;
}

export interface SpecialActionResult {
  success: boolean;
  freedBytes: number;
  message: string;
}

export interface GetRecapSummaryArgs {
  range: RecapRange;
  sessionId?: string;
}

export interface TopCulpritItem {
  name: string;
  path: string;
  category: BloatCategory;
  sizeBytes: number;
}

export interface TimelinePoint {
  timestamp: string; // ISO-8601
  usedBytes: number;
  spikeDelta?: number;
}

export interface RecapAnalytics {
  range: RecapRange;
  totalBloatDetectedBytes: number;
  totalFreedBytes: number;
  potentialSavingsBytes: number;
  top5Culprits: TopCulpritItem[];
  spikeCount: number;
  timeline: TimelinePoint[];
}

export interface ExportReportArgs {
  range: string;
  format: ExportFormat;
  savePath: string;
}

export interface ExportReportResult {
  filePath: string;
}

// ============================================================================
// 4. Tauri Event Stream Payloads
// ============================================================================

export interface ScanProgressPayload {
  scannedFiles: number;
  scannedBytes: number;
  currentPath: string;
  foundItemsCount?: number;
}

export interface SpikeDetectedPayload {
  driveLetter: string;
  deltaBytes: number;
  durationSeconds: number;
  suspectedPath?: string;
  suspectedCategory?: BloatCategory;
  detectedAt: string;
}

export interface CleanupProgressPayload {
  completed: number;
  total: number;
  freedBytes: number;
  currentPath: string;
}

// ============================================================================
// 5. IPC Constants & Type-Safe Invocation Mappings
// ============================================================================

export const IPC_COMMANDS = {
  GET_APP_INFO: 'get_app_info',
  INIT_DB: 'init_db_command',
  GET_RISK_RULES: 'get_risk_rules',
  START_DEEP_SCAN: 'start_deep_scan',
  CANCEL_SCAN: 'cancel_scan',
  START_CODING_SESSION: 'start_coding_session',
  COMPARE_CODING_SESSION: 'compare_coding_session',
  GET_ITEM_INSPECTION: 'get_item_inspection',
  EXECUTE_CLEANUP: 'execute_cleanup',
  RUN_SPECIAL_ACTION: 'run_special_action',
  GET_RECAP_SUMMARY: 'get_recap_summary',
  EXPORT_RECAP_REPORT: 'export_recap_report',
} as const;

export const IPC_EVENTS = {
  SCAN_PROGRESS: 'scan:progress',
  WATCHER_SPIKE_DETECTED: 'watcher:spike_detected',
  CLEANUP_PROGRESS: 'cleanup:progress',
} as const;

export interface IpcCommandMap {
  [IPC_COMMANDS.GET_APP_INFO]: { args: Record<string, never>; result: AppInfoResponse };
  [IPC_COMMANDS.INIT_DB]: { args: Record<string, never>; result: DbStatusResponse };
  [IPC_COMMANDS.GET_RISK_RULES]: { args: Record<string, never>; result: RiskRuleRecord[] };
  [IPC_COMMANDS.START_DEEP_SCAN]: { args: StartDeepScanArgs; result: StartDeepScanResult };
  [IPC_COMMANDS.CANCEL_SCAN]: { args: CancelScanArgs; result: CancelScanResult };
  [IPC_COMMANDS.START_CODING_SESSION]: { args: StartCodingSessionArgs; result: StartCodingSessionResult };
  [IPC_COMMANDS.COMPARE_CODING_SESSION]: { args: CompareCodingSessionArgs; result: SessionDiffSummary };
  [IPC_COMMANDS.GET_ITEM_INSPECTION]: { args: GetItemInspectionArgs; result: ItemInspectionDetail };
  [IPC_COMMANDS.EXECUTE_CLEANUP]: { args: CleanupBatchArgs; result: CleanupBatchResult };
  [IPC_COMMANDS.RUN_SPECIAL_ACTION]: { args: SpecialActionArgs; result: SpecialActionResult };
  [IPC_COMMANDS.GET_RECAP_SUMMARY]: { args: GetRecapSummaryArgs; result: RecapAnalytics };
  [IPC_COMMANDS.EXPORT_RECAP_REPORT]: { args: ExportReportArgs; result: ExportReportResult };
}

export interface IpcEventMap {
  [IPC_EVENTS.SCAN_PROGRESS]: ScanProgressPayload;
  [IPC_EVENTS.WATCHER_SPIKE_DETECTED]: SpikeDetectedPayload;
  [IPC_EVENTS.CLEANUP_PROGRESS]: CleanupProgressPayload;
}
