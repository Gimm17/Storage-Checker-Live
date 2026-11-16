// src-tauri/src/cleaner/process_lock.rs
// Storage Checker Live - Win32 Restart Manager Process Lock Detector

use std::path::Path;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[derive(Debug, Clone)]
pub struct ProcessLockInfo {
    pub is_locked: bool,
    pub locking_process_name: Option<String>,
    pub locking_pid: Option<u32>,
}

/// Checks if a file or directory is actively locked by a running process on Windows
/// using the native Win32 Restart Manager API (`rstrtmgr.dll`).
pub fn check_process_lock<P: AsRef<Path>>(path: P) -> ProcessLockInfo {
    #[cfg(windows)]
    {
        let path = path.as_ref();
        if !path.exists() {
            return ProcessLockInfo {
                is_locked: false,
                locking_process_name: None,
                locking_pid: None,
            };
        }

        let mut session_handle: u32 = 0;
        let mut session_key = [0u16; 33]; // CCH_RM_SESSION_KEY + 1

        let start_res = unsafe {
            windows_sys::Win32::System::RestartManager::RmStartSession(
                &mut session_handle,
                0,
                session_key.as_mut_ptr(),
            )
        };

        if start_res != 0 {
            return ProcessLockInfo {
                is_locked: false,
                locking_process_name: None,
                locking_pid: None,
            };
        }

        let wide_path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let file_paths = [wide_path.as_ptr()];

        let reg_res = unsafe {
            windows_sys::Win32::System::RestartManager::RmRegisterResources(
                session_handle,
                1,
                file_paths.as_ptr(),
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
            )
        };

        if reg_res != 0 {
            unsafe { windows_sys::Win32::System::RestartManager::RmEndSession(session_handle) };
            return ProcessLockInfo {
                is_locked: false,
                locking_process_name: None,
                locking_pid: None,
            };
        }

        let mut n_proc_info_needed: u32 = 0;
        let mut n_proc_info: u32 = 0;
        let mut reboot_reasons: u32 = 0;

        // First probe: determine number of locking processes
        let _ = unsafe {
            windows_sys::Win32::System::RestartManager::RmGetList(
                session_handle,
                &mut n_proc_info_needed,
                &mut n_proc_info,
                std::ptr::null_mut(),
                &mut reboot_reasons,
            )
        };

        if n_proc_info_needed == 0 {
            unsafe { windows_sys::Win32::System::RestartManager::RmEndSession(session_handle) };
            return ProcessLockInfo {
                is_locked: false,
                locking_process_name: None,
                locking_pid: None,
            };
        }

        // Allocate buffer and retrieve locking process details
        let mut process_info = vec![
            windows_sys::Win32::System::RestartManager::RM_PROCESS_INFO {
                Process: windows_sys::Win32::System::RestartManager::RM_UNIQUE_PROCESS {
                    dwProcessId: 0,
                    ProcessStartTime: windows_sys::Win32::Foundation::FILETIME {
                        dwLowDateTime: 0,
                        dwHighDateTime: 0,
                    },
                },
                strAppName: [0u16; 256],
                strServiceShortName: [0u16; 64],
                ApplicationType: 0,
                AppStatus: 0,
                TSSessionId: 0,
                bRestartable: 0,
            };
            n_proc_info_needed as usize
        ];

        n_proc_info = n_proc_info_needed;
        let get_res = unsafe {
            windows_sys::Win32::System::RestartManager::RmGetList(
                session_handle,
                &mut n_proc_info_needed,
                &mut n_proc_info,
                process_info.as_mut_ptr(),
                &mut reboot_reasons,
            )
        };

        unsafe { windows_sys::Win32::System::RestartManager::RmEndSession(session_handle) };

        if get_res == 0 && n_proc_info > 0 {
            let first = &process_info[0];
            let pid = first.Process.dwProcessId;
            let name_len = first.strAppName.iter().position(|&c| c == 0).unwrap_or(256);
            let proc_name = String::from_utf16_lossy(&first.strAppName[..name_len]);

            let final_name = if proc_name.trim().is_empty() {
                format!("PID {}", pid)
            } else {
                proc_name
            };

            return ProcessLockInfo {
                is_locked: true,
                locking_process_name: Some(final_name),
                locking_pid: Some(pid),
            };
        }
    }

    ProcessLockInfo {
        is_locked: false,
        locking_process_name: None,
        locking_pid: None,
    }
}
