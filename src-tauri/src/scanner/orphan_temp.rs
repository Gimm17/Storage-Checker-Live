// src-tauri/src/scanner/orphan_temp.rs
// Storage Checker Live - Orphaned Temp File & Database Context Detector

use std::path::Path;

/// Checks if a file path is located inside standard Windows Temp folders:
/// - `%LOCALAPPDATA%\Temp`
/// - `C:\Windows\Temp`
pub fn is_inside_standard_temp<P: AsRef<Path>>(path: P) -> bool {
    let path = path.as_ref();
    let lower = path.to_string_lossy().to_lowercase().replace('/', "\\");

    if lower.starts_with("c:\\windows\\temp") {
        return true;
    }

    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let std_temp = format!("{}\\temp", local_appdata.to_lowercase().replace('/', "\\"));
        if lower.starts_with(&std_temp) {
            return true;
        }
    }

    false
}

/// Checks whether a file has a temporary, backup, or diagnostic dump extension.
pub fn is_temp_file_extension<P: AsRef<Path>>(path: P) -> bool {
    let path = path.as_ref();
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(e) => e.to_lowercase(),
        None => return false,
    };

    matches!(
        ext.as_str(),
        "tmp" | "temp" | "bak" | "old" | "dmp" | "log" | "swp" | "swo" | "orig"
    )
}

/// Checks if a temporary file is adjacent to an active database or document file.
/// If adjacent to `.sqlite`, `.db`, `.docx`, etc., deleting it could corrupt transactions.
pub fn is_adjacent_to_active_db<P: AsRef<Path>>(path: P) -> bool {
    let path = path.as_ref();
    let parent = match path.parent() {
        Some(p) => p,
        None => return false,
    };

    let filename = match path.file_name().and_then(|f| f.to_str()) {
        Some(f) => f.to_lowercase(),
        None => return false,
    };

    // Explicit SQLite write-ahead log & shared memory files
    if filename.ends_with("-wal") || filename.ends_with("-shm") || filename.ends_with(".journal") {
        return true;
    }

    // Inspect adjacent files in the same directory (shallow check)
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                let ext_lower = ext.to_lowercase();
                if matches!(ext_lower.as_str(), "sqlite" | "sqlite3" | "db" | "db3") {
                    return true;
                }
            }
        }
    }

    false
}
