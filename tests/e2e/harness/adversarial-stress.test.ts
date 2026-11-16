/**
 * Storage Checker Live — Adversarial Stress Test Suite
 * tests/e2e/harness/adversarial-stress.test.ts
 *
 * Adversarially challenges and stress-tests:
 * 1. E2EDatabaseClient: WAL concurrency (100 simultaneous queries), PRAGMA integrity on corrupt DBs, missing tables, missing DB files.
 * 2. AppDriver: 100 rapid RPC bursts, malformed parameters, timeout triggers, event listener subscription & unsubscription lifecycle.
 * 3. Master Test Runner: CLI parsing edge cases, non-existent tiers/filters, graceful exit codes, JUnit XML & JSON report integrity.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { E2EDatabaseClient } from './db-client.ts';
import { AppDriver } from './app-driver.ts';
import { parseCliArgs, discoverTestFiles, buildJunitXml, runMasterRunner, type RunSummary } from '../runner.ts';

// ============================================================================
// SUITE 1: E2EDatabaseClient Adversarial & Concurrency Stress Testing
// ============================================================================

describe('Adversarial Suite 1: E2EDatabaseClient Stress & Boundary Testing', () => {
  let tempDir: string;
  let walDbPath: string;
  let nonWalDbPath: string;
  let corruptDbPath: string;
  let emptyDbPath: string;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl_adv_db_'));
    walDbPath = path.join(tempDir, 'stress_wal.db');
    nonWalDbPath = path.join(tempDir, 'non_wal.db');
    corruptDbPath = path.join(tempDir, 'corrupt.db');
    emptyDbPath = path.join(tempDir, 'empty.db');

    // 1. Setup high-volume WAL database
    const seed = E2EDatabaseClient.openWritable(walDbPath);
    const db = (seed as any).db;
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');

    // Complete Schema
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

    // Seed 9 mandatory rules
    const rules = [
      ['r1', '.gemini', 'AI_IDE', 'SAFE', 'Gemini AI logs', 'Safe', null],
      ['r2', '.cursor', 'AI_IDE', 'SAFE', 'Cursor caches', 'Safe', null],
      ['r3', '.vscode', 'AI_IDE', 'SAFE', 'VSCode server logs', 'Safe', null],
      ['r4', '.ollama', 'AI_IDE', 'SAFE', 'Ollama model blobs', 'Safe', null],
      ['r5', 'node_modules', 'DEV_DEPS', 'SAFE', 'Node modules', 'Reinstallable', null],
      ['r6', 'target', 'DEV_DEPS', 'SAFE', 'Rust target', 'Rebuildable', null],
      ['r7', 'venv', 'DEV_DEPS', 'SAFE', 'Python venv', 'Rebuildable', null],
      ['r8', '.pnpm-store', 'DEV_DEPS', 'SAFE', 'pnpm store', 'Rebuildable', null],
      ['r9', 'ext4.vhdx', 'VIRTUALIZATION', 'DANGER', 'WSL2 disk image', 'Dangerous', 'COMPACT_VHDX'],
    ];
    const insRule = db.prepare('INSERT INTO risk_rules VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of rules) insRule.run(...r);

    // Populate 50 sessions, 200 snapshots, and 500 detected items
    const insSession = db.prepare(`
      INSERT INTO scan_sessions VALUES (?, 'DEEP_SCAN', 'COMPLETED', 104857600, 209715200, 104857600, 0, datetime('now'), datetime('now'))
    `);
    const insSnapshot = db.prepare(`
      INSERT INTO disk_snapshots VALUES (?, ?, 'BEFORE', 'C:\\projects\\app', 104857600, 1500, datetime('now'))
    `);
    const insItem = db.prepare(`
      INSERT INTO detected_items VALUES (?, ?, 'r5', ?, 'DIRECTORY', 'DEV_DEPS', 'SAFE', 1048576, 0, 0, 'DETECTED', datetime('now'))
    `);

    for (let s = 1; s <= 50; s++) {
      const sessId = `session-${s}`;
      insSession.run(sessId);
      for (let snap = 1; snap <= 4; snap++) {
        insSnapshot.run(`snap-${s}-${snap}`, sessId);
      }
      for (let it = 1; it <= 10; it++) {
        insItem.run(`item-${s}-${it}`, sessId, `C:\\projects\\app_${s}\\item_${it}`);
      }
    }
    seed.close();

    // 2. Setup Non-WAL database (DELETE journal mode)
    const nonWalClient = E2EDatabaseClient.openWritable(nonWalDbPath);
    (nonWalClient as any).db.exec('PRAGMA journal_mode = DELETE;');
    nonWalClient.close();

    // 3. Setup Corrupt database (create valid SQLite DB, then corrupt internal header/pages)
    const corruptClient = E2EDatabaseClient.openWritable(corruptDbPath);
    (corruptClient as any).db.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, payload TEXT);');
    for (let i = 0; i < 100; i++) {
      (corruptClient as any).db.prepare('INSERT INTO test_data VALUES (?, ?)').run(i, `val_${i}_${'x'.repeat(200)}`);
    }
    corruptClient.close();

    // Corrupt the b-tree cell pointer array and page 2 data to induce integrity corruption
    const corruptBuf = fs.readFileSync(corruptDbPath);
    // Overwrite btree page header at offset 100-110 and table page at 4096
    for (let offset = 100; offset < 120 && offset < corruptBuf.length; offset++) {
      corruptBuf[offset] = 0x01;
    }
    for (let offset = 4096; offset < 4200 && offset < corruptBuf.length; offset++) {
      corruptBuf[offset] = 0xee;
    }
    fs.writeFileSync(corruptDbPath, corruptBuf);

    // 4. Setup Empty database (zero tables)
    const emptyClient = E2EDatabaseClient.openWritable(emptyDbPath);
    emptyClient.close();
  });

  after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('1.1 Stress Test: Executes 100 concurrent queries across scan_sessions, detected_items, disk_snapshots', async () => {
    const readerClient = new E2EDatabaseClient(walDbPath, { readOnly: true });

    try {
      const queryPromises: Promise<any>[] = [];

      for (let i = 0; i < 100; i++) {
        const queryIndex = i;
        const sessionId = `session-${(i % 50) + 1}`;

        if (queryIndex % 3 === 0) {
          queryPromises.push(
            Promise.resolve().then(() => {
              const sessions = readerClient.getScanSessions();
              assert.equal(sessions.length, 50);
              return sessions.length;
            })
          );
        } else if (queryIndex % 3 === 1) {
          queryPromises.push(
            Promise.resolve().then(() => {
              const items = readerClient.getDetectedItems(sessionId);
              assert.equal(items.length, 10);
              assert.equal(items[0].category, 'DEV_DEPS');
              return items.length;
            })
          );
        } else {
          queryPromises.push(
            Promise.resolve().then(() => {
              const snapshots = readerClient.getDiskSnapshots(sessionId, 'BEFORE');
              assert.equal(snapshots.length, 4);
              return snapshots.length;
            })
          );
        }
      }

      const results = await Promise.all(queryPromises);
      assert.equal(results.length, 100, 'All 100 concurrent read operations must resolve');
    } finally {
      readerClient.close();
    }
  });

  it('1.2 Stress Test: Multiple simultaneous reader clients querying concurrently', async () => {
    const clients: E2EDatabaseClient[] = [];
    const clientCount = 10;

    for (let i = 0; i < clientCount; i++) {
      clients.push(new E2EDatabaseClient(walDbPath, { readOnly: true }));
    }

    try {
      const promises: Promise<number>[] = [];
      for (let i = 0; i < 50; i++) {
        const client = clients[i % clientCount];
        const sessId = `session-${(i % 50) + 1}`;
        promises.push(
          Promise.resolve().then(() => {
            const sess = client.getScanSessionById(sessId);
            assert.ok(sess);
            assert.equal(sess.status, 'COMPLETED');
            return sess.total_files || 0;
          })
        );
      }

      const results = await Promise.all(promises);
      assert.equal(results.length, 50);
    } finally {
      for (const client of clients) {
        client.close();
      }
    }
  });

  it('1.3 Adversarial Test: assertWalMode() throws when database is not in WAL mode', () => {
    const client = new E2EDatabaseClient(nonWalDbPath, { readOnly: true });
    try {
      const mode = client.getJournalMode();
      assert.equal(mode, 'delete');
      assert.throws(
        () => client.assertWalMode(),
        /Expected database to be in WAL mode/
      );
    } finally {
      client.close();
    }
  });

  it('1.4 Adversarial Test: PRAGMA integrity_check behavior on corrupt database file', () => {
    const client = new E2EDatabaseClient(corruptDbPath, { readOnly: true });
    try {
      // When database is corrupted at page level, SQLite may either return integrity rows or throw ERR_SQLITE_ERROR.
      // Observe that checkIntegrity() currently throws ERR_SQLITE_ERROR without try-catch wrapping.
      let checkFailed = false;
      try {
        const check = client.checkIntegrity();
        if (!check.ok) checkFailed = true;
      } catch (err: any) {
        // Documented finding: Node:sqlite throws ERR_SQLITE_ERROR (errcode: 11)
        checkFailed = err.code === 'ERR_SQLITE_ERROR' && (err.message.includes('malformed') || err.message.includes('corrupt'));
      }

      assert.equal(checkFailed, true, 'Corrupt database must be flagged as non-ok or throw ERR_SQLITE_ERROR');

      // assertIntegrity() must reject corrupted database
      let assertThrew = false;
      try {
        client.assertIntegrity();
      } catch (err) {
        assertThrew = true;
      }
      assert.equal(assertThrew, true, 'assertIntegrity() must throw on corrupted database');
    } finally {
      client.close();
    }
  });

  it('1.5 Adversarial Test: Missing tables throw clear assertions when asserting PRD schema', () => {
    const client = new E2EDatabaseClient(emptyDbPath, { readOnly: true });
    try {
      assert.throws(
        () => client.assertTableExists('scan_sessions'),
        /Expected table 'scan_sessions' to exist/
      );
      assert.throws(
        () => client.assertAllPrdTablesExist(),
        /Expected table 'scan_sessions' to exist/
      );
      assert.throws(
        () => client.getScanSessions(),
        /no such table: scan_sessions/
      );
    } finally {
      client.close();
    }
  });

  it('1.6 Adversarial Test: Graceful handling when database file does not exist', () => {
    const nonExistent = path.join(tempDir, 'ghost_database_12345.db');

    assert.throws(
      () => new E2EDatabaseClient(nonExistent, { readOnly: true }),
      /SQLite database file not found at/
    );

    assert.throws(
      () => new E2EDatabaseClient('', { readOnly: true }),
      /SQLite database file not found at/
    );
  });
});

// ============================================================================
// SUITE 2: AppDriver Rapid RPC Bursts, Malformed Inputs & Event Stream Lifecycle
// ============================================================================

describe('Adversarial Suite 2: AppDriver RPC Bursts, Malformed Inputs & Event Lifecycle', () => {
  let driver: AppDriver;

  before(async () => {
    driver = new AppDriver({ mockMode: true });
    await driver.start();
  });

  after(async () => {
    await driver.stop();
  });

  it('2.1 Stress Test: 100 rapid burst RPC commands without race condition or state cross-talk', async () => {
    const burstPromises: Promise<any>[] = [];

    for (let i = 0; i < 100; i++) {
      const callIndex = i;
      if (callIndex % 4 === 0) {
        burstPromises.push(
          driver.startDeepScan({
            targetPaths: [`C:\\mock_burst_${callIndex}`],
            smartDetectCategories: ['AI_IDE', 'DEV_DEPS'],
            enableWin32SizeCalc: true,
          }).then((res) => {
            assert.ok(res.sessionId);
            return res.sessionId;
          })
        );
      } else if (callIndex % 4 === 1) {
        burstPromises.push(
          driver.cancelScan({ sessionId: `session_cancel_${callIndex}` }).then((res) => {
            assert.equal(res.cancelled, true);
            return res.cancelled;
          })
        );
      } else if (callIndex % 4 === 2) {
        burstPromises.push(
          driver.getItemInspection({ itemId: `item_inspect_${callIndex}` }).then((res) => {
            assert.ok(res.id);
            assert.equal(res.riskLevel, 'SAFE');
            return res.id;
          })
        );
      } else {
        burstPromises.push(
          driver.getRecapSummary({ range: 'DAILY' }).then((res) => {
            assert.equal(res.range, 'DAILY');
            assert.ok(res.top5Culprits.length > 0);
            return res.spikeCount;
          })
        );
      }
    }

    const results = await Promise.all(burstPromises);
    assert.equal(results.length, 100, 'All 100 rapid burst RPC invocations must resolve successfully');
  });

  it('2.2 Adversarial Test: Rejects unknown / unsupported RPC commands with clear error', async () => {
    await assert.rejects(
      async () => driver.invoke('completely_invalid_rpc_command_xyz', {}),
      /MockEngine: Unknown IPC command 'completely_invalid_rpc_command_xyz'/
    );
  });

  it('2.3 Adversarial Test: Malformed or empty parameters do not crash MockEngine', async () => {
    // Malformed parameters to known commands
    const res1 = await driver.getItemInspection({ itemId: '' });
    assert.ok(res1.id !== undefined);

    const res2 = await driver.cancelScan({ sessionId: '' });
    assert.equal(res2.cancelled, true);

    const res3 = await driver.executeCleanup({ itemIds: [], permanentDelete: false });
    assert.equal(res3.successfulIds.length, 0);

    const res4 = await driver.runSpecialAction({ action: 'COMPACT_VHDX', targetPath: '' });
    assert.equal(res4.success, true);
  });

  it('2.4 Adversarial Test: Cannot invoke commands when AppDriver is not started', async () => {
    const unstartedDriver = new AppDriver({ mockMode: true });
    await assert.rejects(
      async () => unstartedDriver.invoke('get_app_info'),
      /Cannot invoke 'get_app_info': AppDriver is not started/
    );
  });

  it('2.5 Adversarial Test: waitForEvent timeout triggers properly and cleans up listener', async () => {
    const listenerCountBefore = driver.listenerCount('ghost:event');
    assert.equal(listenerCountBefore, 0);

    await assert.rejects(
      async () => driver.waitForEvent('ghost:event', () => true, 50),
      /Timeout waiting for event 'ghost:event' after 50ms/
    );

    const listenerCountAfter = driver.listenerCount('ghost:event');
    assert.equal(listenerCountAfter, 0, 'Listener must be cleanly detached after timeout');
  });

  it('2.6 Adversarial Test: Event listener lifecycle with 50 simultaneous subscribers without leak', async () => {
    const received: string[] = [];
    const eventName = 'test:burst:event';
    const listenerCount = 50;
    const listeners: ((payload: any) => void)[] = [];

    for (let i = 0; i < listenerCount; i++) {
      const fn = (payload: any) => {
        received.push(`${i}-${payload.msg}`);
      };
      listeners.push(fn);
      driver.on(eventName, fn);
    }

    assert.equal(driver.listenerCount(eventName), listenerCount);

    driver.emit(eventName, { msg: 'payload_ok' });
    assert.equal(received.length, listenerCount);

    // Unsubscribe all
    for (const fn of listeners) {
      driver.off(eventName, fn);
    }
    assert.equal(driver.listenerCount(eventName), 0, 'All event listeners must be successfully detached');
  });

  it('2.7 Adversarial Test: waitForEvent with predicate filtering ignores non-matching payloads', async () => {
    const targetPromise = driver.waitForEvent<{ targetId: string }>(
      'scan:custom',
      (p) => p.targetId === 'target-match',
      500
    );

    // Emit non-matching events first
    driver.emit('scan:custom', { targetId: 'target-1' });
    driver.emit('scan:custom', { targetId: 'target-2' });

    // Emit matching event
    driver.emit('scan:custom', { targetId: 'target-match' });

    const result = await targetPromise;
    assert.equal(result.targetId, 'target-match');
    assert.equal(driver.listenerCount('scan:custom'), 0, 'Matching listener must be removed after resolution');
  });
});

// ============================================================================
// SUITE 3: Master Test Runner CLI, Discoverer & XML/JSON Report Conformance
// ============================================================================

describe('Adversarial Suite 3: Master Runner CLI Edge Cases & Report Conformance', () => {
  it('3.1 Adversarial Test: CLI Parser handles invalid / out-of-range tier and reporter flags gracefully', () => {
    // Unknown tier flag should retain default 'all'
    const opts1 = parseCliArgs(['node', 'runner.ts', '--tier=tier99']);
    assert.equal(opts1.tier, 'all');

    const opts2 = parseCliArgs(['node', 'runner.ts', '--tier=99']);
    assert.equal(opts2.tier, 'all');

    // Valid tier flags
    const opts3 = parseCliArgs(['node', 'runner.ts', '--tier=harness']);
    assert.equal(opts3.tier, 'harness');

    const opts4 = parseCliArgs(['node', 'runner.ts', '--tier=1']);
    assert.equal(opts4.tier, '1');

    // Unknown reporter flag should retain default 'all'
    const opts5 = parseCliArgs(['node', 'runner.ts', '--reporter=invalid_reporter']);
    assert.equal(opts5.reporter, 'all');

    // Invalid timeout string defaults safely to 30000ms
    const opts6 = parseCliArgs(['node', 'runner.ts', '--timeout=not_a_number']);
    assert.equal(opts6.timeoutMs, 30_000);
  });

  it('3.2 Adversarial Test: Empty discovery when filter matches no test files returns 0 failures', async () => {
    const tempOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl_runner_adv_'));

    try {
      const summary = await runMasterRunner({
        tier: 'harness',
        filter: 'definitely_nonexistent_pattern_1234567890',
        reporter: 'all',
        outputDir: tempOutputDir,
        mock: true,
        bail: false,
        timeoutMs: 5000,
      });

      assert.equal(summary.counts.totalSuites, 0);
      assert.equal(summary.counts.failed, 0);
      assert.equal(summary.suites.length, 0);
    } finally {
      try {
        fs.rmSync(tempOutputDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });

  it('3.3 Conformance Test: buildJunitXml escapes special XML characters and produces compliant schema', () => {
    const mockSummary: RunSummary = {
      timestamp: new Date().toISOString(),
      runner: 'node:test + tsx',
      platform: 'win32',
      nodeVersion: process.version,
      durationMs: 1234,
      options: {},
      counts: {
        totalSuites: 1,
        passedSuites: 0,
        failedSuites: 1,
        totalTests: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        todo: 0,
      },
      suites: [
        {
          file: 'tests/e2e/harness/sample.test.ts',
          relativePath: 'tests\\e2e\\harness\\sample.test.ts',
          tier: 'Harness',
          durationMs: 1234,
          passed: false,
          tests: [
            {
              name: 'handles <xml> & "special" characters safely',
              passed: true,
              durationMs: 10,
            },
            {
              name: 'handles error with <tags> & "quotes"',
              passed: false,
              durationMs: 20,
              error: 'Expected <a> & <b> to match',
              stack: 'AssertionError: at Object.<anonymous> (test.ts:42:10)',
            },
          ],
        },
      ],
    };

    const xml = buildJunitXml(mockSummary);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Must include standard XML declaration');
    assert.ok(xml.includes('<testsuites name="Storage Checker Live E2E"'), 'Must have root <testsuites>');
    assert.ok(xml.includes('&lt;xml&gt; &amp; &quot;special&quot;'), 'Must escape XML characters in testcase name');
    assert.ok(xml.includes('&lt;tags&gt; &amp; &quot;quotes&quot;'), 'Must escape XML characters in failure message');
    assert.ok(xml.endsWith('</testsuites>\n'), 'Must close root tag cleanly');
  });

  it('3.4 Conformance Test: discoverTestFiles correctly discovers harness test files', () => {
    const files = discoverTestFiles(process.cwd(), 'harness');
    assert.ok(files.length >= 1, 'Must find at least one harness test file');
    const hasSelfTest = files.some((f) => f.includes('harness-self-test.test.ts'));
    assert.equal(hasSelfTest, true, 'Must find harness-self-test.test.ts');
  });
});
