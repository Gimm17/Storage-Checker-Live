/**
 * tests/e2e/harness/win32-verifier.ts
 *
 * Windows 11 Win32 system effect verifiers:
 * 1. Win32 Exclusive File Lock utility (FileShare.None / ERROR_SHARING_VIOLATION).
 * 2. Windows COM Recycle Bin verifier (Shell.Application Namespace 10 / ssfBITBUCKET).
 * 3. Extended long path normalization (\\?\) and junction point detection helpers.
 */

import { spawn, spawnSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// 1. Win32 Exclusive File Lock Utility
// ---------------------------------------------------------------------------

export interface ExclusiveLockHandle {
  readonly filePath: string;
  readonly pid: number;
  /**
   * Checks whether the file is currently locked by attempting to open it in Node.
   */
  isLocked: () => boolean;
  /**
   * Gracefully releases the lock by closing PowerShell stdin.
   */
  release: () => Promise<void>;
  /**
   * Forcibly terminates the locking child process.
   */
  kill: () => void;
}

/**
 * Spawns an external PowerShell background process that opens `filePath` with
 * [System.IO.FileShare]::None, producing Win32 Error 32 (ERROR_SHARING_VIOLATION).
 *
 * This allows testing Tauri's Restart Manager process lock detector (SKIPPED_LOCKED).
 */
export async function acquireExclusiveLock(
  filePath: string,
  timeoutMs: number = 5000
): Promise<ExclusiveLockHandle> {
  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`[acquireExclusiveLock] Target file does not exist: ${resolvedPath}`);
  }

  // PowerShell script opens file with FileShare.None and holds handle open until stdin input or termination
  const escapedTarget = resolvedPath.replace(/'/g, "''");
  const psScript = `
param($target)
$ErrorActionPreference = 'Stop'
try {
  $stream = [System.IO.File]::Open($target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
  Write-Output "LOCK_ACQUIRED_OK"
  [Console]::Out.Flush()
  # Wait for release signal from Node parent
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

  const pid = child.pid!;

  return new Promise<ExclusiveLockHandle>((resolve, reject) => {
    let acquired = false;
    let errOutput = '';

    const timer = setTimeout(() => {
      if (!acquired) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        reject(
          new Error(
            `[acquireExclusiveLock] Timed out after ${timeoutMs}ms waiting for lock on '${resolvedPath}'. Error: ${errOutput}`
          )
        );
      }
    }, timeoutMs);

    child.stdout.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('LOCK_ACQUIRED_OK')) {
        acquired = true;
        clearTimeout(timer);

        const handle: ExclusiveLockHandle = {
          filePath: resolvedPath,
          pid,
          isLocked: () => {
            try {
              const fd = fs.openSync(resolvedPath, 'r+');
              fs.closeSync(fd);
              return false;
            } catch (err: any) {
              return err.code === 'EBUSY' || err.code === 'EPERM';
            }
          },
          release: async () => {
            return new Promise<void>((res) => {
              if (child.killed || child.exitCode !== null) {
                res();
                return;
              }
              child.on('close', () => res());
              try {
                child.stdin.write('\n');
                child.stdin.end();
              } catch {
                try { child.kill('SIGKILL'); } catch { /* ignore */ }
              }
            });
          },
          kill: () => {
            try {
              child.kill('SIGKILL');
            } catch {
              // Ignore already terminated
            }
          },
        };

        resolve(handle);
      }
    });

    child.stderr.on('data', (d: Buffer) => {
      errOutput += d.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (!acquired) {
        reject(new Error(`PowerShell lock process exited prematurely with code ${code}. Stderr: ${errOutput}`));
      }
    });
  });
}

/**
 * Asserts that a file is currently locked by a process (throws EBUSY).
 */
export function assertFileLocked(filePath: string): void {
  const resolved = path.resolve(filePath);
  try {
    const fd = fs.openSync(resolved, 'r+');
    fs.closeSync(fd);
    assert.fail(`[assertFileLocked] File '${resolved}' was opened successfully; expected Win32 sharing lock violation!`);
  } catch (err: any) {
    assert.ok(
      err.code === 'EBUSY' || err.code === 'EPERM' || String(err.message).includes('busy'),
      `Expected EBUSY/EPERM lock error, but received code: '${err.code}' message: '${err.message}'`
    );
  }
}

/**
 * Asserts that a file is free and not locked by any process.
 */
export function assertFileNotLocked(filePath: string): void {
  const resolved = path.resolve(filePath);
  try {
    const fd = fs.openSync(resolved, 'r+');
    fs.closeSync(fd);
  } catch (err: any) {
    assert.fail(`[assertFileNotLocked] File '${resolved}' is locked: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Windows COM Recycle Bin Verifier (`Shell.Application`)
// ---------------------------------------------------------------------------

export interface RecycleBinItem {
  name: string;
  originalLocation: string;
  dateDeleted: string;
  size: string;
}

export class RecycleBinVerifier {
  /**
   * Queries the total number of items in the Windows Recycle Bin via Shell.Application.
   */
  public static getItemCount(): number {
    const psCmd = `
& {
  $s = New-Object -ComObject Shell.Application
  $b = $s.Namespace(10)
  Write-Output $b.Items().Count
}
`;
    const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
      encoding: 'utf8',
    });

    if (res.error) throw res.error;
    const count = parseInt(res.stdout.trim(), 10);
    return isNaN(count) ? 0 : count;
  }

  /**
   * Enumerates all items in the Recycle Bin with Name and Original Location.
   */
  public static getItems(): RecycleBinItem[] {
    const psCmd = `
& {
  $s = New-Object -ComObject Shell.Application
  $b = $s.Namespace(10)
  $items = @()
  foreach ($item in $b.Items()) {
    $obj = [PSCustomObject]@{
      name = $item.Name
      originalLocation = $b.GetDetailsOf($item, 1)
      dateDeleted = $b.GetDetailsOf($item, 2)
      size = $b.GetDetailsOf($item, 3)
    }
    $items += $obj
  }
  $items | ConvertTo-Json -Compress
}
`;
    const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
      encoding: 'utf8',
    });

    if (res.error) throw res.error;
    const output = res.stdout.trim();
    if (!output || output === 'null') return [];

    try {
      const parsed = JSON.parse(output);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  /**
   * Finds an item in the Recycle Bin matching filename and optional original parent directory.
   */
  public static findItem(fileName: string, originalDir?: string): RecycleBinItem | null {
    const items = this.getItems();
    const targetName = path.basename(fileName).toLowerCase();
    const normDir = originalDir ? path.resolve(originalDir).toLowerCase() : null;

    for (const item of items) {
      if (item.name.toLowerCase() === targetName) {
        if (!normDir) return item;
        const itemDir = path.resolve(item.originalLocation).toLowerCase();
        if (itemDir === normDir || itemDir.startsWith(normDir)) {
          return item;
        }
      }
    }
    return null;
  }

  /**
   * Asserts that a file was moved to the Windows Recycle Bin.
   */
  public static assertItemInRecycleBin(fileName: string, originalDir?: string): void {
    const item = this.findItem(fileName, originalDir);
    assert.ok(
      item !== null,
      `[RecycleBinVerifier] File '${fileName}' ${
        originalDir ? `from '${originalDir}' ` : ''
      }was not found in Windows Recycle Bin!`
    );
  }

  /**
   * Asserts that a file was NOT moved to the Windows Recycle Bin (e.g. permanent deletion).
   */
  public static assertItemNotInRecycleBin(fileName: string, originalDir?: string): void {
    const item = this.findItem(fileName, originalDir);
    assert.ok(
      item === null,
      `[RecycleBinVerifier] File '${fileName}' was unexpectedly found in Windows Recycle Bin!`
    );
  }

  /**
   * Clears the Windows Recycle Bin (used in teardown if needed).
   */
  public static emptyRecycleBin(): void {
    spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue'],
      { stdio: 'ignore' }
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Extended Paths & Junction Point Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a standard Windows path to an extended-length namespaced path (\\?\ prefix).
 */
export function toExtendedPath(targetPath: string): string {
  return path.toNamespacedPath(path.resolve(targetPath));
}

/**
 * Checks whether a path starts with the Win32 extended-length prefix.
 */
export function isExtendedPath(targetPath: string): boolean {
  return targetPath.startsWith('\\\\?\\');
}

/**
 * Verifies whether a given path is an NTFS directory junction or reparse point.
 */
export function isJunction(targetPath: string): boolean {
  try {
    const resolved = path.resolve(targetPath);
    const stats = fs.lstatSync(resolved);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Safely creates an NTFS directory junction point using `mklink /J`.
 */
export function createJunction(junctionPath: string, targetPath: string): void {
  const normJunction = path.resolve(junctionPath);
  const normTarget = path.resolve(targetPath);

  if (fs.existsSync(normJunction)) {
    throw new Error(`[createJunction] Junction destination already exists: ${normJunction}`);
  }

  try {
    execSync(`cmd.exe /c mklink /J "${normJunction}" "${normTarget}"`, { stdio: 'pipe' });
  } catch (err: any) {
    throw new Error(`[createJunction] Failed to create junction: ${err.stderr?.toString() || err.message}`);
  }
}

/**
 * Safely removes a junction point without deleting files inside the target directory.
 */
export function removeJunction(junctionPath: string): void {
  const normJunction = path.resolve(junctionPath);
  if (isJunction(normJunction)) {
    fs.rmdirSync(normJunction);
  }
}
