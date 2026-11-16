// src-tauri/src/session/diff.rs
// Storage Checker Live - Session Baseline Snapshot & Diff Analyzer

use std::path::PathBuf;
use rusqlite::Connection;
use uuid::Uuid;
use chrono::Utc;

use crate::scanner::calculate_directory_size;

#[derive(Debug, Clone)]
pub struct FolderSnapshot {
    pub path: String,
    pub total_bytes: u64,
    pub file_count: u64,
}

/// Takes a hierarchy snapshot of watch paths (level 1-3 subdirectories).
pub fn capture_hierarchy_snapshot(watch_paths: &[PathBuf]) -> Vec<FolderSnapshot> {
    let mut snapshots = Vec::new();

    for root in watch_paths {
        if !root.exists() {
            continue;
        }

        // Add root itself
        let (root_bytes, _, root_files) = calculate_directory_size(root);
        snapshots.push(FolderSnapshot {
            path: root.to_string_lossy().to_string(),
            total_bytes: root_bytes,
            file_count: root_files,
        });

        // Add immediate subdirectories
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let (sub_bytes, _, sub_files) = calculate_directory_size(&p);
                    snapshots.push(FolderSnapshot {
                        path: p.to_string_lossy().to_string(),
                        total_bytes: sub_bytes,
                        file_count: sub_files,
                    });
                }
            }
        }
    }

    snapshots
}

/// Starts a coding session: records baseline snapshot to SQLite.
pub fn start_session(
    session_id: &str,
    watch_paths: &[PathBuf],
    conn: &mut Connection,
) -> Result<u64, String> {
    let snapshots = capture_hierarchy_snapshot(watch_paths);
    let mut total_baseline_bytes: u64 = 0;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for snap in &snapshots {
        total_baseline_bytes += snap.total_bytes;
        let _ = tx.execute(
            "INSERT INTO disk_snapshots (id, session_id, phase, root_path, total_bytes, file_count, captured_at)
             VALUES (?1, ?2, 'BEFORE', ?3, ?4, ?5, ?6)",
            rusqlite::params![
                Uuid::new_v4().to_string(),
                session_id,
                snap.path,
                snap.total_bytes as i64,
                snap.file_count as i64,
                Utc::now().to_rfc3339()
            ],
        );
    }

    let _ = tx.execute(
        "UPDATE scan_sessions SET baseline_used_bytes = ?2 WHERE id = ?1",
        rusqlite::params![session_id, total_baseline_bytes as i64],
    );

    tx.commit().map_err(|e| e.to_string())?;
    Ok(total_baseline_bytes)
}

/// Compares AFTER snapshot against BEFORE snapshot to compute delta bloat.
pub fn compare_session(
    session_id: &str,
    watch_paths: &[PathBuf],
    conn: &mut Connection,
) -> Result<crate::SessionDiffSummary, String> {
    let after_snapshots = capture_hierarchy_snapshot(watch_paths);
    let now = Utc::now().to_rfc3339();

    // Persist AFTER snapshots
    let mut total_after_bytes: u64 = 0;
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for snap in &after_snapshots {
            total_after_bytes += snap.total_bytes;
            let _ = tx.execute(
                "INSERT INTO disk_snapshots (id, session_id, phase, root_path, total_bytes, file_count, captured_at)
                 VALUES (?1, ?2, 'AFTER', ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    Uuid::new_v4().to_string(),
                    session_id,
                    snap.path,
                    snap.total_bytes as i64,
                    snap.file_count as i64,
                    now
                ],
            );
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    // Retrieve BEFORE snapshots from database
    let mut before_map = std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT root_path, total_bytes FROM disk_snapshots WHERE session_id = ?1 AND phase = 'BEFORE'")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(rusqlite::params![session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for r in rows.flatten() {
            before_map.insert(r.0, r.1 as u64);
        }
    }

    let mut expanded_folders = Vec::new();
    let mut new_items = Vec::new();
    let mut total_delta: i64 = 0;

    for after in &after_snapshots {
        match before_map.get(&after.path) {
            Some(&before_bytes) => {
                let delta = (after.total_bytes as i64) - (before_bytes as i64);
                if delta > 0 {
                    total_delta += delta;
                    expanded_folders.push(crate::ExpandedFolderItem {
                        path: after.path.clone(),
                        delta_bytes: delta,
                        current_bytes: after.total_bytes,
                    });
                }
            }
            None => {
                // Completely new folder created during session
                total_delta += after.total_bytes as i64;
                new_items.push(crate::NewItem {
                    path: after.path.clone(),
                    size_bytes: after.total_bytes,
                    category: "DEVELOPMENT".into(),
                });
            }
        }
    }

    // Sort expanded folders by delta descending
    expanded_folders.sort_by(|a, b| b.delta_bytes.cmp(&a.delta_bytes));

    // Calculate duration
    let started_at_str: Result<String, _> = conn.query_row(
        "SELECT started_at FROM scan_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| row.get(0),
    );

    let duration_seconds = match started_at_str {
        Ok(s) => match chrono::DateTime::parse_from_rfc3339(&s) {
            Ok(start_dt) => (Utc::now() - start_dt.with_timezone(&Utc)).num_seconds().max(0) as u64,
            Err(_) => 0,
        },
        Err(_) => 0,
    };

    let _ = conn.execute(
        "UPDATE scan_sessions SET ended_used_bytes = ?2, status = 'COMPLETED', ended_at = ?3 WHERE id = ?1",
        rusqlite::params![session_id, total_after_bytes as i64, now],
    );

    Ok(crate::SessionDiffSummary {
        session_id: session_id.to_string(),
        duration_seconds,
        total_delta_bytes: total_delta,
        expanded_folders,
        new_items,
    })
}
