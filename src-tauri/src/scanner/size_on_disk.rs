// src-tauri/src/scanner/size_on_disk.rs
// Storage Checker Live - Win32 Physical Size-on-Disk Calculator

use std::path::Path;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

/// Calculates the physical size on disk for a file.
/// On Windows, queries `GetCompressedFileSizeW` to account for sparse files and NTFS compression.
pub fn calculate_file_size_on_disk<P: AsRef<Path>>(path: P, logical_size: u64) -> u64 {
    #[cfg(windows)]
    {
        let wide: Vec<u16> = path.as_ref().as_os_str().encode_wide().chain(Some(0)).collect();
        let mut high: u32 = 0;
        let low = unsafe {
            windows_sys::Win32::Storage::FileSystem::GetCompressedFileSizeW(wide.as_ptr(), &mut high)
        };

        if low != u32::MAX || unsafe { windows_sys::Win32::Foundation::GetLastError() } == 0 {
            let actual = ((high as u64) << 32) | (low as u64);
            return actual;
        }
    }

    // Fallback: round up to nearest standard 4KB NTFS cluster
    let cluster_size: u64 = 4096;
    if logical_size == 0 {
        0
    } else {
        ((logical_size + cluster_size - 1) / cluster_size) * cluster_size
    }
}
