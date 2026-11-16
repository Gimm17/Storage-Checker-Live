// src-tauri/src/recap/mod.rs
// Storage Checker Live - Recap & Reporting Subsystem

pub mod export;

pub use export::{compute_recap_analytics, export_report_to_file};
