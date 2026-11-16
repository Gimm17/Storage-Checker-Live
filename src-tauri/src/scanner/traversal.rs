// src-tauri/src/scanner/traversal.rs
// Storage Checker Live - Multi-Threaded Parallel Disk Scanner (jwalk + rayon)

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;

use super::orphan_temp::{is_adjacent_to_active_db, is_inside_standard_temp, is_temp_file_extension};
use super::size_on_disk::calculate_file_size_on_disk;
use crate::risk::{assess_risk, inspect_git_security, is_protected_path};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressEvent {
    pub scanned_files: u64,
    pub scanned_bytes: u64,
    pub current_path: String,
    pub found_items_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedBloatItem {
    pub id: String,
    pub session_id: String,
    pub full_path: String,
    pub item_type: String, // 'FILE' | 'DIRECTORY'
    pub category: String,  // 'AI_IDE' | 'DEV_DEPS' | 'ORPHAN_TEMP' | 'VIRTUALIZATION' | 'OTHER'
    pub risk_level: String, // 'SAFE' | 'CAUTION' | 'DANGER'
    pub size_bytes: u64,
    pub size_on_disk_bytes: u64,
    pub is_outside_standard_temp: bool,
    pub origin_explanation: String,
    pub deletion_impact: String,
    pub special_action: Option<String>,
    pub rebuild_suggestion: Option<String>,
    pub last_modified_at: String,
}

/// Identifies if a directory name corresponds to a known developer or AI bloat folder.
fn identify_bloat_directory(name: &str) -> Option<(&'static str, &'static str)> {
    let lower = name.to_lowercase();
    match lower.as_str() {
        "node_modules" => Some(("DEV_DEPS", "Node.js dependencies folder")),
        "target" => Some(("DEV_DEPS", "Rust / Cargo compilation artifacts")),
        ".venv" | "venv" | "env" => Some(("DEV_DEPS", "Python virtual environment")),
        ".pnpm-store" => Some(("DEV_DEPS", "pnpm global package store cache")),
        "vendor" => Some(("DEV_DEPS", "PHP Composer / Go vendor directory")),
        ".gradle" => Some(("DEV_DEPS", "Gradle build tool cache")),
        ".m2" => Some(("DEV_DEPS", "Maven repository cache")),
        ".next" | ".nuxt" | ".turbo" | ".svelte-kit" => Some(("DEV_DEPS", "Frontend framework compilation cache")),
        ".gemini" => Some(("AI_IDE", "Antigravity & Gemini CLI conversation logs & brain cache")),
        ".cursor" => Some(("AI_IDE", "Cursor AI editor indexing and model storage")),
        ".windsurf" => Some(("AI_IDE", "Windsurf IDE workspace cache")),
        ".continue" => Some(("AI_IDE", "Continue.dev extension local cache")),
        ".ollama" => Some(("AI_IDE", "Ollama local LLM model weights")),
        "huggingface" => Some(("AI_IDE", "HuggingFace cache and models")),
        "avd" => Some(("VIRTUALIZATION", "Android Studio virtual device emulator")),
        _ => None,
    }
}

/// Fast recursive folder size calculator.
pub fn calculate_directory_size(dir: &Path) -> (u64, u64, u64) {
    let mut total_bytes: u64 = 0;
    let mut total_disk_bytes: u64 = 0;
    let mut file_count: u64 = 0;

    for entry in jwalk::WalkDir::new(dir).skip_hidden(false).follow_links(false) {
        if let Ok(entry) = entry {
            if entry.file_type().is_file() {
                if let Ok(meta) = entry.metadata() {
                    let len = meta.len();
                    total_bytes += len;
                    total_disk_bytes += calculate_file_size_on_disk(entry.path(), len);
                    file_count += 1;
                }
            }
        }
    }

    (total_bytes, total_disk_bytes, file_count)
}

/// Performs a multi-threaded deep scan of target paths.
pub fn execute_deep_scan(
    session_id: &str,
    target_paths: &[PathBuf],
    cancel_token: &Arc<AtomicBool>,
    conn: &mut Connection,
    progress_callback: impl Fn(ScanProgressEvent),
) -> Result<Vec<ScannedBloatItem>, String> {
    let mut found_items = Vec::new();
    let mut total_scanned_files: u64 = 0;
    let mut total_scanned_bytes: u64 = 0;
    let mut last_progress_time = Instant::now();

    for target_root in target_paths {
        if cancel_token.load(Ordering::SeqCst) {
            break;
        }

        if !target_root.exists() {
            continue;
        }

        // Configure jwalk multi-threaded traversal with skip logic on bloat & protected directories
        let walker = jwalk::WalkDir::new(target_root)
            .skip_hidden(false)
            .follow_links(false)
            .process_read_dir(|_depth, _path, _state, children| {
                for entry_res in children.iter_mut() {
                    if let Ok(entry) = entry_res {
                        if entry.file_type().is_dir() {
                            let name = entry.file_name().to_string_lossy();
                            if identify_bloat_directory(&name).is_some() || is_protected_path(&entry.path()) {
                                entry.read_children_path = None;
                            }
                        }
                    }
                }
            });

        for entry_res in walker {
            if cancel_token.load(Ordering::SeqCst) {
                break;
            }

            let entry = match entry_res {
                Ok(e) => e,
                Err(_) => continue, // Silently ignore permission denied
            };

            let path = entry.path();
            let file_type = entry.file_type();
            let file_name = entry.file_name().to_string_lossy().to_string();

            // Emit progress event throttled to ~100ms
            total_scanned_files += 1;
            if last_progress_time.elapsed().as_millis() >= 100 {
                progress_callback(ScanProgressEvent {
                    scanned_files: total_scanned_files,
                    scanned_bytes: total_scanned_bytes,
                    current_path: path.to_string_lossy().to_string(),
                    found_items_count: found_items.len() as u64,
                });
                last_progress_time = Instant::now();
            }

            // 1. Check for Directory-Level Bloat (node_modules, target, .gemini, etc.)
            if file_type.is_dir() {
                if is_protected_path(&path) {
                    continue;
                }

                if let Some((category, _desc)) = identify_bloat_directory(&file_name) {
                    let (dir_size, dir_disk_size, _) = calculate_directory_size(&path);
                    total_scanned_bytes += dir_size;

                    // Skip tiny empty folders (< 100 KB)
                    if dir_size >= 100 * 1024 {
                        let git_status = inspect_git_security(&path);
                        let risk = assess_risk(&path, category, &git_status, false);

                        let item = ScannedBloatItem {
                            id: Uuid::new_v4().to_string(),
                            session_id: session_id.to_string(),
                            full_path: path.to_string_lossy().to_string(),
                            item_type: "DIRECTORY".into(),
                            category: category.into(),
                            risk_level: risk.level.as_str().into(),
                            size_bytes: dir_size,
                            size_on_disk_bytes: dir_disk_size,
                            is_outside_standard_temp: false,
                            origin_explanation: risk.origin_explanation,
                            deletion_impact: risk.deletion_impact,
                            special_action: risk.special_action,
                            rebuild_suggestion: risk.rebuild_suggestion,
                            last_modified_at: Utc::now().to_rfc3339(),
                        };

                        found_items.push(item);
                    }
                    continue;
                }
            } else if file_type.is_file() {
                let meta = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let size = meta.len();
                total_scanned_bytes += size;

                let lower_name = file_name.to_lowercase();

                // 2. Virtual Disk / Container Check (.vhdx, .vmdk, .vdi)
                if lower_name.ends_with(".vhdx") || lower_name.ends_with(".vhd") || lower_name.ends_with(".vmdk") || lower_name.ends_with(".vdi") {
                    let disk_size = calculate_file_size_on_disk(&path, size);
                    let git_status = inspect_git_security(&path);
                    let risk = assess_risk(&path, "VIRTUALIZATION", &git_status, false);

                    found_items.push(ScannedBloatItem {
                        id: Uuid::new_v4().to_string(),
                        session_id: session_id.to_string(),
                        full_path: path.to_string_lossy().to_string(),
                        item_type: "FILE".into(),
                        category: "VIRTUALIZATION".into(),
                        risk_level: risk.level.as_str().into(),
                        size_bytes: size,
                        size_on_disk_bytes: disk_size,
                        is_outside_standard_temp: false,
                        origin_explanation: risk.origin_explanation,
                        deletion_impact: risk.deletion_impact,
                        special_action: risk.special_action,
                        rebuild_suggestion: risk.rebuild_suggestion,
                        last_modified_at: Utc::now().to_rfc3339(),
                    });
                }
                // 3. Orphaned Temp Hunter (.tmp, .temp, .bak, .old, .dmp, .log)
                else if is_temp_file_extension(&path) && size >= 50 * 1024 { // filter items >= 50 KB
                    let in_std_temp = is_inside_standard_temp(&path);
                    let is_active_db = is_adjacent_to_active_db(&path);
                    let git_status = inspect_git_security(&path);

                    let risk = assess_risk(&path, "ORPHAN_TEMP", &git_status, is_active_db);
                    let disk_size = calculate_file_size_on_disk(&path, size);

                    found_items.push(ScannedBloatItem {
                        id: Uuid::new_v4().to_string(),
                        session_id: session_id.to_string(),
                        full_path: path.to_string_lossy().to_string(),
                        item_type: "FILE".into(),
                        category: "ORPHAN_TEMP".into(),
                        risk_level: risk.level.as_str().into(),
                        size_bytes: size,
                        size_on_disk_bytes: disk_size,
                        is_outside_standard_temp: !in_std_temp,
                        origin_explanation: risk.origin_explanation,
                        deletion_impact: risk.deletion_impact,
                        special_action: risk.special_action,
                        rebuild_suggestion: risk.rebuild_suggestion,
                        last_modified_at: Utc::now().to_rfc3339(),
                    });
                }
            }
        }
    }

    // Persist discovered items to SQLite database
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for item in &found_items {
        let is_outside = if item.is_outside_standard_temp { 1 } else { 0 };
        let _ = tx.execute(
            "INSERT OR REPLACE INTO detected_items (
                id, session_id, rule_id, full_path, item_type, category, risk_level,
                size_bytes, delta_bytes, is_outside_standard_temp, status, last_modified_at
             ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, 0, ?8, 'DETECTED', ?9)",
            rusqlite::params![
                item.id,
                item.session_id,
                item.full_path,
                item.item_type,
                item.category,
                item.risk_level,
                item.size_bytes as i64,
                is_outside,
                item.last_modified_at
            ],
        );
    }
    tx.commit().map_err(|e| e.to_string())?;

    // Final progress update
    progress_callback(ScanProgressEvent {
        scanned_files: total_scanned_files,
        scanned_bytes: total_scanned_bytes,
        current_path: "Completed".into(),
        found_items_count: found_items.len() as u64,
    });

    Ok(found_items)
}
