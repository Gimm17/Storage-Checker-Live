/**
 * Storage Checker Live - E2E Test Fixture Sandbox Harness
 * File: tests/e2e/harness/fixture-sandbox.ts
 *
 * Implements isolated fixture generation under %TEMP%\scl_e2e_sandbox_<runId>\
 * supporting all 11 PRD feature categories and bulletproof 3-phase teardown.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// ============================================================================
// 1. Interfaces & Types
// ============================================================================

export interface FixtureOptions {
  includeAiIdeBloat?: boolean;
  includeStandardTemp?: boolean;
  includeOrphanTemp?: boolean;
  includeDevDeps?: boolean;
  includeGitDirty?: boolean;
  includeEnvSecrets?: boolean;
  includeActiveDb?: boolean;
  includeSparseVhdx?: boolean;
  includeProcessLocks?: boolean;
  includeJunctions?: boolean;
  includeExtendedPaths?: boolean;
  includeAclRestrictions?: boolean;
}

export interface LockedProcessInfo {
  pid: number;
  filePath: string;
  process: ChildProcess;
}

export interface SandboxPaths {
  root: string;
  namespacedRoot: string;
  mockUserHome: string;
  mockWindowsTemp: string;
  mockProjects: string;
  mockVirtualization: string;
  mockLockedZone: string;
  mockSymlinksJunctions: string;
  mockPermissionRestricted: string;
}

// ============================================================================
// 2. FixtureSandbox Class Implementation
// ============================================================================

export class FixtureSandbox {
  public readonly runId: string;
  public readonly rootPath: string;
  public readonly paths: SandboxPaths;

  private lockedProcesses: LockedProcessInfo[] = [];
  private restrictedPaths: string[] = [];
  private isDestroyed = false;

  constructor(prefix = 'scl_e2e_sandbox') {
    this.runId = crypto.randomUUID().slice(0, 8);
    this.rootPath = path.join(os.tmpdir(), `${prefix}_${this.runId}`);

    this.paths = {
      root: this.rootPath,
      namespacedRoot: path.toNamespacedPath(path.resolve(this.rootPath)),
      mockUserHome: path.join(this.rootPath, 'mock_user_home'),
      mockWindowsTemp: path.join(this.rootPath, 'mock_windows_temp'),
      mockProjects: path.join(this.rootPath, 'mock_projects'),
      mockVirtualization: path.join(this.rootPath, 'mock_virtualization'),
      mockLockedZone: path.join(this.rootPath, 'mock_locked_zone'),
      mockSymlinksJunctions: path.join(this.rootPath, 'mock_symlinks_junctions'),
      mockPermissionRestricted: path.join(this.rootPath, 'mock_permission_restricted'),
    };
  }

  public get namespacedRoot(): string {
    return this.paths.namespacedRoot;
  }

  /**
   * Resolves a relative path segment inside this sandbox root.
   */
  public resolve(...segments: string[]): string {
    return path.join(this.rootPath, ...segments);
  }

  /**
   * Resolves a Windows namespaced path (\\?\) inside this sandbox root.
   */
  public namespaced(...segments: string[]): string {
    return path.toNamespacedPath(path.resolve(this.resolve(...segments)));
  }

  /**
   * Initializes the sandbox directory tree with specified fixture options.
   */
  public async init(options: FixtureOptions = {}): Promise<void> {
    fs.mkdirSync(this.namespacedRoot, { recursive: true });

    if (options.includeAiIdeBloat) this.generateAiIdeBloat();
    if (options.includeStandardTemp) this.generateStandardTemp();
    if (options.includeOrphanTemp) this.generateOrphanTemp();
    if (options.includeDevDeps) this.generateDevDeps();
    if (options.includeGitDirty) this.generateGitRepositories();
    if (options.includeEnvSecrets) this.generateSecretFiles();
    if (options.includeActiveDb) this.generateActiveSqliteDb();
    if (options.includeSparseVhdx) this.generateSparseVhdx();
    if (options.includeProcessLocks) await this.generateProcessLocks();
    if (options.includeJunctions) this.generateJunctions();
    if (options.includeExtendedPaths) this.generateExtendedPaths();
    if (options.includeAclRestrictions) this.generateAclRestrictions();
  }

  /**
   * Helper to generate all 11+ fixture categories in a single call.
   */
  public async generateAll(): Promise<void> {
    await this.init({
      includeAiIdeBloat: true,
      includeStandardTemp: true,
      includeOrphanTemp: true,
      includeDevDeps: true,
      includeGitDirty: true,
      includeEnvSecrets: true,
      includeActiveDb: true,
      includeSparseVhdx: true,
      includeProcessLocks: true,
      includeJunctions: true,
      includeExtendedPaths: true,
      includeAclRestrictions: true,
    });
  }

  // ==========================================================================
  // Category Generators (11+ Categories)
  // ==========================================================================

  /**
   * Category 1: AI / IDE Bloat (.gemini, .cursor, .vscode, .ollama)
   */
  public generateAiIdeBloat(): void {
    // 1. Gemini AI bloat
    const geminiBrain = path.join(this.paths.mockUserHome, '.gemini', 'antigravity', 'brain');
    fs.mkdirSync(geminiBrain, { recursive: true });
    fs.writeFileSync(path.join(geminiBrain, 'session_cache.json'), JSON.stringify({ history: ['prompt_1', 'prompt_2'] }, null, 2));
    fs.writeFileSync(path.join(geminiBrain, 'memory_blobs.bin'), Buffer.alloc(1024 * 50)); // 50 KB

    // 2. Cursor IDE bloat
    const cursorExt = path.join(this.paths.mockUserHome, '.cursor', 'extensions', 'mock-author.ext-1.0.0');
    const cursorStorage = path.join(this.paths.mockUserHome, '.cursor', 'User', 'workspaceStorage', 'workspace-123');
    fs.mkdirSync(cursorExt, { recursive: true });
    fs.mkdirSync(cursorStorage, { recursive: true });
    fs.writeFileSync(path.join(cursorExt, 'cache.bin'), Buffer.alloc(1024 * 100)); // 100 KB
    fs.writeFileSync(path.join(cursorStorage, 'state.vscdb'), Buffer.alloc(1024 * 64)); // 64 KB

    // 3. VSCode IDE bloat
    const vscodeExt = path.join(this.paths.mockUserHome, '.vscode', 'extensions', 'mock-pub.theme-0.5.0');
    const vscodeCli = path.join(this.paths.mockUserHome, '.vscode', 'cli', 'servers', 'Stable-abc123');
    fs.mkdirSync(vscodeExt, { recursive: true });
    fs.mkdirSync(vscodeCli, { recursive: true });
    fs.writeFileSync(path.join(vscodeExt, 'package.json'), JSON.stringify({ name: 'mock-theme' }));
    fs.writeFileSync(path.join(vscodeCli, 'server.log'), 'Server started on port 3000\n');

    // 4. Ollama model blob
    const ollamaBlobs = path.join(this.paths.mockUserHome, '.ollama', 'models', 'blobs');
    const ollamaManifests = path.join(this.paths.mockUserHome, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library', 'llama3');
    fs.mkdirSync(ollamaBlobs, { recursive: true });
    fs.mkdirSync(ollamaManifests, { recursive: true });

    const blobFile = path.join(ollamaBlobs, 'sha256-mockblob-1234567890abcdef');
    this.createSparseFile(blobFile, 100 * 1024 * 1024); // 100 MB sparse
    fs.writeFileSync(path.join(ollamaManifests, 'latest'), JSON.stringify({ schemaVersion: 2, layers: [] }));
  }

  /**
   * Category 2: Standard Temp Zones (AppData/Local/Temp, Windows/Temp)
   */
  public generateStandardTemp(): void {
    const userTemp = path.join(this.paths.mockUserHome, 'AppData', 'Local', 'Temp');
    const winTemp = this.paths.mockWindowsTemp;

    fs.mkdirSync(userTemp, { recursive: true });
    fs.mkdirSync(winTemp, { recursive: true });

    fs.writeFileSync(path.join(userTemp, 'valid_in_temp_installer_123.tmp'), Buffer.alloc(1024 * 10)); // 10 KB
    fs.writeFileSync(path.join(userTemp, 'setup_bootstrapper.log'), 'Installer initialization complete.\n');
    fs.writeFileSync(path.join(winTemp, 'win_update_dism.log'), 'DISM package staging completed.\n');
    fs.writeFileSync(path.join(winTemp, 'cab_unpack_archive.tmp'), Buffer.alloc(1024 * 15)); // 15 KB
  }

  /**
   * Category 3: Orphaned Temp Outside Temp (Desktop, Documents, Projects)
   */
  public generateOrphanTemp(): void {
    const desktop = path.join(this.paths.mockUserHome, 'Desktop');
    const documents = path.join(this.paths.mockUserHome, 'Documents');
    const project = path.join(this.paths.mockProjects, 'clean_npm_app');

    fs.mkdirSync(desktop, { recursive: true });
    fs.mkdirSync(documents, { recursive: true });
    fs.mkdirSync(project, { recursive: true });

    fs.writeFileSync(path.join(desktop, 'memory_crash.dmp'), Buffer.alloc(1024 * 100)); // .dmp crash dump
    fs.writeFileSync(path.join(desktop, 'orphaned_scratch.tmp'), 'temporary calculation scratchpad');
    fs.writeFileSync(path.join(documents, 'mock_notes.txt'), 'Important project notes');
    fs.writeFileSync(path.join(project, 'npm_debug_error.log'), 'npm ERR! code ELIFECYCLE\n');
    fs.writeFileSync(path.join(project, 'database_backup.bak'), Buffer.alloc(1024 * 50)); // .bak backup
  }

  /**
   * Category 4: Dev Dependencies & Caches (node_modules, target, .venv, __pycache__)
   */
  public generateDevDeps(): void {
    // 1. Mock Node/NPM Project
    const npmDir = path.join(this.paths.mockProjects, 'clean_npm_app');
    const nodeModules = path.join(npmDir, 'node_modules');
    fs.mkdirSync(path.join(nodeModules, 'express'), { recursive: true });
    fs.mkdirSync(path.join(nodeModules, '.cache', 'babel-loader'), { recursive: true });
    fs.writeFileSync(path.join(npmDir, 'package.json'), JSON.stringify({ name: 'clean-npm-app', version: '1.0.0' }, null, 2));
    fs.writeFileSync(path.join(nodeModules, 'express', 'package.json'), JSON.stringify({ name: 'express', version: '4.18.2' }));
    fs.writeFileSync(path.join(nodeModules, 'express', 'index.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(nodeModules, '.cache', 'babel-loader', 'cache.bin'), Buffer.alloc(1024 * 50));

    // 2. Mock Rust Project
    const rustDir = path.join(this.paths.mockProjects, 'rust_target_app');
    const targetDir = path.join(rustDir, 'target', 'debug', 'incremental', 'mock_app_123');
    fs.mkdirSync(path.join(rustDir, 'src'), { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(rustDir, 'Cargo.toml'), '[package]\nname = "rust_target_app"\nversion = "0.1.0"\n');
    fs.writeFileSync(path.join(rustDir, 'src', 'main.rs'), 'fn main() { println!("Hello"); }');
    fs.writeFileSync(path.join(targetDir, 'bin_artifact.o'), Buffer.alloc(1024 * 100));

    // 3. Mock Python Virtualenv Project
    const pyDir = path.join(this.paths.mockProjects, 'python_venv_app');
    const venvSite = path.join(pyDir, '.venv', 'Lib', 'site-packages', 'urllib3');
    const pycache = path.join(pyDir, '__pycache__');
    fs.mkdirSync(venvSite, { recursive: true });
    fs.mkdirSync(pycache, { recursive: true });
    fs.writeFileSync(path.join(pyDir, 'app.py'), 'print("Python App")\n');
    fs.writeFileSync(path.join(pyDir, '.venv', 'pyvenv.cfg'), 'home = C:\\Python310\nversion = 3.10.0\n');
    fs.writeFileSync(path.join(venvSite, '__init__.py'), '# urllib3\n');
    fs.writeFileSync(path.join(pycache, 'main.cpython-310.pyc'), Buffer.alloc(1024 * 20));
  }

  /**
   * Category 5: Git Repositories (clean, dirty with uncommitted, stale >30d with pack bloat)
   */
  public generateGitRepositories(): void {
    // 1. Dirty Git Repo
    const dirtyDir = path.join(this.paths.mockProjects, 'dirty_git_app');
    fs.mkdirSync(dirtyDir, { recursive: true });
    try {
      execSync('git init -q', { cwd: dirtyDir, stdio: 'ignore' });
      execSync('git config user.name "E2E Bot"', { cwd: dirtyDir, stdio: 'ignore' });
      execSync('git config user.email "bot@example.com"', { cwd: dirtyDir, stdio: 'ignore' });

      const readme = path.join(dirtyDir, 'README.md');
      fs.writeFileSync(readme, '# Initial Repository Commit\n');
      fs.writeFileSync(path.join(dirtyDir, 'package.json'), JSON.stringify({ name: 'dirty-git-app' }));
      execSync('git add README.md package.json', { cwd: dirtyDir, stdio: 'ignore' });
      execSync('git commit -q -m "Initial commit"', { cwd: dirtyDir, stdio: 'ignore' });

      // Make uncommitted changes
      fs.writeFileSync(readme, '# Modified uncommitted content!\n');
      fs.writeFileSync(path.join(dirtyDir, 'untracked_scratch.txt'), 'untracked dirty file content');
    } catch {
      // Fallback for non-git environments: create standard .git folder layout
      const gitDir = path.join(dirtyDir, '.git');
      fs.mkdirSync(gitDir, { recursive: true });
      fs.writeFileSync(path.join(dirtyDir, 'package.json'), JSON.stringify({ name: 'dirty-git-app' }));
      fs.writeFileSync(path.join(dirtyDir, 'README.md'), '# Modified uncommitted content!\n');
      fs.writeFileSync(path.join(dirtyDir, 'untracked_scratch.txt'), 'untracked dirty file content');
    }

    // 2. Stale Cloned Repo (> 30 days old) with bloated .git/objects/pack (> 200 MB)
    const staleDir = path.join(this.paths.mockProjects, 'bloated_git_repo');
    const packDir = path.join(staleDir, '.git', 'objects', 'pack');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(path.join(staleDir, 'package.json'), JSON.stringify({ name: 'bloated-git-repo' }));

    const dummyPack = path.join(packDir, 'pack-mock1234567890abcdef.pack');
    const dummyIdx = path.join(packDir, 'pack-mock1234567890abcdef.idx');
    this.createSparseFile(dummyPack, 250 * 1024 * 1024); // 250 MB sparse packfile
    fs.writeFileSync(dummyIdx, Buffer.alloc(1024));

    // Age modification timestamp to 45 days ago
    const pastDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    try {
      fs.utimesSync(dummyPack, pastDate, pastDate);
      fs.utimesSync(staleDir, pastDate, pastDate);
    } catch { /* ignore */ }
  }

  /**
   * Category 6: Secret Files (.env, .env.production)
   */
  public generateSecretFiles(): void {
    const envDir = path.join(this.paths.mockProjects, 'sensitive_env_app');
    const nodeModules = path.join(envDir, 'node_modules', 'chalk');
    fs.mkdirSync(nodeModules, { recursive: true });

    fs.writeFileSync(path.join(envDir, 'package.json'), JSON.stringify({ name: 'sensitive-env-app' }));
    fs.writeFileSync(path.join(nodeModules, 'index.js'), 'module.exports = {};');
    fs.writeFileSync(
      path.join(envDir, '.env'),
      'DATABASE_URL="postgresql://postgres:secret123@localhost:5432/production"\nAPI_SECRET_KEY="sk-live-mock-998877"\n'
    );
    fs.writeFileSync(
      path.join(envDir, '.env.production'),
      'AWS_ACCESS_KEY_ID="AKIAIOSFODNN7EXAMPLE"\nAWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"\n'
    );
  }

  /**
   * Category 7: Active SQLite DB Transaction Files (.sqlite, .db-wal, .db-shm + adjacent .tmp)
   */
  public generateActiveSqliteDb(): void {
    const dbDir = path.join(this.paths.mockProjects, 'active_sqlite_app');
    fs.mkdirSync(dbDir, { recursive: true });

    const dbPath = path.join(dbDir, 'app.db');

    // Create WAL SQLite database using Node 24 native DatabaseSync
    try {
      const db = new DatabaseSync(dbPath);
      db.exec('PRAGMA journal_mode=WAL;');
      db.exec('CREATE TABLE IF NOT EXISTS cache_entries (id TEXT PRIMARY KEY, payload TEXT);');
      db.exec('INSERT INTO cache_entries VALUES ("entry_1", "active_in_flight_data");');
      db.close();
    } catch {
      fs.writeFileSync(dbPath, 'SQLite format 3\x00');
    }

    // Ensure transaction sibling files exist
    const walFile = path.join(dbDir, 'app.db-wal');
    const shmFile = path.join(dbDir, 'app.db-shm');
    if (!fs.existsSync(walFile)) {
      fs.writeFileSync(walFile, Buffer.alloc(1024));
    }
    if (!fs.existsSync(shmFile)) {
      fs.writeFileSync(shmFile, Buffer.alloc(1024));
    }

    // Place adjacent .tmp file (< 24h old) to test EC-03 Active DB downgrade guard
    const adjacentTmp = path.join(dbDir, 'cache_query_active.tmp');
    fs.writeFileSync(adjacentTmp, 'in-flight database query temporary results');
    const now = new Date();
    try {
      fs.utimesSync(adjacentTmp, now, now);
    } catch { /* ignore */ }
  }

  /**
   * Category 8: Sparse Virtual Disk Containers (.vhdx) via fsutil sparse
   */
  public generateSparseVhdx(): void {
    const vhdxDir = this.paths.mockVirtualization;
    fs.mkdirSync(vhdxDir, { recursive: true });

    const ext4Vhdx = path.join(vhdxDir, 'ext4.vhdx');
    const dockerVhdx = path.join(vhdxDir, 'docker_data.vhdx');

    // 5 GB sparse WSL2 disk
    this.createSparseFile(ext4Vhdx, 5 * 1024 * 1024 * 1024);

    // 10 GB sparse Docker disk
    this.createSparseFile(dockerVhdx, 10 * 1024 * 1024 * 1024);
  }

  /**
   * Category 9: Win32 Exclusive Process Locked Files (dwShareMode = 0)
   */
  public generateProcessLocks(): Promise<void> {
    return new Promise((resolve, reject) => {
      const lockDir = this.paths.mockLockedZone;
      fs.mkdirSync(lockDir, { recursive: true });

      const lockedLog = path.join(lockDir, 'in_use_service.log');
      fs.writeFileSync(lockedLog, 'Active daemon log written by background service.\n');

      const escapedTarget = lockedLog.replace(/'/g, "''");
      const psScript = `
param($target)
$ErrorActionPreference = 'Stop'
try {
  $stream = [System.IO.File]::Open($target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  Write-Output 'LOCKED_READY'
  [Console]::Out.Flush()
  $null = [Console]::In.ReadLine()
} catch {
  Write-Error $_
} finally {
  if ($stream) { $stream.Close(); $stream.Dispose() }
}
`;

      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `& { ${psScript} } -target '${escapedTarget}'`],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        }
      );

      let timeout: NodeJS.Timeout;

      const onData = (data: Buffer) => {
        if (data.toString().includes('LOCKED_READY')) {
          clearTimeout(timeout);
          this.lockedProcesses.push({
            pid: child.pid!,
            filePath: lockedLog,
            process: child,
          });
          resolve();
        }
      };

      child.stdout?.on('data', onData);
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      timeout = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        reject(new Error('Timeout awaiting LOCKED_READY from PowerShell process lock'));
      }, 5000);
    });
  }

  /**
   * Category 10: NTFS Directory Junctions & Recursive Loops (mklink /J)
   */
  public generateJunctions(): void {
    const juncBase = this.paths.mockSymlinksJunctions;
    const targetDir = path.join(juncBase, 'real_target');
    const safeJunction = path.join(juncBase, 'junction_safe');
    const loopSubfolder = path.join(juncBase, 'loop_subfolder');
    const loopJunction = path.join(loopSubfolder, 'infinite_loop_junction');

    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(loopSubfolder, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'real_data.txt'), 'authentic target payload');

    try {
      // Safe junction pointing to target folder
      execSync(`cmd.exe /c mklink /J "${safeJunction}" "${targetDir}"`, { stdio: 'ignore' });

      // Recursive loop junction pointing back to ancestor directory
      execSync(`cmd.exe /c mklink /J "${loopJunction}" "${juncBase}"`, { stdio: 'ignore' });
    } catch {
      // If junction creation is disabled in specific Windows policy, ignore gracefully
    }
  }

  /**
   * Category 11: Extended-Length Paths (>260 chars up to 32k chars via path.toNamespacedPath)
   */
  public generateExtendedPaths(): void {
    let deepDir = path.join(this.paths.mockProjects, 'deep_long_path_app');
    for (let i = 0; i < 25; i++) {
      deepDir = path.join(deepDir, `sub_level_${i.toString().padStart(2, '0')}`);
    }

    const namespacedDeep = path.toNamespacedPath(path.resolve(deepDir));
    fs.mkdirSync(namespacedDeep, { recursive: true });

    const deepFile = path.join(namespacedDeep, 'deep_orphan_asset.tmp');
    fs.writeFileSync(deepFile, 'deeply nested orphan file exceeding MAX_PATH 260 chars');
  }

  /**
   * Category 12: Permission-Denied ACL Directories (icacls /deny)
   */
  public generateAclRestrictions(): void {
    const restrictedDir = path.join(this.paths.mockPermissionRestricted, 'denied_folder');
    fs.mkdirSync(restrictedDir, { recursive: true });
    fs.writeFileSync(path.join(restrictedDir, 'inaccessible.sys'), 'protected kernel binary');

    try {
      // Deny Everyone access
      execSync(`icacls.exe "${restrictedDir}" /deny "Everyone:(OI)(CI)(F)"`, { stdio: 'ignore' });
      this.restrictedPaths.push(restrictedDir);
    } catch {
      // Ignore if user account does not support icacls deny
    }
  }

  // ==========================================================================
  // Helper Methods & Teardown Protocol
  // ==========================================================================

  /**
   * Creates an NTFS sparse file of the given size in bytes (physical size = 0).
   */
  private createSparseFile(filePath: string, sizeBytes: number): void {
    try {
      execSync(`fsutil file createnew "${filePath}" ${sizeBytes}`, { stdio: 'ignore' });
      execSync(`fsutil sparse setflag "${filePath}"`, { stdio: 'ignore' });
      execSync(`fsutil sparse setrange "${filePath}" 0 ${sizeBytes}`, { stdio: 'ignore' });
    } catch {
      // Safe fallback: truncate without physical allocation
      try {
        const fd = fs.openSync(filePath, 'w');
        try {
          fs.ftruncateSync(fd, sizeBytes);
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        fs.writeFileSync(filePath, Buffer.alloc(1024));
      }
    }
  }

  /**
   * Returns metadata on currently running lock child processes.
   */
  public getLockingProcesses(): { pid: number; filePath: string }[] {
    return this.lockedProcesses.map((p) => ({ pid: p.pid, filePath: p.filePath }));
  }

  /**
   * Executes the 3-Phase Teardown Protocol.
   */
  public async destroy(): Promise<void> {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // ------------------------------------------------------------------------
    // Phase 1: Terminate all child processes holding file locks
    // ------------------------------------------------------------------------
    for (const info of this.lockedProcesses) {
      try {
        if (!info.process.killed) {
          info.process.stdin?.write('\n');
          info.process.stdin?.end();
          info.process.kill('SIGKILL');
          try {
            execSync(`taskkill /F /PID ${info.pid}`, { stdio: 'ignore' });
          } catch { /* already dead */ }
        }
      } catch { /* ignore */ }
    }
    this.lockedProcesses = [];

    // Allow Win32 file handles to close
    await new Promise((r) => setTimeout(r, 150));

    // ------------------------------------------------------------------------
    // Phase 2: Reset ACLs & clear read-only file attributes
    // ------------------------------------------------------------------------
    for (const resPath of this.restrictedPaths) {
      try {
        execSync(`icacls.exe "${resPath}" /remove:d "Everyone"`, { stdio: 'ignore' });
      } catch { /* ignore */ }
    }
    this.restrictedPaths = [];

    try {
      execSync(`attrib.exe -r -s -h "${this.rootPath}\\*" /s /d`, { stdio: 'ignore' });
    } catch { /* ignore */ }

    // ------------------------------------------------------------------------
    // Phase 3: Recursive unlinking using namespaced paths & junction safety
    // ------------------------------------------------------------------------
    if (fs.existsSync(this.namespacedRoot)) {
      try {
        fs.rmSync(this.namespacedRoot, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
      } catch {
        // Fallback using PowerShell if a transient handle lingers
        try {
          execSync(
            `powershell.exe -NoProfile -Command "Remove-Item -LiteralPath '${this.rootPath}' -Recurse -Force -ErrorAction SilentlyContinue"`,
            { stdio: 'ignore' }
          );
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Async disposable interface support (using `await using` syntax).
   */
  public async [Symbol.asyncDispose](): Promise<void> {
    await this.destroy();
  }

  /**
   * Static helper ensuring guaranteed execution and teardown.
   */
  public static async withSandbox(
    options: FixtureOptions,
    fn: (sandbox: FixtureSandbox) => Promise<void>
  ): Promise<void> {
    const sandbox = new FixtureSandbox();
    try {
      await sandbox.init(options);
      await fn(sandbox);
    } finally {
      await sandbox.destroy();
    }
  }
}
