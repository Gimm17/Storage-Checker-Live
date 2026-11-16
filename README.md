<div align="center">

# 💾 Storage Checker Live

### Lightweight Windows Disk Bloat Monitor, Risk Analyzer & Session Recap

[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)](https://v2.tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-Core-orange?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![SQLite](https://img.shields.io/badge/SQLite-rusqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)

*Track disk bloat spikes during coding and AI agent sessions, inspect actual size-on-disk safely, and reclaim gigabytes with multi-layer protection.*

</div>

---

## ✨ Key Features

- **Real-Time Watcher & Spike Detection** — Lightweight background monitoring via Rust watcher (`src-tauri/src/watcher/`) with Windows Toast notifications.
- **Multi-Threaded Deep Explorer** — Fast traversal powered by `jwalk` and `rayon`, computing true disk allocation using Win32 `GetCompressedFileSizeW` / `GetDiskFreeSpaceW`.
- **Orphaned Temp & Hidden Bloat Finder** — Surfaces scattered `.tmp`, `.bak`, `.dmp`, IDE/AI caches, dependency artifacts, and container virtual disks (`VHDX` / WSL2 / AVD).
- **3-Tier Risk Engine & Safety Guards**
  - Classifies findings into `Safe`, `Caution`, and `Danger` with human-readable explanations.
  - Built-in **Protected System Path Whitelist**, **Git Dirty Check** (`git_guard.rs`), and Win32 **Restart Manager Process Lock Check** (`process_lock.rs`).
- **Safe Cleanup & Special Actions** — Moves files to Recycle Bin (`trash`) by default, plus dedicated tools for `git gc` and `VHDX` compaction.
- **Session Diff & Recap Center** — Compares disk usage before and after coding sessions with persisted SQLite history (`rusqlite`) and structured export (`recap/export.rs`).

---

## 🏗️ Tech Stack & Architecture

| Layer | Technology |
| :--- | :--- |
| **Desktop Shell** | Tauri v2 (WebView2, Administrator Manifest) |
| **Core Engine** | Rust (`jwalk`, `rayon`, `rusqlite`, `trash`, `sysinfo`, `windows-sys`) |
| **Frontend UI** | React 19, TypeScript, Tailwind CSS v4, Zustand, `@tanstack/react-virtual`, Lucide Icons |
| **Testing** | Vitest / E2E Harness (`tests/e2e/`) |

```text
Storage-Checker-Live/
├── src/                        # React 19 + TypeScript UI
│   ├── App.tsx                 # Main workspace shell & tab router
│   ├── store/useAppStore.ts    # Zustand state management
│   ├── types/ipc.ts            # Tauri IPC contracts
│   └── components/
│       ├── overview/           # OverviewDashboard
│       ├── explorer/           # DeepExplorer
│       ├── orphan/             # OrphanTempView
│       ├── recap/              # RecapCenter
│       ├── cleanup/            # CleanupQueueModal
│       └── layout/             # Header & Sidebar
├── src-tauri/                  # Rust backend core
│   ├── src/
│   │   ├── watcher/            # Background disk monitor
│   │   ├── scanner/            # Multithreaded traversal, size-on-disk, orphan temp
│   │   ├── risk/               # Risk engine, git guard, system whitelist
│   │   ├── cleaner/            # Recycle bin executor & Win32 process lock checks
│   │   ├── session/            # Session baseline & diff analyzer
│   │   ├── special/            # git gc & VHDX compaction helpers
│   │   ├── recap/              # Session recap export
│   │   └── db/                 # SQLite schema, models & seeding
│   ├── app.manifest            # Windows requireAdministrator manifest
│   └── tauri.conf.json
└── tests/e2e/                  # Adversarial stress & harness tests
```

---

## 🚀 Development & Build

### Prerequisites
- [Node.js](https://nodejs.org/) 20+ & `pnpm`
- [Rust](https://rustup.rs/) + MSVC Build Tools & WebView2 (Windows 10/11)

### Commands
```bash
# Install frontend dependencies
pnpm install

# Run in Tauri development mode
pnpm tauri dev

# Build frontend only (typecheck + Vite)
pnpm run build

# Build production Windows installer & executable
pnpm tauri build
```

See [`PRD.md`](./PRD.md) and [`TEST_INFRA.md`](./TEST_INFRA.md) for full product specs and test infrastructure details.
