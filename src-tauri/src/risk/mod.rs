// src-tauri/src/risk/mod.rs
// Storage Checker Live - Risk Analysis Subsystem

pub mod engine;
pub mod git_guard;
pub mod whitelist;

pub use engine::{assess_risk, RiskAssessment, RiskLevel};
pub use git_guard::{inspect_git_security, GitSecurityStatus};
pub use whitelist::is_protected_path;
