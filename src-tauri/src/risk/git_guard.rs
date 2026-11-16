// src-tauri/src/risk/git_guard.rs
// Storage Checker Live - Git Repository State & Sensitive File Guard

use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Default)]
pub struct GitSecurityStatus {
    pub is_git_repo: bool,
    pub is_git_dirty: bool,
    pub has_env_file: bool,
    pub dirty_reason: Option<String>,
}

/// Locates the root of a Git repository containing the target path, if any.
pub fn find_git_root<P: AsRef<Path>>(path: P) -> Option<PathBuf> {
    let mut current = path.as_ref().to_path_buf();
    if current.is_file() {
        current.pop();
    }

    loop {
        if current.join(".git").exists() {
            return Some(current);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

/// Inspects a directory for sensitive `.env` files (.env, .env.local, .env.production, etc.)
pub fn check_for_env_files<P: AsRef<Path>>(dir: P) -> bool {
    let dir = dir.as_ref();
    if !dir.is_dir() {
        return false;
    }

    let env_patterns = [
        ".env",
        ".env.local",
        ".env.development",
        ".env.production",
        ".env.staging",
        ".env.test",
    ];

    for pattern in &env_patterns {
        if dir.join(pattern).exists() {
            return true;
        }
    }

    false
}

/// Evaluates git repository status: uncommitted changes and sensitive files.
pub fn inspect_git_security<P: AsRef<Path>>(path: P) -> GitSecurityStatus {
    let path = path.as_ref();
    let git_root = match find_git_root(path) {
        Some(root) => root,
        None => {
            return GitSecurityStatus {
                is_git_repo: false,
                is_git_dirty: false,
                has_env_file: check_for_env_files(path),
                dirty_reason: None,
            };
        }
    };

    let has_env = check_for_env_files(&git_root) || (path.is_dir() && check_for_env_files(path));

    // Execute git status --porcelain to inspect working tree status safely
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&git_root)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let is_dirty = !stdout.is_empty();
            let reason = if is_dirty {
                let lines: Vec<&str> = stdout.lines().take(5).collect();
                Some(format!("Uncommitted changes detected in repo: {}", lines.join("; ")))
            } else {
                None
            };

            GitSecurityStatus {
                is_git_repo: true,
                is_git_dirty: is_dirty,
                has_env_file: has_env,
                dirty_reason: reason,
            }
        }
        _ => GitSecurityStatus {
            is_git_repo: true,
            is_git_dirty: false,
            has_env_file: has_env,
            dirty_reason: None,
        },
    }
}
