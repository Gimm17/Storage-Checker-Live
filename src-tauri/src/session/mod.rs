// src-tauri/src/session/mod.rs
// Storage Checker Live - Session Diff Subsystem

pub mod diff;

pub use diff::{capture_hierarchy_snapshot, compare_session, start_session, FolderSnapshot};
