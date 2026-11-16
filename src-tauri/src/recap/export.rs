// src-tauri/src/recap/export.rs
// Storage Checker Live - Recap Analytics & Multi-Format Report Exporter

use std::fs::File;
use std::io::Write;
use rusqlite::Connection;

use crate::{RecapAnalytics, TimelinePoint, TopCulpritItem};

/// Computes recap analytics for the specified range ('SESSION' | 'TODAY' | 'WEEK' | 'ALL').
pub fn compute_recap_analytics(
    range: &str,
    _session_id: Option<&str>,
    conn: &Connection,
) -> Result<RecapAnalytics, String> {
    // 1. Total bloat detected
    let total_bloat: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM detected_items",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // 2. Total freed bytes from cleanup_logs
    let total_freed: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(freed_bytes), 0) FROM cleanup_logs WHERE result_status = 'SUCCESS'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // 3. Potential savings (items still not cleaned)
    let potential_savings = (total_bloat - total_freed).max(0);

    // 4. Top 5 Culprits
    let mut top5 = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT full_path, category, size_bytes FROM detected_items 
                 ORDER BY size_bytes DESC LIMIT 5",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let full_path: String = row.get(0)?;
                let name = std::path::Path::new(&full_path)
                    .file_name()
                    .and_then(|f| f.to_str())
                    .unwrap_or(&full_path)
                    .to_string();

                Ok(TopCulpritItem {
                    name,
                    path: full_path,
                    category: row.get(1)?,
                    size_bytes: row.get::<_, i64>(2)? as u64,
                })
            })
            .map_err(|e| e.to_string())?;

        for r in rows.flatten() {
            top5.push(r);
        }
    }

    // 5. Spike count
    let spike_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM spike_events", [], |r| r.get(0))
        .unwrap_or(0);

    // 6. Timeline sample points from scan_sessions
    let mut timeline = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT started_at, baseline_used_bytes, (peak_used_bytes - baseline_used_bytes) 
                 FROM scan_sessions ORDER BY started_at ASC LIMIT 15",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(TimelinePoint {
                    timestamp: row.get(0)?,
                    used_bytes: row.get::<_, i64>(1)? as u64,
                    spike_delta: Some(row.get(2)?),
                })
            })
            .map_err(|e| e.to_string())?;

        for r in rows.flatten() {
            timeline.push(r);
        }
    }

    Ok(RecapAnalytics {
        range: range.to_string(),
        total_bloat_detected_bytes: total_bloat as u64,
        total_freed_bytes: total_freed as u64,
        potential_savings_bytes: potential_savings as u64,
        top5_culprits: top5,
        spike_count: spike_count as u32,
        timeline,
    })
}

/// Exports a recap report to Markdown (.md), JSON (.json), or CSV (.csv).
pub fn export_report_to_file(
    range: &str,
    format: &str, // "MD" | "JSON" | "CSV"
    save_path: &str,
    conn: &Connection,
) -> Result<String, String> {
    let analytics = compute_recap_analytics(range, None, conn)?;
    let mut file = File::create(save_path).map_err(|e| format!("Failed to create file: {}", e))?;

    match format.to_uppercase().as_str() {
        "JSON" => {
            let json_str = serde_json::to_string_pretty(&analytics).map_err(|e| e.to_string())?;
            file.write_all(json_str.as_bytes()).map_err(|e| e.to_string())?;
        }
        "CSV" => {
            writeln!(file, "Metric,Value").map_err(|e| e.to_string())?;
            writeln!(file, "Range,{}", analytics.range).map_err(|e| e.to_string())?;
            writeln!(file, "TotalBloatDetectedBytes,{}", analytics.total_bloat_detected_bytes).map_err(|e| e.to_string())?;
            writeln!(file, "TotalFreedBytes,{}", analytics.total_freed_bytes).map_err(|e| e.to_string())?;
            writeln!(file, "PotentialSavingsBytes,{}", analytics.potential_savings_bytes).map_err(|e| e.to_string())?;
            writeln!(file, "SpikeCount,{}", analytics.spike_count).map_err(|e| e.to_string())?;
            writeln!(file, "\nTopCulpritName,Category,SizeBytes,Path").map_err(|e| e.to_string())?;
            for item in &analytics.top5_culprits {
                writeln!(file, "\"{}\",{},{},\"{}\"", item.name, item.category, item.size_bytes, item.path).map_err(|e| e.to_string())?;
            }
        }
        _ => {
            // Default: Markdown format
            writeln!(file, "# 📊 Storage Checker Live — Recap Report").map_err(|e| e.to_string())?;
            writeln!(file, "\n| Metric | Value |").map_err(|e| e.to_string())?;
            writeln!(file, "| :--- | :--- |").map_err(|e| e.to_string())?;
            writeln!(file, "| **Reporting Range** | {} |", analytics.range).map_err(|e| e.to_string())?;
            writeln!(file, "| **Total Bloat Detected** | {:.2} GB |", analytics.total_bloat_detected_bytes as f64 / (1024.0 * 1024.0 * 1024.0)).map_err(|e| e.to_string())?;
            writeln!(file, "| **Total Storage Freed** | {:.2} GB |", analytics.total_freed_bytes as f64 / (1024.0 * 1024.0 * 1024.0)).map_err(|e| e.to_string())?;
            writeln!(file, "| **Potential Additional Savings** | {:.2} GB |", analytics.potential_savings_bytes as f64 / (1024.0 * 1024.0 * 1024.0)).map_err(|e| e.to_string())?;
            writeln!(file, "| **Storage Spike Events** | {} |", analytics.spike_count).map_err(|e| e.to_string())?;
            writeln!(file, "\n## 🏆 Top 5 Bloat Culprits\n").map_err(|e| e.to_string())?;
            writeln!(file, "| No | Item | Category | Size | Path |").map_err(|e| e.to_string())?;
            writeln!(file, "| :- | :--- | :--- | :--- | :--- |").map_err(|e| e.to_string())?;
            for (idx, item) in analytics.top5_culprits.iter().enumerate() {
                writeln!(
                    file,
                    "| {} | **{}** | `{}` | {:.2} MB | `{}` |",
                    idx + 1,
                    item.name,
                    item.category,
                    item.size_bytes as f64 / (1024.0 * 1024.0),
                    item.path
                ).map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(save_path.to_string())
}
