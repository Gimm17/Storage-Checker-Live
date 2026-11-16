# E2E Test Infrastructure Specification: Storage Checker Live (`.exe`)

## 1. Test Philosophy & Principles
- **Opaque-Box & Requirement-Driven**: Tests derive directly from `ORIGINAL_REQUEST.md`, `PRD.md`, and `PROJECT.md § Feature Inventory`. Tests interact with the system strictly via binary CLI execution, stdio JSON-RPC IPC requests, direct SQLite store assertions, and Win32 filesystem verification without accessing private backend modules.
- **Progressive Testability & Zero-Flakiness**: All test fixtures operate in isolated per-run sandboxes under `%TEMP%\scl_e2e_sandbox_<runId>\`. Tests manage their own lifecycle and cleanup via an authoritative 3-phase teardown protocol.
- **Systematic Multi-Tier Methodology**:
  - **Tier 1 (Feature Coverage)**: 150 tests covering all 30 features (5 test cases per feature).
  - **Tier 2 (Boundary & Corner Cases)**: 150 boundary and resource stress tests (5 test cases per feature).
  - **Tier 3 (Cross-Feature Pairwise Interactions)**: 15 pairwise interaction suites testing complex concurrent behaviors.
  - **Tier 4 (Real-World Workloads)**: 15 comprehensive real-world developer workflows.
  - **Total Suite Volume**: 330+ distinct, non-trivial test cases.

---

## 2. Test Architecture & Runtime
- **Runtime**: Node.js v24.22.1 with native test runner (`node:test`), assertions (`node:assert/strict`), and reporters (`spec`, `junit`, `tap`).
- **Execution Engine**: `tsx` (v4.23.15) for zero-compilation TypeScript execution.
- **Zero-Dependency SQLite Client**: Built-in Node 24 `node:sqlite` (`DatabaseSync`), inspecting WAL mode database tables (`scan_sessions`, `disk_snapshots`, `detected_items`, `risk_rules`, `spike_events`, `cleanup_logs`) and indexes in < 2ms without native C++ compilation.
- **Headless Application Driver**: `tests/e2e/harness/app-driver.ts` providing newline-delimited JSON-RPC communication over stdio (`--headless-ipc`), supporting all 12 PRD IPC commands and event subscriptions with dual-mode execution (real binary and contract mock engine).
- **Windows File & System Effects Verifier**: `tests/e2e/harness/win32-verifier.ts`:
  - *Win32 Exclusive Locking*: Spawns background process opening files with `[System.IO.FileShare]::None` (`ERROR_SHARING_VIOLATION`, Win32 Error 32) to test Restart Manager API detection and `SKIPPED_LOCKED` reporting.
  - *Windows COM Recycle Bin Verification*: Automates `Shell.Application` Namespace 10 (`ssfBITBUCKET`) to forensically assert items moved to trash.
  - *NTFS Sparse Containers*: Simulates multi-gigabyte virtual disks (`ext4.vhdx`, `docker_data.vhdx`) and bloated git packs via `fsutil sparse` in < 20ms with 0 physical bytes allocated.
  - *Extended-Length Paths*: Normalizes paths via `path.toNamespacedPath` (`\\?\` prefix) up to 32,767 characters to test MAX_PATH boundary resilience.
  - *NTFS Directory Junctions*: Reparse points (`mklink /J`) testing recursive loop avoidance without requiring elevation or Developer Mode.

---

## 3. Directory Layout

```text
tests/e2e/
├── harness/
│   ├── fixture-sandbox.ts            # Isolated sandbox generator & 3-phase teardown
│   ├── app-driver.ts                 # Headless opaque-box JSON-RPC driver & mock engine
│   ├── db-client.ts                  # Node 24 native DatabaseSync SQLite WAL inspector
│   ├── win32-verifier.ts             # Win32 exclusive locking & COM Recycle Bin verifier
│   └── harness-self-test.test.ts     # Automated self-test verifying 100% of harness
├── tier1/                            # 150 Feature Coverage Test Cases (30 features x 5)
│   ├── 01_manifest_elevation.test.ts
│   ├── 02_sqlite_store.test.ts
│   ├── 03_risk_rules_seed.test.ts
│   ├── 04_deep_scanner.test.ts
│   ├── 05_atomic_cancel.test.ts
│   └── ... (through 30_special_action_git_export.test.ts)
├── tier2/                            # 150 Boundary & Corner Cases (30 features x 5)
│   ├── 01_manifest_boundaries.test.ts
│   ├── 02_sqlite_boundaries.test.ts
│   └── ... (through 30_git_export_boundaries.test.ts)
├── tier3/                            # 15 Cross-Feature Interaction Suites
│   ├── 01_scanner_whitelist_interaction.test.ts
│   ├── 02_git_dirty_env_interaction.test.ts
│   ├── 03_orphan_active_db_interaction.test.ts
│   ├── 04_process_lock_cleanup_interaction.test.ts
│   ├── 05_baseline_spike_diff_interaction.test.ts
│   ├── 06_recycle_bin_quota_fallback_interaction.test.ts
│   ├── 07_vhdx_compact_risk_interaction.test.ts
│   ├── 08_custom_whitelist_overview_interaction.test.ts
│   ├── 09_tray_memory_ui_interaction.test.ts
│   ├── 10_stale_repo_git_gc_interaction.test.ts
│   ├── 11_cancel_scanner_sqlite_interaction.test.ts
│   ├── 12_virtual_table_inspector_lock_interaction.test.ts
│   ├── 13_orphan_view_cleanup_modal_interaction.test.ts
│   ├── 14_recap_export_culprits_interaction.test.ts
│   └── 15_elevation_restart_manager_interaction.test.ts
├── tier4/                            # 15 Real-World Workload Scenarios
│   ├── 01_web_dev_messy_workspace.test.ts
│   ├── 02_ai_agent_bloat_recovery.test.ts
│   ├── 03_crashed_tool_orphan_scatter.test.ts
│   ├── 04_docker_wsl_vhdx_compact.test.ts
│   ├── 05_rust_target_directory_flush.test.ts
│   ├── 06_python_ml_session_diff.test.ts
│   ├── 07_stale_monorepo_git_prune.test.ts
│   ├── 08_low_disk_panic_sweep.test.ts
│   ├── 09_tray_watcher_memory_discipline.test.ts
│   ├── 10_sensitive_repo_whitelist_guard.test.ts
│   ├── 11_nested_path_symlink_traversal.test.ts
│   ├── 12_recycle_bin_overflow_fallback.test.ts
│   ├── 13_active_db_lock_defense.test.ts
│   ├── 14_multi_drive_spike_attribution.test.ts
│   └── 15_weekly_storage_audit_export.test.ts
└── runner.ts                         # Master runner across all tiers (JUnit & JSON output)
```

---

## 4. 3-Phase Teardown Protocol

Every test sandbox created by `FixtureSandbox` undergoes the strict 3-phase teardown protocol:

1. **Phase 1: Process Termination**:
   - Signal child processes holding file locks via stdin close.
   - Forcibly terminate locking processes (`kill('SIGKILL')` and `taskkill /F /PID`).
   - Await Win32 kernel handle cleanup (150ms buffer).
2. **Phase 2: ACL & Attribute Restoration**:
   - Reset directory ACL deny rules via `icacls.exe "<path>" /remove:d "Everyone"`.
   - Strip read-only, hidden, and system attributes via `attrib.exe -r -s -h "<root>\*" /s /d`.
3. **Phase 3: Recursive Namespaced Unlinking**:
   - Format path via `path.toNamespacedPath(rootPath)` (`\\?\` prefix).
   - Unlink directories recursively with junction safety (`fs.rmSync` with retry).
   - Fallback to PowerShell `Remove-Item -LiteralPath` if any transient Windows search handle lingers.

---

## 5. Feature Coverage Matrix (30 Features)

| Feature ID | Feature Name | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Interactions) | Tier 4 (Workloads) |
|---|---|---|---|---|---|
| F01 | Elevated Manifest (`requireAdministrator`) | 5 tests | 5 tests | T3-15 | T4-01 |
| F02 | SQLite WAL Store & Schema Migration | 5 tests | 5 tests | T3-11 | T4-15 |
| F03 | Seed Risk Rules Knowledge Base | 5 tests | 5 tests | T3-08 | T4-02 |
| F04 | Multi-threaded Scanner Traversal | 5 tests | 5 tests | T3-01 | T4-01 |
| F05 | Atomic Scan Cancellation | 5 tests | 5 tests | T3-11 | T4-08 |
| F06 | Win32 Actual Size-on-Disk Calculation | 5 tests | 5 tests | T3-07 | T4-04 |
| F07 | Symlink & Junction Loop Avoidance | 5 tests | 5 tests | T3-01 | T4-11 |
| F08 | Standard vs Orphan Temp Categorization | 5 tests | 5 tests | T3-03 | T4-03 |
| F09 | Active SQLite DB Temp Protection | 5 tests | 5 tests | T3-03 | T4-13 |
| F10 | 3-Tier Risk Engine (SAFE/CAUTION/DANGER) | 5 tests | 5 tests | T3-02 | T4-02 |
| F11 | Hardcoded Protected Paths Whitelist | 5 tests | 5 tests | T3-01 | T4-10 |
| F12 | Git Dirty & Uncommitted Change Guard | 5 tests | 5 tests | T3-02 | T4-10 |
| F13 | Sensitive File Guard (.env / secrets) | 5 tests | 5 tests | T3-02 | T4-10 |
| F14 | Win32 Restart Manager Process Lock Detection | 5 tests | 5 tests | T3-04 | T4-13 |
| F15 | Default Recycle Bin Cleanup via `trash` | 5 tests | 5 tests | T3-06 | T4-12 |
| F16 | Permanent Deletion Safety Guard | 5 tests | 5 tests | T3-06 | T4-12 |
| F17 | Extended Path (`\\?\`) Normalization | 5 tests | 5 tests | T3-01 | T4-11 |
| F18 | System Tray Background Watcher (< 30 MB) | 5 tests | 5 tests | T3-09 | T4-09 |
| F19 | Drive Usage Spike Toast Alert Engine | 5 tests | 5 tests | T3-05 | T4-14 |
| F20 | Session Baseline Storage Snapshot | 5 tests | 5 tests | T3-05 | T4-06 |
| F21 | Session Storage Delta & Diff Analyzer | 5 tests | 5 tests | T3-05 | T4-06 |
| F22 | React 19 High-Craft Dark UI Theme | 5 tests | 5 tests | T3-09 | T4-01 |
| F23 | Virtualized List Performance | 5 tests | 5 tests | T3-12 | T4-01 |
| F24 | Split-Pane "Why & Impact" Inspector | 5 tests | 5 tests | T3-12 | T4-02 |
| F25 | Dedicated Orphaned Temp Hunter View | 5 tests | 5 tests | T3-13 | T4-03 |
| F26 | Safety Alert Cleanup Queue Modal | 5 tests | 5 tests | T3-13 | T4-08 |
| F27 | Top 5 Bloat Culprits & Recap Analytics | 5 tests | 5 tests | T3-14 | T4-15 |
| F28 | Recap Report Export (.md, .json, .csv) | 5 tests | 5 tests | T3-14 | T4-15 |
| F29 | Stale Cloned Repo & Packfile Detector | 5 tests | 5 tests | T3-10 | T4-07 |
| F30 | Special Actions (ext4.vhdx Compact / git gc) | 5 tests | 5 tests | T3-07, T3-10 | T4-04, T4-07 |

---

## 6. Execution Commands

### Run Master Runner (All Tiers)
```powershell
npx tsx tests/e2e/runner.ts
```

### Run by Tier
```powershell
# Run Test Harness Self-Test
npx tsx --test tests/e2e/harness/harness-self-test.test.ts

# Run Tier 1 (Feature Coverage)
npx tsx tests/e2e/runner.ts --tier=1

# Run Tier 2 (Boundary & Corner Cases)
npx tsx tests/e2e/runner.ts --tier=2

# Run Tier 3 (Cross-Feature Interactions)
npx tsx tests/e2e/runner.ts --tier=3

# Run Tier 4 (Real-World Workloads)
npx tsx tests/e2e/runner.ts --tier=4
```

### CLI Flags & Reporter Options
- `--tier=1|2|3|4|all|harness`: Selects execution tier.
- `--filter=<pattern>`: Regex filter matching test file names.
- `--reporter=spec|junit|json|all`: Output format (writes `test-results.xml` and `test-results.json`).
- `--mock`: Forces `AppDriver` to use in-process `MockEngine` contract stub.
- `--bail`: Stops execution upon the first failing test case.
