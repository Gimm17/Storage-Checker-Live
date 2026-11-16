// src-tauri/src/db/seed.rs
// Storage Checker Live - Pre-seeded Risk Rules Knowledge Base (PRD § 7.1, § 12)

use rusqlite::{Connection, Result};

pub struct SeedRule {
    pub id: &'static str,
    pub pattern_name: &'static str,
    pub category: &'static str,
    pub default_risk_level: &'static str,
    pub origin_explanation: &'static str,
    pub deletion_impact: &'static str,
    pub special_action: Option<&'static str>,
}

pub const DEFAULT_RISK_RULES: &[SeedRule] = &[
    // 1. AI & IDE Cache / Scratchpad
    SeedRule {
        id: "RULE_AI_GEMINI",
        pattern_name: "Gemini & Antigravity Context Scratchpad",
        category: "AI_IDE",
        default_risk_level: "SAFE",
        origin_explanation: "AI agent context scratchpad, session histories, and transient diff snapshots.",
        deletion_impact: "Safe to delete. Agent will re-init fresh context on next launch.",
        special_action: None,
    },
    SeedRule {
        id: "RULE_AI_CURSOR",
        pattern_name: "Cursor IDE Workspace Cache & Index",
        category: "AI_IDE",
        default_risk_level: "CAUTION",
        origin_explanation: "Cursor IDE workspace indexing, language server cache, and debug logs.",
        deletion_impact: "Safe, but Cursor will re-index projects on next open (brief CPU spike).",
        special_action: None,
    },
    SeedRule {
        id: "RULE_AI_OLLAMA",
        pattern_name: "Ollama Local Model Weights",
        category: "AI_IDE",
        default_risk_level: "CAUTION",
        origin_explanation: "Locally downloaded open LLM weights (multi-GB files).",
        deletion_impact: "Deleting frees massive space, but models must be re-downloaded via ollama run.",
        special_action: None,
    },

    // 2. Development Dependencies & Build Artifacts
    SeedRule {
        id: "RULE_DEV_NODE_MODULES",
        pattern_name: "Node.js Dependencies (node_modules)",
        category: "DEV_DEPS",
        default_risk_level: "CAUTION",
        origin_explanation: "JavaScript/TypeScript third-party dependencies installed via npm/pnpm/yarn.",
        deletion_impact: "Safe to delete. Reinstall anytime with npm install or pnpm install.",
        special_action: None,
    },
    SeedRule {
        id: "RULE_DEV_TARGET",
        pattern_name: "Rust Cargo Target Build Artifacts",
        category: "DEV_DEPS",
        default_risk_level: "CAUTION",
        origin_explanation: "Rust incremental build artifacts, debug binaries, and intermediate object files.",
        deletion_impact: "Safe to delete. Rebuilt on next cargo build (takes longer compile time).",
        special_action: None,
    },
    SeedRule {
        id: "RULE_DEV_VENV",
        pattern_name: "Python Virtual Environment (.venv)",
        category: "DEV_DEPS",
        default_risk_level: "CAUTION",
        origin_explanation: "Python virtual environment packages and local interpreter symlinks.",
        deletion_impact: "Recreatable using python -m venv and pip install -r requirements.txt.",
        special_action: None,
    },
    SeedRule {
        id: "RULE_DEV_PNPM_STORE",
        pattern_name: "PNPM Global Content-Addressable Store",
        category: "DEV_DEPS",
        default_risk_level: "CAUTION",
        origin_explanation: "Global hard-link package store for PNPM.",
        deletion_impact: "Deleting requires re-fetching packages over network on subsequent installs.",
        special_action: Some("PNPM_PRUNE"),
    },
    SeedRule {
        id: "RULE_DEV_NEXT",
        pattern_name: "Next.js Build Cache (.next)",
        category: "DEV_DEPS",
        default_risk_level: "CAUTION",
        origin_explanation: "Next.js compilation cache and optimized client/server page bundles.",
        deletion_impact: "Safe to delete. Rebuilt automatically on npm run dev or build.",
        special_action: None,
    },
    SeedRule {
        id: "RULE_DEV_GIT_PACK",
        pattern_name: "Bloated Git Object Packfiles",
        category: "DEV_DEPS",
        default_risk_level: "DANGER",
        origin_explanation: "Git repository history packfiles.",
        deletion_impact: "Deleting manually corrupts git history. Must optimize safely via Git GC.",
        special_action: Some("GIT_GC"),
    },

    // 3. Orphaned Temp & Scatter Files
    SeedRule {
        id: "RULE_ORPHAN_TEMP_STD",
        pattern_name: "Standard Temp Files (>24h)",
        category: "ORPHAN_TEMP",
        default_risk_level: "SAFE",
        origin_explanation: "Standard OS and application temporary scratch files older than 24 hours.",
        deletion_impact: "Safe to remove. Frees immediate disk space.",
        special_action: None,
    },
    SeedRule {
        id: "RULE_ORPHAN_SCATTER",
        pattern_name: "Orphaned Temp & Scatter Files Outside Temp",
        category: "ORPHAN_TEMP",
        default_risk_level: "SAFE",
        origin_explanation: "Scattered temporary files left behind by crashed tools, editors, or test runs outside standard temp.",
        deletion_impact: "Safe unless active database lockfile. Frees unmonitored project bloat.",
        special_action: None,
    },

    // 4. Virtualization & Containers
    SeedRule {
        id: "RULE_VIRT_VHDX",
        pattern_name: "WSL2 / Docker Virtual Hard Disk (VHDX)",
        category: "VIRTUALIZATION",
        default_risk_level: "DANGER",
        origin_explanation: "Virtual hard disk containing WSL2 Linux filesystem or Docker containers/images.",
        deletion_impact: "Do NOT delete raw file! Destroys all Linux environments & Docker data. Use Safe Compact instead.",
        special_action: Some("COMPACT_VHDX"),
    },
    SeedRule {
        id: "RULE_VIRT_AVD",
        pattern_name: "Android Virtual Device (AVD) Disk Image",
        category: "VIRTUALIZATION",
        default_risk_level: "CAUTION",
        origin_explanation: "Android Virtual Device emulator user storage and disk images.",
        deletion_impact: "Resets emulator to factory state. Wipeable via Android Studio AVD Manager.",
        special_action: None,
    },
];

pub const SEED_SQL: &str = r#"
INSERT INTO risk_rules (id, pattern_name, category, default_risk_level, origin_explanation, deletion_impact, special_action)
VALUES
('RULE_AI_GEMINI', 'Gemini & Antigravity Context Scratchpad', 'AI_IDE', 'SAFE', 'AI agent context scratchpad, session histories, and transient diff snapshots.', 'Safe to delete. Agent will re-init fresh context on next launch.', NULL),
('RULE_AI_CURSOR', 'Cursor IDE Workspace Cache & Index', 'AI_IDE', 'CAUTION', 'Cursor IDE workspace indexing, language server cache, and debug logs.', 'Safe, but Cursor will re-index projects on next open (brief CPU spike).', NULL),
('RULE_AI_OLLAMA', 'Ollama Local Model Weights', 'AI_IDE', 'CAUTION', 'Locally downloaded open LLM weights (multi-GB files).', 'Deleting frees massive space, but models must be re-downloaded via ollama run.', NULL),
('RULE_DEV_NODE_MODULES', 'Node.js Dependencies (node_modules)', 'DEV_DEPS', 'CAUTION', 'JavaScript/TypeScript third-party dependencies installed via npm/pnpm/yarn.', 'Safe to delete. Reinstall anytime with npm install or pnpm install.', NULL),
('RULE_DEV_TARGET', 'Rust Cargo Target Build Artifacts', 'DEV_DEPS', 'CAUTION', 'Rust incremental build artifacts, debug binaries, and intermediate object files.', 'Safe to delete. Rebuilt on next cargo build (takes longer compile time).', NULL),
('RULE_DEV_VENV', 'Python Virtual Environment (.venv)', 'DEV_DEPS', 'CAUTION', 'Python virtual environment packages and local interpreter symlinks.', 'Recreatable using python -m venv and pip install -r requirements.txt.', NULL),
('RULE_DEV_PNPM_STORE', 'PNPM Global Content-Addressable Store', 'DEV_DEPS', 'CAUTION', 'Global hard-link package store for PNPM.', 'Deleting requires re-fetching packages over network on subsequent installs.', 'PNPM_PRUNE'),
('RULE_DEV_NEXT', 'Next.js Build Cache (.next)', 'DEV_DEPS', 'CAUTION', 'Next.js compilation cache and optimized client/server page bundles.', 'Safe to delete. Rebuilt automatically on npm run dev or build.', NULL),
('RULE_ORPHAN_TEMP_STD', 'Standard Temp Files (>24h)', 'ORPHAN_TEMP', 'SAFE', 'Standard OS and application temporary scratch files older than 24 hours.', 'Safe to remove. Frees immediate disk space.', NULL),
('RULE_ORPHAN_SCATTER', 'Orphaned Temp & Scatter Files Outside Temp', 'ORPHAN_TEMP', 'SAFE', 'Scattered temporary files left behind by crashed tools, editors, or test runs outside standard temp.', 'Safe unless active database lockfile. Frees unmonitored project bloat.', NULL),
('RULE_VIRT_VHDX', 'WSL2 / Docker Virtual Hard Disk (VHDX)', 'VIRTUALIZATION', 'DANGER', 'Virtual hard disk containing WSL2 Linux filesystem or Docker containers/images.', 'Do NOT delete raw file! Destroys all Linux environments & Docker data. Use Safe Compact instead.', 'COMPACT_VHDX'),
('RULE_VIRT_AVD', 'Android Virtual Device (AVD) Disk Image', 'VIRTUALIZATION', 'CAUTION', 'Android Virtual Device emulator user storage and disk images.', 'Resets emulator to factory state. Wipeable via Android Studio AVD Manager.', NULL),
('RULE_DEV_GIT_PACK', 'Bloated Git Object Packfiles', 'DEV_DEPS', 'DANGER', 'Git repository history packfiles.', 'Deleting manually corrupts git history. Must optimize safely via Git GC.', 'GIT_GC')
ON CONFLICT(id) DO UPDATE SET
    pattern_name = excluded.pattern_name,
    category = excluded.category,
    default_risk_level = excluded.default_risk_level,
    origin_explanation = excluded.origin_explanation,
    deletion_impact = excluded.deletion_impact,
    special_action = excluded.special_action;
"#;

/// Idempotently seeds the 13 default risk rules into SQLite.
/// Uses ON CONFLICT(id) DO UPDATE to ensure existing databases receive updated rule metadata
/// across software updates without generating duplicate key errors.
pub fn seed_risk_rules(conn: &Connection) -> Result<usize> {
    conn.execute_batch(SEED_SQL)?;
    let count: usize = conn.query_row("SELECT COUNT(*) FROM risk_rules", [], |row| row.get(0))?;
    Ok(count)
}
