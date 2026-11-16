// src-tauri/src/db/models.rs
// Storage Checker Live - Database Models matching PRD § 7.1 and § 7.2

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanSessionRow {
    pub id: String,
    pub session_type: String, // 'DEEP_SCAN' | 'CODING_SESSION' | 'BACKGROUND_WATCH'
    pub status: String,       // 'RUNNING' | 'COMPLETED' | 'CANCELLED'
    pub baseline_used_bytes: i64,
    pub peak_used_bytes: i64,
    pub ended_used_bytes: i64,
    pub total_freed_bytes: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskSnapshotRow {
    pub id: String,
    pub session_id: String,
    pub phase: String, // 'BEFORE' | 'AFTER' | 'PERIODIC'
    pub root_path: String,
    pub total_bytes: i64,
    pub file_count: i64,
    pub captured_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskRuleRow {
    pub id: String,
    pub pattern_name: String,
    pub category: String, // 'AI_IDE' | 'DEV_DEPS' | 'ORPHAN_TEMP' | 'VIRTUALIZATION' | 'OTHER'
    pub default_risk_level: String, // 'SAFE' | 'CAUTION' | 'DANGER'
    pub origin_explanation: String,
    pub deletion_impact: String,
    pub special_action: Option<String>, // 'COMPACT_VHDX' | 'GIT_GC' | 'PNPM_PRUNE' | None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedItemRow {
    pub id: String,
    pub session_id: String,
    pub rule_id: Option<String>,
    pub full_path: String,
    pub item_type: String, // 'FILE' | 'DIRECTORY'
    pub category: String,  // 'AI_IDE' | 'DEV_DEPS' | 'ORPHAN_TEMP' | 'VIRTUALIZATION' | 'OTHER'
    pub risk_level: String, // 'SAFE' | 'CAUTION' | 'DANGER'
    pub size_bytes: i64,
    pub delta_bytes: i64,
    pub is_outside_standard_temp: i64, // 0 or 1
    pub status: String, // 'DETECTED' | 'ANALYZED_SAFE' | 'ANALYZED_CAUTION' | 'ANALYZED_DANGER' | 'QUEUED_FOR_CLEANUP' | 'SKIPPED_LOCKED' | 'MOVED_TO_TRASH' | 'PERMANENTLY_DELETED' | 'OPTIMIZED' | 'RECAPPED'
    pub last_modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpikeEventRow {
    pub id: String,
    pub session_id: Option<String>,
    pub drive_letter: String,
    pub delta_bytes: i64,
    pub duration_seconds: i64,
    pub suspected_path: Option<String>,
    pub suspected_category: Option<String>,
    pub detected_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanupLogRow {
    pub id: String,
    pub item_id: Option<String>,
    pub action_type: String,   // 'RECYCLE_BIN' | 'PERMANENT' | 'COMPACT_VHDX' | 'GIT_GC'
    pub result_status: String, // 'SUCCESS' | 'SKIPPED_LOCKED' | 'FAILED'
    pub freed_bytes: i64,
    pub error_message: Option<String>,
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopBloatCulprit {
    pub full_path: String,
    pub category: String,
    pub size_bytes: i64,
    pub risk_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecapAnalyticsData {
    pub total_freed_bytes: i64,
    pub total_scanned_bytes: i64,
    pub total_cleaned_count: i64,
    pub total_skipped_locked_count: i64,
    pub spike_events_count: i64,
    pub top_culprits: Vec<TopBloatCulprit>,
}
