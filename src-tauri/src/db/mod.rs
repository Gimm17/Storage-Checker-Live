// src-tauri/src/db/mod.rs
// Storage Checker Live - Database Core, Connection Management & Repositories

pub mod models;
pub mod schema;
pub mod seed;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use rusqlite::{params, Connection};
use uuid::Uuid;
use chrono::Utc;

pub use models::*;

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Filesystem path error: {0}")]
    PathError(String),
    #[error("Lock acquisition error: {0}")]
    LockError(String),
    #[error("Entity not found: {0}")]
    NotFound(String),
}

/// Tauri application state container managing the shared SQLite connection.
pub struct DbState {
    pub conn: Mutex<Connection>,
}

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

/// Resolves the canonical SQLite database path:
/// `%LOCALAPPDATA%\StorageCheckerLive\storage_checker.db`
/// Creates the directory if it does not already exist.
pub fn get_db_path() -> Result<PathBuf, DbError> {
    let local_appdata = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|_| {
            std::env::var("USERPROFILE")
                .map(|u| PathBuf::from(u).join("AppData").join("Local"))
        })
        .map_err(|_| DbError::PathError("Could not resolve %LOCALAPPDATA% or %USERPROFILE% environment variables".into()))?;

    let app_dir = local_appdata.join("StorageCheckerLive");
    if !app_dir.exists() {
        std::fs::create_dir_all(&app_dir)
            .map_err(|e| DbError::PathError(format!("Failed to create directory {}: {}", app_dir.display(), e)))?;
    }

    Ok(app_dir.join("storage_checker.db"))
}

/// Initializes the primary SQLite database at `%LOCALAPPDATA%\StorageCheckerLive\storage_checker.db`:
/// 1. Resolves path and creates parent directory.
/// 2. Configures WAL mode, normal synchronous, busy timeout, and memory cache.
/// 3. Executes schema DDL migrations for all 6 tables and indexes.
/// 4. Idempotently seeds default risk rules.
pub fn init_db() -> Result<Connection, DbError> {
    let path = get_db_path()?;
    init_db_at_path(&path)
}

/// Initializes a database connection at a specific path (useful for testing or custom paths).
pub fn init_db_at_path(path: &Path) -> Result<Connection, DbError> {
    let conn = Connection::open(path)?;
    schema::configure_pragmas(&conn)?;
    schema::run_migrations(&conn)?;
    seed::seed_risk_rules(&conn)?;
    Ok(conn)
}

/// Initializes an in-memory SQLite database fully migrated and seeded (for unit and integration tests).
pub fn init_test_db() -> Result<Connection, DbError> {
    let conn = Connection::open_in_memory()?;
    schema::configure_pragmas(&conn)?;
    schema::run_migrations(&conn)?;
    seed::seed_risk_rules(&conn)?;
    Ok(conn)
}

// ============================================================================
// Repository Operations: Scan Sessions
// ============================================================================

pub fn create_session(conn: &Connection, session_type: &str) -> Result<String, DbError> {
    let session_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO scan_sessions (id, session_type, status, baseline_used_bytes, peak_used_bytes, ended_used_bytes, total_freed_bytes, started_at)
         VALUES (?1, ?2, 'RUNNING', 0, 0, 0, 0, ?3)",
        params![session_id, session_type, now],
    )?;

    Ok(session_id)
}

pub fn complete_session(
    conn: &Connection,
    session_id: &str,
    ended_used_bytes: i64,
    peak_used_bytes: i64,
    total_freed_bytes: i64,
) -> Result<(), DbError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE scan_sessions 
         SET status = 'COMPLETED', ended_at = ?1, ended_used_bytes = ?2, peak_used_bytes = ?3, total_freed_bytes = ?4
         WHERE id = ?5",
        params![now, ended_used_bytes, peak_used_bytes, total_freed_bytes, session_id],
    )?;
    Ok(())
}

pub fn cancel_session(conn: &Connection, session_id: &str) -> Result<(), DbError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE scan_sessions SET status = 'CANCELLED', ended_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )?;
    Ok(())
}

pub fn get_session(conn: &Connection, session_id: &str) -> Result<Option<ScanSessionRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, session_type, status, baseline_used_bytes, peak_used_bytes, ended_used_bytes, total_freed_bytes, started_at, ended_at
         FROM scan_sessions WHERE id = ?1",
    )?;

    let mut rows = stmt.query(params![session_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(ScanSessionRow {
            id: row.get(0)?,
            session_type: row.get(1)?,
            status: row.get(2)?,
            baseline_used_bytes: row.get(3)?,
            peak_used_bytes: row.get(4)?,
            ended_used_bytes: row.get(5)?,
            total_freed_bytes: row.get(6)?,
            started_at: row.get(7)?,
            ended_at: row.get(8)?,
        }))
    } else {
        Ok(None)
    }
}

// ============================================================================
// Repository Operations: Disk Snapshots
// ============================================================================

pub fn insert_snapshot(
    conn: &Connection,
    session_id: &str,
    phase: &str,
    root_path: &str,
    total_bytes: i64,
    file_count: i64,
) -> Result<String, DbError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO disk_snapshots (id, session_id, phase, root_path, total_bytes, file_count, captured_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, session_id, phase, root_path, total_bytes, file_count, now],
    )?;

    Ok(id)
}

pub fn get_snapshots_by_session(conn: &Connection, session_id: &str) -> Result<Vec<DiskSnapshotRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, phase, root_path, total_bytes, file_count, captured_at
         FROM disk_snapshots WHERE session_id = ?1 ORDER BY captured_at ASC",
    )?;

    let rows = stmt.query_map(params![session_id], |row| {
        Ok(DiskSnapshotRow {
            id: row.get(0)?,
            session_id: row.get(1)?,
            phase: row.get(2)?,
            root_path: row.get(3)?,
            total_bytes: row.get(4)?,
            file_count: row.get(5)?,
            captured_at: row.get(6)?,
        })
    })?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r?);
    }
    Ok(result)
}

// ============================================================================
// Repository Operations: Detected Bloat Items
// ============================================================================

pub fn batch_insert_detected_items(conn: &mut Connection, items: &[DetectedItemRow]) -> Result<(), DbError> {
    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO detected_items (
                id, session_id, rule_id, full_path, item_type, category, risk_level,
                size_bytes, delta_bytes, is_outside_standard_temp, status, last_modified_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )?;

        for item in items {
            stmt.execute(params![
                item.id,
                item.session_id,
                item.rule_id,
                item.full_path,
                item.item_type,
                item.category,
                item.risk_level,
                item.size_bytes,
                item.delta_bytes,
                item.is_outside_standard_temp,
                item.status,
                item.last_modified_at,
            ])?;
        }
    }
    tx.commit()?;
    Ok(())
}

pub fn get_detected_items_by_session(
    conn: &Connection,
    session_id: &str,
    category_filter: Option<&str>,
    risk_filter: Option<&str>,
) -> Result<Vec<DetectedItemRow>, DbError> {
    let mut query = String::from(
        "SELECT id, session_id, rule_id, full_path, item_type, category, risk_level,
                size_bytes, delta_bytes, is_outside_standard_temp, status, last_modified_at
         FROM detected_items WHERE session_id = ?1",
    );

    if category_filter.is_some() {
        query.push_str(" AND category = ?2");
    }
    if risk_filter.is_some() {
        query.push_str(if category_filter.is_some() { " AND risk_level = ?3" } else { " AND risk_level = ?2" });
    }
    query.push_str(" ORDER BY size_bytes DESC");

    let mut stmt = conn.prepare(&query)?;
    let mut rows = match (category_filter, risk_filter) {
        (Some(cat), Some(risk)) => stmt.query(params![session_id, cat, risk])?,
        (Some(cat), None) => stmt.query(params![session_id, cat])?,
        (None, Some(risk)) => stmt.query(params![session_id, risk])?,
        (None, None) => stmt.query(params![session_id])?,
    };

    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        items.push(DetectedItemRow {
            id: row.get(0)?,
            session_id: row.get(1)?,
            rule_id: row.get(2)?,
            full_path: row.get(3)?,
            item_type: row.get(4)?,
            category: row.get(5)?,
            risk_level: row.get(6)?,
            size_bytes: row.get(7)?,
            delta_bytes: row.get(8)?,
            is_outside_standard_temp: row.get(9)?,
            status: row.get(10)?,
            last_modified_at: row.get(11)?,
        });
    }

    Ok(items)
}

pub fn update_item_status(conn: &Connection, item_id: &str, status: &str) -> Result<(), DbError> {
    conn.execute(
        "UPDATE detected_items SET status = ?1 WHERE id = ?2",
        params![status, item_id],
    )?;
    Ok(())
}

// ============================================================================
// Repository Operations: Risk Rules
// ============================================================================

pub fn get_all_risk_rules(conn: &Connection) -> Result<Vec<RiskRuleRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, pattern_name, category, default_risk_level, origin_explanation, deletion_impact, special_action
         FROM risk_rules ORDER BY id ASC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(RiskRuleRow {
            id: row.get(0)?,
            pattern_name: row.get(1)?,
            category: row.get(2)?,
            default_risk_level: row.get(3)?,
            origin_explanation: row.get(4)?,
            deletion_impact: row.get(5)?,
            special_action: row.get(6)?,
        })
    })?;

    let mut rules = Vec::new();
    for r in rows {
        rules.push(r?);
    }
    Ok(rules)
}

pub fn get_risk_rule_by_id(conn: &Connection, rule_id: &str) -> Result<Option<RiskRuleRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, pattern_name, category, default_risk_level, origin_explanation, deletion_impact, special_action
         FROM risk_rules WHERE id = ?1",
    )?;

    let mut rows = stmt.query(params![rule_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(RiskRuleRow {
            id: row.get(0)?,
            pattern_name: row.get(1)?,
            category: row.get(2)?,
            default_risk_level: row.get(3)?,
            origin_explanation: row.get(4)?,
            deletion_impact: row.get(5)?,
            special_action: row.get(6)?,
        }))
    } else {
        Ok(None)
    }
}

// ============================================================================
// Repository Operations: Spike Events
// ============================================================================

pub fn record_spike_event(
    conn: &Connection,
    session_id: Option<&str>,
    drive_letter: &str,
    delta_bytes: i64,
    duration_seconds: i64,
    suspected_path: Option<&str>,
    suspected_category: Option<&str>,
) -> Result<String, DbError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO spike_events (id, session_id, drive_letter, delta_bytes, duration_seconds, suspected_path, suspected_category, detected_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, session_id, drive_letter, delta_bytes, duration_seconds, suspected_path, suspected_category, now],
    )?;

    Ok(id)
}

pub fn get_recent_spike_events(conn: &Connection, limit: usize) -> Result<Vec<SpikeEventRow>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, drive_letter, delta_bytes, duration_seconds, suspected_path, suspected_category, detected_at
         FROM spike_events ORDER BY detected_at DESC LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok(SpikeEventRow {
            id: row.get(0)?,
            session_id: row.get(1)?,
            drive_letter: row.get(2)?,
            delta_bytes: row.get(3)?,
            duration_seconds: row.get(4)?,
            suspected_path: row.get(5)?,
            suspected_category: row.get(6)?,
            detected_at: row.get(7)?,
        })
    })?;

    let mut events = Vec::new();
    for r in rows {
        events.push(r?);
    }
    Ok(events)
}

// ============================================================================
// Repository Operations: Cleanup Logs
// ============================================================================

pub fn log_cleanup_action(
    conn: &Connection,
    item_id: Option<&str>,
    action_type: &str,
    result_status: &str,
    freed_bytes: i64,
    error_message: Option<&str>,
) -> Result<String, DbError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO cleanup_logs (id, item_id, action_type, result_status, freed_bytes, error_message, executed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, item_id, action_type, result_status, freed_bytes, error_message, now],
    )?;

    Ok(id)
}

// ============================================================================
// Repository Operations: Recap & Analytics
// ============================================================================

pub fn get_recap_analytics(
    conn: &Connection,
    _range: &str, // 'SESSION' | 'TODAY' | 'WEEK' | 'ALL'
    session_id: Option<&str>,
) -> Result<RecapAnalyticsData, DbError> {
    let freed_bytes: i64 = conn.query_row(
        "SELECT COALESCE(SUM(freed_bytes), 0) FROM cleanup_logs WHERE result_status = 'SUCCESS'",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let cleaned_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cleanup_logs WHERE result_status = 'SUCCESS'",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let locked_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM cleanup_logs WHERE result_status = 'SKIPPED_LOCKED'",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    let spikes_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM spike_events",
        [],
        |row| row.get(0),
    ).unwrap_or(0);

    // Calculate scanned bytes & top culprits
    let (scanned_bytes, top_culprits) = if let Some(sid) = session_id {
        let total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM detected_items WHERE session_id = ?1",
            params![sid],
            |row| row.get(0),
        ).unwrap_or(0);

        let mut stmt = conn.prepare(
            "SELECT full_path, category, size_bytes, risk_level
             FROM detected_items WHERE session_id = ?1 ORDER BY size_bytes DESC LIMIT 5",
        )?;
        let rows = stmt.query_map(params![sid], |row| {
            Ok(TopBloatCulprit {
                full_path: row.get(0)?,
                category: row.get(1)?,
                size_bytes: row.get(2)?,
                risk_level: row.get(3)?,
            })
        })?;
        let mut culprits = Vec::new();
        for r in rows {
            culprits.push(r?);
        }
        (total, culprits)
    } else {
        let total: i64 = conn.query_row(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM detected_items",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let mut stmt = conn.prepare(
            "SELECT full_path, category, size_bytes, risk_level
             FROM detected_items ORDER BY size_bytes DESC LIMIT 5",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TopBloatCulprit {
                full_path: row.get(0)?,
                category: row.get(1)?,
                size_bytes: row.get(2)?,
                risk_level: row.get(3)?,
            })
        })?;
        let mut culprits = Vec::new();
        for r in rows {
            culprits.push(r?);
        }
        (total, culprits)
    };

    Ok(RecapAnalyticsData {
        total_freed_bytes: freed_bytes,
        total_scanned_bytes: scanned_bytes,
        total_cleaned_count: cleaned_count,
        total_skipped_locked_count: locked_count,
        spike_events_count: spikes_count,
        top_culprits,
    })
}

// ============================================================================
// Unit Tests Suite
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_initialization_and_seeding() {
        let conn = init_test_db().expect("Failed to initialize test DB");
        let rule_count: i64 = conn.query_row("SELECT COUNT(*) FROM risk_rules", [], |r| r.get(0)).unwrap();
        assert_eq!(rule_count, 13, "Exactly 13 default risk rules must be seeded");

        // Verify PRAGMA foreign_keys is enabled
        let foreign_keys: i64 = conn.query_row("PRAGMA foreign_keys;", [], |r| r.get(0)).unwrap();
        assert_eq!(foreign_keys, 1, "Foreign keys must be ON");
    }

    #[test]
    fn test_seed_idempotency() {
        let conn = init_test_db().expect("Failed to initialize test DB");
        let reseed_count = seed::seed_risk_rules(&conn).expect("Reseeding should succeed");
        assert_eq!(reseed_count, 13, "Reseeding must remain idempotent and count 13");
    }

    #[test]
    fn test_session_lifecycle_and_cascade() {
        let mut conn = init_test_db().expect("Failed to initialize test DB");
        let session_id = create_session(&conn, "DEEP_SCAN").expect("Session creation failed");

        // Verify session retrieval
        let session = get_session(&conn, &session_id).expect("Query failed").expect("Session not found");
        assert_eq!(session.status, "RUNNING");
        assert_eq!(session.session_type, "DEEP_SCAN");

        // Insert snapshot
        let snap_id = insert_snapshot(&conn, &session_id, "BEFORE", "C:\\Projects", 1048576, 42).expect("Snapshot failed");
        let snapshots = get_snapshots_by_session(&conn, &session_id).expect("Get snapshots failed");
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].id, snap_id);

        // Batch insert items
        let item_id = Uuid::new_v4().to_string();
        let item = DetectedItemRow {
            id: item_id.clone(),
            session_id: session_id.clone(),
            rule_id: Some("RULE_DEV_NODE_MODULES".into()),
            full_path: "C:\\Projects\\node_modules".into(),
            item_type: "DIRECTORY".into(),
            category: "DEV_DEPS".into(),
            risk_level: "CAUTION".into(),
            size_bytes: 104857600,
            delta_bytes: 0,
            is_outside_standard_temp: 0,
            status: "DETECTED".into(),
            last_modified_at: Utc::now().to_rfc3339(),
        };
        batch_insert_detected_items(&mut conn, &[item]).expect("Batch insert failed");

        // Query items
        let items = get_detected_items_by_session(&conn, &session_id, Some("DEV_DEPS"), Some("CAUTION")).expect("Query items failed");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].full_path, "C:\\Projects\\node_modules");

        // Log cleanup
        let log_id = log_cleanup_action(&conn, Some(&item_id), "RECYCLE_BIN", "SUCCESS", 104857600, None).expect("Cleanup log failed");
        assert!(!log_id.is_empty());

        // Test cascade delete of session
        conn.execute("DELETE FROM scan_sessions WHERE id = ?1", params![session_id]).expect("Delete session failed");

        // Snapshots and items should be cascaded
        let snapshots_after = get_snapshots_by_session(&conn, &session_id).expect("Query failed");
        assert_eq!(snapshots_after.len(), 0, "Disk snapshots must be cascade deleted with session");

        let items_after = get_detected_items_by_session(&conn, &session_id, None, None).expect("Query failed");
        assert_eq!(items_after.len(), 0, "Detected items must be cascade deleted with session");

        // Cleanup log should have item_id SET NULL (preserving audit history)
        let cleanup_item_id: Option<String> = conn.query_row(
            "SELECT item_id FROM cleanup_logs WHERE id = ?1",
            params![log_id],
            |r| r.get(0),
        ).unwrap();
        assert!(cleanup_item_id.is_none(), "cleanup_logs.item_id must be SET NULL when item is deleted");
    }

    #[test]
    fn test_spike_events_and_recap() {
        let conn = init_test_db().expect("Failed to initialize test DB");

        let spike_id = record_spike_event(
            &conn,
            None,
            "C",
            524288000,
            15,
            Some("C:\\Users\\AppData\\Local\\Temp"),
            Some("ORPHAN_TEMP"),
        ).expect("Record spike event failed");
        assert!(!spike_id.is_empty());

        let events = get_recent_spike_events(&conn, 10).expect("Get spike events failed");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].drive_letter, "C");
        assert_eq!(events[0].delta_bytes, 524288000);

        // Test recap analytics
        let recap = get_recap_analytics(&conn, "ALL", None).expect("Recap analytics failed");
        assert_eq!(recap.spike_events_count, 1);
    }

    // ========================================================================
    // Adversarial Verification Tests (M1.1 Verification Suite)
    // ========================================================================

    fn create_temp_db_path() -> PathBuf {
        let mut temp = std::env::temp_dir();
        let file_name = format!("scl_adversarial_{}.db", Uuid::new_v4());
        temp.push(file_name);
        temp
    }

    fn cleanup_temp_db(path: &PathBuf) {
        let _ = std::fs::remove_file(path);
        let wal = path.with_extension("db-wal");
        let _ = std::fs::remove_file(wal);
        let shm = path.with_extension("db-shm");
        let _ = std::fs::remove_file(shm);
    }

    #[test]
    fn test_adversarial_wal_mode_and_pragmas_on_disk() {
        let path = create_temp_db_path();
        let conn = init_db_at_path(&path).expect("Failed to init database at disk path");

        // 1. Verify journal_mode = WAL on disk
        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
            .expect("PRAGMA journal_mode query failed");
        assert_eq!(
            journal_mode.to_lowercase(),
            "wal",
            "On-disk database must operate in WAL journal mode"
        );

        // 2. Verify synchronous = NORMAL (1)
        let synchronous: i64 = conn
            .query_row("PRAGMA synchronous;", [], |row| row.get(0))
            .expect("PRAGMA synchronous query failed");
        assert_eq!(synchronous, 1, "PRAGMA synchronous must be NORMAL (1)");

        // 3. Verify foreign_keys = ON (1)
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys;", [], |row| row.get(0))
            .expect("PRAGMA foreign_keys query failed");
        assert_eq!(foreign_keys, 1, "PRAGMA foreign_keys must be ON (1)");

        // 4. Verify busy_timeout = 5000
        let busy_timeout: i64 = conn
            .query_row("PRAGMA busy_timeout;", [], |row| row.get(0))
            .expect("PRAGMA busy_timeout query failed");
        assert_eq!(busy_timeout, 5000, "PRAGMA busy_timeout must be 5000ms");

        // 5. Verify all 6 required tables exist
        let required_tables = [
            "scan_sessions",
            "disk_snapshots",
            "risk_rules",
            "detected_items",
            "spike_events",
            "cleanup_logs",
        ];
        for table in &required_tables {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            assert_eq!(count, 1, "Table '{}' must exist in SQLite database", table);
        }

        // 6. Verify required compound and covering indexes exist
        let required_indexes = [
            "idx_scan_sessions_type_started",
            "idx_scan_sessions_started",
            "idx_disk_snapshots_diff",
            "idx_disk_snapshots_session",
            "idx_risk_rules_category",
            "idx_detected_items_session_cat_risk",
            "idx_detected_items_session_size",
            "idx_detected_items_temp_status",
            "idx_detected_items_path",
            "idx_spike_events_detected",
            "idx_spike_events_session",
            "idx_cleanup_logs_executed",
            "idx_cleanup_logs_item",
        ];
        for idx in &required_indexes {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
                    params![idx],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            assert_eq!(count, 1, "Index '{}' must exist in SQLite database", idx);
        }

        drop(conn);
        cleanup_temp_db(&path);
    }

    #[test]
    fn test_adversarial_strict_foreign_keys() {
        let conn = init_test_db().expect("Failed to init test DB");

        // 1. Invalid session_id in disk_snapshots
        let fake_id = Uuid::new_v4().to_string();
        let res = conn.execute(
            "INSERT INTO disk_snapshots (id, session_id, phase, root_path, total_bytes, file_count, captured_at)
             VALUES ('snap-fail', ?1, 'BEFORE', 'C:\\Test', 100, 1, '2026-11-13T00:00:00Z')",
            params![fake_id],
        );
        assert!(res.is_err(), "Foreign key check must reject invalid session_id in disk_snapshots");

        // 2. Invalid session_id in detected_items
        let res = conn.execute(
            "INSERT INTO detected_items (
                id, session_id, rule_id, full_path, item_type, category, risk_level,
                size_bytes, delta_bytes, is_outside_standard_temp, status, last_modified_at
             ) VALUES ('item-fail', ?1, NULL, 'C:\\test', 'FILE', 'OTHER', 'SAFE', 10, 0, 0, 'DETECTED', '2026-11-13T00:00:00Z')",
            params![fake_id],
        );
        assert!(res.is_err(), "Foreign key check must reject invalid session_id in detected_items");

        // 3. Invalid rule_id in detected_items
        let session_id = create_session(&conn, "DEEP_SCAN").unwrap();
        let res = conn.execute(
            "INSERT INTO detected_items (
                id, session_id, rule_id, full_path, item_type, category, risk_level,
                size_bytes, delta_bytes, is_outside_standard_temp, status, last_modified_at
             ) VALUES ('item-fail-rule', ?1, 'NON_EXISTENT_RULE_ID', 'C:\\test', 'FILE', 'OTHER', 'SAFE', 10, 0, 0, 'DETECTED', '2026-11-13T00:00:00Z')",
            params![session_id],
        );
        assert!(res.is_err(), "Foreign key check must reject invalid rule_id in detected_items");

        // 4. Invalid session_id in spike_events
        let res = conn.execute(
            "INSERT INTO spike_events (id, session_id, drive_letter, delta_bytes, duration_seconds, detected_at)
             VALUES ('spike-fail', ?1, 'C', 1000, 5, '2026-11-13T00:00:00Z')",
            params![fake_id],
        );
        assert!(res.is_err(), "Foreign key check must reject invalid session_id in spike_events");

        // 5. Invalid item_id in cleanup_logs
        let fake_item_id = Uuid::new_v4().to_string();
        let res = conn.execute(
            "INSERT INTO cleanup_logs (id, item_id, action_type, result_status, freed_bytes, executed_at)
             VALUES ('log-fail', ?1, 'RECYCLE_BIN', 'SUCCESS', 500, '2026-11-13T00:00:00Z')",
            params![fake_item_id],
        );
        assert!(res.is_err(), "Foreign key check must reject invalid item_id in cleanup_logs");
    }

    #[test]
    fn test_adversarial_cascade_and_set_null_full_chain() {
        let mut conn = init_test_db().expect("Failed to init test DB");
        let session_id = create_session(&conn, "CODING_SESSION").expect("Failed to create session");

        let _snap1 = insert_snapshot(&conn, &session_id, "BEFORE", "C:\\Dev", 10000, 50).unwrap();
        let _snap2 = insert_snapshot(&conn, &session_id, "AFTER", "C:\\Dev", 15000, 60).unwrap();

        let item1_id = Uuid::new_v4().to_string();
        let item2_id = Uuid::new_v4().to_string();
        let item1 = DetectedItemRow {
            id: item1_id.clone(),
            session_id: session_id.clone(),
            rule_id: Some("RULE_AI_GEMINI".into()),
            full_path: "C:\\Dev\\.gemini".into(),
            item_type: "DIRECTORY".into(),
            category: "AI_IDE".into(),
            risk_level: "SAFE".into(),
            size_bytes: 500000,
            delta_bytes: 500000,
            is_outside_standard_temp: 0,
            status: "DETECTED".into(),
            last_modified_at: Utc::now().to_rfc3339(),
        };
        let item2 = DetectedItemRow {
            id: item2_id.clone(),
            session_id: session_id.clone(),
            rule_id: Some("RULE_DEV_NODE_MODULES".into()),
            full_path: "C:\\Dev\\node_modules".into(),
            item_type: "DIRECTORY".into(),
            category: "DEV_DEPS".into(),
            risk_level: "CAUTION".into(),
            size_bytes: 800000,
            delta_bytes: 800000,
            is_outside_standard_temp: 0,
            status: "DETECTED".into(),
            last_modified_at: Utc::now().to_rfc3339(),
        };
        batch_insert_detected_items(&mut conn, &[item1, item2]).expect("Batch insert items failed");

        let spike_id = record_spike_event(
            &conn,
            Some(&session_id),
            "C",
            50000000,
            10,
            Some("C:\\Dev"),
            Some("DEV_DEPS"),
        ).expect("Record spike failed");

        let log1_id = log_cleanup_action(&conn, Some(&item1_id), "RECYCLE_BIN", "SUCCESS", 500000, None).unwrap();
        let log2_id = log_cleanup_action(&conn, Some(&item2_id), "PERMANENT", "SUCCESS", 800000, None).unwrap();

        // 1. Delete item1 -> log1.item_id becomes NULL
        conn.execute("DELETE FROM detected_items WHERE id = ?1", params![item1_id]).expect("Delete item1 failed");
        let log1_item: Option<String> = conn.query_row("SELECT item_id FROM cleanup_logs WHERE id = ?1", params![log1_id], |r| r.get(0)).unwrap();
        assert!(log1_item.is_none(), "log1.item_id must be NULL after item1 deletion (SET NULL)");

        // 2. Delete rule RULE_DEV_NODE_MODULES -> item2.rule_id becomes NULL
        conn.execute("DELETE FROM risk_rules WHERE id = 'RULE_DEV_NODE_MODULES'", []).expect("Delete rule failed");
        let item2_rule: Option<String> = conn.query_row("SELECT rule_id FROM detected_items WHERE id = ?1", params![item2_id], |r| r.get(0)).unwrap();
        assert!(item2_rule.is_none(), "item2.rule_id must be NULL after rule deletion (SET NULL)");

        // 3. Delete session S1 -> cascade deletes snapshots and item2; sets spike_events.session_id and log2.item_id to NULL
        conn.execute("DELETE FROM scan_sessions WHERE id = ?1", params![session_id]).expect("Delete session failed");

        let snap_count: i64 = conn.query_row("SELECT COUNT(*) FROM disk_snapshots WHERE session_id = ?1", params![session_id], |r| r.get(0)).unwrap();
        assert_eq!(snap_count, 0, "Disk snapshots must cascade delete with session");

        let item_count: i64 = conn.query_row("SELECT COUNT(*) FROM detected_items WHERE session_id = ?1", params![session_id], |r| r.get(0)).unwrap();
        assert_eq!(item_count, 0, "Detected items must cascade delete with session");

        let spike_sess: Option<String> = conn.query_row("SELECT session_id FROM spike_events WHERE id = ?1", params![spike_id], |r| r.get(0)).unwrap();
        assert!(spike_sess.is_none(), "spike_events.session_id must be SET NULL on session delete");

        let log2_item: Option<String> = conn.query_row("SELECT item_id FROM cleanup_logs WHERE id = ?1", params![log2_id], |r| r.get(0)).unwrap();
        assert!(log2_item.is_none(), "cleanup_logs.item_id must be SET NULL when item is cascaded");
    }

    #[test]
    fn test_adversarial_check_constraints() {
        let conn = init_test_db().expect("Failed to init test DB");
        let session_id = create_session(&conn, "DEEP_SCAN").unwrap();

        // 1. Invalid session_type
        assert!(conn.execute("INSERT INTO scan_sessions (id, session_type, status, started_at) VALUES ('s1', 'INVALID', 'RUNNING', 'now')", []).is_err());
        // 2. Invalid session status
        assert!(conn.execute("INSERT INTO scan_sessions (id, session_type, status, started_at) VALUES ('s2', 'DEEP_SCAN', 'FAILED', 'now')", []).is_err());
        // 3. Invalid snapshot phase
        assert!(conn.execute("INSERT INTO disk_snapshots (id, session_id, phase, root_path, total_bytes, file_count, captured_at) VALUES ('snap1', ?1, 'DURING', 'C:\\', 1, 1, 'now')", params![session_id]).is_err());
        // 4. Invalid risk rule category
        assert!(conn.execute("INSERT INTO risk_rules (id, pattern_name, category, default_risk_level, origin_explanation, deletion_impact) VALUES ('r1', 'P', 'UNKNOWN', 'SAFE', 'E', 'I')", []).is_err());
        // 5. Invalid risk rule level
        assert!(conn.execute("INSERT INTO risk_rules (id, pattern_name, category, default_risk_level, origin_explanation, deletion_impact) VALUES ('r2', 'P', 'AI_IDE', 'FATAL', 'E', 'I')", []).is_err());
        // 6. Invalid detected item item_type
        assert!(conn.execute("INSERT INTO detected_items (id, session_id, full_path, item_type, category, risk_level, size_bytes, last_modified_at) VALUES ('i1', ?1, 'C:\\', 'SOCKET', 'AI_IDE', 'SAFE', 1, 'now')", params![session_id]).is_err());
        // 7. Invalid is_outside_standard_temp
        assert!(conn.execute("INSERT INTO detected_items (id, session_id, full_path, item_type, category, risk_level, size_bytes, is_outside_standard_temp, last_modified_at) VALUES ('i2', ?1, 'C:\\', 'FILE', 'AI_IDE', 'SAFE', 1, 5, 'now')", params![session_id]).is_err());
        // 8. Invalid detected item status
        assert!(conn.execute("INSERT INTO detected_items (id, session_id, full_path, item_type, category, risk_level, size_bytes, status, last_modified_at) VALUES ('i3', ?1, 'C:\\', 'FILE', 'AI_IDE', 'SAFE', 1, 'BOGUS', 'now')", params![session_id]).is_err());
        // 9. Invalid cleanup action_type
        assert!(conn.execute("INSERT INTO cleanup_logs (id, action_type, result_status, executed_at) VALUES ('l1', 'SHRED', 'SUCCESS', 'now')", []).is_err());
        // 10. Invalid cleanup result_status
        assert!(conn.execute("INSERT INTO cleanup_logs (id, action_type, result_status, executed_at) VALUES ('l2', 'RECYCLE_BIN', 'HALTED', 'now')", []).is_err());
    }

    #[test]
    fn test_adversarial_seed_stress_and_self_healing() {
        let conn = init_test_db().expect("Failed to init test DB");

        // 20 consecutive seed calls
        for _ in 0..20 {
            let count = seed::seed_risk_rules(&conn).expect("Seed failed");
            assert_eq!(count, 13);
        }

        // Verify all 13 canonical risk rules exist
        let expected = [
            "RULE_AI_GEMINI", "RULE_AI_CURSOR", "RULE_AI_OLLAMA",
            "RULE_DEV_NODE_MODULES", "RULE_DEV_TARGET", "RULE_DEV_VENV",
            "RULE_DEV_PNPM_STORE", "RULE_DEV_NEXT", "RULE_DEV_GIT_PACK",
            "RULE_ORPHAN_TEMP_STD", "RULE_ORPHAN_SCATTER",
            "RULE_VIRT_VHDX", "RULE_VIRT_AVD",
        ];
        for id in &expected {
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM risk_rules WHERE id = ?1", params![id], |r| r.get(0)).unwrap();
            assert_eq!(count, 1, "Rule {} must exist", id);
        }

        // Tamper test
        conn.execute("UPDATE risk_rules SET origin_explanation = 'CORRUPTED' WHERE id = 'RULE_AI_GEMINI'", []).unwrap();
        seed::seed_risk_rules(&conn).unwrap();
        let healed: String = conn.query_row("SELECT origin_explanation FROM risk_rules WHERE id = 'RULE_AI_GEMINI'", [], |r| r.get(0)).unwrap();
        assert_ne!(healed, "CORRUPTED");
        assert!(healed.contains("scratchpad"));
    }

    #[test]
    fn test_adversarial_paths_unicode_spaces_emojis_and_sqli() {
        let mut conn = init_test_db().expect("Failed to init test DB");
        let session_id = create_session(&conn, "DEEP_SCAN").unwrap();

        let long_segment = "VeryLongDirectoryNameExceedingStandardWin32MAX_PATH_Constraint_260_Characters_";
        let extended_path = format!(r#"\\?\C:\{0}\{0}\{0}\target\debug\output.exe"#, long_segment);
        let unicode_path = r#"C:\Users\Ливн\Проекты\🚀_Rocket_App_2026\你好\프로젝트\خزانة\node_modules\@scoped\package\index.js"#;
        let sqli_path = r#"C:\Projects\O'Reilly's "Weird" & Path\100%_clean\path\with;DROP TABLE scan_sessions;--\"#;
        let special_chars_path = r#"C:\Program Files (x86)\Common Files\Test [Folder] #1 + v2.0 %20\cache.tmp"#;

        let items = vec![
            DetectedItemRow {
                id: "item-ext".into(),
                session_id: session_id.clone(),
                rule_id: Some("RULE_DEV_TARGET".into()),
                full_path: extended_path.clone(),
                item_type: "FILE".into(),
                category: "DEV_DEPS".into(),
                risk_level: "CAUTION".into(),
                size_bytes: 1048576,
                delta_bytes: 0,
                is_outside_standard_temp: 0,
                status: "DETECTED".into(),
                last_modified_at: Utc::now().to_rfc3339(),
            },
            DetectedItemRow {
                id: "item-uni".into(),
                session_id: session_id.clone(),
                rule_id: Some("RULE_DEV_NODE_MODULES".into()),
                full_path: unicode_path.into(),
                item_type: "FILE".into(),
                category: "DEV_DEPS".into(),
                risk_level: "CAUTION".into(),
                size_bytes: 2048,
                delta_bytes: 0,
                is_outside_standard_temp: 0,
                status: "DETECTED".into(),
                last_modified_at: Utc::now().to_rfc3339(),
            },
            DetectedItemRow {
                id: "item-sqli".into(),
                session_id: session_id.clone(),
                rule_id: None,
                full_path: sqli_path.into(),
                item_type: "FILE".into(),
                category: "OTHER".into(),
                risk_level: "SAFE".into(),
                size_bytes: 4096,
                delta_bytes: 0,
                is_outside_standard_temp: 0,
                status: "DETECTED".into(),
                last_modified_at: Utc::now().to_rfc3339(),
            },
            DetectedItemRow {
                id: "item-spec".into(),
                session_id: session_id.clone(),
                rule_id: Some("RULE_ORPHAN_SCATTER".into()),
                full_path: special_chars_path.into(),
                item_type: "FILE".into(),
                category: "ORPHAN_TEMP".into(),
                risk_level: "SAFE".into(),
                size_bytes: 8192,
                delta_bytes: 0,
                is_outside_standard_temp: 1,
                status: "DETECTED".into(),
                last_modified_at: Utc::now().to_rfc3339(),
            },
        ];

        batch_insert_detected_items(&mut conn, &items).expect("Batch insert failed");

        let retrieved = get_detected_items_by_session(&conn, &session_id, None, None).unwrap();
        assert_eq!(retrieved.len(), 4);

        assert_eq!(retrieved.iter().find(|i| i.id == "item-ext").unwrap().full_path, extended_path);
        assert_eq!(retrieved.iter().find(|i| i.id == "item-uni").unwrap().full_path, unicode_path);
        assert_eq!(retrieved.iter().find(|i| i.id == "item-sqli").unwrap().full_path, sqli_path);
        assert_eq!(retrieved.iter().find(|i| i.id == "item-spec").unwrap().full_path, special_chars_path);

        let session_count: i64 = conn.query_row("SELECT COUNT(*) FROM scan_sessions", [], |r| r.get(0)).unwrap();
        assert_eq!(session_count, 1, "scan_sessions table must remain intact after SQL injection payload test");
    }

    #[test]
    fn test_adversarial_large_payloads_and_boundaries() {
        let conn = init_test_db().expect("Failed to init test DB");

        // Large error message: 180,000 chars
        let large_error: String = "E_ACCESS_DENIED_WHILE_CLEANING_FILE_".repeat(5000);
        let log_id = log_cleanup_action(&conn, None, "PERMANENT", "FAILED", 0, Some(&large_error)).unwrap();
        let ret_err: Option<String> = conn.query_row("SELECT error_message FROM cleanup_logs WHERE id = ?1", params![log_id], |r| r.get(0)).unwrap();
        assert_eq!(ret_err, Some(large_error));

        // Numeric boundaries
        let session_id = create_session(&conn, "DEEP_SCAN").unwrap();
        complete_session(&conn, &session_id, i64::MAX, i64::MAX, 100_000_000).unwrap();
        let session = get_session(&conn, &session_id).unwrap().unwrap();
        assert_eq!(session.ended_used_bytes, i64::MAX);

        // Empty DB recap analytics
        let empty_recap = get_recap_analytics(&conn, "ALL", Some(&session_id)).unwrap();
        assert_eq!(empty_recap.total_freed_bytes, 0);
        assert_eq!(empty_recap.total_scanned_bytes, 0);
        assert_eq!(empty_recap.top_culprits.len(), 0);
    }

    #[test]
    fn test_adversarial_wal_file_concurrency() {
        let path = create_temp_db_path();
        let _init = init_db_at_path(&path).expect("Failed to init disk DB");

        // Test multiple connections sequentially and interleaved to same file
        let conn1 = Connection::open(&path).unwrap();
        schema::configure_pragmas(&conn1).unwrap();

        let conn2 = Connection::open(&path).unwrap();
        schema::configure_pragmas(&conn2).unwrap();

        let sid1 = create_session(&conn1, "BACKGROUND_WATCH").unwrap();
        let sid2 = create_session(&conn2, "BACKGROUND_WATCH").unwrap();

        let s1 = get_session(&conn2, &sid1).unwrap();
        assert!(s1.is_some());

        let s2 = get_session(&conn1, &sid2).unwrap();
        assert!(s2.is_some());

        drop(conn1);
        drop(conn2);
        cleanup_temp_db(&path);
    }
}
