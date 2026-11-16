// src-tauri/src/special/git_gc.rs
// Storage Checker Live - Git Repository Garbage Collection & Pack Pruning

use std::path::Path;
use std::process::Command;
use crate::scanner::calculate_directory_size;

#[derive(Debug, Clone)]
pub struct GitGcResult {
    pub success: bool,
    pub original_size_bytes: u64,
    pub optimized_size_bytes: u64,
    pub freed_bytes: u64,
    pub message: String,
}

/// Runs `git gc --prune=now --aggressive` to shrink swollen `.git/objects/pack`.
pub fn run_git_gc<P: AsRef<Path>>(repo_root: P) -> Result<GitGcResult, String> {
    let root = repo_root.as_ref();
    let git_dir = root.join(".git");

    if !git_dir.exists() {
        return Err(format!("Not a git repository: {}", root.display()));
    }

    let (initial_size, _, _) = calculate_directory_size(&git_dir);

    let output = Command::new("git")
        .args(["gc", "--prune=now"])
        .current_dir(root)
        .output()
        .map_err(|e| format!("Failed to run git gc: {}", e))?;

    let (post_size, _, _) = calculate_directory_size(&git_dir);
    let freed = initial_size.saturating_sub(post_size);
    let success = output.status.success();

    Ok(GitGcResult {
        success,
        original_size_bytes: initial_size,
        optimized_size_bytes: post_size,
        freed_bytes: freed,
        message: if success {
            format!("Git repository optimized. Freed {:.2} MB.", freed as f64 / (1024.0 * 1024.0))
        } else {
            format!("Git GC notice: {}", String::from_utf8_lossy(&output.stderr))
        },
    })
}
