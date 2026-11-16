/**
 * Storage Checker Live — Headless Application Driver
 * tests/e2e/harness/app-driver.ts
 *
 * Provides opaque-box testing of the application binary via stdio JSON-RPC (--headless-ipc)
 * with an integrated spec-compliant mock engine for pre-binary development and headless CI.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  AppInfoResponse,
  DbStatusResponse,
  RiskRuleRecord,
  StartDeepScanArgs,
  StartDeepScanResult,
  CancelScanArgs,
  CancelScanResult,
  StartCodingSessionArgs,
  StartCodingSessionResult,
  CompareCodingSessionArgs,
  SessionDiffSummary,
  GetItemInspectionArgs,
  ItemInspectionDetail,
  CleanupBatchArgs,
  CleanupBatchResult,
  SpecialActionArgs,
  SpecialActionResult,
  GetRecapSummaryArgs,
  RecapAnalytics,
  ExportReportArgs,
  ExportReportResult,
  ScanProgressPayload,
  CleanupProgressPayload,
} from '../../../src/types/ipc.ts';

// ============================================================================
// 1. JSON-RPC Protocol Types
// ============================================================================

export interface RpcRequest {
  id: string | number;
  cmd: string;
  params?: Record<string, unknown>;
}

export interface RpcResponse<T = unknown> {
  id: string | number;
  result?: T;
  error?: string | { code: number; message: string; data?: unknown };
}

export interface RpcEvent<T = unknown> {
  event: string;
  payload: T;
}

export interface AppDriverOptions {
  binaryPath?: string;
  mockMode?: boolean;
  defaultTimeoutMs?: number;
  dbPath?: string;
  env?: Record<string, string>;
  cwd?: string;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
  cmd: string;
}

// ============================================================================
// 2. Headless App Driver Implementation
// ============================================================================

export class AppDriver extends EventEmitter {
  private childProcess: ChildProcess | null = null;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private requestIdCounter = 0;
  private stdoutBuffer = '';
  private isRunning = false;
  private readonly options: Required<AppDriverOptions>;

  // Mock Engine State (used when mockMode is true)
  private mockSessions = new Map<string, { type: string; status: string; startedAt: string }>();
  private mockActiveScanCancel = false;

  constructor(options: AppDriverOptions = {}) {
    super();
    const isMockForced = process.env.APP_DRIVER_MOCK === 'true' || options.mockMode === true;
    const defaultBinary = path.resolve(
      process.cwd(),
      'src-tauri/target/debug/storage-checker-live.exe'
    );

    this.options = {
      binaryPath: options.binaryPath || process.env.APP_BINARY_PATH || defaultBinary,
      mockMode: isMockForced || !fs.existsSync(options.binaryPath || defaultBinary),
      defaultTimeoutMs: options.defaultTimeoutMs || 10_000,
      dbPath: options.dbPath || process.env.STORAGE_CHECKER_DB_PATH || '',
      env: options.env || {},
      cwd: options.cwd || process.cwd(),
    };
  }

  public get isMockMode(): boolean {
    return this.options.mockMode;
  }

  public get isAlive(): boolean {
    return this.isRunning;
  }

  /**
   * Spawns the binary or initializes the mock engine.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;

    if (this.options.mockMode) {
      this.isRunning = true;
      this.emit('started', { mode: 'MOCK' });
      return;
    }

    if (!fs.existsSync(this.options.binaryPath)) {
      throw new Error(
        `Application binary not found at: ${this.options.binaryPath}. ` +
          `Compile with 'cargo build' or enable mock mode with mockMode: true / APP_DRIVER_MOCK=true.`
      );
    }

    const env = {
      ...process.env,
      ...this.options.env,
      STORAGE_CHECKER_HEADLESS: '1',
      ...(this.options.dbPath ? { STORAGE_CHECKER_DB_PATH: this.options.dbPath } : {}),
    };

    this.childProcess = spawn(this.options.binaryPath, ['--headless-ipc'], {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.isRunning = true;

    this.childProcess.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdoutData(chunk.toString('utf8'));
    });

    this.childProcess.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      this.emit('stderr', line);
    });

    this.childProcess.on('exit', (code, signal) => {
      this.isRunning = false;
      this.emit('exit', { code, signal });
      this.cleanupPendingRequests(new Error(`Binary exited with code ${code} (${signal})`));
    });

    this.childProcess.on('error', (err) => {
      this.isRunning = false;
      this.emit('error', err);
      this.cleanupPendingRequests(err);
    });

    this.emit('started', { mode: 'BINARY', pid: this.childProcess.pid });
  }

  /**
   * Stops the binary and frees all resources.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.options.mockMode) {
      this.isRunning = false;
      this.mockSessions.clear();
      this.emit('stopped');
      return;
    }

    if (this.childProcess) {
      const child = this.childProcess;
      this.childProcess = null;
      this.isRunning = false;

      return new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          try {
            if (process.platform === 'win32' && child.pid) {
              spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F'], { stdio: 'ignore' });
            } else {
              child.kill('SIGKILL');
            }
          } catch {
            // Ignore error if already dead
          }
          resolve();
        }, 2000);

        child.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });

        try {
          child.stdin?.end();
          child.kill('SIGTERM');
        } catch {
          resolve();
        }
      });
    }
  }

  /**
   * Sends a low-level JSON-RPC command over stdio or routes to MockEngine.
   */
  public async invoke<T = unknown>(
    cmd: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = this.options.defaultTimeoutMs
  ): Promise<T> {
    if (!this.isRunning) {
      throw new Error(`Cannot invoke '${cmd}': AppDriver is not started.`);
    }

    if (this.options.mockMode) {
      return this.executeMockCommand<T>(cmd, params);
    }

    const id = ++this.requestIdCounter;
    const request: RpcRequest = { id, cmd, params };
    const payload = JSON.stringify(request) + '\n';

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: '${cmd}' (id: ${id}) did not respond within ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer, cmd });

      this.childProcess?.stdin?.write(payload, 'utf8', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(new Error(`Failed to write command '${cmd}' to stdin: ${err.message}`));
        }
      });
    });
  }

  /**
   * Waits for a specific event matching an optional predicate.
   */
  public waitForEvent<T = unknown>(
    eventName: string,
    predicate: (payload: T) => boolean = () => true,
    timeoutMs: number = this.options.defaultTimeoutMs
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(eventName, listener);
        reject(new Error(`Timeout waiting for event '${eventName}' after ${timeoutMs}ms.`));
      }, timeoutMs);

      const listener = (payload: T) => {
        try {
          if (predicate(payload)) {
            clearTimeout(timer);
            this.off(eventName, listener);
            resolve(payload);
          }
        } catch (err) {
          clearTimeout(timer);
          this.off(eventName, listener);
          reject(err);
        }
      };

      this.on(eventName, listener);
    });
  }

  // ==========================================================================
  // Typed PRD IPC Commands (Matching src/types/ipc.ts)
  // ==========================================================================

  public async getAppInfo(): Promise<AppInfoResponse> {
    return this.invoke<AppInfoResponse>('get_app_info');
  }

  public async initDb(): Promise<DbStatusResponse> {
    return this.invoke<DbStatusResponse>('init_db_command');
  }

  public async getRiskRules(): Promise<RiskRuleRecord[]> {
    return this.invoke<RiskRuleRecord[]>('get_risk_rules');
  }

  public async startDeepScan(args: StartDeepScanArgs): Promise<StartDeepScanResult> {
    return this.invoke<StartDeepScanResult>('start_deep_scan', args as any);
  }

  public async cancelScan(args: CancelScanArgs): Promise<CancelScanResult> {
    return this.invoke<CancelScanResult>('cancel_scan', args as any);
  }

  public async startCodingSession(args: StartCodingSessionArgs): Promise<StartCodingSessionResult> {
    return this.invoke<StartCodingSessionResult>('start_coding_session', args as any);
  }

  public async compareCodingSession(args: CompareCodingSessionArgs): Promise<SessionDiffSummary> {
    return this.invoke<SessionDiffSummary>('compare_coding_session', args as any);
  }

  public async getItemInspection(args: GetItemInspectionArgs): Promise<ItemInspectionDetail> {
    return this.invoke<ItemInspectionDetail>('get_item_inspection', args as any);
  }

  public async executeCleanup(args: CleanupBatchArgs): Promise<CleanupBatchResult> {
    return this.invoke<CleanupBatchResult>('execute_cleanup', args as any);
  }

  public async runSpecialAction(args: SpecialActionArgs): Promise<SpecialActionResult> {
    return this.invoke<SpecialActionResult>('run_special_action', args as any);
  }

  public async getRecapSummary(args: GetRecapSummaryArgs): Promise<RecapAnalytics> {
    return this.invoke<RecapAnalytics>('get_recap_summary', args as any);
  }

  public async exportRecapReport(args: ExportReportArgs): Promise<ExportReportResult> {
    return this.invoke<ExportReportResult>('export_recap_report', args as any);
  }

  // ==========================================================================
  // Internal Stream Parsing & JSON-RPC Dispatch
  // ==========================================================================

  private handleStdoutData(data: string): void {
    this.stdoutBuffer += data;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() || '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (!line.startsWith('{')) {
        this.emit('log', line);
        continue;
      }

      try {
        const msg = JSON.parse(line);

        // Check if event notification
        if ('event' in msg && typeof msg.event === 'string') {
          this.emit(msg.event, msg.payload);
          this.emit('event', msg);
          continue;
        }

        // Check if response
        if ('id' in msg) {
          const req = this.pendingRequests.get(msg.id);
          if (req) {
            clearTimeout(req.timer);
            this.pendingRequests.delete(msg.id);

            if (msg.error) {
              const errMsg = typeof msg.error === 'string' ? msg.error : msg.error.message || JSON.stringify(msg.error);
              req.reject(new Error(`RPC error on '${req.cmd}': ${errMsg}`));
            } else {
              req.resolve(msg.result);
            }
          }
        }
      } catch {
        this.emit('log', line);
      }
    }
  }

  private cleanupPendingRequests(error: Error): void {
    for (const [, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(error);
    }
    this.pendingRequests.clear();
  }

  // ==========================================================================
  // In-Process Mock Engine (Contract Stub)
  // ==========================================================================

  private async executeMockCommand<T>(cmd: string, params: Record<string, unknown>): Promise<T> {
    switch (cmd) {
      case 'get_app_info': {
        return {
          name: 'Storage Checker Live',
          version: '0.1.0',
          isAdmin: true,
          isElevated: true,
          osVersion: 'Windows 11 (Mock)',
          arch: 'x86_64',
        } as T;
      }

      case 'init_db_command': {
        return {
          initialized: true,
          path: this.options.dbPath || 'C:\\mock\\storage_checker.db',
          walMode: true,
          rulesSeeded: 24,
        } as T;
      }

      case 'get_risk_rules': {
        const rules: RiskRuleRecord[] = [
          {
            id: 'rule_ai_gemini',
            patternName: '.gemini/antigravity',
            category: 'AI_IDE',
            defaultRiskLevel: 'SAFE',
            originExplanation: 'Gemini Antigravity execution checkpoints and logs',
            deletionImpact: 'Regenerated automatically during next agent session',
            specialAction: null,
          },
          {
            id: 'rule_node_modules',
            patternName: 'node_modules',
            category: 'DEV_DEPS',
            defaultRiskLevel: 'SAFE',
            originExplanation: 'Node.js installed dependencies',
            deletionImpact: 'Rebuildable via npm/pnpm/yarn install',
            specialAction: null,
          },
          {
            id: 'rule_vhdx_compact',
            patternName: '*.vhdx',
            category: 'VIRTUALIZATION',
            defaultRiskLevel: 'DANGER',
            originExplanation: 'Virtual disk container for WSL2/Docker',
            deletionImpact: 'Destroys entire Linux/Docker container filesystem',
            specialAction: 'COMPACT_VHDX',
          },
        ];
        return rules as T;
      }

      case 'start_deep_scan': {
        this.mockActiveScanCancel = false;
        const sessionId = randomUUID();
        this.mockSessions.set(sessionId, {
          type: 'DEEP_SCAN',
          status: 'RUNNING',
          startedAt: new Date().toISOString(),
        });

        // Simulate asynchronous progress events
        setTimeout(() => {
          if (!this.mockActiveScanCancel) {
            const payload: ScanProgressPayload = {
              scannedFiles: 1500,
              scannedBytes: 104_857_600,
              currentPath: 'C:\\mock_projects\\app\\node_modules',
            };
            this.emit('scan:progress', payload);
          }
        }, 10);

        return { sessionId } as T;
      }

      case 'cancel_scan': {
        const sessionId = String(params.sessionId || '');
        this.mockActiveScanCancel = true;
        const session = this.mockSessions.get(sessionId);
        if (session) session.status = 'CANCELLED';
        return { cancelled: true } as T;
      }

      case 'start_coding_session': {
        const sessionId = randomUUID();
        this.mockSessions.set(sessionId, {
          type: 'CODING_SESSION',
          status: 'RUNNING',
          startedAt: new Date().toISOString(),
        });
        return { sessionId, baselineBytes: 52_428_800 } as T;
      }

      case 'compare_coding_session': {
        const sessionId = String(params.sessionId || '');
        const summary: SessionDiffSummary = {
          sessionId,
          durationSeconds: 120,
          totalDeltaBytes: 15_728_640,
          expandedFolders: [
            { path: 'C:\\mock_projects\\app\\node_modules', deltaBytes: 10_485_760, currentBytes: 52_428_800 },
            { path: 'C:\\mock_projects\\app\\.next', deltaBytes: 5_242_880, currentBytes: 15_728_640 },
          ],
          newItems: [
            { path: 'C:\\mock_projects\\app\\session_scratch.tmp', sizeBytes: 2_097_152, category: 'ORPHAN_TEMP' },
          ],
        };
        return summary as T;
      }

      case 'get_item_inspection': {
        const itemId = String(params.itemId || 'mock_item_1');
        const detail: ItemInspectionDetail = {
          id: itemId,
          fullPath: 'C:\\mock_projects\\app\\node_modules',
          itemType: 'DIRECTORY',
          category: 'DEV_DEPS',
          riskLevel: 'SAFE',
          sizeBytes: 52_428_800,
          sizeOnDiskBytes: 52_428_800,
          lastModifiedAt: new Date().toISOString(),
          originExplanation: 'Installed Node.js dependencies',
          deletionImpact: 'Can be restored via pnpm install',
          specialAction: undefined,
          rebuildSuggestion: 'pnpm install',
          isLocked: false,
          isGitDirty: false,
          hasEnvFile: false,
          isOutsideStandardTemp: false,
        };
        return detail as T;
      }

      case 'execute_cleanup': {
        const itemIds = (params.itemIds as string[]) || [];
        const result: CleanupBatchResult = {
          successfulIds: itemIds,
          skippedLockedIds: [],
          failedIds: [],
          totalFreedBytes: 52_428_800,
        };

        const progress: CleanupProgressPayload = {
          completed: itemIds.length,
          total: itemIds.length,
          freedBytes: 52_428_800,
          currentPath: 'C:\\mock_projects\\app\\node_modules',
        };
        this.emit('cleanup:progress', progress);

        return result as T;
      }

      case 'run_special_action': {
        const action = String(params.action || '');
        const result: SpecialActionResult = {
          success: true,
          freedBytes: 1_073_741_824,
          message: `Special action '${action}' completed successfully.`,
        };
        return result as T;
      }

      case 'get_recap_summary': {
        const range = (params.range as any) || 'SESSION';
        const analytics: RecapAnalytics = {
          range,
          totalBloatDetectedBytes: 104_857_600,
          totalFreedBytes: 52_428_800,
          potentialSavingsBytes: 52_428_800,
          top5Culprits: [
            {
              name: 'node_modules',
              path: 'C:\\mock_projects\\app\\node_modules',
              category: 'DEV_DEPS',
              sizeBytes: 52_428_800,
            },
            {
              name: '.gemini',
              path: 'C:\\Users\\Mock\\.gemini',
              category: 'AI_IDE',
              sizeBytes: 25_000_000,
            },
          ],
          spikeCount: 1,
          timeline: [
            { timestamp: new Date().toISOString(), usedBytes: 500_000_000, spikeDelta: 52_428_800 },
          ],
        };
        return analytics as T;
      }

      case 'export_recap_report': {
        const savePath = String(params.savePath || 'C:\\mock\\report.json');
        return { filePath: savePath } as T;
      }

      default:
        throw new Error(`MockEngine: Unknown IPC command '${cmd}'`);
    }
  }
}
