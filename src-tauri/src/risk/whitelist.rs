// src-tauri/src/risk/whitelist.rs
// Storage Checker Live - Hardcoded Protected System Paths Whitelist (Non-Bypassable)

use std::path::Path;

/// Evaluates if a given path is a protected system directory or root system path
/// that must NEVER be deleted or modified by Storage Checker Live.
pub fn is_protected_path<P: AsRef<Path>>(path: P) -> bool {
    let path = path.as_ref();
    let path_str = path.to_string_lossy().replace('/', "\\").to_lowercase();
    let trimmed = path_str.trim_end_matches('\\');

    // 1. Root Drive guards: C:, D:, C:\, D:\
    if trimmed.len() <= 3 && trimmed.contains(':') {
        return true;
    }

    // 2. Windows System & Boot Paths
    let protected_prefixes = [
        "c:\\windows",
        "c:\\boot",
        "c:\\recovery",
        "c:\\system volume information",
        "c:\\$recycle.bin",
        "c:\\program files",
        "c:\\program files (x86)",
        "c:\\programdata\\microsoft",
    ];

    for prefix in &protected_prefixes {
        // Match exact or child directories
        if trimmed == *prefix || trimmed.starts_with(&format!("{}\\", prefix)) {
            // Allow C:\Windows\Temp specifically if targeted explicitly
            if trimmed == "c:\\windows\\temp" || trimmed.starts_with("c:\\windows\\temp\\") {
                return false;
            }
            return true;
        }
    }

    // 3. Critical User Roots (never delete the entire user profile or primary library folders)
    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        let up = userprofile.to_lowercase().replace('/', "\\");
        let up_trimmed = up.trim_end_matches('\\');
        
        // Exact user profile root: C:\Users\<Username>
        if trimmed == up_trimmed {
            return true;
        }

        let user_critical_folders = [
            format!("{}\\desktop", up_trimmed),
            format!("{}\\documents", up_trimmed),
            format!("{}\\downloads", up_trimmed),
            format!("{}\\pictures", up_trimmed),
            format!("{}\\music", up_trimmed),
            format!("{}\\videos", up_trimmed),
            format!("{}\\appdata", up_trimmed),
            format!("{}\\appdata\\local", up_trimmed),
            format!("{}\\appdata\\roaming", up_trimmed),
            format!("{}\\appdata\\locallow", up_trimmed),
        ];

        for ucf in &user_critical_folders {
            if trimmed == *ucf {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protected_paths() {
        assert!(is_protected_path("C:\\"));
        assert!(is_protected_path("C:\\Windows"));
        assert!(is_protected_path("C:\\Windows\\System32"));
        assert!(is_protected_path("C:\\Program Files"));
        assert!(is_protected_path("C:\\Program Files\\Common Files"));
        
        // Windows Temp is allowed for deep clean
        assert!(!is_protected_path("C:\\Windows\\Temp"));
        assert!(!is_protected_path("C:\\Windows\\Temp\\test.tmp"));
        
        // Regular development directories are not protected
        assert!(!is_protected_path("C:\\Projects\\app\\node_modules"));
        assert!(!is_protected_path("C:\\Users\\Lyvn\\Documents\\project\\target"));
    }
}
