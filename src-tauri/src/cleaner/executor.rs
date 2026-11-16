// src-tauri/src/cleaner/executor.rs
// Storage Checker Live - Safe Cleanup Executor (Recycle Bin & Permanent Delete)

use std::path::Path;
use rusqlite::Connection;
use uuid::Uuid;
use chrono::Utc;

use super::process_lock::check_process_lock;
use crate::risk::is_protected_path;

pub struct CleanupExecutionReport {
    pub successful_ids: Vec<String>,
    pub skipped_locked: Vec<(String, String)>, // (id, process_name)
    pub failed_items: Vec<(String, String)>,    // (id, error_message)
    pub total_freed_bytes: u64,
}

/// Normalizes path for Windows extended-length paths (\\?\) to support > 260 character deep nesting.
fn normalize_windows_path<P: AsRef<Path>>(path: P) -> std::path::PathBuf {
    let p = path.as_ref();
    let s = p.to_string_lossy();
    if s.starts_with("\\\\?\\") {
        p.to_path_buf()
    } else {
        std::path::PathBuf::from(format!("\\\\?\\{}", s.replace('/', "\\")))
    }
}

/// Executes a batch cleanup on requested item IDs with strict safety guards.
pub fn execute_cleanup_batch(
    item_ids: &[String],
    mode: &str, // "RECYCLE_BIN" | "PERMANENT"
    conn: &mut Connection,
) -> Result<CleanupExecutionReport, String> {
    let mut report = CleanupExecutionReport {
        successful_ids: Vec::new(),
        skipped_locked: Vec::new(),
        failed_items: Vec::new(),
        total_freed_bytes: 0,
    };

    for id in item_ids {
        // Query item details
        let item_query: Result<(String, String, i64), _> = conn.query_row(
            "SELECT full_path, item_type, size_bytes FROM detected_items WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        );

        let (path_str, item_type, size_bytes) = match item_query {
            Ok(data) => data,
            Err(e) => {
                report.failed_items.push((id.clone(), format!("Item not found in database: {}", e)));
                continue;
            }
        };

        let target_path = std::path::PathBuf::from(&path_str);

        // 1. Hardcoded Protected System Path Guard
        if is_protected_path(&target_path) {
            report.failed_items.push((id.clone(), "Path is protected by Windows system policy and cannot be deleted.".into()));
            let _ = conn.execute(
                "INSERT INTO cleanup_logs (id, item_id, action_type, result_status, freed_bytes, error_message, executed_at)
                 VALUES (?1, ?2, ?3, 'FAILED', 0, 'Protected system path', ?4)",
                rusqlite::params![Uuid::new_v4().to_string(), id, mode, Utc::now().to_rfc3339()],
            );
            continue;
        }

        // 2. VHDX Virtual Disk Direct Deletion Block
        let lower = path_str.to_lowercase();
        if lower.ends_with(".vhdx") || lower.ends_with(".vhd") {
            report.failed_items.push((id.clone(), "Direct deletion of virtual disk (.vhdx) is blocked. Use 'Safe Compact' instead.".into()));
            continue;
        }

        // 3. Process Lock Detection Guard
        let lock_info = check_process_lock(&target_path);
        if lock_info.is_locked {
            let proc_name = lock_info.locking_process_name.unwrap_or_else(|| "Unknown process".into());
            report.skipped_locked.push((id.clone(), proc_name.clone()));

            let _ = conn.execute(
                "UPDATE detected_items SET status = 'SKIPPED_LOCKED' WHERE id = ?1",
                rusqlite::params![id],
            );
            let _ = conn.execute(
                "INSERT INTO cleanup_logs (id, item_id, action_type, result_status, freed_bytes, error_message, executed_at)
                 VALUES (?1, ?2, ?3, 'SKIPPED_LOCKED', 0, ?4, ?5)",
                rusqlite::params![Uuid::new_v4().to_string(), id, mode, format!("Locked by {}", proc_name), Utc::now().to_rfc3339()],
            );
            continue;
        }

        if !target_path.exists() {
            // Already gone or moved
            report.successful_ids.push(id.clone());
            let _ = conn.execute("UPDATE detected_items SET status = 'MOVED_TO_TRASH' WHERE id = ?1", rusqlite::params![id]);
            continue;
        }

        // 4. Execution: Recycle Bin vs Permanent
        let delete_result: Result<(), String> = if mode == "PERMANENT" {
            let norm_path = normalize_windows_path(&target_path);
            let res = if item_type == "DIRECTORY" {
                std::fs::remove_dir_all(&norm_path).or_else(|_| std::fs::remove_dir_all(&target_path))
            } else {
                std::fs::remove_file(&norm_path).or_else(|_| std::fs::remove_file(&target_path))
            };
            res.map_err(|e| e.to_string())
        } else {
            // Default: Move to Windows Recycle Bin via trash crate
            trash::delete(&target_path).map_err(|e| e.to_string())
        };

        match delete_result {
            Ok(_) => {
                let status_str = if mode == "PERMANENT" { "PERMANENTLY_DELETED" } else { "MOVED_TO_TRASH" };
                report.successful_ids.push(id.clone());
                report.total_freed_bytes += size_bytes as u64;

                let _ = conn.execute(
                    "UPDATE detected_items SET status = ?2 WHERE id = ?1",
                    rusqlite::params![id, status_str],
                );
                let _ = conn.execute(
                    "INSERT INTO cleanup_logs (id, item_id, action_type, result_status, freed_bytes, error_message, executed_at)
                     VALUES (?1, ?2, ?3, 'SUCCESS', ?4, NULL, ?5)",
                    rusqlite::params![Uuid::new_v4().to_string(), id, mode, size_bytes, Utc::now().to_rfc3339()],
                );
            }
            Err(e) => {
                let err_msg = format!("Filesystem error: {}", e);
                report.failed_items.push((id.clone(), err_msg.clone()));

                let _ = conn.execute(
                    "INSERT INTO cleanup_logs (id, item_id, action_type, result_status, freed_bytes, error_message, executed_at)
                     VALUES (?1, ?2, ?3, 'FAILED', 0, ?4, ?5)",
                    rusqlite::params![Uuid::new_v4().to_string(), id, mode, err_msg, Utc::now().to_rfc3339()],
                );
            }
        }
    }

    Ok(report)
}
