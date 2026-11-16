// src-tauri/src/special/mod.rs
// Storage Checker Live - Special Optimizers Subsystem

pub mod git_gc;
pub mod vhdx;

pub use git_gc::{run_git_gc, GitGcResult};
pub use vhdx::{compact_vhdx, VhdxCompactResult};
