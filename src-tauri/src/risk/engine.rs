// src-tauri/src/risk/engine.rs
// Storage Checker Live - 3-Tier Risk Intelligence Engine

use std::path::Path;
use serde::{Deserialize, Serialize};
use super::whitelist::is_protected_path;
use super::git_guard::GitSecurityStatus;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum RiskLevel {
    Safe,
    Caution,
    Danger,
}

impl RiskLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            RiskLevel::Safe => "SAFE",
            RiskLevel::Caution => "CAUTION",
            RiskLevel::Danger => "DANGER",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskAssessment {
    pub level: RiskLevel,
    pub origin_explanation: String,
    pub deletion_impact: String,
    pub rebuild_suggestion: Option<String>,
    pub special_action: Option<String>,
    pub is_protected: bool,
}

/// Evaluates the complete risk assessment for a detected path.
pub fn assess_risk<P: AsRef<Path>>(
    path: P,
    category: &str,
    git_status: &GitSecurityStatus,
    is_active_db_adjacent: bool,
) -> RiskAssessment {
    let path = path.as_ref();
    let path_str = path.to_string_lossy();
    let lower_path = path_str.to_lowercase();

    // 1. Hardcoded Protected Whitelist Check
    if is_protected_path(path) {
        return RiskAssessment {
            level: RiskLevel::Danger,
            origin_explanation: "Essential Windows operating system or user root directory.".into(),
            deletion_impact: "CRITICAL: Deleting this directory would destabilize Windows or cause irreversible OS damage.".into(),
            rebuild_suggestion: None,
            special_action: None,
            is_protected: true,
        };
    }

    // 2. Virtual Disk / Container VHDX Check (Hardcoded Danger Rule)
    if lower_path.ends_with(".vhdx") || lower_path.ends_with(".vhd") {
        return RiskAssessment {
            level: RiskLevel::Danger,
            origin_explanation: "WSL2 or Docker Desktop virtual disk image storing all Linux distributions and containers.".into(),
            deletion_impact: "DESTRUCTIVE: Deleting this file will permanently destroy all WSL distributions, installed packages, and Docker containers. Use Safe Compact instead.".into(),
            rebuild_suggestion: Some("Do not delete. Use 'Compact VHDX' to safely reclaim unused disk space.".into()),
            special_action: Some("COMPACT_VHDX".into()),
            is_protected: false,
        };
    }

    // 3. Git Dirty & Sensitive Environment Guard
    if git_status.is_git_dirty {
        return RiskAssessment {
            level: RiskLevel::Danger,
            origin_explanation: "Project repository contains uncommitted source code modifications or untracked changes.".into(),
            deletion_impact: "DATA LOSS RISK: Removing this repository or its files before committing will destroy uncommitted work.".into(),
            rebuild_suggestion: Some("Commit or stash your git changes first before attempting cleanup.".into()),
            special_action: Some("GIT_GC".into()),
            is_protected: false,
        };
    }

    if git_status.has_env_file {
        return RiskAssessment {
            level: RiskLevel::Danger,
            origin_explanation: "Directory contains sensitive environment configuration (.env files with API keys/secrets).".into(),
            deletion_impact: "SECURITY & CONFIG LOSS: Deleting this directory will remove environment secrets and API keys.".into(),
            rebuild_suggestion: Some("Backup your .env files before cleaning up build artifacts.".into()),
            special_action: None,
            is_protected: false,
        };
    }

    // 4. Active Database Context Guard (EC-03)
    if is_active_db_adjacent {
        return RiskAssessment {
            level: RiskLevel::Caution,
            origin_explanation: "Temporary file is adjacent to an active database (SQLite WAL/SHM or document lockfile).".into(),
            deletion_impact: "CORRUPTION RISK: May be an active database transaction journal or lock. Deleting while in use can corrupt the database.".into(),
            rebuild_suggestion: Some("Close any applications using this database before deleting.".into()),
            special_action: None,
            is_protected: false,
        };
    }

    // 5. Category-Specific Evaluations
    match category {
        "DEV_DEPS" => {
            let (origin, impact, rebuild) = if lower_path.ends_with("node_modules") {
                (
                    "Node.js package dependencies installed via npm, pnpm, or yarn.",
                    "Project won't run until dependencies are reinstalled.",
                    "Run 'pnpm install' or 'npm install' to restore.",
                )
            } else if lower_path.ends_with("target") {
                (
                    "Rust build artifacts and compiled binaries from 'cargo build'.",
                    "Future builds will recompile from scratch, taking longer on the first run.",
                    "Run 'cargo build' to recompile when needed.",
                )
            } else if lower_path.contains("venv") || lower_path.ends_with(".venv") {
                (
                    "Python virtual environment containing installed packages.",
                    "Python scripts in this project will not run until environment is recreated.",
                    "Recreate with 'python -m venv .venv && pip install -r requirements.txt'.",
                )
            } else {
                (
                    "Development dependencies and compilation cache.",
                    "Project must re-fetch or rebuild packages before running.",
                    "Run your package manager install command to restore.",
                )
            };

            RiskAssessment {
                level: RiskLevel::Caution,
                origin_explanation: origin.into(),
                deletion_impact: impact.into(),
                rebuild_suggestion: Some(rebuild.into()),
                special_action: None,
                is_protected: false,
            }
        }
        "AI_IDE" => {
            if lower_path.contains(".ollama") || lower_path.contains("huggingface") || lower_path.contains("lm-studio") {
                RiskAssessment {
                    level: RiskLevel::Caution,
                    origin_explanation: "Locally downloaded large language model weights and checkpoints.".into(),
                    deletion_impact: "Local AI inference models will need to be re-downloaded (several gigabytes).".into(),
                    rebuild_suggestion: Some("Re-pull models using 'ollama pull <model>' if needed.".into()),
                    special_action: None,
                    is_protected: false,
                }
            } else {
                RiskAssessment {
                    level: RiskLevel::Safe,
                    origin_explanation: "AI Agent conversation logs, browser sandbox captures, or IDE workspace cache.".into(),
                    deletion_impact: "Completely safe to remove. Clears temporary agent scratchpads and cached indexing.".into(),
                    rebuild_suggestion: None,
                    special_action: None,
                    is_protected: false,
                }
            }
        }
        "ORPHAN_TEMP" => {
            RiskAssessment {
                level: RiskLevel::Safe,
                origin_explanation: "Abandoned temporary file (.tmp, .bak, .old, .log) left outside standard system Temp.".into(),
                deletion_impact: "Completely safe to remove. Frees orphaned disk space without affecting any active software.".into(),
                rebuild_suggestion: None,
                special_action: None,
                is_protected: false,
            }
        }
        "VIRTUALIZATION" => {
            RiskAssessment {
                level: RiskLevel::Caution,
                origin_explanation: "Android Virtual Device (AVD) emulator snapshot or virtual machine cache.".into(),
                deletion_impact: "Emulator state will reset to cold boot. Downloaded system images may need to be reinstalled.".into(),
                rebuild_suggestion: Some("Recreate virtual device in Android Studio Device Manager.".into()),
                special_action: None,
                is_protected: false,
            }
        }
        _ => {
            RiskAssessment {
                level: RiskLevel::Safe,
                origin_explanation: "General temporary cache or build artifact.".into(),
                deletion_impact: "Safe to remove. System or project will re-generate cache automatically.".into(),
                rebuild_suggestion: None,
                special_action: None,
                is_protected: false,
            }
        }
    }
}
