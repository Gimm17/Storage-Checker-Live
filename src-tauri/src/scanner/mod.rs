// src-tauri/src/scanner/mod.rs
// Storage Checker Live - Disk Scanner Subsystem

pub mod orphan_temp;
pub mod size_on_disk;
pub mod traversal;

pub use orphan_temp::{is_adjacent_to_active_db, is_inside_standard_temp, is_temp_file_extension};
pub use size_on_disk::calculate_file_size_on_disk;
pub use traversal::{calculate_directory_size, execute_deep_scan, ScanProgressEvent, ScannedBloatItem};
