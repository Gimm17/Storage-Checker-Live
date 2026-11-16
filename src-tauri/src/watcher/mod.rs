// src-tauri/src/watcher/mod.rs
// Storage Checker Live - Background Watcher Subsystem

pub mod monitor;

pub use monitor::{poll_disk_spikes, trim_working_set, WatcherState};
