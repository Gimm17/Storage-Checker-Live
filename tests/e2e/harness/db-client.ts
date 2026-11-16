/**
 * tests/e2e/harness/db-client.ts
 *
 * Zero-dependency SQLite test inspector built on Node.js 24 native `node:sqlite` (`DatabaseSync`).
 * Opens local SQLite database in WAL mode without blocking concurrent writers.
 * Provides assertions and query helpers for all 6 PRD § 7 tables:
 *   - scan_sessions
 *   - disk_snapshots
 *   - detected_items
 *   - risk_rules
 *   - spike_events
 *   - cleanup_logs
 */

import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// 1. Database Row Interfaces (PRD § 7 & Feature Mappings)
// ---------------------------------------------------------------------------

export type SessionType = 'DEEP_SCAN' | 'CODING_SESSION' | 'BACKGROUND_WATCH';
export type SessionStatus = 'RUNNING' | 'COMPLETED' | 'CANCELLED';

export interface ScanSessionRow {
  id: string;
  session_type: SessionType;
  status: SessionStatus;
  baseline_used_bytes: number | bigint;
  peak_used_bytes: number | bigint;
  ended_used_bytes: number | bigint | null;
  total_freed_bytes: number | bigint;
  started_at: string;
  ended_at: string | null;
  // Aliases for convenience in test suites
  completed_at?: string | null;
  total_files?: number;
  total_bytes?: number | bigint;
}

export type SnapshotPhase = 'BEFORE' | 'AFTER' | 'PERIODIC';

export interface DiskSnapshotRow {
  id: string;
  session_id: string;
  phase: SnapshotPhase;
  root_path: string;
  total_bytes: number | bigint;
  file_count: number;
  captured_at: string;
  depth_level?: number;
}

export type BloatCategory = 'AI_IDE' | 'DEV_DEPS' | 'ORPHAN_TEMP' | 'VIRTUALIZATION' | 'OTHER';
export type RiskLevel = 'SAFE' | 'CAUTION' | 'DANGER';
export type ItemStatus =
  | 'DETECTED'
  | 'QUEUED'
  | 'MOVED_TO_TRASH'
  | 'PERMANENTLY_DELETED'
  | 'SKIPPED_LOCKED'
  | 'OPTIMIZED'
  | 'RECAPPED';

export interface DetectedItemRow {
  id: string;
  session_id: string;
  rule_id: string | null;
  full_path: string;
  item_type: 'FILE' | 'DIRECTORY';
  category: BloatCategory;
  risk_level: RiskLevel;
  size_bytes: number | bigint;
  delta_bytes: number | bigint;
  is_outside_standard_temp: number; // 0 or 1
  status: ItemStatus;
  last_modified_at: string;
  // Aliases
  path?: string;
  logical_size_bytes?: number | bigint;
  disk_size_bytes?: number | bigint;
  is_outside_temp?: boolean;
  locking_process?: string | null;
}

export interface RiskRuleRow {
  id: string;
  pattern_name: string;
  category: BloatCategory;
  default_risk_level: RiskLevel;
  origin_explanation: string;
  deletion_impact: string;
  special_action: 'COMPACT_VHDX' | 'GIT_GC' | null;
  // Aliases
  pattern?: string;
  base_risk?: RiskLevel;
  reason_template?: string;
  is_builtin?: number;
  is_active?: number;
}

export interface SpikeEventRow {
  id: string;
  session_id: string | null;
  drive_letter: string;
  delta_bytes: number | bigint;
  duration_seconds: number;
  suspected_path: string | null;
  suspected_category: string | null;
  detected_at: string;
  // Aliases
  duration_secs?: number;
  source_hint?: string | null;
}

export type CleanupAction = 'RECYCLE_BIN' | 'PERMANENT' | 'COMPACT_VHDX';
export type CleanupStatus = 'SUCCESS' | 'SKIPPED_LOCKED' | 'FAILED' | 'SKIPPED_PROTECTED';

export interface CleanupLogRow {
  id: string;
  item_id: string | null;
  action_type: CleanupAction;
  result_status: CleanupStatus;
  freed_bytes: number | bigint;
  error_message: string | null;
  executed_at: string;
  // Aliases
  path?: string | null;
  method?: CleanupAction;
  status?: CleanupStatus;
  bytes_freed?: number | bigint;
}

export interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface TableIndexInfo {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

// ---------------------------------------------------------------------------
// 2. E2EDatabaseClient Implementation
// ---------------------------------------------------------------------------

export interface DbClientOptions {
  readOnly?: boolean;
  timeoutMs?: number;
}

export class E2EDatabaseClient {
  private db: DatabaseSync;
  public readonly dbPath: string;

  constructor(dbPath: string, options: DbClientOptions = {}) {
    this.dbPath = dbPath;
    const readOnly = options.readOnly ?? true;

    if (readOnly && !fs.existsSync(dbPath)) {
      throw new Error(`[E2EDatabaseClient] SQLite database file not found at: ${dbPath}`);
    }

    this.db = new DatabaseSync(dbPath, { readOnly });
  }

  /**
   * Factory method: Opens writable database connection (e.g. for test seeding).
   */
  public static openWritable(dbPath: string): E2EDatabaseClient {
    return new E2EDatabaseClient(dbPath, { readOnly: false });
  }

  /**
   * Closes the SQLite database handle cleanly.
   */
  public close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore double-close errors
    }
  }

  // -------------------------------------------------------------------------
  // 3. PRAGMA & Schema Assertions
  // -------------------------------------------------------------------------

  public getJournalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string } | undefined;
    return row?.journal_mode?.toLowerCase() ?? 'unknown';
  }

  public assertWalMode(): void {
    const mode = this.getJournalMode();
    assert.equal(
      mode,
      'wal',
      `[PRAGMA journal_mode] Expected database to be in WAL mode, but found '${mode}' at ${this.dbPath}`
    );
  }

  public checkIntegrity(): { ok: boolean; results: string[] } {
    const rows = this.db.prepare('PRAGMA integrity_check;').all() as unknown as Array<{ integrity_check: string }>;
    const results = rows.map((r) => r.integrity_check);
    const ok = results.length === 1 && results[0] === 'ok';
    return { ok, results };
  }

  public assertIntegrity(): void {
    const { ok, results } = this.checkIntegrity();
    assert.ok(
      ok,
      `[PRAGMA integrity_check] SQLite integrity check failed. Violations: ${results.join('; ')}`
    );
  }

  public getTableInfo(tableName: string): TableColumnInfo[] {
    return this.db.prepare(`PRAGMA table_info(${tableName});`).all() as unknown as TableColumnInfo[];
  }

  public getIndexList(tableName: string): TableIndexInfo[] {
    return this.db.prepare(`PRAGMA index_list(${tableName});`).all() as unknown as TableIndexInfo[];
  }

  public assertTableExists(tableName: string): void {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?;")
      .get(tableName);
    assert.ok(row, `[Schema Validation] Expected table '${tableName}' to exist in SQLite store`);
  }

  public assertIndexExists(tableName: string, indexName: string): void {
    const indexes = this.getIndexList(tableName);
    const exists = indexes.some((idx) => idx.name === indexName);
    assert.ok(
      exists,
      `[Schema Validation] Expected index '${indexName}' on table '${tableName}', but found: [${indexes
        .map((i) => i.name)
        .join(', ')}]`
    );
  }

  public assertAllPrdTablesExist(): void {
    const expectedTables = [
      'scan_sessions',
      'disk_snapshots',
      'detected_items',
      'risk_rules',
      'spike_events',
      'cleanup_logs',
    ];
    for (const table of expectedTables) {
      this.assertTableExists(table);
    }
  }

  public assertPrdIndexesExist(): void {
    const expectedIndexes = [
      { table: 'scan_sessions', index: 'idx_scan_sessions_type_started' },
      { table: 'disk_snapshots', index: 'idx_disk_snapshots_diff' },
      { table: 'detected_items', index: 'idx_detected_items_session_cat_risk' },
      { table: 'detected_items', index: 'idx_detected_items_session_size' },
      { table: 'spike_events', index: 'idx_spike_events_detected' },
      { table: 'cleanup_logs', index: 'idx_cleanup_logs_executed' },
    ];

    for (const { table, index } of expectedIndexes) {
      this.assertIndexExists(table, index);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Table 1: scan_sessions Helpers
  // -------------------------------------------------------------------------

  public getScanSessions(filter?: { status?: SessionStatus; type?: SessionType }): ScanSessionRow[] {
    let sql = 'SELECT * FROM scan_sessions WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.type) {
      sql += ' AND session_type = ?';
      params.push(filter.type);
    }
    sql += ' ORDER BY started_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as unknown as ScanSessionRow[];
    return rows.map((r) => this.normalizeSession(r));
  }

  public getScanSessionById(sessionId: string): ScanSessionRow | null {
    const row = this.db
      .prepare('SELECT * FROM scan_sessions WHERE id = ?')
      .get(sessionId) as unknown as ScanSessionRow | null;
    return row ? this.normalizeSession(row) : null;
  }

  public assertScanSessionStatus(sessionId: string, expectedStatus: SessionStatus): void {
    const session = this.getScanSessionById(sessionId);
    assert.ok(session, `Session ID '${sessionId}' not found in scan_sessions table`);
    assert.equal(
      session.status,
      expectedStatus,
      `Session '${sessionId}' status mismatch: expected '${expectedStatus}', got '${session.status}'`
    );
  }

  private normalizeSession(row: ScanSessionRow): ScanSessionRow {
    return {
      ...row,
      completed_at: row.ended_at,
      total_bytes: row.ended_used_bytes ?? row.baseline_used_bytes,
    };
  }

  // -------------------------------------------------------------------------
  // 5. Table 2: disk_snapshots Helpers
  // -------------------------------------------------------------------------

  public getDiskSnapshots(sessionId: string, phase?: SnapshotPhase): DiskSnapshotRow[] {
    let sql = 'SELECT * FROM disk_snapshots WHERE session_id = ?';
    const params: unknown[] = [sessionId];
    if (phase) {
      sql += ' AND phase = ?';
      params.push(phase);
    }
    sql += ' ORDER BY root_path ASC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as unknown as DiskSnapshotRow[];
  }

  public assertSnapshotCount(sessionId: string, phase: SnapshotPhase, expectedCount: number): void {
    const snapshots = this.getDiskSnapshots(sessionId, phase);
    assert.equal(
      snapshots.length,
      expectedCount,
      `Expected ${expectedCount} '${phase}' snapshots for session '${sessionId}', but found ${snapshots.length}`
    );
  }

  // -------------------------------------------------------------------------
  // 6. Table 3: detected_items Helpers
  // -------------------------------------------------------------------------

  public getDetectedItems(
    sessionId: string,
    filter?: { category?: BloatCategory; riskLevel?: RiskLevel; status?: ItemStatus }
  ): DetectedItemRow[] {
    let sql = 'SELECT * FROM detected_items WHERE session_id = ?';
    const params: unknown[] = [sessionId];

    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    if (filter?.riskLevel) {
      sql += ' AND risk_level = ?';
      params.push(filter.riskLevel);
    }
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }

    sql += ' ORDER BY size_bytes DESC';
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as unknown as DetectedItemRow[];
    return rows.map((r) => this.normalizeDetectedItem(r));
  }

  public getDetectedItemById(itemId: string): DetectedItemRow | null {
    const row = this.db
      .prepare('SELECT * FROM detected_items WHERE id = ?')
      .get(itemId) as unknown as DetectedItemRow | null;
    return row ? this.normalizeDetectedItem(row) : null;
  }

  public assertDetectedItemCount(
    sessionId: string,
    expectedCount: number,
    filter?: { category?: BloatCategory; riskLevel?: RiskLevel }
  ): void {
    const items = this.getDetectedItems(sessionId, filter);
    assert.equal(
      items.length,
      expectedCount,
      `Detected items count mismatch for session '${sessionId}': expected ${expectedCount}, got ${items.length}`
    );
  }

  private normalizeDetectedItem(row: DetectedItemRow): DetectedItemRow {
    return {
      ...row,
      path: row.full_path,
      logical_size_bytes: row.size_bytes,
      is_outside_temp: row.is_outside_standard_temp === 1,
    };
  }

  // -------------------------------------------------------------------------
  // 7. Table 4: risk_rules & Seed Verification Helpers
  // -------------------------------------------------------------------------

  public getRiskRules(filter?: { category?: BloatCategory; riskLevel?: RiskLevel }): RiskRuleRow[] {
    let sql = 'SELECT * FROM risk_rules WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    if (filter?.riskLevel) {
      sql += ' AND default_risk_level = ?';
      params.push(filter.riskLevel);
    }
    sql += ' ORDER BY category ASC, pattern_name ASC';

    const stmt = this.db.prepare(sql);
    const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as unknown as RiskRuleRow[];
    return rows.map((r) => ({
      ...r,
      pattern: r.pattern_name,
      base_risk: r.default_risk_level,
      reason_template: r.origin_explanation,
    }));
  }

  public verifySeedKnowledgeBase(): { valid: boolean; missingPatterns: string[]; totalCount: number } {
    const rules = this.getRiskRules();
    const existingPatterns = new Set(rules.map((r) => r.pattern_name.toLowerCase()));

    // Mandatory patterns from PRD § 7 & § 12
    const mandatoryPatterns = [
      '.gemini',
      '.cursor',
      '.vscode',
      '.ollama',
      'node_modules',
      'target',
      'venv',
      '.pnpm-store',
      'ext4.vhdx',
    ];

    const missingPatterns = mandatoryPatterns.filter(
      (pat) => !Array.from(existingPatterns).some((ep) => ep.includes(pat.toLowerCase()))
    );

    return {
      valid: missingPatterns.length === 0 && rules.length >= 9,
      missingPatterns,
      totalCount: rules.length,
    };
  }

  public assertSeedKnowledgeBase(): void {
    const { valid, missingPatterns, totalCount } = this.verifySeedKnowledgeBase();
    assert.ok(
      valid,
      `[Seed Knowledge Base] Missing mandatory seed rules: [${missingPatterns.join(
        ', '
      )}]. Total rules found: ${totalCount}`
    );
  }

  // -------------------------------------------------------------------------
  // 8. Table 5: spike_events Helpers
  // -------------------------------------------------------------------------

  public getSpikeEvents(driveLetter?: string): SpikeEventRow[] {
    let sql = 'SELECT * FROM spike_events WHERE 1=1';
    const params: unknown[] = [];
    if (driveLetter) {
      sql += ' AND drive_letter = ?';
      params.push(driveLetter);
    }
    sql += ' ORDER BY detected_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as unknown as SpikeEventRow[];
    return rows.map((r) => ({
      ...r,
      duration_secs: r.duration_seconds,
      source_hint: r.suspected_path,
    }));
  }

  // -------------------------------------------------------------------------
  // 9. Table 6: cleanup_logs Helpers
  // -------------------------------------------------------------------------

  public getCleanupLogs(filter?: { status?: CleanupStatus; action?: CleanupAction }): CleanupLogRow[] {
    let sql = 'SELECT * FROM cleanup_logs WHERE 1=1';
    const params: unknown[] = [];
    if (filter?.status) {
      sql += ' AND result_status = ?';
      params.push(filter.status);
    }
    if (filter?.action) {
      sql += ' AND action_type = ?';
      params.push(filter.action);
    }
    sql += ' ORDER BY executed_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as unknown as CleanupLogRow[];
    return rows.map((r) => ({
      ...r,
      method: r.action_type,
      status: r.result_status,
      bytes_freed: r.freed_bytes,
    }));
  }

  public getTotalBytesFreed(): bigint {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(freed_bytes), 0) AS total FROM cleanup_logs WHERE result_status = 'SUCCESS'")
      .get() as { total: number | bigint } | undefined;
    return BigInt(row?.total ?? 0);
  }
}
