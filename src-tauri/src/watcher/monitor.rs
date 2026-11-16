// src-tauri/src/watcher/monitor.rs
// Storage Checker Live - Background Disk Watcher & Spike Detector

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;
use sysinfo::Disks;
use rusqlite::Connection;
use uuid::Uuid;
use chrono::Utc;

pub struct WatcherState {
    pub is_running: Arc<AtomicBool>,
}

/// Trims the process working set on Windows to maintain RAM footprint < 30 MB when idle.
pub fn trim_working_set() {
    #[cfg(windows)]
    unsafe {
        let current_process = windows_sys::Win32::System::Threading::GetCurrentProcess();
        windows_sys::Win32::System::ProcessStatus::EmptyWorkingSet(current_process);
    }
}

/// Polls disk free space and detects sudden bloat spikes (> 500 MB in 5 minutes).
pub fn poll_disk_spikes(
    last_free_bytes: &mut u64,
    last_check: &mut Instant,
    conn: &Connection,
    threshold_bytes: u64, // default: 500 * 1024 * 1024
    on_spike: impl Fn(u64, i64),
) {
    let mut disks = Disks::new_with_refreshed_list();
    disks.refresh(true);

    let mut current_free_bytes: u64 = 0;
    for disk in disks.list() {
        // Primary C: drive focus
        if disk.mount_point().to_string_lossy().starts_with("C:") {
            current_free_bytes = disk.available_space();
            break;
        }
    }

    if *last_free_bytes == 0 {
        *last_free_bytes = current_free_bytes;
        *last_check = Instant::now();
        return;
    }

    let elapsed = last_check.elapsed().as_secs();
    if elapsed >= 30 { // evaluate every 30 seconds
        if *last_free_bytes > current_free_bytes {
            let used_delta = *last_free_bytes - current_free_bytes;
            if used_delta >= threshold_bytes {
                // Storage spike detected!
                let _ = conn.execute(
                    "INSERT INTO spike_events (id, session_id, drive_letter, delta_bytes, duration_seconds, suspected_path, suspected_category, detected_at)
                     VALUES (?1, NULL, 'C:', ?2, ?3, 'System/Coding Workspaces', 'AI_OR_DEV_BLOAT', ?4)",
                    rusqlite::params![
                        Uuid::new_v4().to_string(),
                        used_delta as i64,
                        elapsed as i64,
                        Utc::now().to_rfc3339()
                    ],
                );

                on_spike(used_delta, elapsed as i64);
            }
        }

        *last_free_bytes = current_free_bytes;
        *last_check = Instant::now();
        trim_working_set();
    }
}
