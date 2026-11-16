// Storage Checker Live - Tauri v2 Backend Library (`src-tauri/src/lib.rs`)

#![cfg_attr(test, allow(dead_code, unused_imports))]

pub mod db;
pub mod risk;
pub mod scanner;
pub mod cleaner;
pub mod session;
pub mod special;
pub mod recap;
pub mod watcher;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

// ============================================================================
// 1. Application State & Models
// ============================================================================

pub struct AppState {
    pub db: Mutex<Connection>,
    pub scan_cancel_token: Arc<AtomicBool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfoResponse {
    pub name: String,
    pub version: String,
    pub is_admin: bool,
    pub is_elevated: bool,
    pub os_version: String,
    pub arch: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatusResponse {
    pub initialized: bool,
    pub path: String,
    pub wal_mode: bool,
    pub rules_seeded: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskRuleRecord {
    pub id: String,
    pub pattern_name: String,
    pub category: String,
    pub default_risk_level: String,
    pub origin_explanation: String,
    pub deletion_impact: String,
    pub special_action: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDeepScanArgs {
    pub target_paths: Vec<String>,
    pub include_system_temp: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDeepScanResult {
    pub session_id: String,
    pub items_found: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelScanArgs {
    pub session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelScanResult {
    pub cancelled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCodingSessionArgs {
    pub watch_paths: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCodingSessionResult {
    pub session_id: String,
    pub baseline_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareCodingSessionArgs {
    pub session_id: String,
    pub watch_paths: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedFolderItem {
    pub path: String,
    pub delta_bytes: i64,
    pub current_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewItem {
    pub path: String,
    pub size_bytes: u64,
    pub category: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiffSummary {
    pub session_id: String,
    pub duration_seconds: u64,
    pub total_delta_bytes: i64,
    pub expanded_folders: Vec<ExpandedFolderItem>,
    pub new_items: Vec<NewItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetItemInspectionArgs {
    pub item_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInspectionDetail {
    pub id: String,
    pub full_path: String,
    pub item_type: String,
    pub category: String,
    pub risk_level: String,
    pub size_bytes: u64,
    pub size_on_disk_bytes: u64,
    pub last_modified_at: String,
    pub origin_explanation: String,
    pub deletion_impact: String,
    pub special_action: Option<String>,
    pub rebuild_suggestion: Option<String>,
    pub is_locked: bool,
    pub locking_process: Option<String>,
    pub is_git_dirty: bool,
    pub has_env_file: bool,
    pub is_outside_standard_temp: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupBatchArgs {
    pub item_ids: Vec<String>,
    pub mode: String, // 'RECYCLE_BIN' | 'PERMANENT'
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedLockedItem {
    pub id: String,
    pub locking_process: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedItem {
    pub id: String,
    pub error: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupBatchResult {
    pub successful_ids: Vec<String>,
    pub skipped_locked_ids: Vec<SkippedLockedItem>,
    pub failed_ids: Vec<FailedItem>,
    pub total_freed_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialActionArgs {
    pub item_id: String,
    pub action: String, // 'COMPACT_VHDX' | 'GIT_GC' | 'OPEN_EXPLORER'
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialActionResult {
    pub success: bool,
    pub freed_bytes: u64,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRecapSummaryArgs {
    pub range: String, // 'SESSION' | 'TODAY' | 'WEEK' | 'ALL'
    pub session_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopCulpritItem {
    pub name: String,
    pub path: String,
    pub category: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelinePoint {
    pub timestamp: String,
    pub used_bytes: u64,
    pub spike_delta: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapAnalytics {
    pub range: String,
    pub total_bloat_detected_bytes: u64,
    pub total_freed_bytes: u64,
    pub potential_savings_bytes: u64,
    pub top5_culprits: Vec<TopCulpritItem>,
    pub spike_count: u32,
    pub timeline: Vec<TimelinePoint>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReportArgs {
    pub range: String,
    pub format: String, // 'MD' | 'JSON' | 'CSV'
    pub save_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReportResult {
    pub file_path: String,
}

// ============================================================================
// 2. Windows Native Helper Functions
// ============================================================================

#[cfg(windows)]
fn check_is_admin() -> bool {
    unsafe {
        windows_sys::Win32::UI::Shell::IsUserAnAdmin() != 0
    }
}

#[cfg(not(windows))]
fn check_is_admin() -> bool {
    false
}

// ============================================================================
// 3. Tauri IPC Command Handlers
// ============================================================================

#[tauri::command]
fn get_app_info() -> Result<AppInfoResponse, String> {
    let is_admin = check_is_admin();
    Ok(AppInfoResponse {
        name: "Storage Checker Live".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        is_admin,
        is_elevated: is_admin,
        os_version: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
    })
}

#[tauri::command]
fn init_db_command(state: State<'_, AppState>) -> Result<DbStatusResponse, String> {
    let conn = state.db.lock().map_err(|e| format!("Failed to acquire DB lock: {}", e))?;
    let db_path = db::get_db_path().map_err(|e| e.to_string())?;

    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode;", [], |row| row.get(0))
        .unwrap_or_else(|_| "unknown".into());

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM risk_rules;", [], |row| row.get(0))
        .unwrap_or(0);

    Ok(DbStatusResponse {
        initialized: true,
        path: db_path.to_string_lossy().to_string(),
        wal_mode: journal_mode.to_uppercase() == "WAL",
        rules_seeded: count,
    })
}

#[tauri::command]
fn get_risk_rules(state: State<'_, AppState>) -> Result<Vec<RiskRuleRecord>, String> {
    let conn = state.db.lock().map_err(|e| format!("Failed to acquire DB lock: {}", e))?;
    let mut stmt = conn
        .prepare("SELECT id, pattern_name, category, default_risk_level, origin_explanation, deletion_impact, special_action FROM risk_rules ORDER BY id ASC")
        .map_err(|e| e.to_string())?;

    let rules = stmt
        .query_map([], |row| {
            Ok(RiskRuleRecord {
                id: row.get(0)?,
                pattern_name: row.get(1)?,
                category: row.get(2)?,
                default_risk_level: row.get(3)?,
                origin_explanation: row.get(4)?,
                deletion_impact: row.get(5)?,
                special_action: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(rules)
}

#[tauri::command]
fn start_deep_scan(
    app: tauri::AppHandle,
    args: StartDeepScanArgs,
    state: State<'_, AppState>,
) -> Result<StartDeepScanResult, String> {
    state.scan_cancel_token.store(false, Ordering::SeqCst);
    let session_id = uuid::Uuid::new_v4().to_string();

    let mut target_paths: Vec<PathBuf> = args.target_paths.iter().map(PathBuf::from).collect();

    // Default: if no target paths provided, target user profile & current working directory
    if target_paths.is_empty() {
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            target_paths.push(PathBuf::from(userprofile));
        }
        if let Ok(cwd) = std::env::current_dir() {
            target_paths.push(cwd);
        }
    }

    if args.include_system_temp {
        target_paths.push(PathBuf::from("C:\\Windows\\Temp"));
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let started_at = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "INSERT INTO scan_sessions (id, session_type, status, baseline_used_bytes, peak_used_bytes, ended_used_bytes, total_freed_bytes, started_at)
         VALUES (?1, 'DEEP_SCAN', 'RUNNING', 0, 0, 0, 0, ?2)",
        rusqlite::params![session_id, started_at],
    );

    let cancel_token = state.scan_cancel_token.clone();
    let app_handle = app.clone();

    let items = scanner::execute_deep_scan(
        &session_id,
        &target_paths,
        &cancel_token,
        &mut conn,
        move |progress| {
            let _ = app_handle.emit("scan:progress", &progress);
        },
    )?;

    let count = items.len();
    Ok(StartDeepScanResult { session_id, items_found: count })
}

#[tauri::command]
fn cancel_scan(
    args: CancelScanArgs,
    state: State<'_, AppState>,
) -> Result<CancelScanResult, String> {
    state.scan_cancel_token.store(true, Ordering::SeqCst);
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let ended_at = chrono::Utc::now().to_rfc3339();
    let _ = conn.execute(
        "UPDATE scan_sessions SET status = 'CANCELLED', ended_at = ?2 WHERE id = ?1",
        rusqlite::params![args.session_id, ended_at],
    );

    Ok(CancelScanResult { cancelled: true })
}

#[tauri::command]
fn start_coding_session(
    args: StartCodingSessionArgs,
    state: State<'_, AppState>,
) -> Result<StartCodingSessionResult, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let started_at = chrono::Utc::now().to_rfc3339();

    let mut watch_paths: Vec<PathBuf> = args.watch_paths.iter().map(PathBuf::from).collect();
    if watch_paths.is_empty() {
        if let Ok(cwd) = std::env::current_dir() {
            watch_paths.push(cwd);
        }
    }

    let _ = conn.execute(
        "INSERT INTO scan_sessions (id, session_type, status, baseline_used_bytes, peak_used_bytes, ended_used_bytes, total_freed_bytes, started_at)
         VALUES (?1, 'CODING_SESSION', 'RUNNING', 0, 0, 0, 0, ?2)",
        rusqlite::params![session_id, started_at],
    );

    let baseline = session::start_session(&session_id, &watch_paths, &mut conn)?;

    Ok(StartCodingSessionResult {
        session_id,
        baseline_bytes: baseline,
    })
}

#[tauri::command]
fn compare_coding_session(
    args: CompareCodingSessionArgs,
    state: State<'_, AppState>,
) -> Result<SessionDiffSummary, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;

    let mut watch_paths: Vec<PathBuf> = args.watch_paths.unwrap_or_default().iter().map(PathBuf::from).collect();
    if watch_paths.is_empty() {
        if let Ok(cwd) = std::env::current_dir() {
            watch_paths.push(cwd);
        }
    }

    session::compare_session(&args.session_id, &watch_paths, &mut conn)
}

#[tauri::command]
fn get_item_inspection(
    args: GetItemInspectionArgs,
    state: State<'_, AppState>,
) -> Result<ItemInspectionDetail, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT i.id, i.full_path, i.item_type, i.category, i.risk_level, i.size_bytes, 
                    i.is_outside_standard_temp, i.last_modified_at,
                    COALESCE(r.origin_explanation, 'Temporary development artifact'),
                    COALESCE(r.deletion_impact, 'Safe to remove if not currently in use'),
                    r.special_action
             FROM detected_items i
             LEFT JOIN risk_rules r ON i.rule_id = r.id
             WHERE i.id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let mut item = stmt
        .query_row(rusqlite::params![args.item_id], |row| {
            Ok(ItemInspectionDetail {
                id: row.get(0)?,
                full_path: row.get(1)?,
                item_type: row.get(2)?,
                category: row.get(3)?,
                risk_level: row.get(4)?,
                size_bytes: row.get::<_, i64>(5)? as u64,
                size_on_disk_bytes: row.get::<_, i64>(5)? as u64,
                is_outside_standard_temp: row.get::<_, i64>(6)? != 0,
                last_modified_at: row.get(7)?,
                origin_explanation: row.get(8)?,
                deletion_impact: row.get(9)?,
                special_action: row.get(10)?,
                rebuild_suggestion: None,
                is_locked: false,
                locking_process: None,
                is_git_dirty: false,
                has_env_file: false,
            })
        })
        .map_err(|e| format!("Item not found: {}", e))?;

    // Perform live Git and Process Lock inspection
    let target_path = PathBuf::from(&item.full_path);
    let lock_info = cleaner::check_process_lock(&target_path);
    item.is_locked = lock_info.is_locked;
    item.locking_process = lock_info.locking_process_name;

    let git_sec = risk::inspect_git_security(&target_path);
    item.is_git_dirty = git_sec.is_git_dirty;
    item.has_env_file = git_sec.has_env_file;

    Ok(item)
}

#[tauri::command]
fn execute_cleanup(
    args: CleanupBatchArgs,
    state: State<'_, AppState>,
) -> Result<CleanupBatchResult, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let report = cleaner::execute_cleanup_batch(&args.item_ids, &args.mode, &mut conn)?;

    let skipped: Vec<SkippedLockedItem> = report
        .skipped_locked
        .into_iter()
        .map(|(id, proc)| SkippedLockedItem {
            id,
            locking_process: proc,
        })
        .collect();

    let failed: Vec<FailedItem> = report
        .failed_items
        .into_iter()
        .map(|(id, err)| FailedItem { id, error: err })
        .collect();

    Ok(CleanupBatchResult {
        successful_ids: report.successful_ids,
        skipped_locked_ids: skipped,
        failed_ids: failed,
        total_freed_bytes: report.total_freed_bytes,
    })
}

#[tauri::command]
fn run_special_action(
    args: SpecialActionArgs,
    state: State<'_, AppState>,
) -> Result<SpecialActionResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let item_path: String = conn
        .query_row(
            "SELECT full_path FROM detected_items WHERE id = ?1",
            rusqlite::params![args.item_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Item not found: {}", e))?;

    match args.action.as_str() {
        "COMPACT_VHDX" => {
            let res = special::compact_vhdx(&item_path)?;
            Ok(SpecialActionResult {
                success: res.success,
                freed_bytes: res.freed_bytes,
                message: res.message,
            })
        }
        "GIT_GC" => {
            let res = special::run_git_gc(&item_path)?;
            Ok(SpecialActionResult {
                success: res.success,
                freed_bytes: res.freed_bytes,
                message: res.message,
            })
        }
        "OPEN_EXPLORER" => {
            let p = PathBuf::from(&item_path);
            let target = if p.is_file() {
                p.parent().unwrap_or(&p).to_path_buf()
            } else {
                p
            };
            let _ = open::that(target);
            Ok(SpecialActionResult {
                success: true,
                freed_bytes: 0,
                message: "Opened in Windows Explorer".into(),
            })
        }
        _ => Err(format!("Unknown special action: {}", args.action)),
    }
}

#[tauri::command]
fn get_recap_summary(
    args: GetRecapSummaryArgs,
    state: State<'_, AppState>,
) -> Result<RecapAnalytics, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    recap::compute_recap_analytics(&args.range, args.session_id.as_deref(), &conn)
}

#[tauri::command]
fn export_recap_report(
    args: ExportReportArgs,
    state: State<'_, AppState>,
) -> Result<ExportReportResult, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let path = recap::export_report_to_file(&args.range, &args.format, &args.save_path, &conn)?;
    Ok(ExportReportResult { file_path: path })
}

// ============================================================================
// 4. Tauri Application Builder Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(test))]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Initialize SQLite database in %LOCALAPPDATA%\StorageCheckerLive\storage_checker.db
            let conn = db::init_db().map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            let app_state = AppState {
                db: Mutex::new(conn),
                scan_cancel_token: Arc::new(AtomicBool::new(false)),
            };

            app.manage(app_state);

            // Background Disk Watcher & Memory Trimmer
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last_free: u64 = 0;
                let mut last_check = std::time::Instant::now();

                loop {
                    std::thread::sleep(std::time::Duration::from_secs(30));

                    if let Some(state) = app_handle.try_state::<AppState>() {
                        if let Ok(conn) = state.db.lock() {
                            watcher::poll_disk_spikes(
                                &mut last_free,
                                &mut last_check,
                                &conn,
                                500 * 1024 * 1024, // 500 MB spike threshold
                                |_delta, _secs| {
                                    // Notification triggered
                                    let _ = app_handle.emit("watcher:spike_detected", serde_json::json!({
                                        "spikeDetected": true,
                                        "drive": "C:",
                                        "thresholdMb": 500
                                    }));
                                },
                            );
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            init_db_command,
            get_risk_rules,
            start_deep_scan,
            cancel_scan,
            start_coding_session,
            compare_coding_session,
            get_item_inspection,
            execute_cleanup,
            run_special_action,
            get_recap_summary,
            export_recap_report
        ]);

    let _ = builder.run(tauri::generate_context!());
}
