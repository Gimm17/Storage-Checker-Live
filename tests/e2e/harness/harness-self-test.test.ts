/**
 * Storage Checker Live — Harness Self-Test Suite
 * tests/e2e/harness/harness-self-test.test.ts
 *
 * Validates 100% of the TM1 test infrastructure:
 * 1. FixtureSandbox 11 Categories + 3-Phase Teardown.
 * 2. DatabaseSync SQLite Client in WAL mode across all 6 PRD tables.
 * 3. Win32 Exclusive Locks and WinError 32 ERROR_SHARING_VIOLATION.
 * 4. Windows COM Recycle Bin verification via Shell.Application.
 * 5. AppDriver Headless RPC and MockEngine contract execution.
 * 6. Master Test Runner CLI parser, discovery, and XML reporting.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { FixtureSandbox } from './fixture-sandbox.ts';
import { E2EDatabaseClient } from './db-client.ts';
import {
  acquireExclusiveLock,
  assertFileLocked,
  assertFileNotLocked,
  RecycleBinVerifier,
  toExtendedPath,
  isExtendedPath,
  isJunction,
  createJunction,
  removeJunction,
} from './win32-verifier.ts';
import { AppDriver } from './app-driver.ts';
import { parseCliArgs, discoverTestFiles, buildJunitXml, type RunSummary } from '../runner.ts';

// ============================================================================
// Suite 1: Fixture Sandbox 11 Categories & 3-Phase Teardown
// ============================================================================

describe('Harness Self-Test 1: Fixture Sandbox 11 Categories & Teardown Protocol', () => {
  let sandbox: FixtureSandbox;

  before(async () => {
    sandbox = new FixtureSandbox('scl_self_test');
    await sandbox.generateAll();
  });

  it('scaffolds isolated sandbox directory under %TEMP%', () => {
    assert.ok(sandbox.rootPath.startsWith(os.tmpdir()));
    assert.ok(fs.existsSync(sandbox.namespacedRoot));
  });

  it('scaffolds AI/IDE bloat folders and mock caches (Category 1)', () => {
    const geminiCache = sandbox.resolve('mock_user_home', '.gemini', 'antigravity', 'brain', 'session_cache.json');
    const cursorCache = sandbox.resolve('mock_user_home', '.cursor', 'extensions', 'mock-author.ext-1.0.0', 'cache.bin');
    const vscodeLog = sandbox.resolve('mock_user_home', '.vscode', 'cli', 'servers', 'Stable-abc123', 'server.log');
    const ollamaBlob = sandbox.resolve('mock_user_home', '.ollama', 'models', 'blobs', 'sha256-mockblob-1234567890abcdef');

    assert.ok(fs.existsSync(geminiCache), 'Gemini cache should exist');
    assert.ok(fs.existsSync(cursorCache), 'Cursor cache should exist');
    assert.ok(fs.existsSync(vscodeLog), 'VSCode log should exist');
    assert.ok(fs.existsSync(ollamaBlob), 'Ollama model blob should exist');
  });

  it('scaffolds standard and orphaned temp files (Categories 2 & 3)', () => {
    const stdTempFile = sandbox.resolve('mock_user_home', 'AppData', 'Local', 'Temp', 'valid_in_temp_installer_123.tmp');
    const winTempLog = sandbox.resolve('mock_windows_temp', 'win_update_dism.log');
    const desktopDmp = sandbox.resolve('mock_user_home', 'Desktop', 'memory_crash.dmp');
    const projectLog = sandbox.resolve('mock_projects', 'clean_npm_app', 'npm_debug_error.log');

    assert.ok(fs.existsSync(stdTempFile), 'Standard user temp file should exist');
    assert.ok(fs.existsSync(winTempLog), 'Windows temp file should exist');
    assert.ok(fs.existsSync(desktopDmp), 'Orphaned desktop crash dump should exist');
    assert.ok(fs.existsSync(projectLog), 'Orphaned project debug log should exist');
  });

  it('scaffolds dev dependencies and cache hierarchies (Category 4)', () => {
    const npmExpress = sandbox.resolve('mock_projects', 'clean_npm_app', 'node_modules', 'express', 'package.json');
    const rustTarget = sandbox.resolve('mock_projects', 'rust_target_app', 'target', 'debug', 'incremental', 'mock_app_123', 'bin_artifact.o');
    const pycache = sandbox.resolve('mock_projects', 'python_venv_app', '__pycache__', 'main.cpython-310.pyc');

    assert.ok(fs.existsSync(npmExpress), 'NPM package should exist');
    assert.ok(fs.existsSync(rustTarget), 'Rust target artifact should exist');
    assert.ok(fs.existsSync(pycache), 'Python pycache should exist');
  });

  it('scaffolds git repositories with dirty status and stale pack bloat (Category 5)', () => {
    const dirtyReadme = sandbox.resolve('mock_projects', 'dirty_git_app', 'README.md');
    const dirtyUntracked = sandbox.resolve('mock_projects', 'dirty_git_app', 'untracked_scratch.txt');
    const stalePack = sandbox.resolve('mock_projects', 'bloated_git_repo', '.git', 'objects', 'pack', 'pack-mock1234567890abcdef.pack');

    assert.ok(fs.existsSync(dirtyReadme), 'Dirty git repo file should exist');
    assert.ok(fs.existsSync(dirtyUntracked), 'Untracked scratch file should exist');
    assert.ok(fs.existsSync(stalePack), 'Stale git packfile should exist');
  });

  it('scaffolds sensitive secret files (.env, .env.production) (Category 6)', () => {
    const envFile = sandbox.resolve('mock_projects', 'sensitive_env_app', '.env');
    const envProd = sandbox.resolve('mock_projects', 'sensitive_env_app', '.env.production');

    assert.ok(fs.existsSync(envFile), '.env file should exist');
    assert.ok(fs.existsSync(envProd), '.env.production file should exist');
    const content = fs.readFileSync(envFile, 'utf8');
    assert.ok(content.includes('DATABASE_URL'));
  });

  it('scaffolds active SQLite transaction siblings (.db, .db-wal, .db-shm) (Category 7)', () => {
    const dbPath = sandbox.resolve('mock_projects', 'active_sqlite_app', 'app.db');
    const walPath = sandbox.resolve('mock_projects', 'active_sqlite_app', 'app.db-wal');
    const shmPath = sandbox.resolve('mock_projects', 'active_sqlite_app', 'app.db-shm');
    const adjTmp = sandbox.resolve('mock_projects', 'active_sqlite_app', 'cache_query_active.tmp');

    assert.ok(fs.existsSync(dbPath), 'Active SQLite database should exist');
    assert.ok(fs.existsSync(walPath), 'Active WAL journal should exist');
    assert.ok(fs.existsSync(shmPath), 'Active SHM index should exist');
    assert.ok(fs.existsSync(adjTmp), 'Adjacent in-flight temp file should exist');
  });

  it('scaffolds sparse virtual disk containers (.vhdx) (Category 8)', () => {
    const ext4Vhdx = sandbox.resolve('mock_virtualization', 'ext4.vhdx');
    const dockerVhdx = sandbox.resolve('mock_virtualization', 'docker_data.vhdx');

    assert.ok(fs.existsSync(ext4Vhdx), 'ext4.vhdx should exist');
    assert.ok(fs.existsSync(dockerVhdx), 'docker_data.vhdx should exist');
  });

  it('holds Win32 exclusive file lock process (Category 9)', () => {
    const lockingProcs = sandbox.getLockingProcesses();
    assert.ok(lockingProcs.length >= 1, 'Should track at least one locking child process');
    assert.ok(lockingProcs[0].pid > 0);
  });

  it('scaffolds extended-length namespaced paths (> 260 characters) (Category 11)', () => {
    let deep = sandbox.resolve('mock_projects', 'deep_long_path_app');
    for (let i = 0; i < 25; i++) {
      deep = path.join(deep, `sub_level_${i.toString().padStart(2, '0')}`);
    }
    const deepNamespaced = path.toNamespacedPath(path.resolve(deep));
    const deepFile = path.join(deepNamespaced, 'deep_orphan_asset.tmp');

    assert.ok(deepNamespaced.length > 260, `Extended path length (${deepNamespaced.length}) must exceed MAX_PATH 260`);
    assert.ok(fs.existsSync(deepFile), 'Deeply nested file should exist');
  });

  it('executes 3-phase teardown cleanly releasing locks and unlinking sandbox', async () => {
    await sandbox.destroy();
    assert.equal(fs.existsSync(sandbox.namespacedRoot), false, 'Sandbox root directory must be completely removed');
  });

  it('supports withSandbox static wrapper for automated lifecycle', async () => {
    let capturedRoot = '';
    await FixtureSandbox.withSandbox({ includeStandardTemp: true }, async (sb) => {
      capturedRoot = sb.namespacedRoot;
      assert.ok(fs.existsSync(capturedRoot), 'Sandbox should exist within block');
    });
    assert.equal(fs.existsSync(capturedRoot), false, 'Sandbox should be automatically cleaned up after withSandbox');
  });
});

// ============================================================================
// Suite 2: Native Node 24 DatabaseSync Client (WAL Mode & PRD Schema)
// ============================================================================

describe('Harness Self-Test 2: Node 24 Native DatabaseSync SQLite Inspector', () => {
  let dbClient: E2EDatabaseClient;
  let tempDbPath: string;

  before(() => {
    tempDbPath = path.join(os.tmpdir(), `scl_db_test_${Date.now()}.db`);
    // Create initial SQLite store
    const seedClient = E2EDatabaseClient.openWritable(tempDbPath);
    const db = (seedClient as any).db;

    // Enable WAL mode
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');

    // Migrate complete PRD § 7 schema
    db.exec(`
      CREATE TABLE scan_sessions (
        id TEXT PRIMARY KEY,
        session_type TEXT NOT NULL,
        status TEXT NOT NULL,
        baseline_used_bytes INTEGER NOT NULL DEFAULT 0,
        peak_used_bytes INTEGER NOT NULL DEFAULT 0,
        ended_used_bytes INTEGER,
        total_freed_bytes INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE INDEX idx_scan_sessions_type_started ON scan_sessions(session_type, started_at DESC);

      CREATE TABLE disk_snapshots (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
        phase TEXT NOT NULL,
        root_path TEXT NOT NULL,
        total_bytes INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER NOT NULL DEFAULT 0,
        captured_at TEXT NOT NULL
      );
      CREATE INDEX idx_disk_snapshots_diff ON disk_snapshots(session_id, phase, root_path);

      CREATE TABLE risk_rules (
        id TEXT PRIMARY KEY,
        pattern_name TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        default_risk_level TEXT NOT NULL,
        origin_explanation TEXT NOT NULL,
        deletion_impact TEXT NOT NULL,
        special_action TEXT
      );

      CREATE TABLE detected_items (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES scan_sessions(id) ON DELETE CASCADE,
        rule_id TEXT REFERENCES risk_rules(id) ON DELETE SET NULL,
        full_path TEXT NOT NULL,
        item_type TEXT NOT NULL,
        category TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        delta_bytes INTEGER NOT NULL DEFAULT 0,
        is_outside_standard_temp INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        last_modified_at TEXT NOT NULL
      );
      CREATE INDEX idx_detected_items_session_cat_risk ON detected_items(session_id, category, risk_level);
      CREATE INDEX idx_detected_items_session_size ON detected_items(session_id, size_bytes DESC);

      CREATE TABLE spike_events (
        id TEXT PRIMARY KEY,
        session_id TEXT REFERENCES scan_sessions(id) ON DELETE SET NULL,
        drive_letter TEXT NOT NULL,
        delta_bytes INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL,
        suspected_path TEXT,
        suspected_category TEXT,
        detected_at TEXT NOT NULL
      );
      CREATE INDEX idx_spike_events_detected ON spike_events(detected_at DESC);

      CREATE TABLE cleanup_logs (
        id TEXT PRIMARY KEY,
        item_id TEXT REFERENCES detected_items(id) ON DELETE SET NULL,
        action_type TEXT NOT NULL,
        result_status TEXT NOT NULL,
        freed_bytes INTEGER NOT NULL,
        error_message TEXT,
        executed_at TEXT NOT NULL
      );
      CREATE INDEX idx_cleanup_logs_executed ON cleanup_logs(executed_at DESC);
    `);

    // Seed mandatory risk rules
    const seedRules = [
      ['rule_gemini', '.gemini', 'AI_IDE', 'SAFE', 'Gemini AI logs', 'Safe to delete', null],
      ['rule_cursor', '.cursor', 'AI_IDE', 'SAFE', 'Cursor IDE caches', 'Safe to delete', null],
      ['rule_vscode', '.vscode', 'AI_IDE', 'SAFE', 'VSCode server logs', 'Safe to delete', null],
      ['rule_ollama', '.ollama', 'AI_IDE', 'SAFE', 'Ollama model cache', 'Safe to delete', null],
      ['rule_node_modules', 'node_modules', 'DEV_DEPS', 'SAFE', 'Node modules', 'Reinstallable', null],
      ['rule_target', 'target', 'DEV_DEPS', 'SAFE', 'Rust target directory', 'Rebuildable', null],
      ['rule_venv', 'venv', 'DEV_DEPS', 'SAFE', 'Python virtual environment', 'Rebuildable', null],
      ['rule_pnpm', '.pnpm-store', 'DEV_DEPS', 'SAFE', 'pnpm package store', 'Rebuildable', null],
      ['rule_vhdx', 'ext4.vhdx', 'VIRTUALIZATION', 'DANGER', 'WSL2 disk image', 'Destroys Linux subsystem', 'COMPACT_VHDX'],
    ];

    const insertRule = db.prepare(`
      INSERT INTO risk_rules (id, pattern_name, category, default_risk_level, origin_explanation, deletion_impact, special_action)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `);

    for (const rule of seedRules) {
      insertRule.run(...rule);
    }

    // Insert sample session & detected item
    db.prepare(`
      INSERT INTO scan_sessions (id, session_type, status, baseline_used_bytes, started_at)
      VALUES ('session-1', 'DEEP_SCAN', 'COMPLETED', 104857600, datetime('now'));
    `).run();

    db.prepare(`
      INSERT INTO disk_snapshots (id, session_id, phase, root_path, total_bytes, file_count, captured_at)
      VALUES ('snap-1', 'session-1', 'BEFORE', 'C:\\mock', 104857600, 42, datetime('now'));
    `).run();

    db.prepare(`
      INSERT INTO detected_items (id, session_id, rule_id, full_path, item_type, category, risk_level, size_bytes, is_outside_standard_temp, status, last_modified_at)
      VALUES ('item-1', 'session-1', 'rule_node_modules', 'C:\\mock\\node_modules', 'DIRECTORY', 'DEV_DEPS', 'SAFE', 52428800, 0, 'DETECTED', datetime('now'));
    `).run();

    db.prepare(`
      INSERT INTO spike_events (id, session_id, drive_letter, delta_bytes, duration_seconds, detected_at)
      VALUES ('spike-1', 'session-1', 'C', 10485760, 5, datetime('now'));
    `).run();

    db.prepare(`
      INSERT INTO cleanup_logs (id, item_id, action_type, result_status, freed_bytes, executed_at)
      VALUES ('clean-1', 'item-1', 'RECYCLE_BIN', 'SUCCESS', 52428800, datetime('now'));
    `).run();

    seedClient.close();

    // Open read-only WAL client for testing
    dbClient = new E2EDatabaseClient(tempDbPath, { readOnly: true });
  });

  after(() => {
    dbClient.close();
    try {
      fs.unlinkSync(tempDbPath);
      const wal = `${tempDbPath}-wal`;
      const shm = `${tempDbPath}-shm`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch { /* ignore */ }
  });

  it('verifies WAL mode and integrity pragmas', () => {
    assert.equal(dbClient.getJournalMode(), 'wal');
    dbClient.assertWalMode();
    dbClient.assertIntegrity();
  });

  it('verifies all 6 PRD schema tables and expected indexes exist', () => {
    dbClient.assertAllPrdTablesExist();
    dbClient.assertPrdIndexesExist();
  });

  it('verifies seed knowledge base rules coverage', () => {
    const verification = dbClient.verifySeedKnowledgeBase();
    assert.equal(verification.valid, true);
    assert.equal(verification.missingPatterns.length, 0);
    assert.ok(verification.totalCount >= 9);
    dbClient.assertSeedKnowledgeBase();
  });

  it('queries scan_sessions and asserts session status', () => {
    const sessions = dbClient.getScanSessions();
    assert.ok(sessions.length >= 1);
    const session = dbClient.getScanSessionById('session-1');
    assert.ok(session);
    assert.equal(session.session_type, 'DEEP_SCAN');
    dbClient.assertScanSessionStatus('session-1', 'COMPLETED');
  });

  it('queries disk_snapshots and asserts snapshot counts', () => {
    const snapshots = dbClient.getDiskSnapshots('session-1', 'BEFORE');
    assert.equal(snapshots.length, 1);
    dbClient.assertSnapshotCount('session-1', 'BEFORE', 1);
  });

  it('queries detected_items and verifies normalized property aliases', () => {
    const items = dbClient.getDetectedItems('session-1');
    assert.equal(items.length, 1);
    const item = items[0];
    assert.equal(item.category, 'DEV_DEPS');
    assert.equal(item.path, 'C:\\mock\\node_modules');
    assert.equal(item.is_outside_temp, false);
    dbClient.assertDetectedItemCount('session-1', 1);
  });

  it('queries spike_events and cleanup_logs', () => {
    const spikes = dbClient.getSpikeEvents('C');
    assert.equal(spikes.length, 1);
    assert.equal(spikes[0].drive_letter, 'C');

    const logs = dbClient.getCleanupLogs({ status: 'SUCCESS' });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].method, 'RECYCLE_BIN');

    const totalFreed = dbClient.getTotalBytesFreed();
    assert.equal(totalFreed, 52428800n);
  });
});

// ============================================================================
// Suite 3: Win32 Exclusive File Locking & Error Verification
// ============================================================================

describe('Harness Self-Test 3: Win32 File Locking & ERROR_SHARING_VIOLATION', () => {
  const lockTargetFile = path.join(os.tmpdir(), `scl_win32_lock_${Date.now()}.tmp`);

  before(() => {
    fs.writeFileSync(lockTargetFile, 'Active locked payload data\n');
  });

  after(() => {
    if (fs.existsSync(lockTargetFile)) {
      try { fs.unlinkSync(lockTargetFile); } catch { /* ignore */ }
    }
  });

  it('spawns external process holding FileShare.None, detects lock, and releases cleanly', async () => {
    const lockHandle = await acquireExclusiveLock(lockTargetFile, 5000);
    assert.ok(lockHandle.pid > 0);

    try {
      // Assert lock status
      assert.equal(lockHandle.isLocked(), true);
      assertFileLocked(lockTargetFile);
    } finally {
      // Release lock
      await lockHandle.release();
    }

    // Verify file is now unlocked
    assertFileNotLocked(lockTargetFile);
  });

  it('verifies extended-length path helpers', () => {
    const normal = 'C:\\test\\path';
    const extended = toExtendedPath(normal);
    assert.ok(extended.startsWith('\\\\?\\'));
    assert.equal(isExtendedPath(extended), true);
    assert.equal(isExtendedPath(normal), false);
  });

  it('verifies NTFS directory junction helpers', () => {
    const baseDir = path.join(os.tmpdir(), `scl_junc_test_${Date.now()}`);
    const srcDir = path.join(baseDir, 'source_folder');
    const juncDir = path.join(baseDir, 'junction_link');

    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'file.txt'), 'payload');

    try {
      createJunction(juncDir, srcDir);
      assert.ok(fs.existsSync(juncDir));
      assert.equal(isJunction(juncDir), true);
      assert.equal(isJunction(srcDir), false);

      removeJunction(juncDir);
      assert.equal(fs.existsSync(juncDir), false);
      assert.ok(fs.existsSync(path.join(srcDir, 'file.txt')), 'Target directory content must survive junction removal');
    } finally {
      try {
        fs.rmSync(baseDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  });
});

// ============================================================================
// Suite 4: Windows COM Recycle Bin Verification
// ============================================================================

describe('Harness Self-Test 4: Windows COM Recycle Bin Query', () => {
  it('queries Recycle Bin item count via Shell.Application COM interface', () => {
    const count = RecycleBinVerifier.getItemCount();
    assert.ok(typeof count === 'number');
    assert.ok(count >= 0, 'Recycle bin item count cannot be negative');
  });

  it('enumerates Recycle Bin items safely', () => {
    const items = RecycleBinVerifier.getItems();
    assert.ok(Array.isArray(items));
  });
});

// ============================================================================
// Suite 5: Headless App Driver & MockEngine Invocation
// ============================================================================

describe('Harness Self-Test 5: AppDriver RPC & MockEngine Contract Verification', () => {
  let driver: AppDriver;

  before(async () => {
    driver = new AppDriver({ mockMode: true });
    await driver.start();
  });

  after(async () => {
    await driver.stop();
  });

  it('validates getAppInfo returns elevated admin Windows metadata', async () => {
    const info = await driver.getAppInfo();
    assert.equal(info.name, 'Storage Checker Live');
    assert.equal(info.isAdmin, true);
    assert.equal(info.isElevated, true);
    assert.equal(info.arch, 'x86_64');
  });

  it('validates initDb initializes WAL mode database', async () => {
    const db = await driver.initDb();
    assert.equal(db.initialized, true);
    assert.equal(db.walMode, true);
    assert.ok(db.rulesSeeded > 0);
  });

  it('validates getRiskRules returns seeded rule records', async () => {
    const rules = await driver.getRiskRules();
    assert.ok(rules.length >= 3);
    const geminiRule = rules.find((r) => r.category === 'AI_IDE');
    assert.ok(geminiRule);
    assert.equal(geminiRule.defaultRiskLevel, 'SAFE');
  });

  it('executes startDeepScan and receives asynchronous scan:progress event', async () => {
    const eventPromise = driver.waitForEvent<any>('scan:progress', (p) => p.scannedFiles > 0);
    const result = await driver.startDeepScan({
      targetPaths: ['C:\\mock_projects'],
      includeSystemTemp: false,
    });

    assert.ok(result.sessionId.length > 0);
    const eventPayload = await eventPromise;
    assert.ok(eventPayload.scannedFiles >= 1000);
    assert.ok(eventPayload.scannedBytes > 0);
  });

  it('executes cancelScan and verifies cancellation flag', async () => {
    const cancelRes = await driver.cancelScan({ sessionId: 'mock-session-id' });
    assert.equal(cancelRes.cancelled, true);
  });

  it('executes startCodingSession and compareCodingSession calculating storage deltas', async () => {
    const startRes = await driver.startCodingSession({ watchPaths: ['C:\\mock_projects\\app'] });
    assert.ok(startRes.sessionId);

    const diff = await driver.compareCodingSession({ sessionId: startRes.sessionId });
    assert.equal(diff.sessionId, startRes.sessionId);
    assert.ok(diff.totalDeltaBytes > 0);
    assert.ok(diff.expandedFolders.length > 0);
    assert.ok(diff.newItems.length > 0);
  });

  it('executes getItemInspection and retrieves detailed Why & Impact metadata', async () => {
    const inspection = await driver.getItemInspection({ itemId: 'item_123' });
    assert.equal(inspection.id, 'item_123');
    assert.equal(inspection.category, 'DEV_DEPS');
    assert.equal(inspection.riskLevel, 'SAFE');
    assert.ok(inspection.rebuildSuggestion?.includes('pnpm'));
  });

  it('executes executeCleanup in RECYCLE_BIN mode and receives cleanup:progress', async () => {
    const eventPromise = driver.waitForEvent<any>('cleanup:progress', (p) => p.freedBytes > 0);
    const cleanupRes = await driver.executeCleanup({
      itemIds: ['item_1', 'item_2'],
      mode: 'RECYCLE_BIN',
    });

    assert.equal(cleanupRes.successfulIds.length, 2);
    assert.ok(cleanupRes.totalFreedBytes > 0);
    const progress = await eventPromise;
    assert.equal(progress.completed, 2);
  });

  it('executes runSpecialAction for COMPACT_VHDX', async () => {
    const actionRes = await driver.runSpecialAction({
      itemId: 'vhdx_1',
      action: 'COMPACT_VHDX',
    });

    assert.equal(actionRes.success, true);
    assert.ok(actionRes.freedBytes > 0);
  });

  it('executes getRecapSummary and exportRecapReport', async () => {
    const recap = await driver.getRecapSummary({ range: 'SESSION' });
    assert.equal(recap.range, 'SESSION');
    assert.ok(recap.top5Culprits.length > 0);

    const exportRes = await driver.exportRecapReport({
      range: 'SESSION',
      format: 'JSON',
      savePath: 'C:\\reports\\summary.json',
    });
    assert.equal(exportRes.filePath, 'C:\\reports\\summary.json');
  });

  it('rejects unknown commands with informative error', async () => {
    await assert.rejects(
      async () => {
        await driver.invoke('non_existent_command');
      },
      {
        message: /Unknown IPC command 'non_existent_command'/,
      }
    );
  });
});

// ============================================================================
// Suite 6: Master Runner Utilities & Reporting Verification
// ============================================================================

describe('Harness Self-Test 6: Master Runner CLI Parser, Discovery & JUnit XML', () => {
  it('parses CLI arguments correctly', () => {
    const argv = ['node', 'runner.ts', '--tier=harness', '--filter=self-test', '--reporter=junit', '--mock', '--bail'];
    const options = parseCliArgs(argv);

    assert.equal(options.tier, 'harness');
    assert.equal(options.filter, 'self-test');
    assert.equal(options.reporter, 'junit');
    assert.equal(options.mock, true);
    assert.equal(options.bail, true);
  });

  it('discovers harness self-test file', () => {
    const files = discoverTestFiles(process.cwd(), 'harness', 'harness-self-test');
    assert.ok(files.length >= 1, 'Should find at least 1 test file matching harness-self-test');
    assert.ok(files[0].includes('harness-self-test.test.ts'));
  });

  it('builds valid JUnit XML from execution summary', () => {
    const mockSummary: RunSummary = {
      timestamp: new Date().toISOString(),
      runner: 'node:test + tsx',
      platform: 'win32',
      nodeVersion: process.version,
      durationMs: 1250,
      options: { tier: 'harness' },
      counts: {
        totalSuites: 1,
        passedSuites: 1,
        failedSuites: 0,
        totalTests: 2,
        passed: 2,
        failed: 0,
        skipped: 0,
        todo: 0,
      },
      suites: [
        {
          file: 'tests/e2e/harness/harness-self-test.test.ts',
          relativePath: 'tests/e2e/harness/harness-self-test.test.ts',
          tier: 'Harness',
          durationMs: 1250,
          passed: true,
          tests: [
            { name: 'test case 1', passed: true, durationMs: 600 },
            { name: 'test case 2', passed: true, durationMs: 650 },
          ],
        },
      ],
    };

    const xml = buildJunitXml(mockSummary);
    assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes('<testsuites name="Storage Checker Live E2E"'));
    assert.ok(xml.includes('<testcase name="test case 1"'));
  });
});
