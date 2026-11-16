// src-tauri/src/db/schema.rs
// Storage Checker Live - SQLite Schema & Migrations

use rusqlite::{Connection, Result};

pub const SCHEMA_DDL: &str = r#"
-- 1. Scan Sessions Table
CREATE TABLE IF NOT EXISTS scan_sessions (
    id TEXT PRIMARY KEY,
    session_type TEXT NOT NULL CHECK(session_type IN ('DEEP_SCAN', 'CODING_SESSION', 'BACKGROUND_WATCH')),
    status TEXT NOT NULL CHECK(status IN ('RUNNING', 'COMPLETED', 'CANCELLED')),
    baseline_used_bytes INTEGER NOT NULL DEFAULT 0,
    peak_used_bytes INTEGER NOT NULL DEFAULT 0,
    ended_used_bytes INTEGER NOT NULL DEFAULT 0,
    total_freed_bytes INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_sessions_type_started 
ON scan_sessions(session_type, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_sessions_started 
ON scan_sessions(started_at DESC);

-- 2. Disk Snapshots Table
CREATE TABLE IF NOT EXISTS disk_snapshots (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('BEFORE', 'AFTER', 'PERIODIC')),
    root_path TEXT NOT NULL,
    total_bytes INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    captured_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES scan_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_disk_snapshots_diff 
ON disk_snapshots(session_id, phase, root_path);

CREATE INDEX IF NOT EXISTS idx_disk_snapshots_session 
ON disk_snapshots(session_id);

-- 3. Risk Rules Knowledge Base Table
CREATE TABLE IF NOT EXISTS risk_rules (
    id TEXT PRIMARY KEY,
    pattern_name TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('AI_IDE', 'DEV_DEPS', 'ORPHAN_TEMP', 'VIRTUALIZATION', 'OTHER')),
    default_risk_level TEXT NOT NULL CHECK(default_risk_level IN ('SAFE', 'CAUTION', 'DANGER')),
    origin_explanation TEXT NOT NULL,
    deletion_impact TEXT NOT NULL,
    special_action TEXT
);

CREATE INDEX IF NOT EXISTS idx_risk_rules_category 
ON risk_rules(category);

-- 4. Detected Bloat Items Table
CREATE TABLE IF NOT EXISTS detected_items (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    rule_id TEXT,
    full_path TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK(item_type IN ('FILE', 'DIRECTORY')),
    category TEXT NOT NULL CHECK(category IN ('AI_IDE', 'DEV_DEPS', 'ORPHAN_TEMP', 'VIRTUALIZATION', 'OTHER')),
    risk_level TEXT NOT NULL CHECK(risk_level IN ('SAFE', 'CAUTION', 'DANGER')),
    size_bytes INTEGER NOT NULL,
    delta_bytes INTEGER NOT NULL DEFAULT 0,
    is_outside_standard_temp INTEGER NOT NULL DEFAULT 0 CHECK(is_outside_standard_temp IN (0, 1)),
    status TEXT NOT NULL CHECK(status IN (
        'DETECTED', 'ANALYZED_SAFE', 'ANALYZED_CAUTION', 'ANALYZED_DANGER',
        'QUEUED_FOR_CLEANUP', 'SKIPPED_LOCKED', 'MOVED_TO_TRASH',
        'PERMANENTLY_DELETED', 'OPTIMIZED', 'RECAPPED'
    )),
    last_modified_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES scan_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_id) REFERENCES risk_rules(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_detected_items_session_cat_risk 
ON detected_items(session_id, category, risk_level);

CREATE INDEX IF NOT EXISTS idx_detected_items_session_size 
ON detected_items(session_id, size_bytes DESC);

CREATE INDEX IF NOT EXISTS idx_detected_items_temp_status 
ON detected_items(session_id, is_outside_standard_temp, status);

CREATE INDEX IF NOT EXISTS idx_detected_items_path 
ON detected_items(full_path);

-- 5. Spike Events Table
CREATE TABLE IF NOT EXISTS spike_events (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    drive_letter TEXT NOT NULL,
    delta_bytes INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    suspected_path TEXT,
    suspected_category TEXT,
    detected_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES scan_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_spike_events_detected 
ON spike_events(detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_spike_events_session 
ON spike_events(session_id);

-- 6. Cleanup Logs Table
CREATE TABLE IF NOT EXISTS cleanup_logs (
    id TEXT PRIMARY KEY,
    item_id TEXT,
    action_type TEXT NOT NULL CHECK(action_type IN ('RECYCLE_BIN', 'PERMANENT', 'COMPACT_VHDX', 'GIT_GC')),
    result_status TEXT NOT NULL CHECK(result_status IN ('SUCCESS', 'SKIPPED_LOCKED', 'FAILED')),
    freed_bytes INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    executed_at TEXT NOT NULL,
    FOREIGN KEY (item_id) REFERENCES detected_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cleanup_logs_executed 
ON cleanup_logs(executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_cleanup_logs_item 
ON cleanup_logs(item_id);
"#;

/// Configures SQLite connection PRAGMAs for optimal concurrency, data integrity, and performance:
/// - WAL mode: Enables concurrent reading and non-blocking background writes.
/// - synchronous = NORMAL: Balances durability and high-throughput filesystem commits in WAL mode.
/// - foreign_keys = ON: Enforces referential integrity and ON DELETE CASCADE/SET NULL constraints.
/// - busy_timeout = 5000: Prevents instant SQLITE_BUSY errors during parallel scan/watch transactions.
/// - cache_size = -20000: Allocates ~20MB memory page cache for virtual table sorting and recap aggregations.
pub fn configure_pragmas(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
        PRAGMA cache_size = -20000;
        PRAGMA temp_store = MEMORY;
        "#,
    )?;
    Ok(())
}

/// Executes all table creation DDL and compound index migrations idempotently.
pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA_DDL)?;
    Ok(())
}
