// src-tauri/src/special/vhdx.rs
// Storage Checker Live - WSL2 / Docker Desktop ext4.vhdx Safe Compaction

use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct VhdxCompactResult {
    pub success: bool,
    pub original_size_bytes: u64,
    pub compacted_size_bytes: u64,
    pub freed_bytes: u64,
    pub message: String,
}

/// Safely compacts a WSL2 or Docker Desktop ext4.vhdx file.
/// 1. Issues `wsl --shutdown` to flush all writes and close virtual disk handles.
/// 2. Executes diskpart `compact vdisk` command.
/// 3. Returns the reclaimed storage amount.
pub fn compact_vhdx<P: AsRef<Path>>(vhdx_path: P) -> Result<VhdxCompactResult, String> {
    let path = vhdx_path.as_ref();
    if !path.exists() {
        return Err(format!("VHDX file does not exist: {}", path.display()));
    }

    let initial_meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let initial_size = initial_meta.len();

    // Step 1: Ensure WSL is completely stopped
    let _ = Command::new("wsl").args(["--shutdown"]).output();
    std::thread::sleep(std::time::Duration::from_millis(1500));

    // Step 2: Prepare diskpart script in temp directory
    let temp_script = std::env::temp_dir().join("storage_checker_compact.txt");
    let script_content = format!(
        "select vdisk file=\"{}\"\r\ncompact vdisk\r\n",
        path.to_string_lossy().replace('/', "\\")
    );

    std::fs::write(&temp_script, script_content).map_err(|e| format!("Failed to create diskpart script: {}", e))?;

    // Step 3: Run diskpart with administrative privilege
    let diskpart_out = Command::new("diskpart")
        .args(["/s", &temp_script.to_string_lossy()])
        .output();

    let _ = std::fs::remove_file(&temp_script);

    let output = match diskpart_out {
        Ok(out) => out,
        Err(e) => return Err(format!("Failed to execute diskpart: {}", e)),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Step 4: Measure post-compaction size
    let post_meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let post_size = post_meta.len();
    let freed = initial_size.saturating_sub(post_size);

    let success = output.status.success() && !stdout.contains("error");

    Ok(VhdxCompactResult {
        success,
        original_size_bytes: initial_size,
        compacted_size_bytes: post_size,
        freed_bytes: freed,
        message: if success {
            format!("VHDX compacted successfully. Freed {:.2} MB.", freed as f64 / (1024.0 * 1024.0))
        } else {
            format!("Diskpart compaction reported notice: {}", stdout.trim())
        },
    })
}
